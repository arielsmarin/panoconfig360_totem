/**
 * RenderService.js
 * Serviço para comunicação com a API de renderização
 */

import { TILE_PATTERN } from '../utils/TilePattern.js';

export class RenderService {
  constructor(baseUrl = '') {
    this._baseUrl = baseUrl;
  }

  /**
   * Solicita renderização do cubemap (360)
   */
  async renderCubemap(clientId, sceneId, selection) {
    const payload = {
      client: clientId,
      scene: sceneId,
      selection
    };

    try {
      const response = await fetch(`${this._baseUrl}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Erro na renderização');
      }

      return await response.json();
    } catch (error) {
      console.error('[RenderService] Erro no cubemap:', error);
      throw error;
    }
  }

  /**
   * Solicita renderização 2D
   */
  async render2D(clientId, sceneId, selection) {
    const payload = {
      client: clientId,
      scene: sceneId,
      selection
    };

    try {
      const response = await fetch(`${this._baseUrl}/api/render2d`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Erro na renderização 2D');
      }

      return await response.json();
    } catch (error) {
      console.error('[RenderService] Erro no render 2D:', error);
      throw error;
    }
  }

  /**
   * Verifica se tiles existem no cache
   */
  async checkTileCache(clientId, sceneId, buildString) {
    const url = TILE_PATTERN.getCanonicalUrl(clientId, sceneId, buildString);
    
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Verifica saúde da API
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this._baseUrl}/api/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}