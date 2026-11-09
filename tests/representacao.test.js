// Representação (Guia do Emissor Nacional v1.3, item 11): responsável legal (e-CPF), mesma raiz de CNPJ (e-CNPJ),
// procuração eletrônica; e importação das NFS-e emitidas no Emissor Nacional com a conta gov.br.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import { criarApi } from '../core/api.js';
import { adaptarSqlJs } from '../core/banco.js';
import { criarCofre, randomBytes, b64, utf8 } from '../core/seguranca.js';
import { lerPfx } from '../core/certificado.js';
import { nfseSimulada, chaveSimulada } from '../core/dps.js';
import { decodificarXml } from '../core/sefin.js';
import { gerarPfx } from './gerar-cert-teste.js';

// e-CNPJ da matriz (responsável CPF 52998224725 no certificado) e e-CPF do responsável legal
const pfxMatriz = gerarPfx({ cnpj: '11222333000181', nome: 'ALFA MATRIZ' });
const pfxResp = gerarPfx({ cpf: '52998224725', nome: 'JOAO RESPONSAVEL' });
const pfxOutro = gerarPfx({ cpf: '11144477735', nome: 'FULANO SEM VINCULO' });

test('responsável legal, mesma raiz de CNPJ e importação do Emissor Nacional (gov.br)', async () => {
  const SQL = await initSqlJs();
  const usados = [];
  const http = async req => {
    const u = new URL(req.url);
    if (u.host === 'brasilapi.com.br') return { status: 200, headers: { 'content-type': 'application/json' }, body: utf8(JSON.stringify({ cnpj: '11222333000262', razao_social: 'ALFA FILIAL', qualificacao_do_responsavel: 49,
      qsa: [{ nome_socio: 'JOAO RESPONSAVEL', cnpj_cpf_do_socio: '***982247**', qualificacao_socio: 'Sócio-Administrador', codigo_qualificacao_socio: 49 }, { nome_socio: 'MARIA SOCIA', cnpj_cpf_do_socio: '***111222**', qualificacao_socio: 'Sócio', codigo_qualificacao_socio: 22 }] })) };
    if (req.method === 'HEAD') return { status: 404, headers: {}, body: new Uint8Array() };
    if (req.method === 'POST' && u.pathname.endsWith('/nfse')) {
      const dps = decodificarXml(JSON.parse(req.body).dpsXmlGZipB64);
      usados.push((dps.match(/<X509Certificate>([^<]+)</) || [])[1]);
      const ch = chaveSimulada({ cMun: '3550308', tipoDoc: 'CNPJ', doc: '11222333000262', nNFSe: usados.length });
      const nfse = nfseSimulada({ chave: ch, nNFSe: String(usados.length), dpsAssinada: dps, contrib: { cod_municipio: '3550308', documento: '11222333000262', razao_social: 'ALFA FILIAL', im: '7788' }, calc: { ibscbs: null, vBC: 1000, aliq: 0, vISS: 0, vLiq: 1000, vTotalRet: 0 }, municipio: 'São Paulo' });
      return { status: 201, headers: { 'content-type': 'application/json' }, body: utf8(JSON.stringify({ chaveAcesso: ch, nfseXmlGZipB64: Buffer.from(nfse).toString('base64') })) };
    }
    return { status: 404, headers: {}, body: new Uint8Array() };
  };
  const api = criarApi({ nome: 't', db: adaptarSqlJs(new SQL.Database(), () => {}), cofre: criarCofre(randomBytes(32)), http });
  const call = async (method, path, body, token, ok = true) => {
    const [p, qs] = path.split('?');
    const r = await api.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body, token });
    if (ok) assert.ok(r.status < 300, `${path}: ${JSON.stringify(r.json)}`);
    return ok ? r.json : r;
  };
  const { token } = await call('POST', '/api/auth/registrar', { nome: 'R', email: 'r@t.com', senha: '12345678' });
  const cMatriz = await call('POST', '/api/certificados', { pfx: b64(pfxMatriz), senha: '1234' }, token);
  const cResp = await call('POST', '/api/certificados', { pfx: b64(pfxResp), senha: '1234' }, token);
  const cOutro = await call('POST', '/api/certificados', { pfx: b64(pfxOutro), senha: '1234' }, token);
  // Filial (mesma raiz 11222333) sem certificado próprio
  const filial = await call('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '11222333000262', razao_social: 'ALFA FILIAL', cod_municipio: '3550308', regime: 'SN', aliq_sn: 6, ambiente: 'homologacao' }, token);

  // 1) mesma raiz: o e-CNPJ da matriz aparece como opção e é o automático
  let acessos = await call('GET', `/api/contribuintes/${filial.id}/acessos`, null, token);
  assert.deepEqual(acessos.map(a => a.via), ['raiz']);
  assert.equal(acessos[0].certificado_id, cMatriz.id);

  // 2) responsável legal: identificado pelo e-CNPJ (OID do responsável) e pelo QSA da Receita
  const id = await call('GET', `/api/contribuintes/${filial.id}/responsavel`, null, token);
  assert.equal(id.atual, null);
  assert.ok(id.candidatos.some(x => x.cpf === '52998224725' && /e-CNPJ/.test(x.fonte) && x.certificado_id === cResp.id));
  assert.ok(id.candidatos.some(x => x.cpf === '52998224725' && /QSA/.test(x.fonte) && x.confiavel));
  assert.ok(!id.candidatos.some(x => x.cpf === '11144477735'));
  assert.equal(id.qsa.length, 2);
  const salvo = await call('PUT', `/api/contribuintes/${filial.id}/responsavel`, { cpf: '529.982.247-25', nome: 'JOAO RESPONSAVEL', fonte: 'QSA da Receita' }, token);
  assert.deepEqual(salvo.acessos.map(a => a.via), ['raiz', 'responsavel']);
  assert.equal((await call('PUT', `/api/contribuintes/${filial.id}/responsavel`, { cpf: '123' }, token, false)).status, 400);

  // 3) emitir como responsável legal: a DPS é assinada com o e-CPF; certificado sem vínculo é recusado
  const nota = { contribuinte_id: filial.id, tomador: { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'CLIENTE', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '20040020', cod_municipio: '3304557' },
    form: { competencia: '2026-11-01', ctribnac: '010101', descricao: 'Serviço', valor_servico: 1000, trib_issqn: '1', tp_ret_issqn: '1' } };
  const e1 = await call('POST', '/api/notas/emitir', { ...nota, acesso: { certificado_id: cResp.id } }, token);
  assert.equal(e1.status, 'autorizada', JSON.stringify(e1));
  const certPem = c => lerPfx(c, '1234').certPem.replace(/-----[^-]+-----|\s/g, '');
  assert.equal(usados[0], certPem(pfxResp));
  const n1 = await call('GET', `/api/notas/${e1.id}`, null, token);
  assert.equal(n1.emitido_via, 'responsavel');
  const recusa = await call('POST', '/api/notas/emitir', { ...nota, acesso: { certificado_id: cOutro.id } }, token, false);
  assert.equal(recusa.status, 400);
  assert.match(recusa.json.erro, /vínculo/);
  // automático → mesma raiz (e-CNPJ da matriz)
  const e2 = await call('POST', '/api/notas/emitir', nota, token);
  assert.equal(usados[1], certPem(pfxMatriz));
  assert.equal((await call('GET', `/api/notas/${e2.id}`, null, token)).emitido_via, 'raiz');
  // a IM da filial veio da NFS-e (grupo emit)
  assert.equal((await call('GET', `/api/contribuintes/${filial.id}`, null, token)).im, '7788');

  // 4) NFS-e emitida no Emissor Nacional (gov.br): importação do XML baixado, idempotente, e evento de cancelamento
  const src = fs.readFileSync(new URL('./danfse.test.js', import.meta.url), 'utf8');
  const CH = src.match(/const CHAVE = '(\d+)'/)[1];
  const fn = src.slice(src.indexOf('function nfse'), src.indexOf('\n}\n', src.indexOf('function nfse')) + 2);
  const xmlPortal = new Function('CHAVE', fn + '; return nfse;')(CH)().replace(/11222333000181/g, '11222333000262');
  let r = await call('POST', '/api/notas/importar-xml', { xmls: [xmlPortal, '<NFSe><infNFSe Id="NFS1"/></NFSe>'], via: 'govbr' }, token);
  assert.equal(r.importadas, 1);
  assert.equal(r.erros.length, 1);
  const imp = await call('GET', `/api/notas/${r.notas[0].id}`, null, token);
  assert.equal(imp.emitido_via, 'govbr');
  assert.equal(imp.origem, 'portal');
  assert.equal(imp.ambiente, 'producao');
  assert.equal(imp.nnfse, '123');
  r = await call('POST', '/api/notas/importar-xml', { xmls: [Buffer.from(xmlPortal).toString('base64')], via: 'govbr' }, token);
  assert.equal(r.atualizadas, 1);
  r = await call('POST', '/api/notas/importar-xml', { xmls: [`<evento><infEvento><pedRegEvento><infPedReg><chNFSe>${imp.chave_acesso}</chNFSe><e101101/></infPedReg></pedRegEvento></infEvento></evento>`], via: 'govbr' }, token);
  assert.equal(r.eventos, 1, JSON.stringify(r.erros));
  assert.equal((await call('GET', `/api/notas/${imp.id}`, null, token)).status, 'cancelada');
  // prestador não cadastrado
  r = await call('POST', '/api/notas/importar-xml', { xmls: [xmlPortal.replace(/11222333000262/g, '99888777000166')] }, token);
  assert.match(r.erros[0].erro, /não está cadastrado/);
});
