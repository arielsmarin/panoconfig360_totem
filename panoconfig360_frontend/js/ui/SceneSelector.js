/**
 * SceneSelector.js
 * Componente para seleção de cenas
 */

export class SceneSelector {
  constructor(containerId, onSceneChange) {
    this._container = document.getElementById(containerId);
    this._buttonsContainer = document.getElementById('scene-buttons');
    this._onSceneChange = onSceneChange;
    this._scenes = [];
    this._activeSceneId = null;
  }

  /**
   * Renderiza os botões de cena
   */
  render(scenes, activeSceneId = null) {
    this._scenes = scenes;
    this._activeSceneId = activeSceneId || scenes[0]?.id;

    if (!this._buttonsContainer) {
      console.warn('[SceneSelector] Container de botões não encontrado');
      return;
    }

    this._buttonsContainer.innerHTML = '';

    scenes.forEach(scene => {
      const button = document.createElement('button');
      button.className = 'scene-button';
      button.textContent = scene.label;
      button.dataset.sceneId = scene.id;

      if (scene.id === this._activeSceneId) {
        button.classList.add('active');
      }

      button.onclick = () => this._handleSceneClick(scene.id);
      this._buttonsContainer.appendChild(button);
    });
  }

  /**
   * Manipula clique em cena
   */
  _handleSceneClick(sceneId) {
    if (sceneId === this._activeSceneId) return;

    // Atualiza estado visual
    this._buttonsContainer.querySelectorAll('.scene-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sceneId === sceneId);
    });

    this._activeSceneId = sceneId;

    // Callback
    if (this._onSceneChange) {
      this._onSceneChange(sceneId);
    }
  }

  /**
   * Mostra o seletor
   */
  show() {
    if (this._container) {
      this._container.style.display = 'flex';
    }
  }

  /**
   * Esconde o seletor
   */
  hide() {
    if (this._container) {
      this._container.style.display = 'none';
    }
  }

  /**
   * Obtém a cena ativa
   */
  get activeSceneId() {
    return this._activeSceneId;
  }
}