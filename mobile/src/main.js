// Vorticis Emite NFS - inicialização do app Android.
// Todo o sistema roda no próprio aparelho: o núcleo (core/) é executado no WebView,
// o banco SQLite (sql.js/WASM) é persistido no armazenamento privado do app (IndexedDB),
// e a comunicação com a Sefin Nacional usa o plugin nativo com mTLS (certificado ICP-Brasil).
import initSqlJs from 'sql.js';
import { registerPlugin } from '@capacitor/core';
import { criarApi } from '../../core/api.js';
import { adaptarSqlJs } from '../../core/banco.js';
import { criarCofre, randomBytes, b64, unb64 } from '../../core/seguranca.js';

const Nativo = registerPlugin('VorticisNativo');

// ---------------- IndexedDB (chave/valor) ----------------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('vorticis', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kv(op, chave, valor) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
    const s = t.objectStore('kv');
    const r = op === 'get' ? s.get(chave) : s.put(valor, chave);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function iniciar() {
  try { await navigator.storage?.persist?.(); } catch { /* opcional */ }
  const SQL = await initSqlJs({ locateFile: f => `/${f}` });
  const bytes = await kv('get', 'banco');
  const raw = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();

  // Persistência: grava o banco (com debounce) após cada alteração e ao sair do app
  let timer = null, sujo = false;
  const gravar = async () => { if (!sujo) return; sujo = false; await kv('put', 'banco', raw.export()); };
  const agendar = () => { sujo = true; clearTimeout(timer); timer = setTimeout(gravar, 400); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) gravar(); });
  window.addEventListener('pagehide', gravar);

  let chave = await kv('get', 'chave-mestra');
  if (!chave) { chave = randomBytes(32); await kv('put', 'chave-mestra', chave); }

  const http = async ({ url, method = 'GET', headers = {}, body, pfx, senha, publico }) => {
    const r = await Nativo.http({ url, method, headers, body: body ? b64(new TextEncoder().encode(body)) : null, pfx: pfx ? b64(pfx) : null, senha: senha || '', publico: !!publico });
    return { status: r.status, headers: r.headers || {}, body: unb64(r.body || '') };
  };

  const api = criarApi({
    nome: 'Android', versao: __VERSAO__, db: adaptarSqlJs(raw, agendar), cofre: criarCofre(new Uint8Array(chave)), http,
    exportarBanco: () => raw.export(),
  });
  globalThis.__vorticisApi = api;
}

// Ponte usada pelo frontend (public/js/api.js)
globalThis.VorticisNativo = {
  salvar: ({ nome, tipo, base64, abrir }) => Nativo.salvar({ nome, tipo, base64, abrir: !!abrir }),
  compartilhar: ({ nome, tipo, base64 }) => Nativo.compartilhar({ nome, tipo, base64 }),
  imprimir: ({ html, titulo }) => Nativo.imprimir({ html, titulo }),
};
globalThis.__vorticisPronto = iniciar().catch(e => {
  document.body.innerHTML = `<div style="padding:24px;font-family:sans-serif"><h2>Falha ao iniciar o Vorticis Emite NFS</h2><pre style="white-space:pre-wrap">${String(e?.stack || e)}</pre></div>`;
  throw e;
});
