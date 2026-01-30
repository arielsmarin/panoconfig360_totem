export default class Render2DService {
  static async getOrCreate(buildString) {
    // 1️⃣ tenta direto no CDN
    const cdnUrl = this.getCDNUrl(buildString);

    if (await this.exists(cdnUrl)) {
      return cdnUrl;
    }

    // 2️⃣ pede pro backend gerar
    const res = await fetch("/render/2d", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ build: buildString })
    });

    const data = await res.json();
    return data.url;
  }

  // Gera a URL do CDN baseado na string de build
  static getCDNUrl(buildString) {
    return `https://cdn.seudominio.com/renders/2d/${buildString}.png`;
  }
  // Verifica se a URL existe fazendo uma requisição HEAD
  static async exists(url) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }
}
