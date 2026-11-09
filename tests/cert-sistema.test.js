// Certificados instalados no sistema (repositório do Windows / KeyChain do Android): a chave privada não sai do
// sistema – o núcleo pede a assinatura à plataforma e o transporte TLS recebe apenas a referência do certificado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import initSqlJs from 'sql.js';
import { criarApi } from '../core/api.js';
import { adaptarSqlJs } from '../core/banco.js';
import { criarCofre, randomBytes, utf8 } from '../core/seguranca.js';
import { lerPfx, lerCertificadoDer, conferirAssinatura } from '../core/certificado.js';
import { assinar, assinarXml, nfseSimulada, chaveSimulada } from '../core/dps.js';
import { decodificarXml } from '../core/sefin.js';
import { gerarPfx } from './gerar-cert-teste.js';

const pfx = lerPfx(gerarPfx({ cnpj: '11222333000181', nome: 'ALFA LTDA' }), '1234');
const chave = forge.pki.privateKeyFromPem(pfx.keyPem);
const der = Uint8Array.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pfx.certPem))).getBytes(), c => c.charCodeAt(0));
const THUMB = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
const bin = u => String.fromCharCode(...u);

// "Sistema operacional" simulado: assina com a chave guardada, sem expô-la ao núcleo
const assinaturas = [];
const certSistema = {
  listar: async () => [{ id: THUMB, der }, { id: 'FFFF', der: new Uint8Array([1, 2, 3]) }],
  assinar: async (id, dados, alg) => {
    assert.equal(id, THUMB);
    assinaturas.push(alg);
    const md = alg === 'sha256' ? forge.md.sha256.create() : forge.md.sha1.create();
    md.update(bin(dados));
    return Uint8Array.from(chave.sign(md), c => c.charCodeAt(0));
  },
};

test('leitura de certificado DER, prova de posse e assinatura XML idêntica à do .pfx', async () => {
  const info = lerCertificadoDer(der);
  assert.equal(info.documento, '11222333000181');
  assert.equal(info.titular, 'ALFA LTDA');
  assert.equal(info.keyPem, undefined);
  const desafio = randomBytes(32);
  assert.ok(conferirAssinatura(info.certPem, desafio, await certSistema.assinar(THUMB, desafio, 'sha256')));
  assert.ok(!conferirAssinatura(info.certPem, randomBytes(32), await certSistema.assinar(THUMB, desafio, 'sha256')));
  const xml = '<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS1"><tpAmb>2</tpAmb></infDPS></DPS>';
  for (const alg of ['sha1', 'sha256']) {
    const externo = await assinarXml(xml, 'infDPS', { certPem: info.certPem, assinador: (d, a) => certSistema.assinar(THUMB, d, a) }, alg);
    assert.equal(externo, assinar(xml, 'infDPS', pfx, alg));
  }
});

test('login, vínculo e emissão com certificado instalado no sistema (TLS pela plataforma)', async () => {
  const SQL = await initSqlJs();
  const chamadas = [];
  assinaturas.length = 0;
  const http = async req => {
    const u = new URL(req.url);
    chamadas.push({ rota: `${req.method} ${u.pathname}`, certSistema: req.certSistema, pfx: !!req.pfx });
    if (req.method === 'HEAD') return { status: 404, headers: {}, body: new Uint8Array() };
    if (req.method === 'POST' && u.pathname.endsWith('/nfse')) {
      const dps = decodificarXml(JSON.parse(req.body).dpsXmlGZipB64);
      assert.match(dps, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
      assert.match(dps, /<SignatureValue>/);
      const ch = chaveSimulada({ cMun: '3550308', tipoDoc: 'CNPJ', doc: '11222333000181', nNFSe: 1 });
      const nfse = nfseSimulada({ chave: ch, nNFSe: '1', dpsAssinada: dps, contrib: { cod_municipio: '3550308', documento: '11222333000181', razao_social: 'ALFA' }, calc: { ibscbs: null, vBC: 1000, aliq: 0, vISS: 0, vLiq: 1000, vTotalRet: 0 }, municipio: 'São Paulo' });
      return { status: 201, headers: { 'content-type': 'application/json' }, body: utf8(JSON.stringify({ chaveAcesso: ch, nfseXmlGZipB64: Buffer.from(nfse).toString('base64') })) };
    }
    return { status: 404, headers: {}, body: new Uint8Array() };
  };
  const api = criarApi({ nome: 't', db: adaptarSqlJs(new SQL.Database(), () => {}), cofre: criarCofre(randomBytes(32)), http, certSistema });
  const call = async (method, path, body, token, ok = true) => {
    const r = await api.handle({ method, path, query: {}, body, token });
    if (ok) assert.ok(r.status < 300, `${path}: ${JSON.stringify(r.json)}`);
    return ok ? r.json : r;
  };
  // lista só o certificado legível
  const lista = await call('GET', '/api/certificados/sistema');
  assert.equal(lista.suportado, true);
  assert.equal(lista.certificados.length, 1);
  assert.equal(lista.certificados[0].documento, '11222333000181');
  assert.equal(lista.certificados[0].info, undefined);
  // login com prova de posse (assinatura SHA-256 de um desafio)
  const { token, usuario } = await call('POST', '/api/auth/certificado-sistema', { id: THUMB });
  assert.equal(usuario.documento, '11222333000181');
  assert.deepEqual(assinaturas, ['sha256']);
  const certs = await call('GET', '/api/certificados', null, token);
  assert.equal(certs.length, 1);
  assert.equal(certs[0].origem, 'sistema');
  // vincular de novo não duplica
  await call('POST', '/api/certificados/sistema', { id: THUMB }, token);
  assert.equal((await call('GET', '/api/certificados', null, token)).length, 1);
  const r404 = await call('POST', '/api/certificados/sistema', { id: 'NAOEXISTE' }, token, false);
  assert.equal(r404.status, 400);
  // emissão em produção restrita: DPS assinada pelo sistema e TLS com a referência do certificado
  const c = await call('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '11222333000181', razao_social: 'ALFA', cod_municipio: '3550308', regime: 'SN', aliq_sn: 6, ambiente: 'homologacao', certificado_id: certs[0].id }, token);
  const e = await call('POST', '/api/notas/emitir', { contribuinte_id: c.id, tomador: { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'CLIENTE', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '20040020', cod_municipio: '3304557' },
    form: { competencia: '2026-11-01', ctribnac: '010101', descricao: 'Serviço', valor_servico: 1000, trib_issqn: '1', tp_ret_issqn: '1' } }, token);
  assert.equal(e.status, 'autorizada', JSON.stringify(e));
  assert.ok(assinaturas.includes('sha1'));
  const sefin = chamadas.filter(x => /\/(nfse|dps)/.test(x.rota));
  assert.ok(sefin.length >= 2);
  assert.ok(sefin.every(x => x.certSistema === THUMB && !x.pfx));
  // plataforma sem acesso ao repositório (navegador)
  const api2 = criarApi({ nome: 't2', db: adaptarSqlJs(new SQL.Database(), () => {}), cofre: criarCofre(randomBytes(32)), http });
  assert.deepEqual((await api2.handle({ method: 'GET', path: '/api/certificados/sistema', query: {}, body: {} })).json, { suportado: false });
});
