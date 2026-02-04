/**
 * Configurator.js
 * Núcleo do configurador - gerencia estado e seleções
 */

import { EventEmitter } from '../utils/EventEmitter.js';

const CONFIG_STRING_BASE = 36;
const FIXED_LAYERS = 13;

export class Configurator extends EventEmitter {
  constructor(configLoader) {
    super();
    this._configLoader = configLoader;
    this._currentSelection = {};
    this._buildString = null;
  }

  get layers() {
    return this._configLoader.getCurrentLayers();
  }

  get currentSelection() {
    return this._currentSelection;
  }

  get sceneId() {
    return this._configLoader.currentSceneId;
  }

  get clientId() {
    return this._configLoader.clientId;
  }

  /**
   * Inicializa com seleção padrão
   */
  initializeSelection(presetSelection = null) {
    this._currentSelection = {};
    
    for (const layer of this.layers) {
      if (presetSelection && presetSelection[layer.id]) {
        this._currentSelection[layer.id] = presetSelection[layer.id];
      } else if (layer.items && layer.items.length > 0) {
        // Prioriza item base (file === null) ou primeiro item
        const baseItem = layer.items.find(item => item.file === null);
        const defaultItem = baseItem || layer.items[0];
        this._currentSelection[layer.id] = defaultItem.id;
      }
    }

    this._updateBuildString();
    this.emit('selectionChange', this._currentSelection);
    
    console.log("[Configurator] Seleção inicial:", this._currentSelection);
  }

  /**
   * Atualiza seleção de um layer
   */
  updateSelection(layerId, itemId) {
    const layer = this.layers.find(l => l.id === layerId);
    if (!layer) {
      console.warn(`[Configurator] Layer não encontrado: ${layerId}`);
      return false;
    }

    const item = layer.items?.find(i => i.id === itemId);
    if (!item) {
      console.warn(`[Configurator] Item não encontrado: ${itemId} no layer ${layerId}`);
      return false;
    }

    this._currentSelection[layerId] = itemId;
    this._updateBuildString();
    
    this.emit('selectionChange', this._currentSelection);
    this.emit('itemSelected', { layerId, itemId, item });
    
    return true;
  }

  /**
   * Troca de cena
   */
  switchScene(sceneId) {
    if (this._configLoader.setCurrentScene(sceneId)) {
      this.initializeSelection();
      this.emit('sceneChange', sceneId);
      return true;
    }
    return false;
  }

  /**
   * Retorna a build string atual
   */
  getBuildString() {
    return this._buildString;
  }

  /**
   * Atualiza a build string baseada na seleção atual
   */
  _updateBuildString() {
    const scene = this._configLoader.getCurrentScene();
    if (!scene) {
      this._buildString = null;
      return;
    }

    const sceneIndex = scene.scene_index ?? 0;
    const scenePrefix = this._encodeIndex(sceneIndex);
    
    const config = new Array(FIXED_LAYERS).fill(null).map(() => this._encodeIndex(0));

    for (const layer of this.layers) {
      const buildOrder = layer.build_order ?? 0;
      
      if (buildOrder < 0 || buildOrder >= FIXED_LAYERS) continue;

      const selectedId = this._currentSelection[layer.id];
      if (!selectedId) continue;

      const item = layer.items?.find(i => i.id === selectedId);
      if (!item) continue;

      const index = item.index ?? 0;
      config[buildOrder] = this._encodeIndex(index);
    }

    this._buildString = scenePrefix + config.join('');
    console.log(`[Configurator] Build string: ${this._buildString}`);
  }

  /**
   * Codifica índice em base36
   */
  _encodeIndex(num, width = 2) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    let result = "";
    let n = num;
    
    while (n) {
      result = chars[n % 36] + result;
      n = Math.floor(n / 36);
    }
    
    return (result || "0").padStart(width, "0");
  }

  /**
   * Retorna item selecionado de um layer
   */
  getSelectedItem(layerId) {
    const layer = this.layers.find(l => l.id === layerId);
    if (!layer) return null;

    const selectedId = this._currentSelection[layerId];
    return layer.items?.find(i => i.id === selectedId) || null;
  }
}