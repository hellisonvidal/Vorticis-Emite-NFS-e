// Cliente da API. Duas formas de transporte:
//  - HTTP (Windows/Electron e navegador): fetch para o servidor local
//  - Local (Android): o núcleo roda no próprio WebView e é chamado diretamente (globalThis.__vorticisApi)
const KEY = 'vorticis.token';
const local = () => globalThis.__vorticisApi;
export const nativo = () => globalThis.VorticisNativo || null;

export const sessao = {
  get token() { try { return localStorage.getItem(KEY); } catch { return this._t || null; } },
  set token(v) { this._t = v; try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* sem storage */ } },
};

export class ErroApi extends Error {
  constructor(msg, status, dados) { super(msg); this.status = status; this.dados = dados; }
}

async function chamarLocal(method, url, body) {
  const [path, qs] = url.split('?');
  return local().handle({ method, path, query: Object.fromEntries(new URLSearchParams(qs || '')), body: body ? JSON.parse(JSON.stringify(body)) : {}, token: sessao.token });
}

const pronto = () => globalThis.__vorticisPronto || null;

export async function api(method, url, body) {
  if (pronto()) await pronto();
  let status, dados;
  if (local()) {
    const r = await chamarLocal(method, url, body);
    status = r.status; dados = r.json;
  } else {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(sessao.token ? { Authorization: `Bearer ${sessao.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = r.status;
    const ct = r.headers.get('content-type') || '';
    dados = ct.includes('json') ? await r.json() : await r.text();
  }
  if (status === 401 && !url.startsWith('/api/auth')) { sessao.token = null; location.hash = '#/login'; }
  if (status >= 400) throw new ErroApi(dados?.erro || `Erro ${status}`, status, dados);
  return dados;
}
export const get = url => api('GET', url);
export const post = (url, b) => api('POST', url, b);
export const put = (url, b) => api('PUT', url, b);
export const del = url => api('DELETE', url);

const paraBase64 = dados => {
  const bytes = typeof dados === 'string' ? new TextEncoder().encode(dados) : dados;
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// Entrega um arquivo ao usuário: Android -> compartilhar/salvar nativo; demais -> download do navegador
export async function entregarArquivo({ nome, tipo, dados, inline }) {
  if (nativo()) {
    const base64 = paraBase64(dados);
    const r = await nativo().salvar({ nome, tipo, base64, abrir: inline });
    const { modal } = await import('./ui.js');
    const acao = await modal({ titulo: 'Arquivo salvo', corpo: `<p>${r?.local ? `Salvo em <b>${r.local}</b>.` : 'Arquivo gerado.'}</p>`,
      botoes: [{ texto: 'Compartilhar', valor: 'c' }, { texto: 'OK', cls: 'primary', valor: 'ok' }] });
    if (acao === 'c') await nativo().compartilhar({ nome, tipo, base64 });
    return;
  }
  const blob = new Blob([dados], { type: tipo });
  const href = URL.createObjectURL(blob);
  if (inline && tipo === 'application/pdf') window.open(href, '_blank');
  else { const a = document.createElement('a'); a.href = href; a.download = nome; a.click(); }
  setTimeout(() => URL.revokeObjectURL(href), 15000);
}

// Download autenticado (XML, CSV, PDF)
export async function baixarArquivo(url, nome) {
  if (pronto()) await pronto();
  if (local()) {
    const r = await chamarLocal('GET', url);
    if (!r.arquivo) throw new Error(r.json?.erro || `Erro ${r.status}`);
    return entregarArquivo({ ...r.arquivo, nome: nome || r.arquivo.nome });
  }
  const r = await fetch(url, { headers: { Authorization: `Bearer ${sessao.token}` } });
  if (!r.ok) { let e; try { e = (await r.json()).erro; } catch { e = `Erro ${r.status}`; } throw new Error(e); }
  const blob = await r.blob();
  const nomeArq = nome || (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'arquivo';
  return entregarArquivo({ nome: nomeArq, tipo: blob.type, dados: new Uint8Array(await blob.arrayBuffer()), inline: blob.type === 'application/pdf' });
}

// Impressão: Android usa o serviço de impressão do sistema (permite salvar em PDF)
export function imprimir(html, titulo = 'Vorticis Emite NFS') {
  if (nativo()?.imprimir) {
    const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    return nativo().imprimir({ html: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="background:#fff;padding:12px">${html}</body></html>`, titulo });
  }
  window.print();
}

const cache = new Map();
export async function cached(url) {
  if (!cache.has(url)) cache.set(url, get(url).catch(e => { cache.delete(url); throw e; }));
  return cache.get(url);
}
