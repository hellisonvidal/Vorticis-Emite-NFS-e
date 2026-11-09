// Certificados instalados no repositório do Windows (Pessoal / CurrentUser\My e LocalMachine\My).
// A chave privada nunca sai do Windows:
//  - assinatura (XMLDSig da DPS/eventos e prova de posse no login) via .NET RSA.SignData no PowerShell –
//    funciona com chaves não exportáveis e com tokens/cartões A3 (o Windows pede o PIN);
//  - autenticação mútua TLS com a Sefin/ADN pela pilha de rede do Chromium, que entrega o certificado
//    escolhido no evento 'select-client-certificate'.
import { app, BrowserWindow } from 'electron';
import { listar, assinar, THUMB } from './repositorio-windows.js';

// ---------------------------------------------------------------- TLS com certificado do repositório
// Uma janela oculta por certificado (sessão própria, para o Chromium não reaproveitar a escolha de outro certificado).
const janelas = new Map();      // thumbprint -> BrowserWindow
const derPorConteudo = new Map(); // webContents.id -> base64 do certificado desejado
let derCache = new Map();        // thumbprint -> base64 DER

const semPem = pem => String(pem || '').replace(/-----[^-]+-----|\s/g, '');

app.on('select-client-certificate', (event, webContents, url, lista, callback) => {
  const alvo = webContents && derPorConteudo.get(webContents.id);
  if (!alvo) return; // demais janelas: comportamento padrão
  event.preventDefault();
  const c = lista.find(x => semPem(x.data) === alvo);
  callback(c); // sem correspondência: segue sem certificado e a Sefin responde 401/403
});

async function janelaDo(id) {
  let w = janelas.get(id);
  if (w && !w.isDestroyed()) return w;
  if (!derCache.has(id)) derCache = new Map((await listar()).map(c => [c.id, Buffer.from(c.der).toString('base64')]));
  if (!derCache.has(id)) throw new Error('Certificado não encontrado no repositório do Windows.');
  w = new BrowserWindow({ show: false, webPreferences: { partition: `cert-${id}`, webSecurity: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  derPorConteudo.set(w.webContents.id, derCache.get(id));
  await w.loadURL('about:blank');
  janelas.set(id, w);
  w.on('closed', () => janelas.delete(id));
  return w;
}

/** Mesmo contrato do transporte HTTP do servidor: { url, method, headers, body } -> { status, headers, body } */
export async function http({ url, method = 'GET', headers = {}, body, certSistema, timeout = 60000 }) {
  if (!THUMB.test(certSistema || '')) throw new Error('Certificado inválido.');
  if (!String(url).startsWith('https://')) throw new Error('Certificado digital só pode ser usado em conexões HTTPS.');
  const w = await janelaDo(certSistema.toUpperCase());
  const corpo = body === undefined || body === null ? null : Buffer.from(body).toString('base64');
  const codigo = `(async () => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ${Number(timeout) || 60000});
    try {
      const b = ${JSON.stringify(corpo)};
      const r = await fetch(${JSON.stringify(url)}, { method: ${JSON.stringify(method)}, headers: ${JSON.stringify(headers)}, signal: ctl.signal, credentials: 'omit', cache: 'no-store',
        body: b === null ? undefined : Uint8Array.from(atob(b), c => c.charCodeAt(0)) });
      const buf = new Uint8Array(await r.arrayBuffer()); let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body: btoa(s) };
    } catch (e) { return { erro: e.name === 'AbortError' ? 'Tempo esgotado na comunicação com o Sistema Nacional NFS-e.' : String(e.message || e) }; }
    finally { clearTimeout(t); }
  })()`;
  const r = await w.webContents.executeJavaScript(codigo, true);
  if (r.erro) throw new Error(`Falha de comunicação com ${new URL(url).hostname}: ${r.erro}`);
  return { status: r.status, headers: r.headers, body: new Uint8Array(Buffer.from(r.body, 'base64')) };
}

export const certSistemaWindows = { listar, assinar, http };

// Uso em testes/diagnóstico: registra o DER de um certificado sem consultar o PowerShell
export function registrarCertificado(id, der) { derCache.set(String(id).toUpperCase(), Buffer.from(der).toString('base64')); }
