// Testes de comunicação com uma Sefin/ADN/SERPRO simuladas (contratos das APIs oficiais):
// numeração (HEAD /dps), recuperação de E0014, nota pendente por falha de rede, eventos por tipo,
// distribuição do ADN, cadeia ICP via AIA, DANFSe v2.0 e Integra Contador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import initSqlJs from 'sql.js';
import { gzipSync } from 'fflate';
import { criarApi } from '../core/api.js';
import { adaptarSqlJs } from '../core/banco.js';
import { criarCofre, randomBytes, b64, utf8, deUtf8 } from '../core/seguranca.js';
import { nfseSimulada, chaveSimulada } from '../core/dps.js';
import { decodificarXml } from '../core/sefin.js';
import { calcular } from '../core/tributos.js';

// ---------- certificados: AC de teste + titular emitido pela AC, com AIA ----------
const A = forge.asn1;
function criarCert({ subject, issuer, chaveAssin, pub, ca = false, aia, otherCnpj }) {
  const c = forge.pki.createCertificate();
  c.publicKey = pub; c.serialNumber = '0' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  c.validity.notBefore = new Date(Date.now() - 86400e3); c.validity.notAfter = new Date(Date.now() + 365 * 86400e3);
  c.setSubject(subject); c.setIssuer(issuer);
  const exts = [{ name: 'basicConstraints', cA: ca }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyCertSign: ca }];
  if (aia) exts.push({ id: '1.3.6.1.5.5.7.1.1', value: A.toDer(A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
    A.create(A.Class.UNIVERSAL, A.Type.OID, false, A.oidToDer('1.3.6.1.5.5.7.48.2').getBytes()), A.create(A.Class.CONTEXT_SPECIFIC, 6, false, aia)])])).getBytes() });
  if (otherCnpj) exts.push({ id: '2.5.29.17', value: A.toDer(A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [A.create(A.Class.CONTEXT_SPECIFIC, 0, true, [
    A.create(A.Class.UNIVERSAL, A.Type.OID, false, A.oidToDer('2.16.76.1.3.3').getBytes()), A.create(A.Class.CONTEXT_SPECIFIC, 0, true, [A.create(A.Class.UNIVERSAL, A.Type.OCTETSTRING, false, otherCnpj)])])])).getBytes() });
  c.setExtensions(exts);
  c.sign(chaveAssin, forge.md.sha256.create());
  return c;
}
const kAC = forge.pki.rsa.generateKeyPair(2048), kTit = forge.pki.rsa.generateKeyPair(2048);
const dnAC = [{ name: 'commonName', value: 'AC Raiz Teste' }, { name: 'organizationName', value: 'ICP-Brasil' }];
const certAC = criarCert({ subject: dnAC, issuer: dnAC, chaveAssin: kAC.privateKey, pub: kAC.publicKey, ca: true });
const certTit = criarCert({ subject: [{ name: 'commonName', value: 'ALFA LTDA:11222333000181' }], issuer: dnAC, chaveAssin: kAC.privateKey, pub: kTit.publicKey, aia: 'http://repositorio.ac-teste.br/ac-raiz.cer', otherCnpj: '11222333000181' });
const pfxSoTitular = (() => { const d = A.toDer(forge.pkcs12.toPkcs12Asn1(kTit.privateKey, [certTit], '1234', { algorithm: '3des' })).getBytes(); return Uint8Array.from(d, ch => ch.charCodeAt(0)); })();
const derAC = Uint8Array.from(A.toDer(forge.pki.certificateToAsn1(certAC)).getBytes(), ch => ch.charCodeAt(0));

// ---------- servidor simulado ----------
const enc = o => utf8(JSON.stringify(o));
const resp = (status, json, headers = { 'content-type': 'application/json' }) => ({ status, headers, body: json === undefined ? new Uint8Array() : enc(json) });
const estado = { usadas: new Set(), nfse: new Map(), canceladas: new Set(), falharRede: false, chamadas: [], adn: [], certsTLS: [] };
const contrib = { tipo_doc: 'CNPJ', documento: '11222333000181', razao_social: 'ALFA LTDA', cod_municipio: '3550308', uf: 'SP', regime: 'SN', aliq_sn: 6, logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '01001000' };

async function http(req) {
  const u = new URL(req.url);
  estado.chamadas.push(`${req.method} ${u.host}${u.pathname}`);
  if (req.pfx) estado.certsTLS.push(req.pfx.length);
  if (u.host === 'repositorio.ac-teste.br') return { status: 200, headers: {}, body: derAC };
  if (u.host.includes('serpro')) {
    const pedido = JSON.parse(req.body);
    const dados = JSON.parse(pedido.pedidoDados.dados);
    if (pedido.contribuinte.numero !== dados.outorgado) return resp(200, { status: 400, mensagens: [{ codigo: 'ERRO', texto: 'Dados inválidos.' }] });
    return resp(200, { status: 200, mensagens: [{ codigo: '[Sucesso-PROCURACOES]', texto: 'Requisição efetuada com sucesso.' }],
      dados: JSON.stringify([{ dtexpiracao: '20281231', nrsistemas: 2, sistemas: ['NFS-e Nota Fiscal de Serviços Eletrônica', 'Outro'] }, { dtexpiracao: '20270101', nrsistemas: 1, sistemas: ['e-Social'] }]), eco: dados });
  }
  if (u.host.startsWith('adn')) {
    if (u.pathname.startsWith('/contribuintes/DFe/')) {
      const nsu = +u.pathname.split('/').pop();
      const docs = estado.adn.filter(d => d.NSU > nsu);
      if (!docs.length) return resp(404, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] });
      return resp(200, { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: docs });
    }
    return resp(404, {});
  }
  const p = u.pathname.replace('/SefinNacional', '');
  let m;
  if ((m = p.match(/^\/dps\/(DPS\d{42})$/))) {
    const usada = estado.usadas.has(m[1]);
    if (req.method === 'HEAD') return { status: usada ? 200 : 404, headers: {}, body: new Uint8Array() };
    const ch = [...estado.nfse.entries()].find(([, v]) => v.idDps === m[1])?.[0];
    return ch ? resp(200, { chaveAcesso: ch }) : resp(404, { erros: [{ Codigo: 'E404', Descricao: 'DPS não encontrada' }] });
  }
  if (p === '/nfse' && req.method === 'POST') {
    const dps = decodificarXml(JSON.parse(req.body).dpsXmlGZipB64);
    const id = dps.match(/Id="(DPS\d+)"/)[1];
    if (estado.falharRede) { estado.falharRede = false; estado.usadas.add(id); guardar(id, dps); throw new Error('socket hang up'); }
    if (estado.usadas.has(id) || [...estado.nfse.values()].some(v => v.idDps === id)) return resp(400, { erros: [{ Codigo: 'E0014', Descricao: 'Conjunto de Série, Número... já existe' }] });
    estado.usadas.add(id);
    const ch = guardar(id, dps);
    return resp(201, { tipoAmbiente: 2, idDps: id, chaveAcesso: ch, nfseXmlGZipB64: b64(gzipSync(utf8(estado.nfse.get(ch).xml))), alertas: [] });
  }
  if ((m = p.match(/^\/nfse\/(\d{50})$/))) return estado.nfse.has(m[1]) ? resp(200, { chaveAcesso: m[1], nfseXmlGZipB64: b64(gzipSync(utf8(estado.nfse.get(m[1]).xml))) }) : resp(404, {});
  if ((m = p.match(/^\/nfse\/(\d{50})\/eventos$/))) {
    if (req.method !== 'POST') return resp(405, { Message: "The requested resource does not support http method 'GET'." });
    estado.canceladas.add(m[1]);
    return resp(201, { eventoXmlGZipB64: b64(gzipSync(utf8('<evento/>'))) });
  }
  if ((m = p.match(/^\/nfse\/(\d{50})\/eventos\/(\d{6})\/(\d+)$/))) {
    if (m[2] === '101101' && estado.canceladas.has(m[1])) return resp(200, { eventos: [{ chaveAcesso: m[1], tipoEvento: 101101, arquivoXml: b64(utf8(b64(gzipSync(utf8('<evento>e101101</evento>'))))) }] });
    return resp(400, { dataHoraProcessamento: 'x' });
  }
  if ((m = p.match(/^\/parametros_municipais\/(\d{7})\/convenio$/))) return resp(200, { codigoMunicipio: m[1], situacao: 'Ativo' });
  return resp(404, { erros: [{ Codigo: '404', Descricao: `rota ${p}` }] });
}
let seqNFSe = 0;
function guardar(idDps, dps) {
  seqNFSe++;
  const ch = chaveSimulada({ cMun: '3550308', tipoDoc: 'CNPJ', doc: contrib.documento, nNFSe: seqNFSe });
  const calc = calcular({ valor_servico: +(dps.match(/<vServ>([\d.]+)/) || [0, 0])[1], competencia: '2026-11-01', trib_issqn: '1', tp_ret_issqn: '1' }, contrib);
  estado.nfse.set(ch, { idDps, xml: nfseSimulada({ chave: ch, nNFSe: String(seqNFSe), dpsAssinada: dps, contrib, calc, municipio: 'São Paulo/SP' }) });
  return ch;
}

test('comunicação completa com Sefin/ADN/SERPRO simuladas', async () => {
  const SQL = await initSqlJs();
  const api = criarApi({ nome: 'teste', db: adaptarSqlJs(new SQL.Database()), cofre: criarCofre(randomBytes(32)), http });
  const call = async (method, path, body, token, esperado = [200, 202]) => {
    const [p, qs] = path.split('?');
    const r = await api.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body, token });
    assert.ok(esperado.includes(r.status), `${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const { token } = await call('POST', '/api/auth/registrar', { nome: 'T', email: 't@t.com', senha: '12345678' });

  // 1) certificado só com o titular: cadeia completada via AIA e PFX reempacotado
  const cert = await call('POST', '/api/certificados', { pfx: b64(pfxSoTitular), senha: '1234' }, token);
  assert.equal(cert.cadeia.completa, true, JSON.stringify(cert.cadeia));
  assert.equal(cert.cadeia.complementada, true);
  assert.equal(cert.cadeia.icp, true);
  assert.ok(estado.chamadas.includes('GET repositorio.ac-teste.br/ac-raiz.cer'));

  const c = await call('POST', '/api/contribuintes', { ...contrib, ambiente: 'homologacao', certificado_id: cert.id, serie_dps: '1' }, token);
  assert.equal(c.serie_dps, '00001');
  await call('POST', '/api/contribuintes', { ...contrib, documento: '19131243000197', serie_dps: '70000' }, token, [400]);

  // 2) numeração: outra instalação já usou DPS 1..37 na mesma série -> app descobre e ajusta para 38
  const idDe = n => `DPS3550308211222333000181${'00001'}${String(n).padStart(15, '0')}`;
  for (let n = 1; n <= 37; n++) estado.usadas.add(idDe(n));
  const v = await call('POST', `/api/contribuintes/${c.id}/sequencia/verificar`, null, token);
  assert.equal(v.ultimoDPSSefin, 37);
  assert.equal(v.proxNDPS, 38);
  assert.ok(v.consultas < 20, `consultas: ${v.consultas}`);

  const form = { competencia: '2026-11-01', ctribnac: '010101', descricao: 'Serviço', valor_servico: 1000, trib_issqn: '1', tp_ret_issqn: '1' };
  const tom = { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'CLIENTE', logradouro: 'Rua B', numero: '2', bairro: 'Centro', cep: '20040020', cod_municipio: '3304557' };

  // 3) emissão normal + pulo automático de número já usado (HEAD antes do envio)
  estado.usadas.add(idDe(38));
  const e1 = await call('POST', '/api/notas/emitir', { contribuinte_id: c.id, tomador: tom, form }, token);
  assert.equal(e1.status, 'autorizada');
  assert.match(e1.idDps, /0{11}39$/);
  assert.ok(e1.mensagens.some(m => m.codigo === 'SEQ'));
  assert.ok(estado.certsTLS.every(n => n > pfxSoTitular.length), 'mTLS deve usar o PFX com a cadeia completa');

  // 4) falha de rede no envio -> nota PENDENTE; consulta pelo id da DPS recupera a NFS-e autorizada
  estado.falharRede = true;
  const e2 = await call('POST', '/api/notas/emitir', { contribuinte_id: c.id, tomador: tom, form }, token);
  assert.equal(e2.status, 'pendente');
  const s2 = await call('POST', `/api/notas/${e2.id}/sincronizar`, null, token);
  assert.equal(s2.status, 'autorizada');
  const n2 = await call('GET', `/api/notas/${e2.id}`, null, token);
  assert.equal(n2.chave_acesso.length, 50);

  // 5) E0014 (DPS já processada, resposta perdida): o app recupera a NFS-e existente em vez de rejeitar
  const prox = (await call('GET', `/api/contribuintes/${c.id}/sequencia`, null, token)).proxNDPS;
  const idDup = idDe(prox);
  const chDup = guardar(idDup, `<DPS><infDPS Id="${idDup}"><vServ>1000.00</vServ></infDPS></DPS>`); // HEAD ainda não acusa (replicação)
  const e3 = await call('POST', '/api/notas/emitir', { contribuinte_id: c.id, tomador: tom, form }, token);
  assert.equal(e3.status, 'autorizada');
  assert.equal(e3.chave, chDup);
  assert.ok(e3.mensagens.some(m => m.codigo === 'E0014'));

  // 6) cancelamento e situação via /eventos/101101/1 (a rota sem tipo responde 405)
  await call('POST', `/api/notas/${e1.id}/cancelar`, { motivo: '1', justificativa: 'Erro na emissão do valor informado' }, token);
  const s1 = await call('POST', `/api/notas/${e1.id}/sincronizar`, null, token);
  assert.equal(s1.status, 'cancelada');
  assert.ok(!estado.chamadas.some(x => /\/eventos$/.test(x) && x.startsWith('GET')));

  // 7) DANFSe v2.0 local com QR Code da consulta pública e marca d'água de cancelada
  const d1 = await call('GET', `/api/notas/${e1.id}/danfse`, null, token);
  assert.match(d1.html, /DANFSe v2\.0/);
  assert.match(d1.html, /NFS-e SEM VALIDADE JURÍDICA/);
  assert.match(d1.html, /<svg[^>]*>/);
  assert.match(d1.html, /CANCELADA/);
  assert.match(d1.html, /Totais Aproximados dos Tributos cfe\. Lei nº 12\.741\/2012/);

  // 8) ADN: importa nota emitida pelo portal Web (série 70000) e evento de cancelamento
  const chWeb = chaveSimulada({ cMun: '3550308', tipoDoc: 'CNPJ', doc: contrib.documento, nNFSe: 99 });
  const dpsWeb = `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS355030821122233300018170000000000000000005"><tpAmb>2</tpAmb><serie>70000</serie><nDPS>5</nDPS><dCompet>2026-10-10</dCompet><tpEmit>1</tpEmit><prest><CNPJ>11222333000181</CNPJ></prest><toma><CPF>52998224725</CPF><xNome>CLIENTE WEB</xNome></toma><serv><cServ><cTribNac>010101</cTribNac><xDescServ>Feita no portal</xDescServ></cServ></serv><valores><vServPrest><vServ>777.00</vServ></vServPrest></valores></infDPS></DPS>`;
  const calcW = calcular({ valor_servico: 777, competencia: '2026-10-10' }, contrib);
  const xmlWeb = nfseSimulada({ chave: chWeb, nNFSe: '99', dpsAssinada: dpsWeb, contrib, calc: calcW, municipio: 'São Paulo/SP' });
  estado.adn.push({ NSU: 10, ChaveAcesso: chWeb, TipoDocumento: 'NFSE', ArquivoXml: b64(gzipSync(utf8(xmlWeb))) });
  estado.adn.push({ NSU: 11, ChaveAcesso: chWeb, TipoDocumento: 'EVENTO', TipoEvento: '101101', ArquivoXml: b64(gzipSync(utf8(`<evento><infEvento><pedRegEvento><infPedReg><chNFSe>${chWeb}</chNFSe><e101101/></infPedReg></pedRegEvento></infEvento></evento>`))) });
  estado.adn.push({ NSU: 12, ChaveAcesso: '9'.repeat(50), TipoDocumento: 'NFSE', ArquivoXml: b64(gzipSync(utf8(xmlWeb.replace(/11222333000181/g, '19131243000197')))) });
  const imp = await call('POST', `/api/contribuintes/${c.id}/importar-adn`, {}, token);
  assert.equal(imp.importadas, 1);
  assert.equal(imp.eventos, 1);
  assert.equal(imp.ignoradas, 1);
  assert.equal(imp.ultimoNSU, 12);
  assert.equal(imp.sequencia.ultimaNFSe.nnfse, '99');
  const web = (await call('GET', '/api/notas?q=Feita', null, token)).itens[0];
  assert.equal(web.status, 'cancelada');
  assert.equal(web.valor_servico, 777);
  const imp2 = await call('POST', `/api/contribuintes/${c.id}/importar-adn`, {}, token);
  assert.equal(imp2.importadas, 0);

  // 9) diagnóstico de produção com testes remotos
  const dg = await call('GET', `/api/contribuintes/${c.id}/diagnostico?remoto=1`, null, token);
  const item = n => dg.checks.find(x => x.item.startsWith(n));
  assert.equal(item('Cadeia ICP-Brasil').status, 'ok');
  assert.equal(item('Conexão mTLS').status, 'ok');
  assert.equal(item('Convênio do município').status, 'ok');
  assert.equal(item('Testes na Produção restrita').status, 'ok');

  // 10) Integra Contador (modo trial): vencimento da procuração com o serviço NFS-e
  const certProc = await call('POST', '/api/certificados', { pfx: b64(pfxSoTitular), senha: '1234' }, token, [400]); // mesmo serial
  void certProc;
  const p = await call('POST', '/api/procuracoes', { contribuinte_id: c.id, certificado_id: cert.id, valida_ate: '2026-12-31' }, token);
  const r = await call('POST', '/api/procuracoes/verificar-receita', { procuracao_id: p.id }, token);
  assert.equal(r.trial, true);
  assert.equal(r.resultados[0].validaAte, '2028-12-31');
  assert.ok(r.resultados[0].sistemas[0].includes('NFS-e'));
});

test('decodificação tolerante dos XML das APIs', () => {
  const xml = '<a>ç</a>';
  assert.equal(decodificarXml(b64(gzipSync(utf8(xml)))), xml);
  assert.equal(decodificarXml(b64(utf8(b64(gzipSync(utf8(xml)))))), xml);
  assert.equal(decodificarXml(xml), xml);
  assert.equal(decodificarXml(b64(utf8(xml))), xml);
  void deUtf8;
});
