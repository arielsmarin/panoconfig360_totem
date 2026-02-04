/**
 * ViewerManager.js
 * Gerenciamento do Marzipano viewer
 */

import { CreateCameraController, CAMERA_POIS } from './CameraController.js';
import { TILE_PATTERN } from '../utils/TilePattern.js';

export class ViewerManager {
  constructor(containerId, viewerConfig = {}) {
    this._containerId = containerId;
    this._viewerConfig = viewerConfig;
    this._viewer = null;
    this._view = null;
    this._scene = null;
    this._cameraController = null;
    this._currentBuild = null;
    this._currentClientId = null;
    this._currentSceneId = null;
  }

  get viewer() {
    return this._viewer;
  }

  get view() {
    return this._view;
  }

  /**
   * Inicializa o Marzipano viewer
   */
  initialize() {
    const container = document.getElementById(this._containerId);
    if (!container) {
      throw new Error(`Container não encontrado: ${this._containerId}`);
    }

    if (typeof Marzipano === 'undefined') {
      throw new Error('Marzipano não está carregado. Verifique o script no HTML.');
    }

    this._viewer = new Marzipano.Viewer(container, {
      controls: { mouseViewMode: "drag" },
    });

    console.log("[ViewerManager] Viewer inicializado");
    return this._viewer;
  }

  /**
   * Carrega uma cena com os tiles
   */
  async loadScene(clientId, sceneId, buildString) {
    if (!this._viewer) {
      throw new Error("Viewer não inicializado");
    }

    const { tileSize = 512, cubeSize = 1024 } = this._viewerConfig;
    
    // Usa o padrão correto alinhado com o backend
    const tileUrl = TILE_PATTERN.getMarzipanoPattern(clientId, sceneId, buildString);

    console.log(`[ViewerManager] Carregando tiles: ${tileUrl}`);

    // Fonte de tiles
    const source = Marzipano.ImageUrlSource.fromString(tileUrl);

    // Geometria - apenas um nível
    const geometry = new Marzipano.CubeGeometry([
      { tileSize: tileSize, size: cubeSize }
    ]);

    // Limiter
    const limiter = Marzipano.RectilinearView.limit.traditional(
      cubeSize,
      (100 * Math.PI) / 180
    );

    // View
    const initialViewParams = { 
      yaw: 0, 
      pitch: 0, 
      fov: this._viewerConfig.defaultFov || Math.PI / 2 
    };

    this._view = new Marzipano.RectilinearView(initialViewParams, limiter);

    // Cria cena
    this._scene = this._viewer.createScene({
      source: source,
      geometry: geometry,
      view: this._view,
      pinFirstLevel: true,
    });

    // Exibe cena
    this._scene.switchTo();
    this._currentBuild = buildString;
    this._currentClientId = clientId;
    this._currentSceneId = sceneId;

    // Inicializa controle de câmera
    this._cameraController = CreateCameraController(this._view);

    console.log(`[ViewerManager] Cena carregada: ${buildString}`);
    return this._scene;
  }

  /**
   * Atualiza a cena com novos tiles
   */
  async updateScene(clientId, sceneId, buildString) {
    // Se é a mesma build e mesma cena, ignora
    if (
      this._currentBuild === buildString && 
      this._currentClientId === clientId && 
      this._currentSceneId === sceneId
    ) {
      console.log("[ViewerManager] Build já carregada, ignorando");
      return;
    }

    // Salva parâmetros da view atual
    const currentParams = this._view ? {
      yaw: this._view.yaw(),
      pitch: this._view.pitch(),
      fov: this._view.fov()
    } : null;

    // Carrega nova cena
    await this.loadScene(clientId, sceneId, buildString);

    // Restaura view se havia uma anterior (e é a mesma cena)
    if (currentParams && this._view && this._currentSceneId === sceneId) {
      this._view.setYaw(currentParams.yaw);
      this._view.setPitch(currentParams.pitch);
      this._view.setFov(currentParams.fov);
    }

    console.log(`[ViewerManager] Cena atualizada: ${buildString}`);
  }

  /**
   * Foca a câmera em um ponto de interesse
   */
  focusOn(poiKey) {
    if (this._cameraController) {
      this._cameraController.focusOn(poiKey);
    }
  }

  /**
   * Retorna POIs disponíveis
   */
  getAvailablePOIs() {
    return Object.keys(CAMERA_POIS);
  }

  /**
   * Destrói o viewer
   */
  destroy() {
    if (this._viewer) {
      this._viewer.destroy();
      this._viewer = null;
      this._view = null;
      this._scene = null;
      this._cameraController = null;
    }
  }
}