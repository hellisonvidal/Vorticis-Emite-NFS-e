// Emissor Nacional (web) dentro do app Windows, para emitir com a conta gov.br, como responsável legal ou procurador.
// - Janela com sessão persistente própria (o login gov.br continua salvo entre usos), separada do restante do app;
// - navegação limitada a domínios gov.br (demais links abrem no navegador padrão);
// - o XML baixado da NFS-e é lido após o download e enviado ao app, que importa a nota automaticamente.
import { BrowserWindow, session, shell, screen, dialog, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const PARTICAO = 'persist:emissor-govbr';
const govbr = url => { try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'gov.br' || u.hostname.endsWith('.gov.br')); } catch { return false; } };
export const ehEmissor = url => { try { const u = new URL(url); return u.hostname === 'www.nfse.gov.br' && /^\/EmissorNacional/i.test(u.pathname); } catch { return false; } };

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
export function abrirEmissor(url, principal) {
  if (janelaEmissor && !janelaEmissor.isDestroyed()) {
    if (janelaEmissor.isMinimized()) janelaEmissor.restore();
    janelaEmissor.focus();
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
  // Login gov.br com certificado digital: o usuário escolhe qual certificado apresentar
  win.webContents.on('select-client-certificate', (e, url, lista, callback) => {
    e.preventDefault();
    if (lista.length <= 1) return callback(lista[0]);
    const botoes = lista.slice(0, 8).map(c => `${c.subjectName}${c.issuerName ? ` (${c.issuerName})` : ''}`);
    const r = dialog.showMessageBoxSync(win, { type: 'question', title: 'Certificado digital', message: 'Escolha o certificado para entrar no gov.br', buttons: [...botoes, 'Cancelar'], cancelId: botoes.length, noLink: true });
    callback(r < botoes.length ? lista[r] : undefined);
  });
}
