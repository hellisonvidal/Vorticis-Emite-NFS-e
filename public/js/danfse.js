// DANFSe v2.0 no frontend: pré-visualização, impressão, PDF e geração a partir de qualquer XML de NFS-e
import { get, post, imprimir, baixarArquivo, entregarArquivo, cached } from './api.js';
import { $, esc, icon, modal, toast } from './ui.js';

/** Plataforma gera PDF direto (Windows/Android)? No navegador, o PDF sai pelo "Salvar como PDF" da impressão. */
export const temPdf = () => cached('/api/status').then(s => !!s.pdf).catch(() => false);

const pedir = req => (req.body ? post(req.url, req.body) : get(req.url));
const comFormato = url => `${url}${url.includes('?') ? '&' : '?'}formato=pdf`;

/** req = { url, body? } – rota que devolve { html, nome } (ou o PDF com formato=pdf) */
export async function imprimirDanfse(req, titulo = 'DANFSe') {
  const d = await pedir(req);
  imprimir(d.html, titulo, { documento: true });
  return d;
}

export async function baixarDanfse(req) {
  if (await temPdf()) return baixarArquivo(comFormato(req.url), undefined, req.body ? { method: 'POST', body: req.body } : {});
  const d = await pedir(req);
  return entregarArquivo({ nome: d.nome, tipo: 'text/html', dados: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(d.nome)}</title></head><body style="margin:0;background:#fff">${d.html}</body></html>` });
}

export const paginaPrevia = html => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:8px;background:#e5e7eb">${html}</body></html>`;

/** Botões padrão (para o rodapé de modais) */
export async function botoesDanfse(req, titulo) {
  const pdf = await temPdf();
  return [
    { texto: `${icon('printer')}Imprimir DANFSe`, acao: async () => { await imprimirDanfse(req, titulo); return false; } },
    { texto: `${icon('download')}${pdf ? 'DANFSe em PDF' : 'DANFSe (HTML)'}`, acao: async () => { await baixarDanfse(req); return false; } },
  ];
}

/** Gera o DANFSe de um XML de NFS-e qualquer (notas recebidas, baixadas do portal ou do ADN). */
export async function danfseDeXml() {
  let xml = '';
  const req = () => ({ url: '/api/danfse/xml', body: { xml, situacao: $('#dxSit')?.value || 'autorizada' } });
  const ver = async bg => {
    if (!xml) throw new Error('Selecione o arquivo XML da NFS-e ou cole o conteúdo.');
    const d = await pedir(req());
    const fr = $('.danfse-frame', bg); fr.classList.remove('hidden'); fr.srcdoc = paginaPrevia(d.html);
    return d;
  };
  await modal({
    titulo: 'DANFSe a partir de XML', wide: true,
    corpo: `<p class="small muted" style="margin-top:0">Gere o DANFSe v2.0 (NT 008/2026) de qualquer NFS-e Padrão Nacional, inclusive notas recebidas como tomador. A API oficial de DANFSe foi suspensa em 03/08/2026, por isso o documento é gerado localmente a partir do XML.</p>
      <div class="grid g3" style="align-items:end">
        <label class="f span2"><span>Arquivo XML da NFS-e</span><input type="file" id="dxArq" accept=".xml,text/xml,application/xml"></label>
        <label class="f"><span>Situação da nota</span><select id="dxSit"><option value="autorizada">Normal</option><option value="cancelada">Cancelada (marca d'água)</option><option value="substituida">Substituída (marca d'água)</option></select></label>
      </div>
      <details class="collapse" style="margin-top:8px"><summary>Ou cole o XML</summary><textarea id="dxTxt" rows="5" style="width:100%;font-family:monospace;font-size:12px" placeholder="&lt;NFSe ...&gt;"></textarea></details>
      <iframe class="danfse-frame hidden" title="DANFSe" style="margin-top:12px"></iframe>`,
    botoes: [
      { texto: `${icon('eye')}Visualizar`, acao: async bg => { await ver(bg); return false; } },
      { texto: `${icon('printer')}Imprimir`, acao: async () => { if (!xml) throw new Error('Selecione o XML.'); await imprimirDanfse(req(), 'DANFSe'); return false; } },
      { texto: `${icon('download')}Baixar`, acao: async () => { if (!xml) throw new Error('Selecione o XML.'); await baixarDanfse(req()); return false; } },
      { texto: 'Fechar', cls: 'primary', valor: true },
    ],
    onOpen: bg => {
      $('#dxArq', bg).onchange = async e => { const f = e.target.files[0]; if (!f) return; xml = await f.text(); try { await ver(bg); } catch (er) { toast(er.message, 'error'); } };
      $('#dxTxt', bg).oninput = e => { xml = e.target.value.trim(); };
      $('#dxSit', bg).onchange = () => { if (xml) ver(bg).catch(er => toast(er.message, 'error')); };
    },
  });
}
