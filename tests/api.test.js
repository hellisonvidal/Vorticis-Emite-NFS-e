// Testes de integração: cadastro, login (senha e certificado), procuração, emissão (simulação) em todos os regimes,
// validação do XML DPS contra o XSD oficial v1.01, cópia da última nota, cancelamento, relatórios e dashboard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gerarPfx } from './gerar-cert-teste.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-'));
// Cópia do XSD oficial: o padrão da série usa âncoras ^$ (sintaxe .NET) que o libxml interpreta como literais.
const xsdDir = path.join(tmp, 'xsd');
fs.cpSync(path.resolve('docs-oficiais/xsd/Schemas/1.01'), xsdDir, { recursive: true });
const ts = path.join(xsdDir, 'tiposSimples_v1.01.xsd');
fs.writeFileSync(ts, fs.readFileSync(ts, 'utf8').replace('^0{0,4}\\d{1,5}$', '0{0,4}\\d{1,5}'));
const XSD = path.join(xsdDir, 'DPS_v1.01.xsd');
const XSD_EVT = path.join(xsdDir, 'pedRegEvento_v1.01.xsd');

let srv, base, token;
const api = async (method, url, body, tk = token) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
};
function validarXSD(xml, xsd = XSD) {
  const f = path.join(tmp, `x${Math.random()}.xml`);
  fs.writeFileSync(f, xml);
  try { execFileSync('xmllint', ['--noout', '--schema', xsd, f], { stdio: 'pipe' }); return true; }
  catch (e) { throw new Error(String(e.stderr)); }
}

before(async () => {
  const { criarAplicacao } = await import('../server/index.js');
  const { app } = criarAplicacao({ dataDir: tmp });
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

const pfxEmpresa = gerarPfx({ nome: 'ALFA SERVICOS LTDA', cnpj: '11222333000181' });
const pfxContador = gerarPfx({ nome: 'JOAO CONTADOR', cnpj: undefined, cpf: '52998224725' });
const ids = {};

test('registro e login por usuário/senha', async () => {
  let r = await api('POST', '/api/auth/registrar', { nome: 'Admin', email: 'admin@teste.com', senha: 'senha12345' }, null);
  assert.equal(r.status, 200);
  r = await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'errada' }, null);
  assert.equal(r.status, 401);
  r = await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'senha12345' }, null);
  assert.equal(r.status, 200);
  token = r.body.token;
});

test('login por certificado digital identifica o titular', async () => {
  const r = await api('POST', '/api/auth/certificado', { pfx: pfxContador.toString('base64'), senha: '1234' }, null);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.usuario.documento, '52998224725');
  const bad = await api('POST', '/api/auth/certificado', { pfx: pfxContador.toString('base64'), senha: 'x' }, null);
  assert.equal(bad.status, 400);
});

test('cadastro de certificados (empresa e procurador)', async () => {
  let r = await api('POST', '/api/certificados', { pfx: pfxEmpresa.toString('base64'), senha: '1234', apelido: 'Alfa A1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.documento, '11222333000181');
  ids.certEmp = r.body.id;
  r = await api('POST', '/api/certificados', { pfx: pfxContador.toString('base64'), senha: '1234', apelido: 'Contador' });
  assert.equal(r.body.tipo_doc, 'CPF');
  ids.certCont = r.body.id;
});

const contrib = (doc, regime, extra = {}) => ({
  tipo_doc: 'CNPJ', documento: doc, razao_social: `EMPRESA ${regime}`, im: '', cep: '01310100', logradouro: 'Av Paulista', numero: '1000', bairro: 'Bela Vista',
  cod_municipio: '3550308', uf: 'SP', regime, aliq_sn: 6, aliq_iss: 2, ambiente: 'simulacao', ibscbs_ativo: true, ...extra,
});
const CNPJS = { MEI: '45723174000110', SN: '11222333000181', SN_EXCESSO_ISS: '04252011000110', SN_EXCESSO: '33000167000101', LP: '60746948000112', LR: '00000000000191', LA: '07526557000100', IMUNE: '34028316000103', ISENTA: '27865757000102' };

test('cadastro de empresas em todos os regimes', async () => {
  for (const [reg, doc] of Object.entries(CNPJS)) {
    const r = await api('POST', '/api/contribuintes', contrib(doc, reg, reg === 'SN' ? { certificado_id: ids.certEmp } : {}));
    assert.equal(r.status, 200, `${reg}: ${JSON.stringify(r.body)}`);
    ids[reg] = r.body.id;
  }
  const inval = await api('POST', '/api/contribuintes', contrib('11111111111111', 'SN'));
  assert.equal(inval.status, 400);
});

test('procurações múltiplas para a mesma empresa', async () => {
  let r = await api('POST', '/api/procuracoes', { contribuinte_id: ids.LP, certificado_id: ids.certCont, valida_ate: '2099-12-31' });
  assert.equal(r.status, 200);
  ids.proc = r.body.id;
  r = await api('POST', '/api/procuracoes', { contribuinte_id: ids.LP, certificado_id: ids.certEmp, escopo: 'consulta' });
  assert.equal(r.status, 200);
  const c = await api('GET', `/api/contribuintes/${ids.LP}`);
  assert.equal(c.body.procuracoes.length, 2);
});

const tomador = { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'CLIENTE BETA SA', cep: '20040020', logradouro: 'Rua da Assembleia', numero: '10', bairro: 'Centro', cod_municipio: '3304557', uf: 'RJ', email: 'fin@beta.com', retem_federais: 1 };
const form = (extra = {}) => ({
  competencia: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), ctribnac: '010101', cnbs: '115021000', descricao: 'Desenvolvimento de sistema sob encomenda - etapa 1',
  valor_servico: 10000, trib_issqn: '1', tp_ret_issqn: '1', aliq_iss: 2, ibscbs_ativo: true, ind_op: '100301', cclasstrib: '000001', ...extra,
});

test('emissão simulada em todos os regimes gera DPS válida no XSD v1.01', async () => {
  for (const reg of Object.keys(CNPJS)) {
    const extra = reg === 'LP' ? { ret_irrf: 1.5, ret_irrf_tipo: 'p', ret_csll: 1, ret_csll_tipo: 'p', ret_pis: true, ret_cofins: true, tp_ret_issqn: '2' }
      : reg === 'IMUNE' ? { trib_issqn: '2', tp_imunidade: '3' } : reg === 'SN' ? { tp_ret_issqn: '2', aliq_iss: 2.5 } : {};
    const r = await api('POST', '/api/notas/emitir', { contribuinte_id: ids[reg], tomador, form: form(extra), acesso: reg === 'LP' ? { procuracao_id: ids.proc } : {} });
    assert.equal(r.status, 200, `${reg}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.status, 'autorizada');
    assert.equal(r.body.chave.length, 50);
    const n = await api('GET', `/api/notas/${r.body.id}`);
    validarXSD(n.body.xml_dps);
    ids[`nota_${reg}`] = r.body.id;
    if (reg === 'SN' || reg === 'LP') assert.match(n.body.xml_dps, /<Signature/, `${reg} deveria estar assinada`);
    if (reg === 'LP') {
      assert.equal(n.body.emitido_via, 'procuracao');
      assert.equal(n.body.valor_irrf, 150);
      assert.equal(n.body.valor_csll, 100);
      assert.match(n.body.xml_dps, /<tpRetPisCofins>3<\/tpRetPisCofins>/);
      assert.ok(!/<pAliq>/.test(n.body.xml_dps), 'não optante com convênio ativo não envia pAliq');
    }
    if (reg === 'SN') assert.match(n.body.xml_dps, /<pAliq>2.50<\/pAliq>/);
    if (reg === 'MEI') { assert.ok(!/<pAliq>|<pTotTribSN>/.test(n.body.xml_dps)); assert.match(n.body.xml_dps, /<opSimpNac>2/); }
    if (reg === 'SN_EXCESSO_ISS') assert.match(n.body.xml_dps, /<regApTribSN>2/);
    assert.match(n.body.xml_dps, /<IBSCBS><finNFSe>0<\/finNFSe>/);
  }
});

test('assinatura XMLDSig é verificável', async () => {
  const { SignedXml } = await import('xml-crypto');
  const { DOMParser } = await import('@xmldom/xmldom');
  const n = await api('GET', `/api/notas/${ids.nota_SN}`);
  const doc = new DOMParser().parseFromString(n.body.xml_dps, 'text/xml');
  const sigNode = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  const cert = n.body.xml_dps.match(/<X509Certificate>([^<]+)/)[1];
  const sig = new SignedXml({ publicCert: `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----` });
  sig.loadSignature(sigNode);
  assert.ok(sig.checkSignature(n.body.xml_dps));
});

test('IBS/CBS 2026: CBS 0,9% e IBS 0,1% sobre base sem ISS/PIS/COFINS', async () => {
  const r = await api('POST', '/api/notas/calcular', { contribuinte_id: ids.LP, form: form() });
  const ib = r.body.calc.ibscbs;
  // base = 10000 - ISS 200 - PIS 65 - COFINS 300 = 9435
  assert.equal(ib.vBC, 9435);
  assert.equal(ib.vCBS, 84.92);
  assert.equal(ib.vIBSUF, 9.44);
  const red = await api('POST', '/api/notas/calcular', { contribuinte_id: ids.LP, form: form({ cclasstrib: '200052', ibscbs_pred: 30 }) });
  assert.equal(red.body.calc.ibscbs.pCBS, 0.63);
});

test('validações bloqueiam emissão inconsistente', async () => {
  const r = await api('POST', '/api/notas/emitir', { contribuinte_id: ids.SN, tomador, form: form({ ctribnac: '123', valor_servico: 0 }) });
  assert.equal(r.status, 422);
  assert.ok(r.body.erros.length >= 2);
});

test('copiar última nota e emitir alterando tomador e valores', async () => {
  const u = await api('GET', `/api/notas/ultima?contribuinte_id=${ids.SN}`);
  assert.equal(u.body.id, ids.nota_SN);
  const novo = { ...u.body.dados.tomador, id: undefined, documento: '11444777000161', nome: 'OUTRO CLIENTE LTDA' };
  const r = await api('POST', '/api/notas/emitir', { contribuinte_id: ids.SN, tomador: novo, form: { ...u.body.dados.form, valor_servico: 2500 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = await api('GET', `/api/notas/${r.body.id}`);
  assert.equal(n.body.valor_servico, 2500);
  assert.equal(n.body.tomador_nome, 'OUTRO CLIENTE LTDA');
  assert.equal(n.body.ndps, 2);
});

test('cancelamento gera pedido de evento válido no XSD', async () => {
  const r = await api('POST', `/api/notas/${ids.nota_MEI}/cancelar`, { motivo: '1', justificativa: 'Erro na emissão do valor do serviço' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = await api('GET', `/api/notas/${ids.nota_MEI}`);
  assert.equal(n.body.status, 'cancelada');
  validarXSD(n.body.eventos[0].xml, XSD_EVT);
});

test('consultas de tabelas, relatórios e dashboard', async () => {
  const c = await api('GET', '/api/tabelas/ctribnac?q=limpeza');
  assert.ok(c.body.total > 0);
  const nb = await api('GET', '/api/tabelas/nbs?q=1.1502');
  assert.ok(nb.body.total > 0);
  const lista = await api('GET', '/api/notas?status=autorizada');
  assert.ok(lista.body.total >= 9);
  const csv = await api('GET', '/api/relatorios/notas.csv');
  assert.match(csv.body, /Prestador;CNPJ\/CPF Prestador/);
  const res = await api('GET', '/api/relatorios/resumo?agrupar=empresa');
  assert.ok(res.body.length >= 9);
  const d = await api('GET', `/api/dashboard?contribuinte_id=${ids.SN}`);
  assert.equal(d.body.mes.qtd, 2);
  assert.equal(d.body.limite.valor, 4800000);
});
