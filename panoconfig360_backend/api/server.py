# api/server.py
import os
import json
import logging
import shutil
import time
import tempfile
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Body
from panoconfig360_backend.render.dynamic_stack import load_config, stack_layers
from panoconfig360_backend.render.split_faces_cubemap import process_cubemap
from panoconfig360_backend.render.stack_2d import render_stack_2d
from panoconfig360_backend.render.resolve_2d_assets import resolve_2d_base, resolve_2d_overlay
from panoconfig360_backend.models.render_2d import Render2DRequest
from panoconfig360_backend.storage.storage_local import exists, upload_file
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

# CONFIGURAÇÕES GLOBAIS
ROOT_DIR = Path(__file__).resolve().parents[1].parent
CONFIG_URL = ROOT_DIR / "panoconfig360_frontend/pano/config.json"
LOCAL_CACHE_DIR = ROOT_DIR / "panoconfig360_cache"
FRONTEND_DIR = ROOT_DIR / "panoconfig360_frontend"
os.makedirs(LOCAL_CACHE_DIR, exist_ok=True)
project, layers = None, None
tile_pattern = "{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg"


def get_tile_key(build, face, lod, x, y):
    tile_root = project.get(
        "tileRoot", "cubemap/tiles").rstrip("/")
    return f"{tile_root}/{tile_pattern}" \
        .replace("{BUILD}", build) \
        .replace("{FACE}", face) \
        .replace("{LOD}", str(lod)) \
        .replace("{X}", str(x)) \
        .replace("{Y}", str(y))


logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

last_request_time = 0.0
lock = threading.Lock()
MIN_INTERVAL = 1.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global project, layers, tile_pattern

    try:
        logging.info(f"Carregando configuração do projeto de {CONFIG_URL}...")
        project, layers, naming = load_config(CONFIG_URL)

        tile_pattern = (
            naming.get("tilePattern")
            or project.get("naming", {}).get("tilePattern", tile_pattern)
            if naming or project else tile_pattern
        )

        logging.info(
            f"✅ Configuração carregada: {len(layers) if layers is not None else 0} camadas detectadas."
        )
        logging.info(f"🎨 Padrão de tiles ativo: {tile_pattern}")

    except Exception:
        logging.exception("❌ Falha ao carregar configuração do CDN:")
        project, layers = None, None
        tile_pattern = "{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg"

    yield

    logging.info("🧹 Encerrando aplicação — limpando recursos se necessário.")

app = FastAPI(lifespan=lifespan)

app.mount(
    "/panoconfig360_cache",
    StaticFiles(directory=LOCAL_CACHE_DIR),
    name="panoconfig360_cache"
)
app.mount(
    "/static",
    StaticFiles(directory=FRONTEND_DIR),
    name="static"
)

app.mount(
    "/pano",
    StaticFiles(directory=FRONTEND_DIR / "pano"),
    name="pano"
)

app.mount(
    "/css",
    StaticFiles(directory=FRONTEND_DIR / "css"),
    name="css"
)


@app.post("/api/render")
def render_cubemap(payload: dict = Body(...), request: Request = None):
    origin = request.headers.get("origin") if request else None
    logging.info(f"🌐 Requisição recebida de origem: {origin}")

    # ⏱️ RATE LIMIT
    now = time.monotonic()
    with lock:
        global last_request_time
        if now - last_request_time < MIN_INTERVAL:
            raise HTTPException(
                status_code=429,
                detail="Muitas requisições — aguarde um instante antes de tentar novamente."
            )
        last_request_time = now

    # ✅ VALIDAÇÕES INICIAIS
    if project is None or layers is None:
        raise HTTPException(
            status_code=500, detail="Configuração do projeto não carregada")

    build = payload.get("build")
    selection = payload.get("selection")

    if not build or not selection:
        raise HTTPException(
            status_code=400, detail="build ou selection ausente")

    # 🔍 VERIFICAÇÃO DE CACHE NO R2 (ANTES DE QUALQUER PROCESSAMENTO)
    tile_root = project.get("tileRoot", "cubemap/tiles").rstrip("/")
    metadata_key = f"{tile_root}/{build}.json"

    logging.info(f"🔍 Verificando cache no R2: {metadata_key}")

    if exists(metadata_key):
        logging.info(f"✅ Build {build} encontrado no R2. Retornando cache.")
        return {
            "status": "cached",
            "build": build,
            "tileRoot": tile_root,
            "message": "Tiles já existem no CDN, consumir diretamente."
        }

    logging.info(f"🆕 Build {build} não existe no R2. Iniciando geração...")

    # 🏗️ PROCESSAMENTO (SOMENTE SE NÃO EXISTIR NO CACHE)
    start = time.monotonic()
    tmp_dir = tempfile.mkdtemp(prefix=f"{build}_")
    logging.info(f"📁 Diretório temporário criado: {tmp_dir}")

    try:
        # 1️⃣ Empilha camadas (gera imagem combinada em memória)
        logging.info("🖼️ Gerando stack de camadas...")
        stack_img, build_str = stack_layers(project, layers, selection)
        if not build_str:
            build_str = str(build)

        # 2️⃣ Gera tiles do cubemap (salva temporariamente em disco)
        logging.info("🧩 Dividindo cubemap em tiles...")
        process_cubemap(stack_img, tmp_dir, tile_size=512,
                        level=0, build=build_str)

        # 3️⃣ Libera memória da imagem após gerar tiles
        del stack_img
        logging.info("🧹 Memória da imagem liberada.")

        # 4️⃣ Faz upload de cada tile para o cache local
        logging.info("📤 Iniciando upload dos tiles para o cache local...")
        uploaded_count = 0

        for filename in os.listdir(tmp_dir):
            if not filename.lower().endswith(".jpg"):
                continue

            file_path = os.path.join(tmp_dir, filename)
            key = f"{tile_root}/{filename}"

            try:
                upload_file(file_path, key, "image/jpeg")
                uploaded_count += 1
                logging.info(f"📤 Upload concluído: {key}")
            except Exception:
                logging.exception(f"❌ Falha ao fazer upload: {filename}")

        logging.info(f"📤 {uploaded_count} tiles enviados para o cache local.")

        # 5️⃣ Publica metadados SOMENTE se pelo menos 1 tile foi enviado
        if uploaded_count > 0:
            meta = {
                "build": build_str,
                "tileRoot": tile_root,
                "tiles_count": uploaded_count,
                "generated_at": int(time.time()),
                "status": "ready",
            }
            meta_path = os.path.join(tmp_dir, f"{build_str}.json")

            with open(meta_path, "w", encoding="utf-8") as meta_file:
                json.dump(meta, meta_file)

            try:
                upload_file(meta_path, metadata_key, "application/json")
                logging.info(f"📤 Upload de metadata concluído: {metadata_key}")
            except Exception:
                logging.exception(
                    f"Falha ao fazer upload dos metadados {meta_path} -> {metadata_key}"
                )
        else:
            logging.warning(
                f"⚠️ Nenhum tile enviado para build={build_str}; não publicando metadata."
            )

        elapsed = time.monotonic() - start
        logging.info(
            f"✅ Render completo em {elapsed:.2f}s — Build: {build_str}")

        return {
            "status": "generated",
            "build": build_str,
            "tileRoot": tile_root,
            "tiles_count": uploaded_count,
            "elapsed_seconds": round(elapsed, 2),
            "message": "Tiles gerados e enviados para o CDN." if uploaded_count > 0
            else "Processo concluído sem tiles — verifique entradas."
        }

    except HTTPException:
        raise
    except Exception as e:
        logging.exception("❌ Erro inesperado durante o processamento:")
        raise HTTPException(
            status_code=500, detail=f"Erro interno ao processar render: {str(e)}")

    finally:
        # 6️⃣ LIMPEZA: Remove diretório temporário (libera disco)
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            logging.info(f"🧹 Diretório temporário removido: {tmp_dir}")
        except Exception:
            logging.exception(f"⚠️ Falha ao remover: {tmp_dir}")


@app.post("/api/render2d")
def render_2d(payload: Render2DRequest):
    build = payload.buildString
    selection = payload.selection

    cdn_key = f"renders/2d/{build}.jpg"

    # cache-first
    if exists(cdn_key):
        print(f"✅ Imagem 2D para build {build} encontrada no cache.")
        return {
            "status": "cached",
            "url": f"{os.getenv('CDN_BASE')}/{cdn_key}"
        }
    base_path = resolve_2d_base()

    ordered_layers = sorted(layers, key=lambda l: l.get("build_order", 0))
    overlays = []


    for layer in ordered_layers:
        layer_id = layer["id"]
        item_id = selection.get(layer_id)

        if not item_id:
            continue

        # acha o item no config
        item_def = next(
            (i for i in layer.get("items", []) if i["id"] == item_id),
            None
        )

        # 🔑 regra oficial do config.json
        if not item_def or item_def.get("file") is None:
            continue

        overlays.append({
            "path": resolve_2d_overlay(layer_id, item_def["file"])
        })

    output = "/tmp/render_2d.jpg"

    render_stack_2d(
        base_image_path=base_path,
        layers=overlays,
        output_path=output
    )

    upload_file(output, cdn_key, "image/jpeg")

    return {
        "status": "generated",
        "url": f"{os.getenv('CDN_BASE')}/{cdn_key}"
    }


@app.get("/")
def serve_frontend():
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(
            status_code=404, detail="index.html não encontrado")
    return FileResponse(index_path)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "panoconfig360-backend", "version": "0.0.1"}
