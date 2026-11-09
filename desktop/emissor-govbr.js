// Emissor Nacional (web) dentro do app Windows, para emitir com a conta gov.br, como responsável legal ou procurador.
// - Janela com sessão persistente própria (o login gov.br continua salvo entre usos), separada do restante do app;
// - navegação limitada a domínios gov.br (demais links abrem no navegador padrão);
// - o XML baixado da NFS-e é lido após o download e enviado ao app, que importa a nota automaticamente.
import { BrowserWindow, session, shell, screen, dialog, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const PARTICAO = 'persist:emissor-govbr';
const govbr = url => { try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'gov.br' || u.hostname.endsWith('.gov.br')); } catch { return false; } };
export const ehEmissor = url => { try { const u = new URL(url); return ['www.nfse.gov.br', 'www.producaorestrita.nfse.gov.br'].includes(u.hostname) && /^\/EmissorNacional/i.test(u.pathname); } catch { return false; } };

/** Separa os dados do painel (enviados pelo app em "#vorticis=...") do endereço do Emissor. */
export function separarDados(url) {
  const i = url.indexOf('#vorticis=');
  if (i < 0) return { url, dados: null };
  let dados = null;
  try { dados = JSON.parse(decodeURIComponent(url.slice(i + 10))); } catch { /* ignora */ }
  return { url: url.slice(0, i), dados };
}

// Painel "Vorticis" mostrado dentro da página do Emissor Nacional: lista os dados da nota e insere cada um no campo
// do Emissor em que o usuário clicou por último (ou copia). Os estilos entram por insertCSS (não dependem da CSP).
const CSS_PAINEL = `#vorticis-painel{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:70vh;display:flex;flex-direction:column;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 20px 50px rgba(2,6,23,.3);font:13px/1.4 system-ui,'Segoe UI',sans-serif}
#vorticis-painel *{box-sizing:border-box;font:inherit;color:inherit}
#vorticis-painel .vp-h{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;border-radius:13px 13px 0 0;cursor:pointer}
#vorticis-painel .vp-h b{flex:1;color:#fff;font-weight:700}
#vorticis-painel .vp-h span{color:#fff}
#vorticis-painel .vp-c{overflow:auto;padding:8px 10px}
#vorticis-painel.min .vp-c{display:none}
#vorticis-painel .vp-i{font-size:11.5px;color:#475569;margin:2px 0 8px}
#vorticis-painel .vp-l{display:flex;align-items:center;gap:6px;padding:6px 0;border-top:1px solid #e2e8f0}
#vorticis-painel .vp-t{flex:1;min-width:0}
#vorticis-painel .vp-t small{display:block;font-size:11px;color:#64748b}
#vorticis-painel .vp-t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
#vorticis-painel button{all:unset;cursor:pointer;font-size:11.5px;font-weight:600;padding:4px 8px;border-radius:7px;border:1px solid #cbd5e1;background:#f8fafc;color:#1e293b}
#vorticis-painel button.vp-p{background:#2563eb;border-color:#2563eb;color:#fff}`;

function painelVorticis(d) {
  window.__vorticisPainelDados = d;
  if (window.__vorticisPainelRender) return window.__vorticisPainelRender();
  let alvo = null, min = false;
  document.addEventListener('focusin', e => { const t = e.target; if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && !t.closest('#vorticis-painel')) alvo = t; }, true);
  const el = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
  const aviso = (b, t) => { const o = b.textContent; b.textContent = t; setTimeout(() => { b.textContent = o; }, 1200); };
  const inserir = (v, b) => {
    if (!alvo || !document.contains(alvo)) return aviso(b, 'Clique no campo');
    const proto = alvo.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    alvo.focus();
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(alvo, v);
    for (const ev of ['input', 'change']) alvo.dispatchEvent(new Event(ev, { bubbles: true }));
    alvo.dispatchEvent(new FocusEvent('blur'));
    aviso(b, 'Inserido');
  };
  const copiar = async (v, b) => {
    try { await navigator.clipboard.writeText(v); } catch { const t = el('textarea'); t.value = v; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    aviso(b, 'Copiado');
  };
  const render = () => {
    const dd = window.__vorticisPainelDados || {};
    let p = document.getElementById('vorticis-painel');
    if (!p) { p = el('div'); p.id = 'vorticis-painel'; (document.body || document.documentElement).append(p); }
    p.className = min ? 'min' : '';
    p.replaceChildren();
    const h = el('div', 'vp-h'); h.append(el('b', '', 'Vorticis · dados da nota'), el('span', '', min ? '▲' : '▼'));
    h.onclick = () => { min = !min; render(); };
    const c = el('div', 'vp-c');
    c.append(el('div', 'vp-i', [dd.empresa, dd.representante].filter(Boolean).join(' · ')));
    c.append(el('div', 'vp-i', 'Clique no campo do Emissor e depois em "Inserir". Ao baixar o XML, a nota volta para o app.'));
    for (const [rot, val, cp] of dd.linhas || []) {
      const l = el('div', 'vp-l'), t = el('div', 'vp-t');
      t.append(el('small', '', rot), el('div', '', val));
      const bi = el('button', 'vp-p', 'Inserir'), bc = el('button', '', 'Copiar');
      bi.onmousedown = e => e.preventDefault(); // não tira o foco do campo do Emissor
      bi.onclick = () => inserir(cp, bi); bc.onclick = () => copiar(cp, bc);
      l.append(t, bi, bc); c.append(l);
    }
    p.append(h, c);
  };
  window.__vorticisPainelRender = render;
  render();
  setInterval(() => { if (!document.getElementById('vorticis-painel')) render(); }, 1500);
}
let dadosPainel = null;
function injetarPainel(win) {
  if (!dadosPainel || win.isDestroyed()) return;
  const wc = win.webContents;
  wc.insertCSS(CSS_PAINEL).catch(() => {});
  wc.executeJavaScript(`(${painelVorticis.toString()})(${JSON.stringify(dadosPainel)})`).catch(() => {});
}

export const opcoesJanela = () => ({
  width: 1200, height: 900, title: 'Emissor Nacional NFS-e (gov.br) — Vorticis', autoHideMenuBar: true,
  webPreferences: { partition: PARTICAO, sandbox: true, contextIsolation: true, nodeIntegration: false },
});

let sessaoPronta = false;
function prepararSessao(principal) {
  if (sessaoPronta) return;
  sessaoPronta = true;
  session.fromPartition(PARTICAO).on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'Salvar arquivo do Emissor Nacional', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    item.once('done', (_ev, estado) => {
      const arq = item.getSavePath();
      if (estado !== 'completed' || !arq || !/\.xml$/i.test(arq)) return;
      try {
        if (fs.statSync(arq).size > 5 * 1024 * 1024) return;
        const xml = fs.readFileSync(arq, 'utf8');
        if (!/infNFSe|<NFSe[\s>]|e101101|e105102/.test(xml)) return;
        principal()?.webContents.executeJavaScript(`globalThis.__vorticisImportarXml && globalThis.__vorticisImportarXml(${JSON.stringify(xml)})`).catch(() => {});
      } catch { /* arquivo inacessível */ }
    });
  });
}

let janelaEmissor = null;
/** Abre (ou traz à frente) a janela do Emissor Nacional. O window.open do app é negado e a janela é criada aqui,
 *  porque janelas filhas herdam a sessão da janela que as abriu e o Emissor precisa de sessão própria. */
export function abrirEmissor(endereco, principal) {
  const { url, dados } = separarDados(endereco);
  if (dados) dadosPainel = dados;
  if (janelaEmissor && !janelaEmissor.isDestroyed()) {
    if (janelaEmissor.isMinimized()) janelaEmissor.restore();
    janelaEmissor.focus();
    // outro ambiente (produção x produção restrita): troca a página; senão só atualiza o painel
    if (new URL(janelaEmissor.webContents.getURL() || url).hostname !== new URL(url).hostname) janelaEmissor.loadURL(url);
    else injetarPainel(janelaEmissor);
    return janelaEmissor;
  }
  janelaEmissor = new BrowserWindow({ ...opcoesJanela(), show: false });
  configurarJanelaEmissor(janelaEmissor, principal);
  janelaEmissor.once('ready-to-show', () => janelaEmissor?.show());
  janelaEmissor.on('closed', () => { janelaEmissor = null; });
  janelaEmissor.loadURL(url);
  return janelaEmissor;
}

/** Configura a janela do Emissor Nacional (navegação, downloads, certificado do login gov.br, posição). */
export function configurarJanelaEmissor(win, principal) {
  prepararSessao(principal);
  // lado a lado: app à esquerda (assistente com os dados da nota), Emissor à direita
  try {
    const p = principal();
    const area = screen.getDisplayMatching(p.getBounds()).workArea;
    const meio = Math.round(area.width * 0.45);
    if (p.isMaximized()) p.unmaximize();
    p.setBounds({ x: area.x, y: area.y, width: meio, height: area.height });
    win.setBounds({ x: area.x + meio, y: area.y, width: area.width - meio, height: area.height });
  } catch { /* monitor indisponível */ }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (govbr(url)) return { action: 'allow', overrideBrowserWindowOptions: opcoesJanela() };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!govbr(url)) { e.preventDefault(); shell.openExternal(url); } });
  // painel com os dados da nota em cada página do Emissor (o login gov.br passa por sso.acesso.gov.br, sem painel)
  win.webContents.on('dom-ready', () => { if (ehEmissor(win.webContents.getURL())) injetarPainel(win); });
  // Login gov.br com certificado digital: o usuário escolhe qual certificado apresentar
  win.webContents.on('select-client-certificate', (e, url, lista, callback) => {
    e.preventDefault();
    if (lista.length <= 1) return callback(lista[0]);
    const botoes = lista.slice(0, 8).map(c => `${c.subjectName}${c.issuerName ? ` (${c.issuerName})` : ''}`);
    const r = dialog.showMessageBoxSync(win, { type: 'question', title: 'Certificado digital', message: 'Escolha o certificado para entrar no gov.br', buttons: [...botoes, 'Cancelar'], cancelId: botoes.length, noLink: true });
    callback(r < botoes.length ? lista[r] : undefined);
  });
}
