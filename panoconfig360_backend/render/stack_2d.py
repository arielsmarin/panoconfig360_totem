from PIL import Image


def render_stack_2d(
    base_image_path: str,
    layers: list,
    output_path: str
):
    """
    Empilha imagens 2D (base + overlays) e salva JPG final.
    layers: lista já ORDENADA, cada item contém { "path": "..." }
    """

    base = Image.open(base_image_path).convert("RGBA")
    base_size = base.size  # (width, height)

    for layer in layers:
        overlay = Image.open(layer["path"]).convert("RGBA")

        # 🔒 correção crítica (não quebra nada)
        if overlay.size != base_size:
            overlay = overlay.resize(base_size, Image.BICUBIC)

        base = Image.alpha_composite(base, overlay)

    base.convert("RGB").save(output_path, "JPEG", quality=95)
    print(f"Imagem final salva em: {output_path}")
