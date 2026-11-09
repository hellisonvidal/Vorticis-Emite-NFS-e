// Consulta de CNPJ (Receita: BrasilAPI → Minha Receita → CNPJ.ws), endereço completo e inscrição municipal
// obtida das NFS-e / cadastros locais; preenchimento em lote só de campos vazios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { criarApi } from '../core/api.js';
import { adaptarSqlJs } from '../core/banco.js';
import { criarCofre, randomBytes, utf8 } from '../core/seguranca.js';

const BRASILAPI = { cnpj: '19131243000197', razao_social: 'MERCADO CENTRAL LTDA', nome_fantasia: 'MERCADO', cep: '20040020', descricao_tipo_de_logradouro: 'RUA', logradouro: 'DA ASSEMBLEIA 10',
  numero: '10', complemento: 'SALA  5 ', bairro: 'CENTRO', uf: 'RJ', codigo_municipio_ibge: 3304557, municipio: 'RIO DE JANEIRO', ddd_telefone_1: '2122223333', email: null,
  descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: true, opcao_pelo_mei: false };
const CNPJWS = { razao_social: 'MERCADO CENTRAL LTDA', simples: { simples: 'Sim', mei: 'Não' }, estabelecimento: { cnpj: '19131243000197', email: 'Fiscal@Mercado.com.br', ddd1: '21', telefone1: '22223333',
  tipo_logradouro: 'RUA', logradouro: 'DA ASSEMBLEIA', numero: '10', cep: '20040020', bairro: 'CENTRO', estado: { sigla: 'RJ' }, cidade: { ibge_id: 3304557, nome: 'Rio de Janeiro' }, situacao_cadastral: 'Ativa' } };

test('consulta CNPJ com fontes alternativas, endereço completo e IM das NFS-e', async () => {
  const SQL = await initSqlJs();
  const chamadas = [];
  let brasilApiFora = false;
  const json = (st, o) => ({ status: st, headers: { 'content-type': 'application/json' }, body: utf8(JSON.stringify(o)) });
  const http = async req => {
    const u = new URL(req.url); chamadas.push(u.host);
    const doc = u.pathname.split('/').pop();
    if (u.host === 'brasilapi.com.br') return brasilApiFora ? json(503, {}) : json(200, { ...BRASILAPI, cnpj: doc });
    if (u.host === 'minhareceita.org') return json(200, { ...BRASILAPI, logradouro: 'DA ASSEMBLEIA' });
    if (u.host === 'publica.cnpj.ws') return json(200, { ...CNPJWS, estabelecimento: { ...CNPJWS.estabelecimento, cnpj: doc } });
    return json(404, {});
  };
  const api = criarApi({ nome: 't', db: adaptarSqlJs(new SQL.Database(), () => {}), cofre: criarCofre(randomBytes(32)), http });
  const call = async (method, path, body, token, ok = true) => {
    const [p, qs] = path.split('?');
    const r = await api.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body, token });
    if (ok) assert.ok(r.status < 300, `${path}: ${JSON.stringify(r.json)}`);
    return ok ? r.json : r;
  };
  const { token } = await call('POST', '/api/auth/registrar', { nome: 'R', email: 'r@t.com', senha: '12345678' });

  // 1) endereço completo: tipo + logradouro sem o número colado, complemento limpo, e-mail/telefone completados pelo CNPJ.ws
  let d = await call('GET', '/api/consulta/cnpj/19.131.243-0001-97', null, token);
  assert.equal(d.logradouro, 'RUA DA ASSEMBLEIA');
  assert.equal(d.numero, '10');
  assert.equal(d.complemento, 'SALA 5');
  assert.equal(d.email, 'fiscal@mercado.com.br');
  assert.equal(d.fone, '2122223333');
  assert.equal(d.municipio, 'Rio de Janeiro');
  assert.equal(d.uf, 'RJ');
  assert.equal(d.ativa, true);
  assert.equal(d.im, '');
  assert.match(d.im_aviso, /CNC/);
  assert.ok(chamadas.includes('publica.cnpj.ws'));
  // BrasilAPI fora do ar → Minha Receita
  brasilApiFora = true; chamadas.length = 0;
  d = await call('GET', '/api/consulta/cnpj/19131243000197', null, token);
  assert.equal(d.nome, 'MERCADO CENTRAL LTDA');
  assert.deepEqual(chamadas.slice(0, 2), ['brasilapi.com.br', 'minhareceita.org']);
  brasilApiFora = false;
  assert.equal((await call('GET', '/api/consulta/cnpj/11111111111111', null, token, false)).status, 400);

  // 2) IM do tomador aprendida da NFS-e emitida (o cadastro local do cliente é removido para forçar a leitura do XML)
  const c = await call('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '11222333000181', razao_social: 'ALFA', cod_municipio: '3550308', im: '998877', regime: 'SN', aliq_sn: 6, ambiente: 'simulacao' }, token);
  await call('POST', '/api/notas/emitir', { contribuinte_id: c.id, tomador: { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'MERCADO', im: '5544', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '20040020', cod_municipio: '3304557' },
    form: { competencia: '2026-11-01', ctribnac: '010101', descricao: 'Serviço', valor_servico: 1000, trib_issqn: '1', tp_ret_issqn: '1' } }, token);
  const toms = await call('GET', '/api/tomadores', null, token);
  for (const t of toms) await call('DELETE', `/api/tomadores/${t.id}`, null, token);
  d = await call('GET', '/api/consulta/cnpj/19131243000197', null, token);
  assert.equal(d.im, '5544');
  assert.match(d.im_fonte, /NFS-e/);
  // IM do emitente vem do cadastro da empresa
  assert.equal((await call('GET', '/api/consulta/cnpj/11222333000181', null, token)).im, '998877');

  // 3) completar em lote: só campos vazios, IM pelas notas; não sobrescreve o que o usuário digitou
  const id = (await call('POST', '/api/tomadores', { contribuinte_id: c.id, tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'Nome digitado', email: 'meu@email.com' }, token)).id;
  const r = await call('POST', '/api/cadastros/completar', { tipo: 'tomadores' }, token);
  assert.equal(r.atualizados, 1);
  assert.equal(r.ims, 1);
  const t = (await call('GET', '/api/tomadores', null, token)).find(x => x.id === id);
  assert.equal(t.nome, 'Nome digitado');
  assert.equal(t.email, 'meu@email.com');
  assert.equal(t.logradouro, 'RUA DA ASSEMBLEIA');
  assert.equal(t.cod_municipio, '3304557');
  assert.equal(t.im, '5544');
});
