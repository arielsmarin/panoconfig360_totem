import Configurator from "./Configurator.js";
import { UIController } from "./UI.js";
import {
  CreateCameraController,
  CAMERA_POIS,
} from "./camera/CameraController.js";

// Carrega a configuração do projeto
let ProjectConfig = {};
try {
  const response = await fetch("/pano/config.json");
  ProjectConfig = await response.json();
} catch (err) {
  console.error("Failed to load config.json", err);
}

let pendingAutoLoadBuild = null;

// Gera o padrão de URL para tiles baseado na configuração do projeto
function getTileUrlPattern(cdnBase, tilePath, build) {
  // Exemplo: {BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg
  const pattern =
    ProjectConfig?.naming?.tilePattern || "{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg";
  // Força build como string para evitar "[object Object]"
  const buildStr = String(build);
  return `${cdnBase}/${tilePath}/${pattern}`
    .replace("{BUILD}", buildStr)
    .replace("{FACE}", "{f}")
    .replace("{LOD}", "{z}")
    .replace("{X}", "{x}")
    .replace("{Y}", "{y}");
}

(async () => {
  // Parâmetros de URL
  const urlParams = new URLSearchParams(window.location.search);
  const DEFAULT_BUILD = "0605030403";
  let INITIAL_BUILD = urlParams.get("build") || DEFAULT_BUILD;

  // URLs fixas de backend e CDN
  const API_BASE = "";
  const CDN_BASE = "/panoconfig360_cache";
  const TILE_PATH = "cubemap/tiles";

  // Carrega o configurador
  const configurator = new Configurator("/pano/config.json");
  await configurator.load();

  const expectedLength =
    configurator.layers.length * configurator.project.buildChars;
  if (
    !/^[0-9a-z]+$/i.test(INITIAL_BUILD) ||
    INITIAL_BUILD.length !== expectedLength
  ) {
    console.warn("Invalid or incomplete build string — reverting to default.");
    INITIAL_BUILD = DEFAULT_BUILD;
  }

  // Aplica a build string ao configurador
  function applyBuildToConfigurator(build) {
    const base = configurator.project.configStringBase;
    const chars = configurator.project.buildChars;

    configurator.layers.forEach((layer, index) => {
      const chunk = build.slice(index * chars, (index + 1) * chars);
      const itemIndex = base === 16 ? parseInt(chunk, 16) : parseInt(chunk, 36);
      const item = layer.items.find((i) => i.index === itemIndex);
      if (item) configurator.selectItem(layer.id, item.id);
    });
  }

  applyBuildToConfigurator(INITIAL_BUILD);

  configurator.getLayers().forEach((layer) => {
    if (!configurator.currentSelection[layer.id]) {
      const defaultItem = layer.items.find((i) => i.index === 0);
      if (defaultItem) configurator.selectItem(layer.id, defaultItem.id);
    }
  });

  const panoElement = document.getElementById("pano-config-api");
  const viewer = new Marzipano.Viewer(panoElement, {
    controls: { mouseViewMode: "drag" },
  });

  const SAVED_POI_KEY = "pano-camera-poi";
  const savedPoi = localStorage.getItem(SAVED_POI_KEY) || "island";
  const INITIAL_POI = CAMERA_POIS[savedPoi] || CAMERA_POIS.island;

  const view = new Marzipano.RectilinearView({
    yaw: INITIAL_POI.yaw,
    pitch: INITIAL_POI.pitch,
    fov: Math.PI / 2,
  });

  const CameraController = CreateCameraController(view);

  const geometry = new Marzipano.CubeGeometry([{ size: 1024, tileSize: 512 }]);

  // Helper: normaliza/valida build
  function getValidBuild(input) {
    const chars = configurator.project.buildChars;
    const len = configurator.layers.length * chars;
    let b = typeof input === "string" ? input : configurator.getBuildString();
    // Aceita [0-9a-z], tamanho exato
    if (!/^[0-9a-z]+$/i.test(b) || b.length !== len) {
      b = configurator.getBuildString();
    }
    return b;
  }

  // Cria uma cena de cubemap baseada na build string
  const createCubemapScene = (build) => {
    const b = getValidBuild(build);
    const tileUrl = getTileUrlPattern(CDN_BASE, TILE_PATH, b);
    const source = Marzipano.ImageUrlSource.fromString(tileUrl);
    return viewer.createScene({ source, geometry, view });
  };

  // Controle robusto de troca de cena para evitar "No such layer in stage"
  let currentScene = null;
  let isTransitioning = false;
  let pendingScene = null;
  let scenesToDestroy = [];

  function switchScene(nextScene, opts = {}) {
    const transitionDuration = opts.transitionDuration ?? 300;

    // Primeira cena
    if (!currentScene) {
      try {
        nextScene.switchTo({ transitionDuration: 0 });
        currentScene = nextScene;
      } catch (e) {
        console.error("Erro ao exibir cena inicial:", e);
      }
      return;
    }

    // Se já está em transição, enfileira a próxima cena
    if (isTransitioning) {
      if (pendingScene && pendingScene !== nextScene) {
        scenesToDestroy.push(pendingScene);
      }
      pendingScene = nextScene;
      return;
    }

    executeTransition(nextScene, transitionDuration);
  }

  function executeTransition(nextScene, transitionDuration) {
    isTransitioning = true;
    const prevScene = currentScene;
    currentScene = nextScene;

    try {
      viewer.stopMovement();
      viewer.setIdleMovement(null);
    } catch (e) {}

    try {
      nextScene.switchTo({ transitionDuration }, () => {
        onTransitionComplete(prevScene, transitionDuration);
      });
    } catch (e) {
      console.error("Erro ao fazer switchTo:", e);
      isTransitioning = false;
      processPendingScene();
    }
  }

  function onTransitionComplete(prevScene, transitionDuration) {
    // Atraso seguro para destruir a cena anterior
    if (prevScene) {
      const destroyDelay = Math.max(transitionDuration + 500, 800);
      setTimeout(() => {
        safeDestroyScene(prevScene);
      }, destroyDelay);
    }

    // Destrói cenas puladas por cliques rápidos
    scenesToDestroy.forEach((scene) => {
      setTimeout(() => safeDestroyScene(scene), 100);
    });
    scenesToDestroy = [];

    isTransitioning = false;
    processPendingScene();
  }

  function processPendingScene() {
    if (pendingScene) {
      const next = pendingScene;
      pendingScene = null;
      setTimeout(() => {
        switchScene(next, { transitionDuration: 300 });
      }, 50);
    }
  }

  function safeDestroyScene(scene) {
    if (!scene) return;
    if (scene === currentScene) return;
    if (scene === pendingScene) return;

    try {
      scene.destroy();
    } catch (e) {
      // Ignora erros esperados de cena já removida
      if (!e.message?.includes("No such layer")) {
        console.warn("Aviso ao destruir cena:", e.message);
      }
    }
  }

  // Verificação rápida no CDN — sempre usa build válido
  async function existsOnCDN(build) {
    const b = getValidBuild(build);

    const metadataUrl = `${CDN_BASE}/${TILE_PATH}/${b}.json`;
    const sampleTileUrl = getTileUrlPattern(CDN_BASE, TILE_PATH, b)
      .replace("{f}", "f")
      .replace("{z}", "0")
      .replace("{x}", "0")
      .replace("{y}", "0");

    try {
      const [metaRes, sampleRes] = await Promise.all([
        fetch(metadataUrl, { method: "HEAD" }),
        fetch(sampleTileUrl, { method: "HEAD" }),
      ]);
      return metaRes.ok && sampleRes.ok;
    } catch {
      return false;
    }
  }

  // 2) Fila de render em segundo plano: snapshot (deep clone) da seleção ao enfileirar
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const backgroundRenderQueue = [];
  const queuedBuilds = new Set();
  let queueRunning = false;

  function enqueueBackgroundRender(build, selection) {
    const b = getValidBuild(build);
    if (queuedBuilds.has(b)) return;

    // Snapshot da seleção para não “mudar” enquanto está na fila
    const selectionSnapshot = JSON.parse(JSON.stringify(selection));
    backgroundRenderQueue.push({ build: b, selection: selectionSnapshot });
    queuedBuilds.add(b);

    if (!queueRunning) processBackgroundQueue();
  }

  async function processBackgroundQueue() {
    queueRunning = true;
    while (backgroundRenderQueue.length) {
      const { build, selection } = backgroundRenderQueue.shift();
      try {
        // Evita render redundante (se ficou pronto enquanto esperava a fila)
        if (await existsOnCDN(build)) {
          console.log(
            `ℹ️ Build ${build} já disponível no CDN — pulando render.`,
          );
        } else {
          const res = await fetch(`${API_BASE}/api/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ build, selection }),
          });

          if (!res.ok) {
            console.warn(
              `Render backend retornou status ${res.status} para build ${build}`,
            );
          } else {
            // Poll: só considera pronto quando metadata e ao menos 1 tile existirem
            for (let attempt = 1; attempt <= 15; attempt++) {
              await sleep(2000);
              if (await existsOnCDN(build)) {
                console.log(
                  `✅ Tiles gerados para build ${build} e disponíveis no CDN.`,
                );
                if (pendingAutoLoadBuild === build) {
                  console.info(
                    `🔄 Carregando automaticamente o cubemap ${build}`,
                  );
                  showBuild(build, true); // força reload
                  pendingAutoLoadBuild = null;
                }
                break;
              }
            }
          }
        }
      } catch (e) {
        console.error(
          `Erro ao processar render em background para ${build}:`,
          e,
        );
      } finally {
        queuedBuilds.delete(build);
        // Respeita MIN_INTERVAL=1s do backend
        await sleep(1100);
      }
    }
    queueRunning = false;
  }

  // 3) Mostrar build: se não existe, enfileira render e retorna sem bloquear
  async function showBuild(next) {
    const build = getValidBuild(next);

    try {
      const hasTiles = await existsOnCDN(build);

      if (!hasTiles) {
        const selection = configurator.getCurrentSelection();
        enqueueBackgroundRender(build, selection);
        console.info(
          `🔄 Build ${build} não existe no CDN. Render em segundo plano enfileirado.`,
        );
        pendingAutoLoadBuild = build;
        return; // não troca cena; UI continua livre
      }

      const newScene = createCubemapScene(build);
      switchScene(newScene, { transitionDuration: 300 });
      history.replaceState(null, "", `?build=${build}`);
    } catch (err) {
      console.error("Erro ao trocar/mostrar cena:", err);
    }
  }

  // =========================
  // RENDER 2D (on-demand)
  // =========================
  function get2DUrl(build) {
    const b = getValidBuild(build);
    return `${CDN_BASE}/renders/2d/2d_${b}.jpg`;
  }

  // Mostra o render 2D na página
  function show2D(build) {
    const url = get2DUrl(build);

    let container = document.getElementById("render2d-container");
    let img = document.getElementById("render2d-preview");
    let status = document.getElementById("render2d-status");

    if (!container) {
      container = document.createElement("div");
      container.id = "render2d-container";

      container.style.position = "fixed";
      container.style.top = "50%";
      container.style.left = "50%";
      container.style.transform = "translate(-50%, -50%)";
      container.style.width = "1280px";
      container.style.maxWidth = "90vw";
      container.style.background = "rgb(255, 255, 255)";
      container.style.border = "1px solid #333";
      container.style.padding = "8px";
      container.style.zIndex = "9999";

      // ❌ botão fechar
      const closeBtn = document.createElement("button");
      closeBtn.innerHTML = "✕";
      closeBtn.title = "Fechar preview 2D";
      closeBtn.style.position = "absolute";
      closeBtn.style.top = "4px";
      closeBtn.style.right = "6px";
      closeBtn.style.background = "rgba(0,0,0,0.6)";
      closeBtn.style.color = "#fff";
      closeBtn.style.border = "none";
      closeBtn.style.fontSize = "18px";
      closeBtn.style.cursor = "pointer";
      closeBtn.onclick = () => {
        container.style.display = "none";
      };

      // 🔄 TEXTO (status)
      status = document.createElement("div");
      status.id = "render2d-status";
      status.innerText = "Gerando render da combinação...";
      status.style.color = "#000";
      status.style.textAlign = "center";
      status.style.padding = "40px 8px";
      status.style.fontSize = "16px";

      // 🖼️ IMAGEM
      img = document.createElement("img");
      img.id = "render2d-preview";
      img.style.width = "100%";
      img.style.display = "none";

      container.appendChild(closeBtn);
      container.appendChild(status);
      container.appendChild(img);
      document.body.appendChild(container);
    }

    // fallback: se já tiver imagem
    img.src = url;
    img.style.display = "block";
    status.style.display = "none";
    container.style.display = "block";
  }

  function show2DLoading() {
    const container = document.getElementById("render2d-container");
    const img = document.getElementById("render2d-preview");
    const status = document.getElementById("render2d-status");

    if (!container) return;

    container.style.display = "block";
    status.style.display = "block";
    img.style.display = "none";
  }

  function show2DImage(url) {
    const img = document.getElementById("render2d-preview");
    const status = document.getElementById("render2d-status");

    if (!img || !status) return;

    status.style.display = "none";
    img.src = url;
    img.style.display = "block";
  }

  async function exists2DOnCDN(build) {
    const url = get2DUrl(build);
    try {
      const res = await fetch(url, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function request2DRender(build) {
    const b = getValidBuild(build);

    const res = await fetch(`${API_BASE}/api/render2d`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buildString: `2d_${b}`,
        selection: configurator.getCurrentSelection(),
      }),
    });

    if (!res.ok) {
      throw new Error(`Render 2D falhou (${res.status})`);
    }

    return get2DUrl(b);
  }

  async function handleSave2Render(build) {
    const b = getValidBuild(build);

    // 🔥 SEMPRE abre a div e mostra o texto
    show2D(b);
    show2DLoading();

    // cache-first
    if (await exists2DOnCDN(b)) {
      console.log(`🖼️ Render 2D ${b} já existe no CDN`);
      show2DImage(get2DUrl(b));
      return;
    }

    console.log(`🎨 Solicitando render 2D para ${b}`);
    await request2DRender(b);
    show2DImage(get2DUrl(b));
  }

  // Inicialização: tenta mostrar a cena inicial; caso não exista, enfileira render
  await showBuild(INITIAL_BUILD);

  // UIController chama showBuild — mesmo que ele passe objeto, showBuild normaliza
  new UIController(
    configurator,
    showBuild,
    (layerId) => CameraController.focusOn(layerId),
    handleSave2Render,
  );
})();
