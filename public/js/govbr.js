// Emissão pela conta gov.br. A conta gov.br (prata/ouro) só é aceita no Emissor Nacional web: as APIs exigem
// certificado. O app abre o Emissor Nacional, onde você entra com o gov.br e usa "Procuração/Representação" para atuar
// como responsável legal ou procurador. Ao lado fica um assistente com os dados da nota para copiar, e o XML baixado
// volta para o app (no Windows, automaticamente; no navegador/Android, pelo botão "Importar XML").
import { post } from './api.js';
import { $$, esc, icon, modal, toast, fmtDoc, fmtCTrib, fmtNBS, moeda, dataBR } from './ui.js';

export const URL_EMISSOR = 'https://www.nfse.gov.br/EmissorNacional';
const ehDesktop = () => /Electron/i.test(navigator.userAgent);

/** Importa XML de NFS-e (texto) e mostra o resultado; usado pelo Windows (download capturado) e pelo seletor de arquivos. */
export async function importarXmls(xmls, via = 'govbr') {
  const r = await post('/api/notas/importar-xml', { xmls, via });
  const ok = r.importadas + r.atualizadas;
  if (ok) dispatchEvent(new Event('vorticis:notas-importadas'));
  if (ok) toast(`${ok} NFS-e importada(s)${r.notas[0] ? `: nº ${r.notas.map(n => n.nnfse).join(', ')}` : ''}.`, 'ok');
  if (r.eventos) toast(`${r.eventos} evento(s) de cancelamento/substituição aplicado(s).`, 'ok');
  if (r.erros.length) toast(r.erros.map(e => e.erro).join(' · '), 'error');
  return r;
}
// Chamado pelo processo principal do Windows quando um XML é baixado na janela do Emissor Nacional
globalThis.__vorticisImportarXml = async xml => {
  try {
    const r = await importarXmls([xml], 'govbr');
    if (r.notas[0]) { const { detalheNota } = await import('./pages/notas.js'); detalheNota(r.notas[0].id); }
  } catch (e) { toast(`XML baixado no Emissor Nacional não foi importado: ${e.message}`, 'error'); }
};

/** Seletor de arquivos XML (vários) para importar notas emitidas no Emissor Nacional. */
export function escolherXmls(via = 'govbr') {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xml,text/xml,application/xml'; inp.multiple = true;
  inp.onchange = async () => {
    try {
      const xmls = await Promise.all([...inp.files].map(f => f.text()));
      if (xmls.length) await importarXmls(xmls, via);
    } catch (e) { toast(e.message, 'error'); }
  };
  inp.click();
}

function linhasDaNota(c, p, k) {
  const f = p?.form || {}, t = p?.tomador || {};
  const L = [];
  const add = (rot, val, copia = val) => { if (val !== undefined && val !== null && String(val).trim() !== '') L.push([rot, String(val), String(copia)]); };
  add('Representar (CNPJ/CPF do prestador)', fmtDoc(c.documento), String(c.documento));
  add('Competência', f.competencia ? dataBR(f.competencia) : '');
  if (t.documento || t.nome) {
    add('Tomador — CPF/CNPJ', fmtDoc(t.documento), t.documento);
    add('Tomador — nome', t.nome);
    add('Tomador — inscrição municipal', t.im);
    add('Tomador — CEP', t.cep);
    add('Tomador — endereço', [t.logradouro, t.numero, t.complemento, t.bairro].filter(Boolean).join(', '));
    add('Tomador — e-mail', t.email);
    add('Tomador — telefone', t.fone);
  }
  add('Código de tributação nacional', f.ctribnac ? fmtCTrib(f.ctribnac) : '', f.ctribnac);
  add('Código de tributação municipal', f.ctribmun);
  add('NBS', f.cnbs ? fmtNBS(f.cnbs) : '', f.cnbs);
  add('Descrição do serviço', f.descricao);
  add('Valor do serviço', f.valor_servico ? moeda(f.valor_servico) : '', f.valor_servico ? Number(f.valor_servico).toFixed(2).replace('.', ',') : '');
  if (+f.desconto_incond) add('Desconto incondicionado', moeda(f.desconto_incond), Number(f.desconto_incond).toFixed(2).replace('.', ','));
  if (+f.desconto_cond) add('Desconto condicionado', moeda(f.desconto_cond), Number(f.desconto_cond).toFixed(2).replace('.', ','));
  if (k) {
    add('Alíquota do ISS', k.aliq ? `${String(k.aliq).replace('.', ',')}%` : '');
    add('ISS retido pelo tomador?', k.retido ? 'Sim' : 'Não');
    if (k.fed?.vIRRF) add('IRRF retido', moeda(k.fed.vIRRF), k.fed.vIRRF.toFixed(2).replace('.', ','));
    if (k.fed?.vCSLL) add('CSLL retida', moeda(k.fed.vCSLL), k.fed.vCSLL.toFixed(2).replace('.', ','));
    if (k.fed?.vCP) add('INSS/CP retido', moeda(k.fed.vCP), k.fed.vCP.toFixed(2).replace('.', ','));
  }
  add('cIndOp (IBS/CBS)', f.ind_op);
  add('cClassTrib (IBS/CBS)', f.cclasstrib);
  add('Informações complementares', f.info_compl);
  return L;
}

/**
 * Abre o Emissor Nacional (gov.br) e o assistente.
 * @param c empresa emitente; @param p payload da emissão (opcional); @param k cálculo (opcional)
 */
export async function abrirEmissorGovBr(c, p = null, k = null) {
  // Windows: janela do app com sessão própria (o login gov.br fica salvo) e captura do XML baixado
  window.open(URL_EMISSOR, ehDesktop() ? 'vorticis-emissor-nacional' : '_blank', ehDesktop() ? 'width=1200,height=900' : 'noopener');
  const linhas = linhasDaNota(c, p, k);
  await modal({
    titulo: 'Emitir pelo Emissor Nacional (conta gov.br)', wide: true,
    corpo: `<ol class="small" style="margin-top:0;padding-left:18px;display:grid;gap:4px">
        <li>Entre no Emissor Nacional com a <b>conta gov.br</b> (nível prata ou ouro)${ehDesktop() ? ' na janela aberta ao lado. O login fica salvo neste computador' : ' na aba aberta'}.</li>
        <li>No menu do usuário, use <b>Procuração/Representação</b> e informe <b>${fmtDoc(c.documento)}</b> (${esc(c.razao_social)}). Isso funciona para o responsável legal da empresa (pela base CNPJ) e para o procurador com procuração eletrônica do serviço NFS-e.</li>
        <li>Emita a nota com os dados abaixo (use o botão de copiar ao lado de cada campo).</li>
        <li>Baixe o <b>XML</b> da NFS-e. ${ehDesktop() ? 'O app importa automaticamente e abre a nota aqui.' : 'Depois clique em "Importar XML" para trazê-la ao app.'}</li></ol>
      <div class="alert info small" style="margin:10px 0">${icon('info')}<div>O Emissor Nacional usa a série de DPS do Emissor Web (70000–79999), separada da série deste app: a numeração não conflita.</div></div>
      ${linhas.length ? `<div class="table-wrap"><table class="copiar"><tbody>${linhas.map(([r, v], i) => `<tr><td style="width:240px" class="small muted">${esc(r)}</td><td>${esc(v)}</td><td style="width:44px"><button class="btn sm ghost" data-cp="${i}" title="Copiar">${icon('copy')}</button></td></tr>`).join('')}</tbody></table></div>` : ''}`,
    botoes: [
      { texto: `${icon('download')}Importar XML`, acao: () => { escolherXmls('govbr'); return false; } },
      { texto: `${icon('send')}Abrir o Emissor novamente`, acao: () => { window.open(URL_EMISSOR, ehDesktop() ? 'vorticis-emissor-nacional' : '_blank'); return false; } },
      { texto: 'Fechar', cls: 'primary', valor: true },
    ],
    onOpen: bg => $$('[data-cp]', bg).forEach(b => b.onclick = async () => {
      const v = linhas[+b.dataset.cp][2];
      try { await navigator.clipboard.writeText(v); } catch {
        const ta = document.createElement('textarea'); ta.value = v; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      b.innerHTML = icon('check'); setTimeout(() => { b.innerHTML = icon('copy'); }, 1200);
    }),
  });
}
