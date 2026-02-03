import os
import json
import logging
from pathlib import Path
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


# ======================================================
# 📦 CONFIG LOADER
# ======================================================

def load_config(config_path):
    if isinstance(config_path, Path):
        config_path = str(config_path)

    if config_path.startswith("http"):
        raise RuntimeError("Config remoto não permitido em modo offline")

    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config não encontrado: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    scenes = config.get("scenes")

    # fallback v1 (single scene)
    if not scenes:
        scenes = {
            "default": {
                "scene_index": 0,
                "layers": config.get("layers", []),
                "base_image": config.get("base_image"),
            }
        }

    naming = config.get("naming", {})
    return config, scenes, naming


# ======================================================
# 🔢 BUILD STRING
# ======================================================

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
        layer_id = layer["id"]
        selected_id = selection.get(layer_id)

        # 1️⃣ nada selecionado → posição neutra
        if not selected_id:
            index = 0
        else:
            item = next(
                (i for i in layer.get("items", []) if i["id"] == selected_id),
                None
            )

            # 2️⃣ item não encontrado → neutro (defensivo)
            if not item:
                index = 0
            else:
                # 3️⃣ index vem SEMPRE do JSON (catálogo)
                index = item["index"]

        if base == 16:
            value = format(index, f"0{chars}x")
        else:
            value = base36_encode(index, chars)

        result.append(value)

    return "".join(result)


# ======================================================
# 🧩 STACK DE IMAGENS (CORE)
# ======================================================

def stack_layers(
    scene_id: str,
    layers: list,
    selection: dict,
    assets_root: Path,
    config_string_base: int = 36,
    build_chars: int = 2
):
    """
    Empilha base + overlays da cena atual.
    assets_root: raiz da cena (ex: assets/scenes/kitchen)
    """

    base_image_name = f"base_{scene_id}.jpg"
    base_path = assets_root / base_image_name

    if not base_path.exists():
        raise FileNotFoundError(f"Imagem base não encontrada: {base_path}")

    missing_overlays = []

    with Image.open(base_path).convert("RGBA") as base:
        for layer in sorted(layers, key=lambda x: x.get("build_order", 0)):
            layer_id = layer["id"]
            item_id = selection.get(layer_id)

            item_id = selection.get(layer_id)

            # 1️⃣ nada selecionado → ignora layer
            if not item_id:
                continue

            item = next(
                (i for i in layer.get("items", []) if i["id"] == item_id),
                None
            )

            # 2️⃣ item inválido → ignora
            if not item:
                continue

            # 3️⃣ regra vinda do JSON: file null = sem overlay
            if item.get("file") is None:
                continue

            # 4️⃣ naming REAL do filesystem
            file_name = f"{layer_id}_{item_id}.png"

            overlay_path = assets_root / "layers" / layer_id / file_name

            # 5️⃣ aqui sim é erro real
            if not overlay_path.exists():
                missing_overlays.append((layer_id, file_name))
                continue

            with Image.open(overlay_path).convert("RGBA") as overlay:
                base.alpha_composite(overlay)

        if missing_overlays:
            raise RuntimeError(f"Overlays ausentes: {missing_overlays}")

        build_string = build_string_from_selection(
            layers,
            selection,
            base=36,
            chars=2
        )

        logging.info(f"✅ Stack gerado em memória: {build_string}")
        return base.convert("RGB"), build_string
