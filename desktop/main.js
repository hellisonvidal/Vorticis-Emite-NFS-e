// Vorticis Emite NFS - aplicativo Windows (Electron).
// Sobe o servidor local em 127.0.0.1 (porta aleatória) e abre a interface numa janela nativa.
import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import { certSistemaWindows } from './certificados-windows.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOME = 'Vorticis Emite NFS';
app.setName(NOME);
// Interface em português (formato de data dd/mm/aaaa nos campos de data, textos do Chromium)
app.commandLine.appendSwitch('lang', 'pt-BR');
if (process.platform === 'win32') app.setAppUserModelId('br.com.vorticis.emitenfs');

if (!app.requestSingleInstanceLock()) app.quit();

let janela, servidor, base, saindo = false;
const pastaDados = () => path.join(app.getPath('userData'), 'dados');

async function iniciar() {
  process.removeAllListeners('warning'); // oculta o aviso "SQLite is experimental"
  const { iniciarServidor } = await import('../server/index.js');
  servidor = await iniciarServidor({ porta: 0, host: '127.0.0.1', dataDir: pastaDados(), nome: 'Windows', gerarPdf, certSistema: process.platform === 'win32' ? certSistemaWindows : undefined });
  base = `http://127.0.0.1:${servidor.porta}`;
  criarJanela();
}

// PDF do DANFSe: renderiza o HTML numa janela oculta (sem JavaScript) e imprime em A4 com as margens do @page
async function gerarPdf(html) {
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64'));
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', landscape: false, printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(pdf);
  } finally { w.destroy(); }
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1360, height: 880, minWidth: 900, minHeight: 600, title: NOME, show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'), backgroundColor: '#0f172a', autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  janela.once('ready-to-show', () => { janela.maximize(); janela.show(); });
  // Confirmação antes de fechar (botão X, Alt+F4 ou menu Arquivo → Sair)
  janela.on('close', e => {
    if (saindo) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(janela, { type: 'question', title: NOME, message: 'Deseja realmente sair do Vorticis Emite NFS?', detail: 'Notas em digitação que não foram salvas como rascunho serão perdidas.', buttons: ['Sair', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true });
    if (r === 0) { saindo = true; janela.close(); }
  });
  janela.loadURL(base);

  // Links externos no navegador padrão; PDFs (DANFSe) e prévias em janela própria
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(base) || url.startsWith('blob:')) return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 800, title: NOME, autoHideMenuBar: true } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(base)) { e.preventDefault(); shell.openExternal(url); } });
  // Downloads (XML, CSV, backup): pergunta onde salvar, sugerindo a pasta Downloads
  janela.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'Salvar arquivo', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
}

function menu() {
  const tpl = [
    { label: 'Arquivo', submenu: [
      { label: 'Nova NFS-e', accelerator: 'CmdOrCtrl+N', click: () => janela?.webContents.executeJavaScript("location.hash='#/emitir?t='+Date.now()") },
      { label: 'Copiar última nota', accelerator: 'CmdOrCtrl+Shift+C', click: () => janela?.webContents.executeJavaScript("location.hash='#/emitir?ultima=1'") },
      { type: 'separator' },
      { label: 'Abrir pasta de dados', click: () => shell.openPath(pastaDados()) },
      { label: 'Imprimir', accelerator: 'CmdOrCtrl+P', click: () => janela?.webContents.print() },
      { type: 'separator' },
      { role: 'quit', label: 'Sair' },
    ] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
    { label: 'Exibir', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'resetZoom', label: 'Tamanho original' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }, { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' }] },
    { label: 'Ajuda', submenu: [
      { label: 'Documentação oficial NFS-e (gov.br)', click: () => shell.openExternal('https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica') },
      { label: 'Portal Emissor Nacional', click: () => shell.openExternal('https://www.nfse.gov.br/EmissorNacional') },
      { type: 'separator' },
      { label: `Sobre o ${NOME}`, click: () => dialog.showMessageBox(janela, { type: 'info', title: NOME, message: `${NOME} ${app.getVersion()}`, detail: `Emissor de NFS-e Padrão Nacional (leiaute DPS v1.01) com IBS/CBS.\n\nDados: ${pastaDados()}` }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (janela) { if (janela.isMinimized()) janela.restore(); janela.focus(); } });
app.on('window-all-closed', () => { servidor?.srv.close(); servidor?.fechar(); app.quit(); });
app.whenReady().then(() => { menu(); return iniciar(); }).catch(e => { dialog.showErrorBox(NOME, `Falha ao iniciar: ${e.stack || e.message}`); app.quit(); });
