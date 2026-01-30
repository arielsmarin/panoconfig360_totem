/* Configurator class to manage project configuration */
/* Loads project data from a JSON file and provides methods to access layers and selections. */

export default class Configurator {
  constructor(jsonPath) {
    this.jsonPath = jsonPath;
    this.project = {};
    this.layers = [];
    this.currentSelection = {};
  }

  async load() {
    try {
      const response = await fetch(this.jsonPath);
      if (!response.ok)
        throw new Error(`Failed to load ${this.jsonPath}: ${response.status}`);
      const data = await response.json();
      this.project = data.project || {};
      this.project.cosmeticStyleSheet =
        this.project?.cosmeticStyleSheet ?? null;

      this.layers = (data.layers || [])
        .slice()
        .sort((a, b) => (a.build_order || 0) - (b.build_order || 0));
      return this;
    } catch (err) {
      console.error("Configurator.load failed", err);
      throw err;
    }
  }

  getBaseImage() {
    return this.project.baseImage;
  }

  getLayers() {
    return this.layers;
  }

  selectItem(layerId, itemId) {
    this.currentSelection[layerId] = itemId;
  }

  getCurrentSelection() {
    return this.currentSelection;
  }

  getBuildString() {
    const base = this.project.configStringBase;
    const chars = this.project.buildChars;

    return this.layers
      .map((layer) => {
        const selectedId = this.currentSelection[layer.id];
        const item =
          layer.items.find((i) => i.id === selectedId) ||
          layer.items.find((i) => i.index === 0);

        const index = item ? item.index : 0;

        return base === 16
          ? index.toString(16).padStart(chars, "0")
          : index.toString(36).padStart(chars, "0");
      })
      .join("");
  }
}
