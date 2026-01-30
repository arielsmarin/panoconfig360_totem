# =========================
# V2 helpers (config único por cliente)
# source/clients/{client}/config.json
# =========================

# def load_client_config(client_id: str) -> dict:
#     key = f"source/clients/{client_id}/config.json"
#     cfg = get_json(key)

#     if not isinstance(cfg, dict):
#         raise ValueError(f"Config inválido para client: {client_id}")
#     return cfg


# def resolve_base_image_key(client_id: str, scene_id: str) -> str:
#     key = f"source/clients/{client_id}/scenes/{scene_id}/base_{scene_id}.jpg"
#     if not exists(key):
#         raise ValueError(
#             f"Base image não encontrada no Storage R2: {key} "
#             f"(regra: base_{scene_id}.jpg)"
#         )
#     return key


# def resolve_scene_config(client_cfg: dict, scene_id: str) -> dict:
#     scenes = client_cfg.get("scenes", {})
#     if not scenes:
#         raise ValueError("Config do cliente não possui 'scenes'")

#     # formato recomendado: dict
#     if isinstance(scenes, dict):
#         scene_cfg = scenes.get(scene_id)
#         if not scene_cfg:
#             raise ValueError(
#                 f"Cena '{scene_id}' não encontrada no config do cliente")
#         return scene_cfg

#     # fallback: list
#     if isinstance(scenes, list):
#         for s in scenes:
#             if s.get("id") == scene_id:
#                 return s
#         raise ValueError(
#             f"Cena '{scene_id}' não encontrada no config do cliente")

#     raise ValueError("cfg.scenes inválido (esperado dict ou list)")


# def normalize_scene_for_stack(client_id: str, scene_id: str, scene_cfg: dict):
#     """
#     Normaliza a cena para o motor de empilhamento (stack).

#     Regras:
#     - NÃO usa project.baseImageKey (base é determinística: base_{scene}.jpg)
#     - NÃO depende de item.file nem gera overlayKey aqui
#     - O dynamic_stack resolve overlays com:
#         source/clients/{client}/scenes/{scene}/layers/{layerId}/{layerId}_{itemId}.png
#     """

#     # project mínimo necessário pro stack v2
#     project = {
#         "client": client_id,
#         "scene": scene_id,

#         # mantém compatibilidade com build_string_from_selection()
#         # se não existir no JSON, cai no default do dynamic_stack (36, 2)
#         "configStringBase": scene_cfg.get("configStringBase", 36),
#         "buildChars": scene_cfg.get("buildChars", 2),
#     }

#     layers = scene_cfg.get("layers") or []
#     if not isinstance(layers, list):
#         raise ValueError("scene_cfg.layers inválido (esperado list)")

#     normalized_layers = []

#     for layer in layers:
#         layer_id = layer.get("id")
#         if not layer_id:
#             continue

#         items = layer.get("items") or []
#         if not isinstance(items, list):
#             items = []

#         normalized_items = []
#         for it in items:
#             item_id = it.get("id")
#             if not item_id:
#                 continue

#             # mantém o item como está (sem inventar overlayKey)
#             # overlay será resolvido pelo dynamic_stack por naming determinístico
#             normalized_items.append({**it})

#         normalized_layers.append(
#             {
#                 "id": layer_id,
#                 "label": layer.get("label", layer_id),
#                 "build_order": int(layer.get("build_order", 0)),
#                 "items": normalized_items,
#             }
#         )

#     # BUG FIX: retornar normalized_layers (não layers)
#     return project, normalized_layers


# # =========================
# # V2 endpoint (client + scene)
# # =========================
# @app.post("/api/v2/render")
# def render_cubemap_v2(payload: dict = Body(...), request: Request = None):
#     origin = request.headers.get("origin") if request else None
#     logging.info(f"🌐 [v2] Requisição recebida de origem: {origin}")

#     client = payload.get("client")
#     scene = payload.get("scene")

#     selection = payload.get("selection")

#     # selection pode ser {} (válido)
#     if not client or not scene or selection is None:
#         raise HTTPException(
#             status_code=400, detail="client, scene ou selection ausente")

#     if not isinstance(selection, dict):
#         raise HTTPException(
#             status_code=400, detail="selection precisa ser um objeto (dict)")

#     # 1) carrega config único do cliente + resolve cena
#     try:
#         client_cfg = load_client_config(client)
#         scene_cfg = resolve_scene_config(client_cfg, scene)
#         project_v2, layers_v2 = normalize_scene_for_stack(
#             client, scene, scene_cfg)
#     except Exception as e:
#         raise HTTPException(status_code=400, detail=str(e))

#     # 2) gera stack + build
#     try:
#         stack_img, build_str = stack_layers_from_r2(
#             project_v2, layers_v2, selection)
#     except Exception as e:
#         logging.exception("❌ [v2] Erro no stack_layers_from_r2")
#         raise HTTPException(status_code=500, detail=str(e))

#     tile_root = f"tiles/clients/{client}/scenes/{scene}".rstrip("/")
#     metadata_key = f"{tile_root}/{build_str}.json"

#     logging.info(f"🔍 [v2] Verificando cache no R2: {metadata_key}")

#     # 3) cache
#     if exists(metadata_key):
#         logging.info(f"✅ [v2] Cache hit: {metadata_key}")
#         return {
#             "status": "cached",
#             "build": build_str,
#             "tileRoot": tile_root,
#             "message": "Tiles já existem no CDN."
#         }

#     # 4) gerar tiles localmente
#     start = time.monotonic()
#     tmp_dir = tempfile.mkdtemp(prefix=f"{client}_{scene}_{build_str}_")
#     logging.info(f"📁 [v2] Diretório temporário criado: {tmp_dir}")

#     try:
#         process_cubemap(stack_img, tmp_dir, tile_size=512,
#                         level=0, build=build_str)
#         del stack_img

#         uploaded_count = 0
#         for filename in os.listdir(tmp_dir):
#             if not filename.lower().endswith(".jpg"):
#                 continue

#             file_path = os.path.join(tmp_dir, filename)
#             key = f"{tile_root}/{filename}"

#             upload_file(file_path, key, "image/jpeg")
#             uploaded_count += 1

#         meta = {
#             "client": client,
#             "scene": scene,
#             "build": build_str,
#             "tileRoot": tile_root,
#             "tiles_count": uploaded_count,
#             "generated_at": int(time.time()),
#             "status": "ready",
#         }

#         meta_path = os.path.join(tmp_dir, f"{build_str}.json")
#         with open(meta_path, "w", encoding="utf-8") as f:
#             json.dump(meta, f)

#         upload_file(meta_path, metadata_key, "application/json")

#         elapsed = time.monotonic() - start
#         logging.info(f"✅ [v2] Render completo em {elapsed:.2f}s")

#         return {
#             "status": "generated",
#             "build": build_str,
#             "tileRoot": tile_root,
#             "tilesCount": uploaded_count
#         }

#     finally:
#         shutil.rmtree(tmp_dir, ignore_errors=True)
#         logging.info(f"🧹 [v2] Tmp apagado: {tmp_dir}")
