import os
import json
import logging
from pathlib import Path
from PIL import Image
from panoconfig360_backend.storage.storage_local import download_file

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

# Diretórios base
BASE_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = BASE_DIR / "assets"

# Diretórios para imagens panorâmicas e stacks temporários
PANO_DIR = BASE_DIR
STACKS_DIR = "/tmp/stacks"


def load_config(config_path):
    # Normaliza para string
    if isinstance(config_path, Path):
        config_path = str(config_path)

    # OFFLINE MODE: bloqueia HTTP
    if config_path.startswith("http"):
        raise RuntimeError("Config remoto não permitido em modo offline")

    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config não encontrado: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data["project"], data["layers"], data.get("naming", {})


def base36_encode(num: int, width: int = 2) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    result = ""
    while num:
        num, i = divmod(num, 36)
        result = chars[i] + result
    return (result or "0").zfill(width)


def build_string_from_selection(layers, selection, base=36, chars=2):
    result = []
    for layer in sorted(layers, key=lambda x: x.get("build_order", 0)):
        selected_id = selection.get(layer["id"])
        item = next((i for i in layer.get("items", [])
                    if i["id"] == selected_id), None)
        index = item["index"] if item else 0
        value = format(index, f"0{chars}x") if base == 16 else base36_encode(
            index, chars)
        result.append(value)
    return "".join(result)


def stack_layers(project, layers, selection):
    """Empilha imagens locais de /assets e retorna PIL.Image + build string."""
    base_path = os.path.join(ASSETS_DIR, project["baseImage"])
    if not os.path.exists(base_path):
        raise FileNotFoundError(f"Imagem base não encontrada: {base_path}")

    missing_overlays = []
    with Image.open(base_path).convert("RGBA") as base:
        for layer in sorted(layers, key=lambda x: x.get("build_order", 0)):
            item_id = selection.get(layer["id"])
            if not item_id:
                continue

            item = next((i for i in layer.get("items", [])
                        if i["id"] == item_id), None)
            if not item:
                continue

            file_name = item.get("file")
            if not file_name:
                continue  # item base ou item sem overlay

            overlay_path = os.path.join(
                ASSETS_DIR, "layers", layer["id"], file_name
            )
            if not os.path.exists(overlay_path):
                missing_overlays.append((layer["id"], item["file"]))
                continue

            with Image.open(overlay_path).convert("RGBA") as overlay:
                base.alpha_composite(overlay)

        if missing_overlays:
            raise RuntimeError(f"Overlays ausentes: {missing_overlays}")

        build_string = build_string_from_selection(
            layers, selection, project["configStringBase"], project["buildChars"]
        )

        logging.info(f"✅ Stack gerado em memória: {build_string}")
        return base.convert("RGB"), build_string


def resolve_base_key_v2(project: dict) -> str:
    client = project.get("client")
    scene = project.get("scene")
    if not client or not scene:
        raise ValueError("project precisa ter {client, scene} no v2")
    return f"source/clients/{client}/scenes/{scene}/base_{scene}.jpg"


def resolve_overlay_key_v2(project: dict, layer_id: str, item_id: str) -> str:
    client = project.get("client")
    scene = project.get("scene")
    if not client or not scene:
        raise ValueError("project precisa ter {client, scene} no v2")
    return f"source/clients/{client}/scenes/{scene}/layers/{layer_id}/{layer_id}_{item_id}.png"


def resolve_overlay_key(project: dict, layer: dict, item: dict) -> str | None:
    k = item.get("overlayKey")
    if k:
        return k

    k = item.get("fileKey") or item.get("imageKey")
    if k:
        return k

    layer_id = layer.get("id")
    item_id = item.get("id")
    if layer_id and item_id and project.get("client") and project.get("scene"):
        return resolve_overlay_key_v2(project, layer_id, item_id)

    return None

# Exemplo de uso:
# project, layers = load_config("path/to/config.json")
# selection = {"layer1": "itemA", "layer2": "itemB"}
# image, build_str = stack_layers(project, layers, selection)
