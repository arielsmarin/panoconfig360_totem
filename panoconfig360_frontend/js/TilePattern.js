
// Estrutura: scene/kitchen/tiles/{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg

//   {BUILD} = string de configuração (ex: "0605030403")
//   {FACE}  = face do cubemap (l, r, u, d, f, b)
//   {LOD}   = nível de detalhe (zoom level)
//   {X}     = coordenada horizontal da tile
//   {Y}     = coordenada vertical da tile

export const TILE_PATTERN = Object.freeze({
  
    // Padrão de template usado na geração de tiles.
  template: "{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg",

    // Gera o path relativo de um tile.
  getPath(build, face, lod, x, y, tileRoot = "scene/kitchen/tiles") {
    return `${tileRoot}/${build}_${face}_${lod}_${x}_${y}.jpg`;
  },

  /**
   * Gera a URL completa de um tile.
   * Exemplo:
   * getUrl("https://cdn", "scene/kitchen/tiles", "0605030403", "f", 0, 0, 0)
   * → "https://cdn/scene/kitchen/tiles/0605030403_f_0_0_0.jpg"
   */
  getUrl(cdnBase, tileRoot, build, face, lod, x, y) {
    return `${cdnBase.replace(/\/$/, "")}/${this.getPath(
      build,
      face,
      lod,
      x,
      y,
      tileRoot
    )}`;
  },

  /**
   * Retorna o padrão de URL usado pelo Marzipano.
   * Exemplo:
   * → "https://cdn/scene/kitchen/tiles/0605030403_{f}_{z}_{x}_{y}.jpg"
   */
  getMarzipanoUrl(cdnBase, tileRoot, build) {
    return `${cdnBase.replace(/\/$/, "")}/${tileRoot}/${build}_{f}_{z}_{x}_{y}.jpg`;
  },

  /**
   * Retorna o URL canônico (tile base para HEAD check)
   * Exemplo:
   * → "https://cdn/scene/kitchen/tiles/0605030403_f_0_0_0.jpg"
   */
  getCanonicalUrl(cdnBase, tileRoot, build) {
    return this.getUrl(cdnBase, tileRoot, build, "f", 0, 0, 0);
  },
});
