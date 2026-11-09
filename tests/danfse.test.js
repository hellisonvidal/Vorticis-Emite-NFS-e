// DANFSe v2.0 (NT SE/CGNFS-e 008/2026 v1.02): regras de campos, supressões, canhoto, lote, XML avulso e PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { gerarDANFSe, gerarDANFSeLote } from '../core/danfse.js';
import { criarApi } from '../core/api.js';
import { adaptarSqlJs } from '../core/banco.js';
import { criarCofre, randomBytes, b64 } from '../core/seguranca.js';
import { gerarPfx } from './gerar-cert-teste.js';

const CHAVE = '35503082211222333000181000000000012326110000000017';
function nfse({ tpAmb = '1', cStat = '100', dCompet = '2026-11-05', cTribNac = '171901', toma = true, tribISSQN = '1', tpRet = '1', dest = false, indDest = '0', extras = '' } = {}) {
  return `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${CHAVE}">
<xLocEmi>São Paulo</xLocEmi><xLocPrestacao>São Paulo</xLocPrestacao><nNFSe>123</nNFSe><cLocIncid>3550308</cLocIncid><xLocIncid>São Paulo</xLocIncid>
<xTribNac>Assessoria e consultoria contábil</xTribNac><verAplic>SefinNac</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><cStat>${cStat}</cStat><dhProc>2026-11-05T10:20:30-03:00</dhProc><nDFSe>1</nDFSe>
<emit><CNPJ>11222333000181</CNPJ><IM>998877</IM><xNome>ALFA SERVICOS LTDA</xNome><enderNac><xLgr>Rua A</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><UF>SP</UF><CEP>01001000</CEP></enderNac><fone>1133334444</fone><email>fiscal@alfa.com.br</email></emit>
<valores><vCalcDR>50.00</vCalcDR><tpBM>1</tpBM><vCalcBM>10.00</vCalcBM><vBC>900.00</vBC><pAliqAplic>5.00</pAliqAplic><vISSQN>45.00</vISSQN><vTotalRet>100.00</vTotalRet><vLiq>850.00</vLiq></valores>
<IBSCBS><cLocalidadeIncid>3550308</cLocalidadeIncid><xLocalidadeIncid>São Paulo</xLocalidadeIncid><valores><vBC>880.00</vBC><vCalcReeRepRes>20.00</vCalcReeRepRes><uf><pIBSUF>0.10</pIBSUF><pAliqEfetUF>0.10</pAliqEfetUF></uf><mun><pIBSMun>0.00</pIBSMun><pAliqEfetMun>0.00</pAliqEfetMun></mun><fed><pCBS>0.90</pCBS><pAliqEfetCBS>0.90</pAliqEfetCBS></fed></valores>
<totCIBS><vTotNF>859.68</vTotNF><gIBS><vIBSTot>0.88</vIBSTot><gIBSUFTot><vIBSUF>0.88</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>0.00</vIBSMun></gIBSMunTot></gIBS><gCBS><vCBS>7.92</vCBS></gCBS></totCIBS></IBSCBS>
<DPS versao="1.01"><infDPS Id="DPS355030821122233300018100001000000000000001"><tpAmb>${tpAmb}</tpAmb><dhEmi>2026-11-05T10:19:00-03:00</dhEmi><verAplic>V</verAplic><serie>1</serie><nDPS>77</nDPS><dCompet>${dCompet}</dCompet><tpEmit>1</tpEmit><cLocEmi>3550308</cLocEmi>
${cStat === '101' ? '<subst><chSubstda>35503082211222333000181000000000009926110000000099</chSubstda><cMotivo>01</cMotivo></subst>' : ''}
<prest><CNPJ>11222333000181</CNPJ><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
${toma ? '<toma><CNPJ>19131243000197</CNPJ><xNome>MERCADO CENTRAL LTDA</xNome><end><endNac><cMun>3304557</cMun><CEP>20040020</CEP></endNac><xLgr>Rua da Assembleia</xLgr><nro>10</nro><xBairro>Centro</xBairro></end><email>fin@mercado.com.br</email></toma>' : ''}
<interm><CPF>12345678909</CPF><xNome>JOSE INTERMEDIARIO</xNome></interm>
<serv><locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest><cServ><cTribNac>${cTribNac}</cTribNac><xDescServ>Consultoria mensal</xDescServ><cNBS>115021000</cNBS></cServ>
<obra><cObra>OBRA-9</cObra></obra><atvEvento><xNome>Feira</xNome><dtIni>2026-11-01</dtIni><dtFim>2026-11-02</dtFim><idAtvEvt>EVT-1</idAtvEvt></atvEvento>
<infoCompl><idDocTec>ART-5</idDocTec><docRef>REF-3</docRef><xPed>PO-44</xPed><gItemPed><xItemPed>1</xItemPed><xItemPed>2</xItemPed></gItemPed><xInfComp>Contrato 15</xInfComp></infoCompl></serv>
<valores><vServPrest><vServ>1000.00</vServ></vServPrest><vDescCondIncond><vDescIncond>30.00</vDescIncond><vDescCond>5.00</vDescCond></vDescCondIncond>
<trib><tribMun><tribISSQN>${tribISSQN}</tribISSQN><tpRetISSQN>2</tpRetISSQN></tribMun><tribFed><piscofins><CST>01</CST><vBCPisCofins>1000.00</vBCPisCofins><pAliqPis>0.65</pAliqPis><pAliqCofins>3.00</pAliqCofins><vPis>6.50</vPis><vCofins>30.00</vCofins><tpRetPisCofins>${tpRet}</tpRetPisCofins></piscofins><vRetCP>11.00</vRetCP><vRetIRRF>15.00</vRetIRRF><vRetCSLL>10.00</vRetCSLL></tribFed>
<totTrib><vTotTrib><vTotTribFed>120.00</vTotTribFed><vTotTribEst>0.00</vTotTribEst><vTotTribMun>45.00</vTotTribMun></vTotTrib></totTrib></trib></valores>
<IBSCBS><finNFSe>0</finNFSe><indFinal>0</indFinal><cIndOp>100301</cIndOp><indDest>${indDest}</indDest>${dest ? '<dest><CNPJ>60746948000112</CNPJ><xNome>DESTINO SA</xNome><fone>2122223333</fone></dest>' : ''}<valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS>
${extras}</infDPS></DPS></infNFSe></NFSe>`;
}
const texto = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('DANFSe v2.0: campos e regras da NT 008 v1.02', () => {
  const h = gerarDANFSe(nfse());
  const t = texto(h);
  // cabeçalho e identificação
  assert.match(t, /DANFSe v2\.0 Documento Auxiliar da NFS-e/);
  assert.doesNotMatch(t, /SEM VALIDADE JURÍDICA/);
  assert.match(t, /Município: São Paulo \/ SP/);
  assert.match(t, /Ambiente Gerador: Sistema Nacional da NFS-e/);
  assert.match(t, /Tipo de Ambiente: Produção/);
  assert.match(h, new RegExp(`>${CHAVE}<`));
  assert.match(t, /NÚMERO DA NFS-E 123 COMPETÊNCIA DA NFS-E 05\/11\/2026 DATA E HORA DA EMISSÃO DA NFS-E 05\/11\/2026 10:20:30/);
  assert.match(t, /NÚMERO DA DPS 77 SÉRIE DA DPS 1/);
  assert.match(t, /EMITENTE DA NFS-E Prestador SITUAÇÃO DA NFS-E NFS-e Gerada FINALIDADE NFS-e regular/);
  // prestador vem do grupo emit
  assert.match(t, /11\.222\.333\/0001-81 Indicador Municipal \(Inscrição\) 998877 Telefone 1133334444/);
  assert.match(t, /ALFA SERVICOS LTDA/);
  assert.match(t, /Simples Nacional na Data de Competência Não Optante/);
  // destinatário = tomador (indDest = 0) e intermediário identificado
  assert.match(t, /O DESTINATÁRIO É O PRÓPRIO TOMADOR\/ADQUIRENTE DA OPERAÇÃO/);
  assert.match(t, /INTERMEDIÁRIO DA OPERAÇÃO CNPJ \/ CPF \/ NIF 123\.456\.789-09/);
  // serviço: formatos, local com país, descrição do código sem rótulo
  assert.match(t, /17\.19\.01/);
  assert.match(t, /1\.1502\.10\.00/);
  assert.match(t, /São Paulo \/ SP \/ BR/);
  assert.match(t, /Assessoria e consultoria contábil Descrição do Serviço Consultoria mensal/);
  // ISSQN: benefício municipal pelo tpBM, deduções = vCalcDR + vCalcReeRepRes
  assert.match(t, /Benefício Municipal Isenção Cálculo do BM R\$ 10,00 Total Deduções\/Reduções R\$ 70,00 Desconto Incondicionado R\$ 30,00/);
  assert.match(t, /Retenção do ISSQN Retido pelo Tomador ISSQN Apurado R\$ 45,00/);
  // federal: tpRetPisCofins = 1 → contribuições retidas = CSLL + PIS + COFINS; débitos próprios zerados
  assert.match(t, /Contribuições Sociais - Retidas R\$ 46,50/);
  assert.match(t, /PIS - Débito Apuração Própria R\$ 0,00 COFINS - Débito Apuração Própria R\$ 0,00/);
  assert.match(t, /Descrição Contrib\. Sociais - Retidas PIS\/COFINS Retidos/);
  // IBS/CBS: exclusões = descIncond + vCalcReeRepRes + vISSQN + vPIS + vCOFINS
  assert.match(t, /Exclusões e Reduções da Base de Cálculo R\$ 131,50/);
  assert.match(t, /100301 \/ 3550308 \/ São Paulo \/ SP/);
  assert.match(t, /Total do IBS\/CBS R\$ 8,80 Valor Líquido da NFS-e \+ IBS\/CBS R\$ 859,68/);
  // informações complementares na ordem da NT, separadas por pipes, e totais aproximados
  assert.match(t, /Inf\. Cont\.: Contrato 15 \| Doc\. Ref\.: REF-3 \| Cod\. Obra: OBRA-9 \| Cod\. Evt\.: EVT-1 \| Doc\. Tec\.: ART-5 \| Núm\. Ped\.: PO-44 \| Item Ped\.: 1, 2/);
  assert.match(t, /Totais Aproximados dos Tributos cfe\. Lei nº 12\.741\/2012: Federais: R\$ 120,00; Estaduais: R\$ 0,00; Municipais: R\$ 45,00/);
  // sem canhoto nem marca d'água por padrão
  assert.doesNotMatch(t, /DATA CIENTIFICAÇÃO/i);
  assert.doesNotMatch(h, /class="wm"/);
});

test('DANFSe v2.0: PIS/COFINS não retidos, homologação, substituição e item 99', () => {
  const t = texto(gerarDANFSe(nfse({ tpAmb: '2', cStat: '101', tpRet: '2', cTribNac: '990101' }), { situacao: 'substituida' }));
  assert.match(t, /NFS-e SEM VALIDADE JURÍDICA/);
  assert.match(t, /Tipo de Ambiente: Homologação/);
  assert.doesNotMatch(t, /Município: São Paulo/); // item 99: não exibe município no cabeçalho
  assert.match(t, /Contribuições Sociais - Retidas R\$ 10,00/);
  assert.match(t, /PIS - Débito Apuração Própria R\$ 6,50 COFINS - Débito Apuração Própria R\$ 30,00/);
  assert.match(t, /SITUAÇÃO DA NFS-E NFS-e de Substituição Gerada/);
  assert.match(t, /NFS-e Subst\.: 35503082211222333000181000000000009926110000000099/);
  assert.match(t, /SUBSTITUÍDA/);
});

test('DANFSe v2.0: blocos não identificados, não sujeita ao ISSQN, competência 2027, destinatário', () => {
  const t = texto(gerarDANFSe(nfse({ toma: false, tribISSQN: '4', dCompet: '2027-01-10' })));
  assert.match(t, /TOMADOR\/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e/);
  assert.match(t, /DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e/);
  assert.match(t, /TRIBUTAÇÃO MUNICIPAL \(ISSQN\) - OPERAÇÃO NÃO SUJEITA AO ISSQN/);
  assert.doesNotMatch(t, /PIS - Débito Apuração Própria/); // Nota 6: só até 2026
  const d = texto(gerarDANFSe(nfse({ dest: true, indDest: '1' })));
  assert.match(d, /DESTINATÁRIO DA OPERAÇÃO CNPJ \/ CPF \/ NIF 60\.746\.948\/0001-12/);
  assert.match(d, /DESTINO SA/);
});

test('DANFSe v2.0: opções de canhoto e supressões (Notas 1 e 5), cancelada e lote', () => {
  const x = nfse();
  const c = texto(gerarDANFSe(x, { canhoto: true, situacao: 'cancelada' }));
  assert.match(c, /Data Cientificação: Identificação e Assinatura Nº NFS-e \/ Chave NFS-e 123 \/ 3550308/);
  assert.match(c, /CANCELADA/);
  const base = texto(gerarDANFSe(x));
  assert.match(base, /Endereço Rua da Assembleia, 10, Centro/);
  assert.doesNotMatch(base, /Regime Especial de Tributação do ISSQN/); // Nota 5: linha sem dados suprimida
  const sem = texto(gerarDANFSe(x, { suprimirEndereco: true, suprimirLinhasVazias: false }));
  assert.doesNotMatch(sem, /Rua da Assembleia/);
  assert.match(sem, /Regime Especial de Tributação do ISSQN Nenhum/);
  const lote = gerarDANFSeLote([{ xml: x }, { xml: x, situacao: 'cancelada' }]);
  assert.equal((lote.match(/class="danfse-pg"/g) || []).length, 2);
  assert.equal((lote.match(/<style>/g) || []).length, 1);
  assert.throws(() => gerarDANFSe('<DPS/>'), /não é uma NFS-e/);
});

test('API do DANFSe: opções, lote, XML avulso e PDF da plataforma', async () => {
  const SQL = await initSqlJs();
  const pdfs = [];
  const mk = gerarPdf => criarApi({ nome: 't', db: adaptarSqlJs(new SQL.Database(), () => {}), cofre: criarCofre(randomBytes(32)), http: async () => ({ status: 503, headers: {}, body: new Uint8Array() }), gerarPdf });
  const api = mk(async html => { pdfs.push(html); return new Uint8Array([37, 80, 68, 70]); });
  const call = async (a, method, path, body, token, ok = true) => {
    const [p, qs] = path.split('?');
    const r = await a.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body, token });
    if (ok) assert.ok(r.status < 300, `${path}: ${JSON.stringify(r.json)}`);
    return ok ? (r.json ?? r.arquivo) : r;
  };
  const { token } = await call(api, 'POST', '/api/auth/registrar', { nome: 'D', email: 'd@t.com', senha: '12345678' });
  const cert = await call(api, 'POST', '/api/certificados', { pfx: b64(gerarPfx({ cnpj: '11222333000181' })), senha: '1234' }, token);
  const c = await call(api, 'POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '11222333000181', razao_social: 'ALFA', cod_municipio: '3550308', regime: 'SN', aliq_sn: 6, ambiente: 'simulacao', certificado_id: cert.id }, token);
  const ids = [];
  for (const v of [1000, 2000]) {
    const r = await call(api, 'POST', '/api/notas/emitir', { contribuinte_id: c.id, tomador: { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'CLIENTE', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '20040020', cod_municipio: '3304557' },
      form: { competencia: '2026-11-01', ctribnac: '010101', descricao: 'Serviço', valor_servico: v, trib_issqn: '1', tp_ret_issqn: '1', ibscbs_ativo: true, ind_op: '100301', cclasstrib: '000001' } }, token);
    ids.push(r.id);
  }
  // opções padrão e gravação
  assert.deepEqual(await call(api, 'GET', '/api/config/danfse', null, token), { canhoto: false, suprimirEndereco: false, suprimirLinhasVazias: true, pdf: true });
  await call(api, 'PUT', '/api/config/danfse', { canhoto: true }, token);
  const um = await call(api, 'GET', `/api/notas/${ids[0]}/danfse`, null, token);
  assert.match(um.html, /SIMULAÇÃO - SEM VALOR FISCAL/);
  assert.match(texto(um.html), /Data Cientificação/);
  assert.equal(um.pdf, true);
  // PDF gerado pela plataforma
  const pdf = await call(api, 'GET', `/api/notas/${ids[0]}/danfse?formato=pdf`, null, token);
  assert.equal(pdf.tipo, 'application/pdf');
  assert.match(pdf.nome, /^DANFSe-.*\.pdf$/);
  assert.match(pdfs[0], /^<!doctype html>/);
  // lote: uma página por nota, ignora ids sem XML
  const lote = await call(api, 'POST', '/api/danfse/lote', { ids: [...ids, 99999] }, token);
  assert.equal(lote.quantidade, 2);
  assert.equal(lote.ignoradas, 1);
  assert.equal((lote.html.match(/class="danfse-pg"/g) || []).length, 2);
  // XML avulso (texto ou gzip+base64) e situação
  const avulso = await call(api, 'POST', '/api/danfse/xml', { xml: '﻿' + nfse(), situacao: 'cancelada' }, token);
  assert.match(avulso.html, /CANCELADA/);
  assert.equal(avulso.nome, `DANFSe-${CHAVE}.html`);
  const ruim = await call(api, 'POST', '/api/danfse/xml', { xml: '<DPS/>' }, token, false);
  assert.equal(ruim.status, 400);
  // plataforma sem gerador de PDF
  const api2 = mk(undefined);
  const t2 = (await call(api2, 'POST', '/api/auth/registrar', { nome: 'E', email: 'e@t.com', senha: '12345678' })).token;
  const r501 = await call(api2, 'POST', '/api/danfse/xml?formato=pdf', { xml: nfse() }, t2, false);
  assert.equal(r501.status, 501);
});
