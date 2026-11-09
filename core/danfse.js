// DANFSe v2.0 — Documento Auxiliar da NFS-e gerado localmente a partir do XML autorizado,
// conforme NT SE/CGNFS-e nº 008/2026 v1.02 (a API oficial de geração do DANFSe foi suspensa em 03/08/2026).
//
// Cobertura da NT 008:
//  2.1.1–2.1.12  todos os blocos e campos, a partir das tags do XML (nada que não conste do XML é impresso)
//  2.1.13        canhoto opcional (opção `canhoto`)
//  2.2           A4 retrato, página única, margens de 0,18 cm, borda de 1 pt, linhas de 0,5 pt, sombreamento cinza 5%
//  2.3 / Notas   blocos não identificados (Nota 2), destinatário = tomador (Nota 3), operação não sujeita ao ISSQN (Nota 4),
//                supressão da linha de endereço/e-mail (Nota 1, opção `suprimirEndereco`), supressão de linhas sem dados
//                (Nota 5, opção `suprimirLinhasVazias`), linha PIS/COFINS só até competência 2026 (Nota 6),
//                NFS-e substituída/obra/imóvel/evento em Inf. Complementares (Notas 7–9), totais aproximados (Nota 10),
//                traço (-) para campos sem informação (Nota 12)
//  2.4           fontes Arial (títulos) e Microsoft Sans Serif (conteúdo), tamanhos 9/8/7/6 pt, QR Code ≥ 1,52 cm,
//                "NFS-e SEM VALIDADE JURÍDICA" em vermelho quando tpAmb = 2, reticências ao exceder o tamanho do campo
//  2.5           marca d'água "CANCELADA"/"SUBSTITUÍDA" diagonal, Arial ≥ 50 pt, cinza K35
import qrcode from 'qrcode-generator';
import { parseXml, busca, no, txt, num, attr } from './xml.js';
import { MUN, CTRIB } from './tabelas.js';
import { URL_CONSULTA_PUBLICA } from './sefin.js';
import { LOGO_NFSE } from './logo-nfse.js';

export const OPCOES_DANFSE = { canhoto: false, suprimirEndereco: false, suprimirLinhasVazias: true };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const vazioV = v => v === undefined || v === null || String(v).trim() === '';
const traco = v => (vazioV(v) ? '-' : v);
const corta = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 3) + '...' : s; };
const fmtN = (v, max = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: max });
const moeda = v => (vazioV(v) || Number.isNaN(Number(v)) ? '-' : 'R$ ' + fmtN(v));
const pct = v => (vazioV(v) || Number.isNaN(Number(v)) ? '-' : fmtN(v, 4) + '%');
const so = s => String(s ?? '').replace(/\D/g, '');
const soma = (...vs) => (vs.every(v => v === null || v === undefined) ? null : vs.reduce((a, v) => a + (Number(v) || 0), 0));
const r2 = v => (v === null ? null : Math.round(v * 100) / 100);

export function docFmt(d) {
  const x = so(d);
  if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return d || '';
}
const cepFmt = c => (so(c).length === 8 ? so(c).replace(/(\d{2})(\d{3})(\d{3})/, '$1.$2-$3') : c || '');
const nbsFmt = c => (so(c).length === 9 ? so(c).replace(/(\d)(\d{4})(\d{2})(\d{2})/, '$1.$2.$3.$4') : c || '');
const ctnFmt = c => (so(c).length === 6 ? so(c).replace(/(\d{2})(\d{2})(\d{2})/, '$1.$2.$3') : c || '');
function dataBR(d) { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'; }
function dataHoraBR(d) { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : '-'; }
const munUF = c => { const m = MUN.get(so(c)); return m ? `${m.nome} / ${m.uf}` : c || ''; };
const ufDe = c => MUN.get(so(c))?.uf || '';
// Nomes de município do XML às vezes já trazem a UF ("São Paulo/SP"): a UF é concatenada separadamente
const nomeMun = s => String(s || '').replace(/\s*[/-]\s*[A-Z]{2}$/, '');

// Descrições das opções do leiaute (tiposSimples_v1.01.xsd)
const D = {
  ambGer: { 1: 'Prefeitura', 2: 'Sistema Nacional da NFS-e' },
  tpAmb: { 1: 'Produção', 2: 'Homologação (Produção Restrita)' },
  tpEmit: { 1: 'Prestador', 2: 'Tomador', 3: 'Intermediário' },
  cStat: { 100: 'NFS-e Gerada', 101: 'NFS-e de Substituição Gerada', 102: 'NFS-e de Decisão Judicial', 103: 'NFS-e Avulsa', 107: 'NFS-e MEI' },
  finNFSe: { 0: 'NFS-e regular' },
  opSimpNac: { 1: 'Não Optante', 2: 'Optante - Microempreendedor Individual (MEI)', 3: 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)' },
  regApTribSN: { 1: 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional', 2: 'Regime de apuração dos tributos federais pelo SN e o ISSQN pela NFS-e conforme respectiva legislação municipal do tributo', 3: 'Regime de apuração dos tributos federais e municipal pela NFS-e conforme respectivas legislações federal e municipal de cada tributo' },
  tribISSQN: { 1: 'Operação Tributável', 2: 'Imunidade', 3: 'Exportação de Serviço', 4: 'Não Incidência' },
  tpRetISSQN: { 1: 'Não Retido', 2: 'Retido pelo Tomador', 3: 'Retido pelo Intermediário' },
  regEspTrib: { 0: 'Nenhum', 1: 'Ato Cooperado (Cooperativa)', 2: 'Estimativa', 3: 'Microempresa Municipal', 4: 'Notário ou Registrador', 5: 'Profissional Autônomo', 6: 'Sociedade de Profissionais', 9: 'Outros' },
  tpImunidade: { 0: 'Imunidade (tipo não informado na nota de origem)', 1: 'Patrimônio, renda ou serviços, uns dos outros', 2: 'Templos de qualquer culto', 3: 'Patrimônio, renda ou serviços dos partidos políticos, sindicatos, educação e assistência social', 4: 'Livros, jornais, periódicos e o papel destinado a sua impressão', 5: 'Fonogramas e videofonogramas musicais produzidos no Brasil' },
  tpSusp: { 1: 'Exigibilidade Suspensa por Decisão Judicial', 2: 'Exigibilidade Suspensa por Processo Administrativo' },
  tpBM: { 1: 'Isenção', 2: 'Redução da BC em %', 3: 'Redução da BC em R$', 4: 'Alíquota Diferenciada' },
  tpRetPisCofins: { 0: 'PIS/COFINS/CSLL Não Retidos', 1: 'PIS/COFINS Retidos', 2: 'PIS/COFINS Não Retidos', 3: 'PIS/COFINS/CSLL Retidos', 4: 'PIS/COFINS Retidos, CSLL Não Retido', 5: 'PIS Retido, COFINS/CSLL Não Retido', 6: 'COFINS Retido, PIS/CSLL Não Retido', 7: 'PIS Não Retido, COFINS/CSLL Retidos', 8: 'PIS/COFINS Não Retidos, CSLL Retido', 9: 'COFINS Não Retido, PIS/CSLL Retidos' },
};
const desc = (tab, v) => (vazioV(v) ? '-' : D[tab][v] || v);
// PIS e COFINS retidos para cada tpRetPisCofins (NT 008 v1.02: tpRetPisCofins = 1 soma PIS/COFINS às retenções e zera o débito próprio)
const RETIDOS = { 0: [0, 0], 1: [1, 1], 2: [0, 0], 3: [1, 1], 4: [1, 1], 5: [1, 0], 6: [0, 1], 7: [0, 1], 8: [0, 0], 9: [1, 0] };

function pessoa(p) {
  if (!p) return null;
  const end = no(p, 'end');
  const nac = no(end, 'endNac'), ext = no(end, 'endExt');
  return {
    doc: txt(p, 'CNPJ') || txt(p, 'CPF') || txt(p, 'NIF') || (txt(p, 'cNaoNIF') ? 'NIF não informado' : ''), im: txt(p, 'IM'), fone: txt(p, 'fone'), nome: txt(p, 'xNome'), email: txt(p, 'email'),
    mun: nac ? munUF(txt(nac, 'cMun')) : ext ? [txt(ext, 'xCidade'), txt(ext, 'xEstProvReg'), txt(ext, 'cPais')].filter(Boolean).join(' / ') : '',
    ibgeCep: nac ? `${txt(nac, 'cMun')} / ${cepFmt(txt(nac, 'CEP'))}` : ext ? `${txt(ext, 'cEndPost')} (ext)` : '',
    endereco: end ? [txt(end, 'xLgr'), txt(end, 'nro'), txt(end, 'xCpl'), txt(end, 'xBairro')].filter(Boolean).join(', ') : '',
  };
}

const cel = (label, valor, { span = 1, sh = false, grande = false } = {}) =>
  `<div class="c${sh ? ' sh' : ''}${grande ? ' g' : ''}" style="grid-column:span ${span}"><b>${esc(label)}</b><span>${esc(traco(valor))}</span></div>`;
const titulo = t => `<div class="c t"><b class="bt">${esc(t)}</b></div>`;
const bloco = (linhas, cls = '') => `<div class="blk${cls ? ' ' + cls : ''}">${linhas.filter(Boolean).join('')}</div>`;
const vazio = texto => `<div class="blk vz"><div class="c t" style="grid-column:span 4"><b class="bt">${esc(texto)}</b></div></div>`;
// Linha suprimível (Nota 5): só imprime se algum valor existir
const temDados = (...vs) => vs.some(v => !vazioV(v) && v !== '-');

export const ESTILO_DANFSE = `<style>
.danfse-v2{width:20.6cm;height:29.2cm;margin:0 auto;display:flex;flex-direction:column;border:1pt solid #000;position:relative;background:#fff;color:#000;font:7pt 'Microsoft Sans Serif','MS Sans Serif','Segoe UI',Arial,sans-serif;box-sizing:border-box;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.danfse-v2 *{box-sizing:border-box}
.danfse-v2 .hd{display:grid;grid-template-columns:5.1cm 1fr 5.09cm;align-items:center;min-height:1.16cm;background:#f2f2f2;border-bottom:.5pt solid #000;padding:.08cm .19cm}
.danfse-v2 .hd img{width:4cm;height:.81cm;object-fit:contain;object-position:left center}
.danfse-v2 .hd .tt{text-align:center;font:bold 9pt Arial,sans-serif;line-height:1.25}
.danfse-v2 .hd .tt .sv{color:#ff0000}
.danfse-v2 .hd .mn{font-size:8pt;line-height:1.2}.danfse-v2 .hd .mn small{display:block;font-size:6pt}
.danfse-v2 .blk{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:.5pt solid #000;flex:none}
.danfse-v2 .blk.vz .c{min-height:.32cm}
.danfse-v2 .c{padding:.05cm .19cm;min-height:.63cm;overflow:hidden}
.danfse-v2 .c b{display:block;font:bold 6pt Arial,sans-serif}
.danfse-v2 .c span{display:block;font-size:7pt;white-space:pre-wrap;word-break:break-word}
.danfse-v2 .c.g{min-height:.67cm}.danfse-v2 .c.g b{font-size:7pt;text-transform:uppercase}
.danfse-v2 .c.t .bt,.danfse-v2 .id b{font:bold 7pt Arial,sans-serif;text-transform:uppercase}
.danfse-v2 .blk>.c.t,.danfse-v2 .sh{background:#f2f2f2}
.danfse-v2 .id{display:grid;grid-template-columns:repeat(3,1fr) 5.09cm;border-bottom:.5pt solid #000;flex:none}
.danfse-v2 .id .c{min-height:.67cm}
.danfse-v2 .qr{grid-column:4;grid-row:1/span 4;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:.08cm .05cm}
.danfse-v2 .qr svg{width:1.6cm;height:1.6cm;display:block}
.danfse-v2 .qr p{font-size:6pt;margin:.06cm 0 0;text-align:center;line-height:1.15;letter-spacing:-.1pt}
.danfse-v2 .dtrib{grid-column:span 4;padding:.03cm .19cm;font-size:7pt;min-height:.38cm}
.danfse-v2 .desc{grid-column:span 4;min-height:2.2cm}
.danfse-v2 .ic{padding:.05cm .19cm;flex:1 1 auto;min-height:1.6cm;overflow:hidden;display:flex;flex-direction:column}
.danfse-v2 .ic .tx{flex:0 1 auto;min-height:0;overflow:hidden}.danfse-v2 .ic .tt2{flex:none}
.danfse-v2 .ic b{font:bold 7pt Arial,sans-serif}.danfse-v2 .ic p{font-size:7pt;margin:.03cm 0 0;white-space:pre-wrap;word-break:break-word}
.danfse-v2 .can{display:grid;grid-template-columns:repeat(4,1fr);border-top:.5pt dashed #000;flex:none}
.danfse-v2 .can .c{min-height:.67cm;border-right:.5pt solid #000}.danfse-v2 .can .c:last-child{border-right:0}
.danfse-v2 .can .c b{font-size:7pt;text-transform:uppercase}
.danfse-v2 .wm{position:absolute;top:44%;left:-10%;right:-10%;text-align:center;transform:rotate(-35deg);font:96pt Arial,sans-serif;color:#a6a6a6;mix-blend-mode:multiply;pointer-events:none;letter-spacing:4pt}
.danfse-pg+.danfse-pg{margin-top:12px}
@media print{@page{size:A4 portrait;margin:.18cm}html,body{margin:0;padding:0;background:#fff}.danfse-pg{break-after:page;page-break-after:always}.danfse-pg:last-child{break-after:auto;page-break-after:auto}.danfse-pg+.danfse-pg{margin-top:0}}
</style>`;

/**
 * Gera o HTML (A4, página única) do DANFSe v2.0.
 * @param {string} xml XML da NFS-e
 * @param {{situacao?: string, simulacao?: boolean, canhoto?: boolean, suprimirEndereco?: boolean, suprimirLinhasVazias?: boolean, estilo?: boolean}} opts
 */
export function gerarDANFSe(xml, opts = {}) {
  const o = { ...OPCOES_DANFSE, situacao: 'autorizada', simulacao: false, estilo: true, ...opts };
  const doc = parseXml(xml);
  const inf = busca(doc, 'infNFSe');
  if (!inf) throw new Error('XML não é uma NFS-e.');
  const dps = busca(inf, 'infDPS');
  if (!dps) throw new Error('XML da NFS-e sem a DPS (infDPS).');
  const chave = attr(inf, 'Id').replace(/^NFS/, '');
  const tpAmb = txt(dps, 'tpAmb');
  const emit = no(inf, 'emit');
  const enderEmit = no(emit, 'enderNac');
  const cTribNac = txt(dps, 'serv/cServ/cTribNac');
  const ate2026 = (txt(dps, 'dCompet') || '9999') <= '2026-12-31';

  // ---------------- cabeçalho / identificação (2.1.2 e 2.4.3) ----------------
  const qr = qrcode(0, 'M');
  qr.addData(URL_CONSULTA_PUBLICA + chave);
  qr.make();
  const qrSvg = qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
  // Município do emitente: não exibir quando o item do código de tributação nacional for 99
  const ufEmit = txt(enderEmit, 'UF') || ufDe(txt(enderEmit, 'cMun'));
  const municipioEmit = cTribNac.startsWith('99') ? '' : `Município: ${corta(`${nomeMun(txt(inf, 'xLocEmi')) || (MUN.get(so(txt(enderEmit, 'cMun')))?.nome ?? '')}${ufEmit ? ' / ' + ufEmit : ''}`, 37)}`;

  const prest = pessoa(no(dps, 'prest'));
  // Quando o emitente é o prestador, nome e endereço vêm do grupo emit da NFS-e
  if (prest && emit && txt(dps, 'tpEmit') !== '2' && txt(dps, 'tpEmit') !== '3') {
    Object.assign(prest, {
      nome: prest.nome || txt(emit, 'xNome'), fone: prest.fone || txt(emit, 'fone'), email: prest.email || txt(emit, 'email'), im: prest.im || txt(emit, 'IM'),
      ...(!prest.mun && enderEmit ? {
        mun: munUF(txt(enderEmit, 'cMun')), ibgeCep: `${txt(enderEmit, 'cMun')} / ${cepFmt(txt(enderEmit, 'CEP'))}`,
        endereco: [txt(enderEmit, 'xLgr'), txt(enderEmit, 'nro'), txt(enderEmit, 'xCpl'), txt(enderEmit, 'xBairro')].filter(Boolean).join(', '),
      } : {}),
    });
  }
  const regTrib = no(dps, 'prest/regTrib');
  const toma = pessoa(no(dps, 'toma'));
  const interm = pessoa(no(dps, 'interm'));
  const ibsDps = no(dps, 'IBSCBS');
  const dest = pessoa(no(ibsDps, 'dest'));

  const pessoaBloco = (rot, p, { im = true, sn = false } = {}) => bloco([
    titulo(rot), cel('CNPJ / CPF / NIF', corta(docFmt(p.doc), 40)), im ? cel('Indicador Municipal (Inscrição)', corta(p.im, 15)) : '<div class="c"></div>', cel('Telefone', corta(p.fone, 20)),
    cel('Nome / Nome Empresarial', corta(p.nome, 80), { span: 2 }), cel('Município / Sigla UF', corta(p.mun, 37)), cel('Código IBGE / CEP', corta(p.ibgeCep, 24)),
    ...(o.suprimirEndereco ? [] : [cel('Endereço', corta(p.endereco, 80), { span: 2 }), cel('E-mail', corta(p.email, 80), { span: 2 })]),
    ...(sn ? [cel('Simples Nacional na Data de Competência', corta(desc('opSimpNac', txt(regTrib, 'opSimpNac')), 40)), cel('Regime de Apuração Tributária pelo SN', corta(desc('regApTribSN', txt(regTrib, 'regApTribSN')), 80), { span: 3 })] : []),
  ]);

  // ---------------- serviço prestado (2.1.7) ----------------
  const cServ = no(dps, 'serv/cServ');
  const locPrest = no(dps, 'serv/locPrest');
  const descTrib = txt(inf, 'xTribMun') || txt(inf, 'xTribNac') || CTRIB.get(cTribNac)?.descricao || '';
  const cLocPrest = txt(locPrest, 'cLocPrestacao');
  const localPrest = cLocPrest ? `${nomeMun(txt(inf, 'xLocPrestacao')) || MUN.get(so(cLocPrest))?.nome || cLocPrest} / ${ufDe(cLocPrest) || '-'} / BR`
    : txt(locPrest, 'cPaisPrestacao') ? `${txt(inf, 'xLocPrestacao') || '-'} / - / ${txt(locPrest, 'cPaisPrestacao')}` : '';
  const servico = bloco([
    titulo('SERVIÇO PRESTADO'),
    cel('Código de Tributação Nacional / Municipal', `${ctnFmt(cTribNac)}${txt(cServ, 'cTribMun') ? ' / ' + txt(cServ, 'cTribMun') : ''}`),
    cel('Código da NBS', nbsFmt(txt(cServ, 'cNBS'))),
    cel('Local da Prestação / Sigla UF / País', corta(localPrest, 42)),
    // Descrição do código de tributação: sem título no DANFSe (municipal se houver, senão nacional)
    `<div class="dtrib">${esc(corta(traco(descTrib), 170))}</div>`,
    `<div class="c desc"><b>Descrição do Serviço</b><span>${esc(corta(traco(txt(cServ, 'xDescServ')), 1300))}</span></div>`,
  ]);

  // ---------------- tributação municipal (2.1.8) ----------------
  const tribMun = no(dps, 'valores/trib/tribMun');
  const vInf = no(inf, 'valores');
  const ibs = no(inf, 'IBSCBS');
  const vIbs = no(ibs, 'valores');
  const tribISSQN = txt(tribMun, 'tribISSQN');
  const regEsp = txt(regTrib, 'regEspTrib');
  const bm = no(tribMun, 'BM');
  const vDescIncond = num(dps, 'valores/vDescCondIncond/vDescIncond');
  const vCalcReeRepRes = num(vIbs, 'vCalcReeRepRes');
  let municipal;
  if (!tribMun || tribISSQN === '4') municipal = vazio('TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN');
  else {
    const cLocIncid = txt(inf, 'cLocIncid');
    const incid = tribISSQN === '3' ? `- / - / ${txt(tribMun, 'cPaisResult') || '-'}`
      : cLocIncid || txt(inf, 'xLocIncid') ? `${nomeMun(txt(inf, 'xLocIncid')) || MUN.get(so(cLocIncid))?.nome || cLocIncid} / ${ufDe(cLocIncid) || '-'} / BR` : '';
    const lRegime = [regEsp && regEsp !== '0' ? desc('regEspTrib', regEsp) : '', txt(tribMun, 'tpImunidade') ? desc('tpImunidade', txt(tribMun, 'tpImunidade')) : '',
      txt(tribMun, 'exigSusp/tpSusp') ? desc('tpSusp', txt(tribMun, 'exigSusp/tpSusp')) : '', txt(tribMun, 'exigSusp/nProcesso')];
    const totalDR = soma(num(dps, 'valores/vDedRed/vDR') ?? num(vInf, 'vCalcDR'), vCalcReeRepRes);
    const lBM = [txt(vInf, 'tpBM') ? desc('tpBM', txt(vInf, 'tpBM')) : txt(bm, 'nBM') ? `Nº ${txt(bm, 'nBM')}` : '', num(vInf, 'vCalcBM') ?? num(bm, 'vRedBCBM'), r2(totalDR), vDescIncond];
    municipal = bloco([
      titulo('TRIBUTAÇÃO MUNICIPAL (ISSQN)'), cel('Tipo de Tributação do ISSQN', desc('tribISSQN', tribISSQN)),
      cel('Município / Sigla UF / País de Incidência do ISSQN', corta(incid, 42), { span: 2 }),
      ...(!o.suprimirLinhasVazias || temDados(...lRegime) ? [
        cel('Regime Especial de Tributação do ISSQN', desc('regEspTrib', regEsp)), cel('Tipo de Imunidade do ISSQN', corta(lRegime[1], 40)),
        cel('Suspensão da Exigibilidade do ISSQN', corta(lRegime[2], 40)), cel('Número Processo Suspensão', corta(lRegime[3], 30))] : []),
      ...(!o.suprimirLinhasVazias || temDados(...lBM) ? [
        cel('Benefício Municipal', corta(lBM[0], 40)), cel('Cálculo do BM', moeda(lBM[1])), cel('Total Deduções/Reduções', moeda(lBM[2])), cel('Desconto Incondicionado', moeda(lBM[3]))] : []),
      cel('BC ISSQN', moeda(num(vInf, 'vBC'))), cel('Alíquota Aplicada', pct(num(vInf, 'pAliqAplic'))),
      cel('Retenção do ISSQN', desc('tpRetISSQN', txt(tribMun, 'tpRetISSQN'))), cel('ISSQN Apurado', moeda(num(vInf, 'vISSQN'))),
    ]);
  }

  // ---------------- tributação federal, exceto CBS (2.1.9) ----------------
  const fed = no(dps, 'valores/trib/tribFed');
  const pc = no(fed, 'piscofins');
  const tpRet = txt(pc, 'tpRetPisCofins');
  const [rPis, rCof] = RETIDOS[tpRet] || [0, 0];
  const vPis = num(pc, 'vPis'), vCof = num(pc, 'vCofins'), vCsll = num(fed, 'vRetCSLL');
  const contribRetidas = soma(vCsll, rPis ? vPis : null, rCof ? vCof : null);
  const federal = bloco([
    titulo('TRIBUTAÇÃO FEDERAL (EXCETO CBS)'), cel('IRRF', moeda(num(fed, 'vRetIRRF'))), cel('Contribuição Previdenciária - Retida', moeda(num(fed, 'vRetCP'))),
    cel('Contribuições Sociais - Retidas', moeda(r2(contribRetidas))),
    ...(ate2026 ? [cel('PIS - Débito Apuração Própria', moeda(pc ? (rPis ? 0 : vPis) : null)), cel('COFINS - Débito Apuração Própria', moeda(pc ? (rCof ? 0 : vCof) : null)),
      cel('Descrição Contrib. Sociais - Retidas', tpRet ? corta(desc('tpRetPisCofins', tpRet), 40) : '-', { span: 2 })] : []),
  ]);

  // ---------------- IBS / CBS (2.1.10) ----------------
  const tot = no(ibs, 'totCIBS');
  const g = no(ibsDps, 'valores/trib/gIBSCBS');
  const cLocIncIbs = txt(ibs, 'cLocalidadeIncid');
  const exclusoes = ibs ? soma(vDescIncond, vCalcReeRepRes, num(vInf, 'vISSQN'), ate2026 ? vPis : null, ate2026 ? vCof : null) : null;
  const ibscbs = bloco([
    titulo('TRIBUTAÇÃO IBS / CBS'), cel('CST / cClassTrib', g ? `${txt(g, 'CST') || '-'} / ${txt(g, 'cClassTrib') || '-'}` : ''),
    cel('Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF',
      ibs || ibsDps ? corta(`${txt(ibsDps, 'cIndOp') || '-'} / ${cLocIncIbs || '-'} / ${nomeMun(txt(ibs, 'xLocalidadeIncid')) || MUN.get(so(cLocIncIbs))?.nome || '-'} / ${txt(ibs, 'UFIncid') || ufDe(cLocIncIbs) || '-'}`, 56) : '', { span: 2 }),
    cel('Exclusões e Reduções da Base de Cálculo', moeda(r2(exclusoes))), cel('Base de Cálculo Após Exclusões e Reduções', moeda(num(vIbs, 'vBC'))),
    cel('Red. Alíquota IBS / Red. Alíquota CBS', vIbs ? `${pct(num(vIbs, 'uf/pRedAliqUF') ?? 0)} / ${pct(num(vIbs, 'mun/pRedAliqMun') ?? 0)} / ${pct(num(vIbs, 'fed/pRedAliqCBS') ?? 0)}` : ''),
    cel('Alíquota - IBS UF / IBS Mun', vIbs ? `${pct(num(vIbs, 'uf/pIBSUF'))} / ${pct(num(vIbs, 'mun/pIBSMun'))}` : ''),
    cel('Aliq. Efetiva Municipal - IBS', pct(num(vIbs, 'mun/pAliqEfetMun'))), cel('Valor Apurado Municipal - IBS', moeda(num(tot, 'gIBS/gIBSMunTot/vIBSMun'))),
    cel('Aliq. Efetiva Estadual - IBS', pct(num(vIbs, 'uf/pAliqEfetUF'))), cel('Valor Apurado Estadual - IBS', moeda(num(tot, 'gIBS/gIBSUFTot/vIBSUF'))),
    cel('Valor Total Apurado - IBS', moeda(num(tot, 'gIBS/vIBSTot'))), cel('Alíquota - CBS', pct(num(vIbs, 'fed/pCBS'))),
    cel('Alíquota Efetiva - CBS', pct(num(vIbs, 'fed/pAliqEfetCBS'))), cel('Valor Total Apurado - CBS', moeda(num(tot, 'gCBS/vCBS'))),
  ]);

  // ---------------- valor total (2.1.11) ----------------
  const totalIBSCBS = tot ? soma(num(tot, 'gIBS/vIBSTot'), num(tot, 'gCBS/vCBS')) : null;
  const totais = bloco([
    titulo('VALOR TOTAL DA NFS-E'), cel('Valor da Operação / Serviço', moeda(num(dps, 'valores/vServPrest/vServ')), { grande: true }),
    cel('Desconto Incondicionado', moeda(vDescIncond)), cel('Desconto Condicionado', moeda(num(dps, 'valores/vDescCondIncond/vDescCond'))),
    cel('Total das Retenções (ISSQN / Federais)', moeda(num(vInf, 'vTotalRet'))), cel('Valor Líquido da NFS-e', moeda(num(vInf, 'vLiq')), { grande: true }),
    cel('Total do IBS/CBS', moeda(r2(totalIBSCBS))), cel('Valor Líquido da NFS-e + IBS/CBS', moeda(num(tot, 'vTotNF') ?? num(vInf, 'vLiq')), { sh: true, grande: true }),
  ]);

  // ---------------- informações complementares (2.1.12, Notas 7 a 10) ----------------
  const ic = no(dps, 'serv/infoCompl');
  const partes = [];
  const add = (rot, v) => { if (!vazioV(v)) partes.push(`${rot} ${v}`); };
  add('Inf. Cont.:', txt(ic, 'xInfComp'));
  add('NFS-e Subst.:', txt(dps, 'subst/chSubstda'));
  add('Doc. Ref.:', txt(ic, 'docRef'));
  add('Cod. Obra:', txt(dps, 'serv/obra/cObra'));
  add('Insc. Imob.:', txt(dps, 'serv/obra/inscImobFisc') || txt(ibsDps, 'imovel/inscImobFisc'));
  add('Cod. Evt.:', txt(dps, 'serv/atvEvento/idAtvEvt'));
  add('Doc. Tec.:', txt(ic, 'idDocTec'));
  add('Núm. Ped.:', txt(ic, 'xPed'));
  const itens = []; for (let n = no(ic, 'gItemPed')?.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && n.textContent.trim()) itens.push(n.textContent.trim());
  add('Item Ped.:', itens.join(', '));
  add('Inf. A. T. Mun.:', txt(inf, 'xOutInf'));
  const tt = no(dps, 'valores/trib/totTrib');
  let totaisAprox;
  if (no(tt, 'vTotTrib')) totaisAprox = `Federais: ${moeda(num(tt, 'vTotTrib/vTotTribFed'))}; Estaduais: ${moeda(num(tt, 'vTotTrib/vTotTribEst'))}; Municipais: ${moeda(num(tt, 'vTotTrib/vTotTribMun'))}`;
  else if (no(tt, 'pTotTrib')) totaisAprox = `Federais: ${pct(num(tt, 'pTotTrib/pTotTribFed'))}; Estaduais: ${pct(num(tt, 'pTotTrib/pTotTribEst'))}; Municipais: ${pct(num(tt, 'pTotTrib/pTotTribMun'))}`;
  else if (no(tt, 'pTotTribSN')) totaisAprox = `Federais: -; Estaduais: -; Municipais: - (Simples Nacional: ${pct(num(tt, 'pTotTribSN'))})`;
  else totaisAprox = 'Federais: -; Estaduais: -; Municipais: -';
  const textoIC = corta(partes.join(' | '), 2000);
  const linhaTotais = `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ${totaisAprox}`;

  // ---------------- canhoto opcional (2.1.13) ----------------
  const canhoto = o.canhoto ? `<div class="can"><div class="c"><b>Data Cientificação:</b><span></span></div><div class="c"><b>Identificação e Assinatura</b><span></span></div>
<div class="c" style="grid-column:span 2"><b>Nº NFS-e / Chave NFS-e</b><span>${esc(corta(`${txt(inf, 'nNFSe') || '-'} / ${chave}`, 66))}</span></div></div>` : '';

  const marca = o.situacao === 'cancelada' ? 'CANCELADA' : o.situacao === 'substituida' ? 'SUBSTITUÍDA' : '';
  const semValidade = o.simulacao ? 'SIMULAÇÃO - SEM VALOR FISCAL' : tpAmb === '2' ? 'NFS-e SEM VALIDADE JURÍDICA' : '';
  // Destinatário (Notas 2 e 3): indDest = 0 → o destinatário é o próprio tomador
  const blocoDest = dest ? pessoaBloco('DESTINATÁRIO DA OPERAÇÃO', dest, { im: false })
    : vazio(toma && (txt(ibsDps, 'indDest') === '0' || (!ibsDps && toma)) ? 'O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO' : 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');

  return `${o.estilo ? ESTILO_DANFSE : ''}<div class="danfse-pg"><div class="danfse-v2">
<div class="hd"><img src="${LOGO_NFSE}" alt="NFS-e"><div class="tt">DANFSe v2.0<br>Documento Auxiliar da NFS-e${semValidade ? `<br><span class="sv">${esc(semValidade)}</span>` : ''}</div>
<div class="mn">${esc(municipioEmit)}<small>Ambiente Gerador: ${esc(desc('ambGer', txt(inf, 'ambGer')))}</small><small>Tipo de Ambiente: ${esc(desc('tpAmb', tpAmb))}</small></div></div>
<div class="id">
  <div class="c" style="grid-column:span 3"><b>CHAVE DE ACESSO DA NFS-E</b><span style="font-size:8pt;letter-spacing:.3pt">${esc(traco(chave))}</span></div>
  <div class="qr">${qrSvg}<p>A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e</p></div>
  <div class="c"><b>NÚMERO DA NFS-E</b><span>${esc(traco(txt(inf, 'nNFSe')))}</span></div><div class="c"><b>COMPETÊNCIA DA NFS-E</b><span>${dataBR(txt(dps, 'dCompet'))}</span></div><div class="c"><b>DATA E HORA DA EMISSÃO DA NFS-E</b><span>${dataHoraBR(txt(inf, 'dhProc'))}</span></div>
  <div class="c"><b>NÚMERO DA DPS</b><span>${esc(traco(txt(dps, 'nDPS')))}</span></div><div class="c"><b>SÉRIE DA DPS</b><span>${esc(traco(txt(dps, 'serie')))}</span></div><div class="c"><b>DATA E HORA DA EMISSÃO DA DPS</b><span>${dataHoraBR(txt(dps, 'dhEmi'))}</span></div>
  <div class="c sh"><b>EMITENTE DA NFS-E</b><span>${esc(desc('tpEmit', txt(dps, 'tpEmit')))}</span></div><div class="c"><b>SITUAÇÃO DA NFS-E</b><span>${esc(corta(desc('cStat', txt(inf, 'cStat')), 40))}</span></div><div class="c"><b>FINALIDADE</b><span>${esc(corta(desc('finNFSe', txt(ibsDps, 'finNFSe')), 40))}</span></div>
</div>
${prest ? pessoaBloco('PRESTADOR / FORNECEDOR', prest, { sn: true }) : vazio('PRESTADOR / FORNECEDOR NÃO IDENTIFICADO NA NFS-e')}
${toma ? pessoaBloco('TOMADOR / ADQUIRENTE', toma) : vazio('TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e')}
${blocoDest}
${interm ? pessoaBloco('INTERMEDIÁRIO DA OPERAÇÃO', interm) : vazio('INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e')}
${servico}${municipal}${federal}${ibscbs}${totais}
<div class="ic"><b>INFORMAÇÕES COMPLEMENTARES</b>${textoIC ? `<p class="tx">${esc(textoIC)}</p>` : ''}<p class="tt2">${esc(linhaTotais)}</p></div>
${canhoto}
${marca ? `<div class="wm">${marca}</div>` : ''}
</div></div>`;
}

/** Vários DANFSe num único documento (uma página A4 por nota). */
export function gerarDANFSeLote(itens, opts = {}) {
  return ESTILO_DANFSE + itens.map(i => gerarDANFSe(i.xml, { ...opts, situacao: i.situacao, simulacao: i.simulacao, estilo: false })).join('\n');
}
