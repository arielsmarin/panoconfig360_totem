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
from panoconfig360_backend.models.render_2d import Render2DRequest
from panoconfig360_backend.storage.storage_local import exists, upload_file
from panoconfig360_backend.render.scene_context import resolve_scene_context
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

# CONFIGURAÇÕES GLOBAIS
ROOT_DIR = Path(__file__).resolve().parents[1].parent
CLIENTS_ROOT = Path("panoconfig360_backend/assets/clients")
LOCAL_CACHE_DIR = ROOT_DIR / "panoconfig360_cache"
FRONTEND_DIR = ROOT_DIR / "panoconfig360_frontend"
os.makedirs(LOCAL_CACHE_DIR, exist_ok=True)
project, layers = None, None
tile_pattern = "{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg"


# Carrega configuração do cliente padrão
def load_client_config(client_id: str):
    config_path = CLIENTS_ROOT / client_id / "config.json"

    if not config_path.exists():
        raise FileNotFoundError(
            f"Configuração do cliente '{client_id}' não encontrada em {config_path}.")

    project, scenes, naming = load_config(config_path)

    project["scenes"] = scenes
    project["client_id"] = client_id

    return project, naming


# Carrega configuração do cliente padrão
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
    logging.info("🚀 Iniciando backend STRATY")

    os.makedirs(LOCAL_CACHE_DIR, exist_ok=True)

    # apenas default
    global tile_pattern
    tile_pattern = "{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg"

    yield

    logging.info("🧹 Encerrando backend STRATY")


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


@app.post("/api/render", response_model=None)
def render_cubemap(
    payload: dict = Body(...),
    request: Request = None
):
    origin = request.headers.get("origin") if request else None
    logging.info(f"🌐 Requisição recebida de origem: {origin}")

    # ======================================================
    # ⏱️ RATE LIMIT (GLOBAL)
    # ======================================================
    now = time.monotonic()
    with lock:
        global last_request_time
        if now - last_request_time < MIN_INTERVAL:
            raise HTTPException(
                status_code=429,
                detail="Muitas requisições — aguarde um instante antes de tentar novamente."
            )
        last_request_time = now

    # ======================================================
    # ✅ VALIDAÇÕES INICIAIS DO PAYLOAD
    # ======================================================
    client_id = payload.get("client")
    scene_id = payload.get("scene")
    selection = payload.get("selection")

    if not client_id:
        raise HTTPException(400, "client ausente no payload")

    if not scene_id:
        raise HTTPException(400, "scene ausente no payload")

    if not selection or not isinstance(selection, dict):
        raise HTTPException(400, "selection ausente ou inválida")

    # ======================================================
    # 📦 CARREGA CONFIG DO CLIENTE
    # ======================================================
    try:
        project, _ = load_client_config(client_id)
        project["client_id"] = client_id

    except Exception as e:
        logging.exception("❌ Falha ao carregar config do cliente")
        raise HTTPException(500, f"Erro ao carregar config do cliente: {e}")

    # ======================================================
    # 🎬 RESOLVE CONTEXTO DA CENA
    # ======================================================
    try:
        ctx = resolve_scene_context(project, scene_id)
    except Exception as e:
        logging.exception("❌ Cena inválida")
        raise HTTPException(400, f"Cena inválida: {e}")

    scene_layers = ctx["layers"]
    assets_root = ctx["assets_root"]
    scene_index = ctx["scene_index"]

    # ======================================================
    # 🧮 GERA BUILD STRING REAL (COM CENA)
    # ======================================================
    stack_img, build_body = stack_layers(
        scene_id=scene_id,
        layers=scene_layers,
        selection=selection,
        assets_root=assets_root,
    )

    scene_prefix = format(scene_index, "02x")
    build_str = scene_prefix + build_body

    # ======================================================
    # 🔍 VERIFICAÇÃO DE CACHE (COM BUILD CORRETO)
    # ======================================================
    tile_root = f"cubemap/{client_id}/{scene_id}/tiles/{build_str}"
    metadata_key = f"{tile_root}/metadata.json"

    logging.info(f"🔍 Verificando cache local: {metadata_key}")

    if exists(metadata_key):
        logging.info(f"✅ Build {build_str} já existe no cache.")
        return {
            "status": "cached",
            "build": build_str,
            "tileRoot": tile_root,
            "message": "Tiles já existem no cache, consumir diretamente."
        }

    # ======================================================
    # 🏗️ PROCESSAMENTO
    # ======================================================
    start = time.monotonic()
    tmp_dir = tempfile.mkdtemp(prefix=f"{build_str}_")
    logging.info(f"📁 Diretório temporário criado: {tmp_dir}")

    try:
        logging.info("🧩 Gerando tiles do cubemap...")
        process_cubemap(
            stack_img,
            tmp_dir,
            tile_size=512,
            level=0,
            build=build_str
        )

        del stack_img
        logging.info("🧹 Memória do stack liberada.")

        # ==================================================
        # 📤 UPLOAD DOS TILES
        # ==================================================
        uploaded_count = 0

        for filename in os.listdir(tmp_dir):
            if not filename.lower().endswith(".jpg"):
                continue

            file_path = os.path.join(tmp_dir, filename)
            key = f"{tile_root}/{filename}"

            upload_file(file_path, key, "image/jpeg")
            uploaded_count += 1

        logging.info(f"📤 {uploaded_count} tiles enviados para o cache local.")

        # ==================================================
        # 🧾 METADATA
        # ==================================================
        if uploaded_count > 0:
            meta = {
                "client": client_id,
                "scene": scene_id,
                "build": build_str,
                "tileRoot": tile_root,
                "tiles_count": uploaded_count,
                "generated_at": int(time.time()),
                "status": "ready",
            }

            meta_path = os.path.join(tmp_dir, f"{build_str}.json")
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f)

            upload_file(meta_path, metadata_key, "application/json")

        elapsed = time.monotonic() - start
        logging.info(f"✅ Render concluído em {elapsed:.2f}s")

        return {
            "status": "generated",
            "client": client_id,
            "scene": scene_id,
            "build": build_str,
            "tileRoot": tile_root,
            "tiles_count": uploaded_count,
            "elapsed_seconds": round(elapsed, 2),
        }

    except Exception as e:
        logging.exception("❌ Erro durante render")
        raise HTTPException(500, f"Erro interno ao processar render: {e}")

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        logging.info(f"🧹 Diretório temporário removido: {tmp_dir}")


@app.post("/api/render2d")
def render_2d(payload: Render2DRequest):
    client_id = payload.client
    scene_id = payload.scene
    selection = payload.selection  # mantido por simetria
    build_string = payload.buildString  # JÁ EXISTE, NÃO RECALCULA

    cdn_key = f"renders/2d_{build_string}.jpg"

    if exists(cdn_key):
        logging.info(f"✅ Render 2D já existe no cache: {cdn_key}")
        return {
            "status": "cached",
            "client": client_id,
            "scene": scene_id,
            "build": build_string,
            "url": f"/panoconfig360_cache/{cdn_key}"
        }

    # resolve config do cliente
    project, _ = load_client_config(client_id)
    project["client_id"] = client_id

    # resolve cena (MESMA lógica do cubemap)
    ctx = resolve_scene_context(project, scene_id)
    assets_root = ctx["assets_root"]
    layers = ctx["layers"]

    # base 2D (MESMO caminho do cubemap, só muda o prefixo)
    base_path = assets_root / f"2d_base_{scene_id}.jpg"
    if not base_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Base 2D não encontrada: {base_path}"
        )

    ordered_layers = sorted(layers, key=lambda l: l.get("build_order", 0))
    overlays = []

    for layer in ordered_layers:
        layer_id = layer["id"]

        # item escolhido para essa layer (MESMA lógica do cubemap)
        item_id = selection.get(layer_id)

        # se for null, ignora (ex: baccarat)
        if not item_id:
            continue

        overlay_path = (
            assets_root
            / "layers"
            / layer_id
            / f"2d_{layer_id}_{item_id}.png"
        )

        if not overlay_path.exists():
            continue  # overlay opcional, igual cubemap

        overlays.append({"path": str(overlay_path)})

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        output = tmp.name

    render_stack_2d(
        base_image_path=str(base_path),
        layers=overlays,
        output_path=output
    )

    # 🔑 OUTPUT IGUAL AO CUBEMAP (prefixo 2d_)
    upload_file(output, cdn_key, "image/jpeg")
    os.remove(output)

    return {
        "status": "generated",
        "client": client_id,
        "scene": scene_id,
        "build": build_string,
        "url": f"/panoconfig360_cache/{cdn_key}"
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
