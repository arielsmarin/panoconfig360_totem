export class UIController {
  constructor(configurator, onSelectionChange, onFocusRequest, onSave2Render) {
    this.configurator = configurator;
    this.onSelectionChange = onSelectionChange;
    this.onFocusRequest = onFocusRequest;
    this.onSave2Render = onSave2Render;

    this.activeLayerId = null;

    this.menuContainer = document.getElementById("menu-elements");
    this.submenuContainer = document.getElementById("submenu-materials");
    this.save2RenderButton = document.getElementById("save-2render");

    this.submenuPreviewImg = null;
    this.submenuPreviewLabel = null;
    this.submenuTileList = null;

    this.renderMainMenu();
    this.bindSave2RenderButton();
  }

  /* =========================
   * MENU PRINCIPAL
   * ========================= */
  renderMainMenu() {
    this.menuContainer.innerHTML = "";

    this.configurator.layers.forEach((layer) => {
      const selectedId = this.configurator.currentSelection[layer.id];
      const selectedItem = layer.items.find((i) => i.id === selectedId);

      const card = document.createElement("div");
      card.className = "menu-item";
      card.onclick = () => {
        if (this.onFocusRequest) {
          this.onFocusRequest(layer.id);
        }
        this.toggleSubmenu(layer.id);
      };

      const thumb = document.createElement("img");
      thumb.className = "menu-item-thumbnail";
      thumb.src = selectedItem?.thumbnail || "";
      thumb.alt = selectedItem?.label || "";

      const text = document.createElement("div");
      text.className = "menu-item-text";

      const title = document.createElement("div");
      title.className = "menu-item-title";
      title.textContent = layer.label;

      const subtitle = document.createElement("div");
      subtitle.className = "menu-item-subtitle";
      subtitle.textContent = selectedItem?.label || "";

      const arrow = document.createElement("div");
      arrow.className = "menu-item-arrow";
      arrow.textContent = "›";

      text.append(title, subtitle);
      card.append(thumb, text, arrow);
      this.menuContainer.appendChild(card);
    });
  }

  /* =========================
   * SUBMENU (PAINEL)
   * ========================= */
  toggleSubmenu(layerId) {
    if (this.activeLayerId === layerId) {
      this.closeSubmenu();
      return;
    }

    this.activeLayerId = layerId;
    this.renderSubmenu();
  }

  closeSubmenu() {
    this.activeLayerId = null;
    this.submenuContainer.classList.remove("active");
    this.submenuContainer.innerHTML = "";

    this.submenuPreviewImg = null;
    this.submenuPreviewLabel = null;
    this.submenuTileList = null;
  }

  renderSubmenu() {
    const layer = this.configurator.layers.find(
      (l) => l.id === this.activeLayerId,
    );
    if (!layer) return;

    this.submenuContainer.classList.add("submenu-panel", "active");
    this.submenuContainer.innerHTML = "";

    /* Header */
    const header = document.createElement("div");
    header.className = "submenu-header";

    const back = document.createElement("div");
    back.className = "submenu-back";
    back.textContent = "‹";
    back.onclick = () => this.closeSubmenu();

    const title = document.createElement("div");
    title.className = "submenu-title";
    title.textContent = layer.label;

    header.append(back, title);
    this.submenuContainer.appendChild(header);

    /* Body */
    const body = document.createElement("div");
    body.className = "submenu-body";

    const selectedId = this.configurator.currentSelection[layer.id];
    const selectedItem = layer.items.find((i) => i.id === selectedId);

    /* Preview principal */
    if (selectedItem) {
      const preview = document.createElement("div");
      preview.className = "submenu-main-preview";

      const img = document.createElement("img");
      img.src = selectedItem.thumbnail || "";
      img.alt = selectedItem.label;

      const label = document.createElement("div");
      label.className = "submenu-main-label";
      label.textContent = selectedItem.label;

      this.submenuPreviewImg = img;
      this.submenuPreviewLabel = label;

      preview.append(img, label);
      body.appendChild(preview);
    }

    /* Lista de materiais */
    const list = document.createElement("div");
    list.className = "tile-list";
    this.submenuTileList = list;

    layer.items.forEach((item) => {
      const isBase = item.index === 0;

      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.itemId = item.id;

      if (item.id === selectedId) {
        tile.classList.add("active");
      }

      if (isBase) {
        tile.classList.add("tile-base");
      }

      const img = document.createElement("img");
      img.src = item.thumbnail || "css/thumbnail/";
      img.alt = item.label;

      const label = document.createElement("div");
      label.className = "tile-label";
      label.textContent = item.label;

      tile.onclick = () => {
        this.selectItem(layer.id, item.id);
      };

      tile.append(img, label);
      list.appendChild(tile);
    });

    body.appendChild(list);
    this.submenuContainer.appendChild(body);
  }

  /* =========================
   * SELEÇÃO DE ITEM
   * ========================= */
  selectItem(layerId, itemId) {
    this.configurator.currentSelection[layerId] = itemId;

    const layer = this.configurator.layers.find((l) => l.id === layerId);
    const item = layer.items.find((i) => i.id === itemId);

    // Atualiza preview
    if (item && this.submenuPreviewImg && this.submenuPreviewLabel) {
      this.submenuPreviewImg.src = item.thumbnail || "";
      this.submenuPreviewImg.alt = item.label;
      this.submenuPreviewLabel.textContent = item.label;
    }

    // Atualiza estado ativo
    if (this.submenuTileList) {
      this.submenuTileList.querySelectorAll(".tile").forEach((tile) => {
        tile.classList.toggle("active", tile.dataset.itemId === itemId);
      });
    }

    this.renderMainMenu();
    this.onSelectionChange(this.configurator.currentSelection);
  }

  // =========================
  // BOTÃO RENDERIZAR 2D
  // =========================

  bindSave2RenderButton() {
    if (!this.save2RenderButton) return;

    this.save2RenderButton.onclick = () => {
      const build = this.configurator.getBuildString();
      this.onSave2Render(build);
    };
  }
}
