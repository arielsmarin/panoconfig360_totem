/**
 * main.js
 * Ponto de entrada da aplicação - Orquestrador principal
 */

import { ConfigLoader } from './config/ConfigLoader.js';
import { Configurator } from './core/Configurator.js';
import { ViewerManager } from './viewer/ViewerManager.js';
import { RenderService } from './services/RenderService.js';
import { UIController } from './ui/UIController.js';
import { SceneSelector } from './ui/SceneSelector.js';

// ======================================================
// CONFIGURAÇÃO
// ======================================================
const CLIENT_ID = 'monte-negro';
const VIEWER_CONTAINER_ID = 'pano-config-api';

// ======================================================
// INSTÂNCIAS GLOBAIS
// ======================================================
let configLoader = null;
let configurator = null;
let viewerManager = null;
let renderService = null;
let uiController = null;
let sceneSelector = null;

// ======================================================
// INICIALIZAÇÃO
// ======================================================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    console.log('[Main] Iniciando aplicação...');

    // 1. Carrega configuração do cliente
    configLoader = new ConfigLoader(CLIENT_ID);
    await configLoader.load();

    // 2. Cria o configurator
    configurator = new Configurator(configLoader);
    configurator.initializeSelection();

    // 3. Inicializa o viewer
    const viewerConfig = configLoader.getViewerConfig();
    viewerManager = new ViewerManager(VIEWER_CONTAINER_ID, viewerConfig);
    viewerManager.initialize();

    // 4. Cria o serviço de render
    renderService = new RenderService();

    // 5. Cria o seletor de cenas
    const scenes = configLoader.getSceneList();
    sceneSelector = new SceneSelector('scene-selector', handleSceneChange);
    sceneSelector.render(scenes, configLoader.currentSceneId);

    // 6. Cria o controlador de UI
    uiController = new UIController(configurator, {
      onSelectionChange: handleSelectionChange,
      onFocusRequest: handleFocusRequest,
      onSave2Render: handleSave2Render
    });
    uiController.renderMainMenu();

    // 7. Carrega a cena inicial
    await loadCurrentScene();

    console.log('[Main] Aplicação iniciada com sucesso!');

  } catch (error) {
    console.error('[Main] Erro na inicialização:', error);
  }
}

// ======================================================
// HANDLERS
// ======================================================

/**
 * Carrega a cena atual no viewer
 */
async function loadCurrentScene() {
  const clientId = configLoader.clientId;
  const sceneId = configurator.sceneId;
  const selection = configurator.currentSelection;
  const buildString = configurator.getBuildString();

  console.log(`[Main] Carregando cena: ${sceneId}`);

  try {
    // Solicita renderização ao backend
    const result = await renderService.renderCubemap(clientId, sceneId, selection);
    console.log('[Main] Render result:', result);

    // Carrega os tiles no viewer
    await viewerManager.loadScene(clientId, sceneId, result.build);

  } catch (error) {
    console.error('[Main] Erro ao carregar cena:', error);
  }
}

/**
 * Handler para mudança de seleção
 */
async function handleSelectionChange(selection) {
  console.log('[Main] Seleção alterada:', selection);
  
  // Atualiza o viewer com a nova seleção
  await loadCurrentScene();
}

/**
 * Handler para foco em POI
 */
function handleFocusRequest(layerId) {
  console.log(`[Main] Foco solicitado: ${layerId}`);
  viewerManager.focusOn(layerId);
}

/**
 * Handler para mudança de cena
 */
async function handleSceneChange(sceneId) {
  console.log(`[Main] Mudando para cena: ${sceneId}`);
  
  // Troca a cena no configurator
  configurator.switchScene(sceneId);
  
  // Atualiza UI
  uiController.setConfigurator(configurator);
  
  // Carrega a nova cena
  await loadCurrentScene();
}

/**
 * Handler para renderização 2D
 */
async function handleSave2Render() {
  const clientId = configLoader.clientId;
  const sceneId = configurator.sceneId;
  const selection = configurator.currentSelection;

  console.log('[Main] Solicitando render 2D...');

  try {
    const result = await renderService.render2D(clientId, sceneId, selection);
    console.log('[Main] Render 2D result:', result);

    // Abre a imagem em nova aba ou faz download
    if (result.url) {
      window.open(result.url, '_blank');
    }

  } catch (error) {
    console.error('[Main] Erro no render 2D:', error);
  }
}