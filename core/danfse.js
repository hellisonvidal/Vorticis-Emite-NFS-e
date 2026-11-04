// DANFSe v2.0 — Documento Auxiliar da NFS-e gerado localmente a partir do XML autorizado,
// conforme NT SE/CGNFS-e nº 008/2026 v1.02 (a API oficial de geração do DANFSe foi suspensa em 03/08/2026).
import qrcode from 'qrcode-generator';
import { parseXml, busca, no, txt, num, attr } from './xml.js';
import { MUN, CTRIB } from './tabelas.js';
import { URL_CONSULTA_PUBLICA } from './sefin.js';
import { LOGO_NFSE } from './logo-nfse.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const traco = v => (v === undefined || v === null || String(v).trim() === '' ? '-' : v);
const corta = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 3) + '...' : s; };
const moeda = v => (v === null || v === undefined || v === '' ? '-' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = v => (v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + '%');
const so = s => String(s ?? '').replace(/\D/g, '');
function docFmt(d) {
  const x = so(d);
  if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return d || '';
}
const cepFmt = c => (so(c).length === 8 ? so(c).replace(/(\d{2})(\d{3})(\d{3})/, '$1.$2-$3') : c || '');
function dataBR(d) { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'; }
function dataHoraBR(d) { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : '-'; }
const munUF = c => { const m = MUN.get(so(c)); return m ? `${m.nome} / ${m.uf}` : c || ''; };

const D = {
  ambGer: { 1: 'Prefeitura', 2: 'Sistema Nacional da NFS-e' },
  tpAmb: { 1: 'Produção', 2: 'Produção Restrita (Homologação)' },
  tpEmit: { 1: 'Prestador', 2: 'Tomador', 3: 'Intermediário' },
  cStat: { 100: 'NFS-e Gerada', 101: 'NFS-e de Substituição Gerada', 102: 'NFS-e de Decisão Judicial', 103: 'NFS-e Avulsa', 107: 'NFS-e MEI' },
  finNFSe: { 0: 'NFS-e regular' },
  opSimpNac: { 1: 'Não Optante', 2: 'Optante - Microempreendedor Individual (MEI)', 3: 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)' },
  regApTribSN: { 1: 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional', 2: 'Tributos federais pelo SN e ISSQN por fora do SN conforme legislação municipal', 3: 'Tributos federais e municipal por fora do SN conforme respectivas legislações' },
  tribISSQN: { 1: 'Operação Tributável', 2: 'Imunidade', 3: 'Exportação de Serviço', 4: 'Não Incidência' },
  tpRetISSQN: { 1: 'Não Retido', 2: 'Retido pelo Tomador', 3: 'Retido pelo Intermediário' },
  regEspTrib: { 0: 'Nenhum', 1: 'Ato Cooperado (Cooperativa)', 2: 'Estimativa', 3: 'Microempresa Municipal', 4: 'Notário ou Registrador', 5: 'Profissional Autônomo', 6: 'Sociedade de Profissionais', 9: 'Outros' },
  tpImunidade: { 0: 'Imunidade (tipo não informado)', 1: 'Patrimônio, renda ou serviços, uns dos outros', 2: 'Templos de qualquer culto', 3: 'Partidos, sindicatos, educação e assistência social', 4: 'Livros, jornais, periódicos e papel', 5: 'Fonogramas e videofonogramas' },
  tpSusp: { 1: 'Decisão Judicial', 2: 'Processo Administrativo' },
  tpRetPisCofins: { 0: 'PIS/COFINS/CSLL Não Retidos', 1: 'PIS/COFINS Retidos', 2: 'PIS/COFINS Não Retidos', 3: 'PIS/COFINS/CSLL Retidos', 4: 'PIS/COFINS Retidos, CSLL Não Retido', 5: 'PIS Retido, COFINS/CSLL Não Retido', 6: 'COFINS Retido, PIS/CSLL Não Retido', 7: 'PIS Não Retido, COFINS/CSLL Retidos', 8: 'PIS/COFINS Não Retidos, CSLL Retido', 9: 'COFINS Não Retido, PIS/CSLL Retidos' },
};
const desc = (tab, v) => (v === '' || v === null || v === undefined ? '-' : D[tab][v] || v);
// Quais contribuições estão retidas para cada tpRetPisCofins: [PIS, COFINS, CSLL]
const RETIDOS = { 0: [0, 0, 0], 1: [1, 1, 0], 2: [0, 0, 0], 3: [1, 1, 1], 4: [1, 1, 0], 5: [1, 0, 0], 6: [0, 1, 0], 7: [0, 1, 1], 8: [0, 0, 1], 9: [1, 0, 1] };

function pessoa(p) {
  if (!p) return null;
  const end = no(p, 'end');
  const nac = no(end, 'endNac'), ext = no(end, 'endExt');
  return {
    doc: txt(p, 'CNPJ') || txt(p, 'CPF') || txt(p, 'NIF'), im: txt(p, 'IM'), fone: txt(p, 'fone'), nome: txt(p, 'xNome'), email: txt(p, 'email'),
    mun: nac ? munUF(txt(nac, 'cMun')) : ext ? `${txt(ext, 'xCidade')} / ${txt(ext, 'cPais')}` : '',
    ibgeCep: nac ? `${txt(nac, 'cMun')} / ${cepFmt(txt(nac, 'CEP'))}` : ext ? txt(ext, 'cEndPost') : '',
    endereco: end ? [txt(end, 'xLgr'), txt(end, 'nro'), txt(end, 'xCpl'), txt(end, 'xBairro')].filter(Boolean).join(', ') : '',
  };
}

const cel = (label, valor, { span = 1, destaque = false } = {}) =>
  `<div class="c${destaque ? ' sh' : ''}" style="grid-column:span ${span}"><b>${esc(label)}</b><span>${esc(traco(valor))}</span></div>`;
const titulo = t => `<div class="c t"><b class="bt">${esc(t)}</b></div>`;
const bloco = linhas => `<div class="blk">${linhas.join('')}</div>`;
const vazio = texto => `<div class="blk"><div class="c t" style="grid-column:span 4"><b class="bt">${esc(texto)}</b></div></div>`;

/**
 * Gera o HTML (A4, página única) do DANFSe v2.0.
 * @param {string} xml XML da NFS-e
 * @param {{situacao?: 'autorizada'|'cancelada'|'substituida', simulacao?: boolean}} opts
 */
export function gerarDANFSe(xml, { situacao = 'autorizada', simulacao = false } = {}) {
  const doc = parseXml(xml);
  const inf = busca(doc, 'infNFSe');
  if (!inf) throw new Error('XML não é uma NFS-e.');
  const dps = busca(inf, 'infDPS');
  const chave = attr(inf, 'Id').replace(/^NFS/, '');
  const tpAmb = txt(dps, 'tpAmb');
  const emit = no(inf, 'emit');
  const enderEmit = no(emit, 'enderNac');
  const cTribNac = txt(dps, 'serv/cServ/cTribNac');
  const item99 = cTribNac.startsWith('99');

  // ---------------- cabeçalho / identificação ----------------
  const qr = qrcode(0, 'M');
  qr.addData(URL_CONSULTA_PUBLICA + chave);
  qr.make();
  const qrSvg = qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
  const municipioEmit = item99 ? '' : `Município: ${txt(inf, 'xLocEmi') || munUF(txt(enderEmit, 'cMun'))}${txt(enderEmit, 'UF') && !txt(inf, 'xLocEmi').includes('/') ? ' / ' + txt(enderEmit, 'UF') : ''}`;

  const prest = pessoa(no(dps, 'prest'));
  // Quando o emitente é o prestador, os dados cadastrais vêm do grupo emit da NFS-e
  if (prest && !prest.nome && emit) {
    Object.assign(prest, {
      nome: txt(emit, 'xNome'), fone: prest.fone || txt(emit, 'fone'), email: prest.email || txt(emit, 'email'), im: prest.im || txt(emit, 'IM'),
      mun: munUF(txt(enderEmit, 'cMun')), ibgeCep: `${txt(enderEmit, 'cMun')} / ${cepFmt(txt(enderEmit, 'CEP'))}`,
      endereco: [txt(enderEmit, 'xLgr'), txt(enderEmit, 'nro'), txt(enderEmit, 'xCpl'), txt(enderEmit, 'xBairro')].filter(Boolean).join(', '),
    });
  }
  const regTrib = no(dps, 'prest/regTrib');
  const toma = pessoa(no(dps, 'toma'));
  const interm = pessoa(no(dps, 'interm'));
  const ibsDps = no(dps, 'IBSCBS');
  const dest = pessoa(no(ibsDps, 'dest'));

  const pessoaBloco = (rot, p, { im = true, sn = false } = {}) => bloco([
    titulo(rot), cel('CNPJ / CPF / NIF', docFmt(p.doc)), im ? cel('Indicador Municipal (Inscrição)', p.im) : cel('', ''), cel('Telefone', p.fone),
    cel('Nome / Nome Empresarial', corta(p.nome, 80), { span: 2 }), cel('Município / Sigla UF', corta(p.mun, 37)), cel('Código IBGE / CEP', p.ibgeCep),
    cel('Endereço', corta(p.endereco, 80), { span: 2 }), cel('E-mail', corta(p.email, 80), { span: 2 }),
    ...(sn ? [cel('Simples Nacional na Data de Competência', corta(desc('opSimpNac', txt(regTrib, 'opSimpNac')), 40)), cel('Regime de Apuração Tributária pelo SN', corta(desc('regApTribSN', txt(regTrib, 'regApTribSN')), 80), { span: 3 })] : []),
  ]);

  // ---------------- serviço ----------------
  const cServ = no(dps, 'serv/cServ');
  const locPrest = no(dps, 'serv/locPrest');
  const descTrib = txt(inf, 'xTribMun') || txt(inf, 'xTribNac') || CTRIB.get(cTribNac)?.descricao || '';
  const servico = bloco([
    titulo('SERVIÇO PRESTADO'),
    cel('Código de Tributação Nacional / Municipal', `${cTribNac.replace(/(\d{2})(\d{2})(\d{2})/, '$1.$2.$3')}${txt(cServ, 'cTribMun') ? ' / ' + txt(cServ, 'cTribMun') : ''}`),
    cel('Código da NBS', txt(cServ, 'cNBS')),
    cel('Local da Prestação / Sigla UF / País', txt(locPrest, 'cLocPrestacao') ? munUF(txt(locPrest, 'cLocPrestacao')) : txt(locPrest, 'cPaisPrestacao')),
    cel('Descrição do Código de Tributação Nacional / Municipal', corta(descTrib, 200), { span: 4 }),
    `<div class="c desc" style="grid-column:span 4"><b>Descrição do Serviço</b><span>${esc(traco(txt(cServ, 'xDescServ')))}</span></div>`,
  ]);

  // ---------------- tributação municipal ----------------
  const tribMun = no(dps, 'valores/trib/tribMun');
  const vInf = no(inf, 'valores');
  const tribISSQN = txt(tribMun, 'tribISSQN');
  const regEsp = txt(regTrib, 'regEspTrib');
  const bm = no(tribMun, 'BM');
  const municipal = tribISSQN === '4' && !txt(vInf, 'vISSQN') ? vazio('TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN') : bloco([
    titulo('TRIBUTAÇÃO MUNICIPAL (ISSQN)'), cel('Tipo de Tributação do ISSQN', desc('tribISSQN', tribISSQN)),
    cel('Município / Sigla UF / País de Incidência do ISSQN', txt(inf, 'xLocIncid') ? `${txt(inf, 'xLocIncid')}` : munUF(txt(inf, 'cLocIncid')) || txt(tribMun, 'cPaisResult'), { span: 2 }),
    ...((regEsp && regEsp !== '0') || txt(tribMun, 'tpImunidade') || no(tribMun, 'exigSusp') ? [
      cel('Regime Especial de Tributação do ISSQN', desc('regEspTrib', regEsp)), cel('Tipo de Imunidade do ISSQN', txt(tribMun, 'tpImunidade') ? desc('tpImunidade', txt(tribMun, 'tpImunidade')) : '-'),
      cel('Suspensão da Exigibilidade do ISSQN', txt(tribMun, 'exigSusp/tpSusp') ? desc('tpSusp', txt(tribMun, 'exigSusp/tpSusp')) : 'Não'), cel('Número Processo Suspensão', txt(tribMun, 'exigSusp/nProcesso'))] : []),
    ...(bm || txt(vInf, 'vCalcDR') || num(dps, 'valores/vDescCondIncond/vDescIncond') ? [
      cel('Benefício Municipal', txt(bm, 'nBM')), cel('Cálculo do BM', moeda(num(vInf, 'vCalcBM'))), cel('Total Deduções/Reduções', moeda(num(vInf, 'vCalcDR') ?? num(dps, 'valores/vDedRed/vDR'))),
      cel('Desconto Incondicionado', moeda(num(dps, 'valores/vDescCondIncond/vDescIncond')))] : []),
    cel('BC ISSQN', moeda(num(vInf, 'vBC'))), cel('Alíquota Aplicada', pct(num(vInf, 'pAliqAplic'))),
    cel('Retenção do ISSQN', desc('tpRetISSQN', txt(tribMun, 'tpRetISSQN'))), cel('ISSQN Apurado', moeda(num(vInf, 'vISSQN'))),
  ]);

  // ---------------- tributação federal ----------------
  const fed = no(dps, 'valores/trib/tribFed');
  const pc = no(fed, 'piscofins');
  const tpRet = txt(pc, 'tpRetPisCofins');
  const [rPis, rCof, rCsll] = RETIDOS[tpRet] || [0, 0, 0];
  const vPis = num(pc, 'vPis') || 0, vCof = num(pc, 'vCofins') || 0, vCsll = num(fed, 'vRetCSLL') || 0;
  const contribRetidas = (rPis ? vPis : 0) + (rCof ? vCof : 0) + (rCsll || vCsll ? vCsll : 0);
  const ate2026 = (txt(dps, 'dCompet') || '9999') <= '2026-12-31';
  const federal = bloco([
    titulo('TRIBUTAÇÃO FEDERAL (EXCETO CBS)'), cel('IRRF', moeda(num(fed, 'vRetIRRF'))), cel('Contribuição Previdenciária - Retida', moeda(num(fed, 'vRetCP'))),
    cel('Contribuições Sociais - Retidas', moeda(contribRetidas || null)),
    ...(ate2026 ? [cel('PIS - Débito Apuração Própria', moeda(pc && !rPis ? vPis : null)), cel('COFINS - Débito Apuração Própria', moeda(pc && !rCof ? vCof : null)),
      cel('Descrição Contrib. Sociais - Retidas', tpRet ? corta(desc('tpRetPisCofins', tpRet), 60) : '-', { span: 2 })] : []),
  ]);

  // ---------------- IBS / CBS ----------------
  const ibs = no(inf, 'IBSCBS');
  let ibscbs = '';
  if (ibs || ibsDps) {
    const v = no(ibs, 'valores'), tot = no(ibs, 'totCIBS');
    const g = no(ibsDps, 'valores/trib/gIBSCBS');
    ibscbs = bloco([
      titulo('TRIBUTAÇÃO IBS / CBS'), cel('CST / cClassTrib', `${txt(g, 'CST')} / ${txt(g, 'cClassTrib')}`),
      cel('Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF', `${txt(ibsDps, 'cIndOp')} / ${txt(ibs, 'cLocalidadeIncid')} / ${txt(ibs, 'xLocalidadeIncid') || munUF(txt(ibs, 'cLocalidadeIncid'))}`, { span: 2 }),
      cel('Exclusões e Reduções da Base de Cálculo', moeda(num(v, 'vCalcReeRepRes'))), cel('Base de Cálculo Após Exclusões e Reduções', moeda(num(v, 'vBC'))),
      cel('Red. Alíquota IBS / Red. Alíquota CBS', `${pct(num(v, 'uf/pRedAliqUF') ?? 0)} / ${pct(num(v, 'mun/pRedAliqMun') ?? 0)} / ${pct(num(v, 'fed/pRedAliqCBS') ?? 0)}`),
      cel('Alíquota - IBS UF / IBS Mun', `${pct(num(v, 'uf/pIBSUF'))} / ${pct(num(v, 'mun/pIBSMun'))}`),
      cel('Aliq. Efetiva Municipal - IBS', pct(num(v, 'mun/pAliqEfetMun'))), cel('Valor Apurado Municipal - IBS', moeda(num(tot, 'gIBS/gIBSMunTot/vIBSMun'))),
      cel('Aliq. Efetiva Estadual - IBS', pct(num(v, 'uf/pAliqEfetUF'))), cel('Valor Apurado Estadual - IBS', moeda(num(tot, 'gIBS/gIBSUFTot/vIBSUF'))),
      cel('Valor Total Apurado - IBS', moeda(num(tot, 'gIBS/vIBSTot'))), cel('Alíquota - CBS', pct(num(v, 'fed/pCBS'))),
      cel('Alíquota Efetiva - CBS', pct(num(v, 'fed/pAliqEfetCBS'))), cel('Valor Total Apurado - CBS', moeda(num(tot, 'gCBS/vCBS'))),
    ]);
  }

  // ---------------- totais ----------------
  const tot = no(ibs, 'totCIBS');
  const vServ = num(dps, 'valores/vServPrest/vServ');
  const totalIBSCBS = ibs ? (num(tot, 'gIBS/vIBSTot') || 0) + (num(tot, 'gCBS/vCBS') || 0) : null;
  const totais = bloco([
    titulo('VALOR TOTAL DA NFS-E'), cel('VALOR DA OPERAÇÃO / SERVIÇO', moeda(vServ), { destaque: false }),
    cel('Desconto Incondicionado', moeda(num(dps, 'valores/vDescCondIncond/vDescIncond'))), cel('Desconto Condicionado', moeda(num(dps, 'valores/vDescCondIncond/vDescCond'))),
    cel('Total das Retenções (ISSQN / Federais)', moeda(num(vInf, 'vTotalRet'))), cel('VALOR LÍQUIDO DA NFS-e', moeda(num(vInf, 'vLiq'))),
    cel('Total do IBS/CBS', moeda(totalIBSCBS)), cel('VALOR LÍQUIDO DA NFS-e + IBS/CBS', moeda(num(tot, 'vTotNF') ?? num(vInf, 'vLiq')), { destaque: true }),
  ]);

  // ---------------- informações complementares ----------------
  const ic = no(dps, 'serv/infoCompl');
  const partes = [];
  const add = (rot, v) => { if (v) partes.push(`${rot} ${v}`); };
  add('Inf. Cont.:', txt(ic, 'xInfComp'));
  add('NFS-e Subst.:', txt(dps, 'subst/chSubstda'));
  add('Doc. Ref.:', txt(ic, 'docRef'));
  add('Cod. Obra:', txt(dps, 'serv/obra/cObra'));
  add('Insc. Imob.:', txt(dps, 'serv/obra/inscImobFisc') || txt(ibsDps, 'imovel/inscImobFisc'));
  add('Cod. Evt.:', txt(dps, 'serv/atvEvento/idAtvEvt'));
  add('Doc. Tec.:', txt(ic, 'idDocTec'));
  add('Núm. Ped.:', txt(ic, 'xPed'));
  add('Item Ped.:', [...(no(ic, 'gItemPed')?.childNodes || [])].map(n => n.textContent).filter(Boolean).join(', '));
  add('Inf. A. T. Mun.:', txt(inf, 'xOutInf'));
  const tt = no(dps, 'valores/trib/totTrib');
  let totaisAprox;
  if (no(tt, 'vTotTrib')) totaisAprox = `Federais: ${moeda(num(tt, 'vTotTrib/vTotTribFed'))}; Estaduais: ${moeda(num(tt, 'vTotTrib/vTotTribEst'))}; Municipais: ${moeda(num(tt, 'vTotTrib/vTotTribMun'))}`;
  else if (no(tt, 'pTotTrib')) totaisAprox = `Federais: ${pct(num(tt, 'pTotTrib/pTotTribFed'))}; Estaduais: ${pct(num(tt, 'pTotTrib/pTotTribEst'))}; Municipais: ${pct(num(tt, 'pTotTrib/pTotTribMun'))}`;
  else if (no(tt, 'pTotTribSN')) totaisAprox = `Simples Nacional: ${pct(num(tt, 'pTotTribSN'))}`;
  else totaisAprox = 'Não informados (Decreto nº 8.264/2014)';
  partes.push(`Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ${totaisAprox}`);

  const marca = situacao === 'cancelada' ? 'CANCELADA' : situacao === 'substituida' ? 'SUBSTITUÍDA' : '';
  const semValidade = simulacao ? 'SIMULAÇÃO — DOCUMENTO SEM VALOR FISCAL' : tpAmb === '2' ? 'NFS-e SEM VALIDADE JURÍDICA' : '';

  return `<div class="danfse-v2">
<style>
.danfse-v2{width:20.4cm;min-height:28.5cm;margin:0 auto;border:1pt solid #000;position:relative;background:#fff;color:#000;font:7pt 'Microsoft Sans Serif','Segoe UI',Arial,sans-serif;box-sizing:border-box;overflow:hidden}
.danfse-v2 *{box-sizing:border-box}
.danfse-v2 .hd{display:grid;grid-template-columns:5.1cm 1fr 5.09cm;align-items:center;min-height:1.16cm;background:#f2f2f2;border-bottom:.5pt solid #000;padding:.1cm .19cm}
.danfse-v2 .hd img{width:4cm;height:auto}
.danfse-v2 .hd .tt{text-align:center;font:bold 9pt Arial,sans-serif;line-height:1.25}
.danfse-v2 .hd .tt .sv{color:#e00000}
.danfse-v2 .hd .mn{font-size:8pt;line-height:1.2}.danfse-v2 .hd .mn small{display:block;font-size:6pt}
.danfse-v2 .blk{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:.5pt solid #000}
.danfse-v2 .c{padding:.06cm .19cm;min-height:.63cm;overflow:hidden}
.danfse-v2 .c b{display:block;font:bold 6pt Arial,sans-serif}
.danfse-v2 .c span{display:block;font-size:7pt;white-space:pre-wrap;word-break:break-word}
.danfse-v2 .c.t{display:flex;align-items:flex-start}
.danfse-v2 .c.t .bt,.danfse-v2 .id b{font:bold 7pt Arial,sans-serif;text-transform:uppercase}
.danfse-v2 .blk>.c.t{background:#f2f2f2}
.danfse-v2 .sh{background:#f2f2f2}
.danfse-v2 .id{display:grid;grid-template-columns:repeat(3,1fr) 5.09cm;border-bottom:.5pt solid #000}
.danfse-v2 .qr{grid-row:span 4;display:flex;flex-direction:column;align-items:center;padding:.1cm}
.danfse-v2 .qr svg{width:1.7cm;height:1.7cm}
.danfse-v2 .qr p{font-size:6pt;margin:.08cm 0 0;text-align:center;line-height:1.15}
.danfse-v2 .desc{min-height:2.4cm}
.danfse-v2 .ic{padding:.06cm .19cm;min-height:2.2cm;border-bottom:.5pt solid #000}
.danfse-v2 .ic b{font:bold 7pt Arial,sans-serif}.danfse-v2 .ic div{font-size:7pt}
.danfse-v2 .wm{position:absolute;top:42%;left:0;right:0;text-align:center;transform:rotate(-35deg);font:50pt Arial,sans-serif;color:#a6a6a6;opacity:.55;pointer-events:none}
@media print{@page{size:A4 portrait;margin:.18cm}.danfse-v2{border-width:1pt}}
</style>
<div class="hd"><img src="${LOGO_NFSE}" alt="NFS-e"><div class="tt">DANFSe v2.0<br>Documento Auxiliar da NFS-e${semValidade ? `<br><span class="sv">${esc(semValidade)}</span>` : ''}</div>
<div class="mn">${esc(corta(municipioEmit, 50))}<small>Ambiente Gerador: ${esc(desc('ambGer', txt(inf, 'ambGer')))}</small><small>Tipo de Ambiente: ${esc(desc('tpAmb', tpAmb))}</small></div></div>
<div class="id">
  <div class="c" style="grid-column:span 3"><b>CHAVE DE ACESSO DA NFS-E</b><span style="font-size:8pt;letter-spacing:.3pt">${esc(chave)}</span></div>
  <div class="qr">${qrSvg}<p>A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e</p></div>
  <div class="c"><b>NÚMERO DA NFS-E</b><span>${esc(traco(txt(inf, 'nNFSe')))}</span></div><div class="c"><b>COMPETÊNCIA DA NFS-E</b><span>${dataBR(txt(dps, 'dCompet'))}</span></div><div class="c"><b>DATA E HORA DA EMISSÃO DA NFS-E</b><span>${dataHoraBR(txt(inf, 'dhProc'))}</span></div>
  <div class="c"><b>NÚMERO DA DPS</b><span>${esc(traco(txt(dps, 'nDPS')))}</span></div><div class="c"><b>SÉRIE DA DPS</b><span>${esc(traco(txt(dps, 'serie')))}</span></div><div class="c"><b>DATA E HORA DA EMISSÃO DA DPS</b><span>${dataHoraBR(txt(dps, 'dhEmi'))}</span></div>
  <div class="c sh"><b>EMITENTE DA NFS-E</b><span>${esc(desc('tpEmit', txt(dps, 'tpEmit')))}</span></div><div class="c"><b>SITUAÇÃO DA NFS-E</b><span>${esc(corta(desc('cStat', txt(inf, 'cStat')), 40))}</span></div><div class="c"><b>FINALIDADE</b><span>${esc(desc('finNFSe', txt(ibsDps, 'finNFSe') || '0'))}</span></div>
</div>
${prest ? pessoaBloco('PRESTADOR / FORNECEDOR', prest, { sn: true }) : ''}
${toma ? pessoaBloco('TOMADOR / ADQUIRENTE', toma) : vazio('TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e')}
${dest ? pessoaBloco('DESTINATÁRIO DA OPERAÇÃO', dest, { im: false }) : vazio(toma ? 'O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO' : 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e')}
${interm ? pessoaBloco('INTERMEDIÁRIO DA OPERAÇÃO', interm) : vazio('INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e')}
${servico}${municipal}${federal}${ibscbs}${totais}
<div class="ic"><b>INFORMAÇÕES COMPLEMENTARES</b>${partes.map(p => `<div>${esc(p)};</div>`).join('')}</div>
${marca ? `<div class="wm">${marca}</div>` : ''}
</div>`;
}
