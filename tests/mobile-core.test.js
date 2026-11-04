// Garante que o núcleo roda com o adaptador sql.js (o mesmo usado no Android) e que a DPS assinada é válida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { criarApi } from '../core/api.js';
import { adaptarSqlJs } from '../core/banco.js';
import { criarCofre, randomBytes, b64 } from '../core/seguranca.js';
import { gerarPfx } from './gerar-cert-teste.js';

test('núcleo com sql.js: cadastro, certificado, emissão assinada e persistência', async () => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  let gravacoes = 0;
  const api = criarApi({ nome: 'android-teste', db: adaptarSqlJs(raw, () => gravacoes++), cofre: criarCofre(randomBytes(32)), http: async () => ({ status: 503, headers: {}, body: new Uint8Array() }) });
  const call = async (method, path, body, token) => {
    const [p, qs] = path.split('?');
    const r = await api.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body, token });
    assert.ok(r.status < 300, `${path}: ${JSON.stringify(r.json)}`);
    return r.json ?? r.arquivo;
  };
  const { token } = await call('POST', '/api/auth/registrar', { nome: 'Mobile', email: 'm@t.com', senha: '12345678' });
  const cert = await call('POST', '/api/certificados', { pfx: b64(gerarPfx({ cnpj: '11222333000181' })), senha: '1234' }, token);
  const c = await call('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '11222333000181', razao_social: 'ALFA', cod_municipio: '3550308', regime: 'SN', aliq_sn: 6, ambiente: 'simulacao', certificado_id: cert.id }, token);
  const r = await call('POST', '/api/notas/emitir', { contribuinte_id: c.id, tomador: { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'CLIENTE', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '20040020', cod_municipio: '3304557' },
    form: { competencia: '2026-11-01', ctribnac: '010101', descricao: 'Serviço', valor_servico: 1000, trib_issqn: '1', tp_ret_issqn: '1', ibscbs_ativo: true, ind_op: '100301', cclasstrib: '000001' } }, token);
  assert.equal(r.status, 'autorizada');
  const n = await call('GET', `/api/notas/${r.id}`, null, token);
  assert.match(n.xml_dps, /<SignatureValue>/);
  const csv = await call('GET', '/api/relatorios/notas.csv', null, token);
  assert.match(csv.dados, /ALFA/);
  assert.ok(gravacoes > 5);
  // banco exportado e reaberto preserva os dados
  const reaberto = new SQL.Database(raw.export());
  assert.equal(reaberto.exec('SELECT COUNT(*) FROM notas')[0].values[0][0], 1);
});
