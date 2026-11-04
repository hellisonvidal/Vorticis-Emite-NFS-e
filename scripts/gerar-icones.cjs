// Gera os ícones PNG (Windows e Android) a partir de public/img/icone.svg usando o Chromium do Playwright.
// Uso: node scripts/gerar-icones.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'icone.svg'), 'utf8');
  const b = await chromium.launch();
  const p = await b.newPage();
  // Símbolo sem o fundo (para o ícone adaptativo do Android, cujo fundo é um gradiente nativo)
  const svgSemFundo = svg.replace(/<rect[^>]*\/>/, '');
  const renderSvg = async (fonte, tam, arquivo, escala) => {
    const inner = Math.round(tam * escala);
    await p.setViewportSize({ width: tam, height: tam });
    await p.setContent(`<html><body style="margin:0;width:${tam}px;height:${tam}px;display:grid;place-items:center;background:transparent">${fonte.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body></html>`);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    await p.screenshot({ path: arquivo, omitBackground: true });
  };
  // Tela de abertura: fundo escuro, ícone e nome
  const splash = async (w, h, arquivo) => {
    const lado = Math.round(Math.min(w, h) * 0.28);
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(lado * 0.18)}px;background:radial-gradient(circle at 30% 20%,#312e81,#0f172a 70%);font-family:Inter,Segoe UI,Roboto,sans-serif">
      ${svg.replace('<svg ', `<svg width="${lado}" height="${lado}" `)}<div style="color:#fff;font-weight:700;font-size:${Math.round(lado * 0.2)}px;letter-spacing:-.01em">Vorticis Emite NFS</div>
      <div style="color:#a5b4fc;font-size:${Math.round(lado * 0.09)}px">NFS-e Padrão Nacional · IBS/CBS</div></body></html>`);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    await p.screenshot({ path: arquivo });
  };
  const render = async (tam, arquivo, { fundo = false, escala = 1, redondo = false } = {}) => {
    const inner = Math.round(tam * escala);
    await p.setViewportSize({ width: tam, height: tam });
    await p.setContent(`<html><body style="margin:0;width:${tam}px;height:${tam}px;display:grid;place-items:center;background:${fundo ? '#4f46e5' : 'transparent'}">
      <div style="width:${inner}px;height:${inner}px;${redondo ? 'border-radius:50%;overflow:hidden' : ''}">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    await p.screenshot({ path: arquivo, omitBackground: !fundo });
  };
  await render(1024, 'build/icon.png');
  await render(512, 'public/img/icone-512.png');
  await render(192, 'public/img/icone-192.png');
  // Android: mipmaps (ícone legado e redondo) e foreground adaptativo
  const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, t] of Object.entries(dens)) {
    await render(t, `build/android/mipmap-${d}/ic_launcher.png`);
    await render(t, `build/android/mipmap-${d}/ic_launcher_round.png`, { redondo: true });
    await renderSvg(svgSemFundo, Math.round(t * 2.25), `build/android/mipmap-${d}/ic_launcher_foreground.png`, 0.7);
  }
  const splashes = { drawable: [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-mdpi': [480, 320], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960],
    'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-hdpi': [480, 800], 'drawable-port-mdpi': [320, 480], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920] };
  for (const [d, [w, h]] of Object.entries(splashes)) await splash(w, h, `build/android/${d}/splash.png`);
  await b.close();
  console.log('Ícones gerados.');
})();
