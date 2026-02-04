/**
 * TilePattern.js
 * Padrão de URL para tiles do cubemap
 * Alinhado com o backend (split_faces_cubemap.py e server.py)
 * 
 * Estrutura: cubemap/{client}/{scene}/tiles/{BUILD}/{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg
 */

export const TILE_PATTERN = Object.freeze({
  template: "{BUILD}_{FACE}_{LOD}_{X}_{Y}.jpg",

  /**
   * Gera o nome do arquivo de tile
   */
  getTileFilename(build, face, lod, x, y) {
    return `${build}_${face}_${lod}_${x}_${y}.jpg`;
  },

  /**
   * Gera a URL completa de um tile para o cache local
   * Estrutura: /panoconfig360_cache/cubemap/{client}/{scene}/tiles/{build}/{build}_{face}_{lod}_{x}_{y}.jpg
   */
  getLocalUrl(clientId, sceneId, build, face, lod, x, y) {
    return `/panoconfig360_cache/cubemap/${clientId}/${sceneId}/tiles/${build}/${build}_${face}_${lod}_${x}_${y}.jpg`;
  },

  /**
   * Retorna o padrão de URL usado pelo Marzipano
   * Usa placeholders {f}, {z}, {x}, {y}
   */
  getMarzipanoPattern(clientId, sceneId, build) {
    return `/panoconfig360_cache/cubemap/${clientId}/${sceneId}/tiles/${build}/${build}_{f}_{z}_{x}_{y}.jpg`;
  },

  /**
   * Retorna o URL canônico (tile base para HEAD check)
   * Face 'f' (front), LOD 0, posição 0,0
   */
  getCanonicalUrl(clientId, sceneId, build) {
    return this.getLocalUrl(clientId, sceneId, build, 'f', 0, 0, 0);
  },

  /**
   * Constrói o tileRoot baseado no cliente, cena e build
   * Alinhado com server.py: tile_root = f"cubemap/{client_id}/{scene_id}/tiles/{build_str}"
   */
  buildTileRoot(clientId, sceneId, build) {
    return `cubemap/${clientId}/${sceneId}/tiles/${build}`;
  }
});