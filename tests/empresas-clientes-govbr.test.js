// v1.4: clientes separados por empresa, parâmetros municipais (rotas oficiais e mensagens) e emissão pelo gov.br
// com validação do representante (titular, responsável legal, procurador) e vínculo do XML ao rascunho preparado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import { criarApi } from '../core/api.js';
import { adaptarSqlJs, iniciarBanco } from '../core/banco.js';
import { criarCofre, randomBytes, b64, utf8 } from '../core/seguranca.js';
import { gerarPfx } from './gerar-cert-teste.js';

const pfxAlfa = gerarPfx({ cnpj: '11222333000181', nome: 'ALFA' });
const pfxContador = gerarPfx({ cpf: '11144477735', nome: 'CARLOS CONTADOR' });

test('clientes por empresa, parâmetros municipais e emissão pelo gov.br', async () => {
  const SQL = await initSqlJs();
  const rotas = [];
  const http = async req => {
    const u = new URL(req.url);
    if (u.host === 'brasilapi.com.br') return { status: 200, headers: { 'content-type': 'application/json' }, body: utf8(JSON.stringify({ cnpj: '11222333000181', razao_social: 'ALFA', qualificacao_do_responsavel: 49,
      qsa: [{ nome_socio: 'JOAO RESPONSAVEL', cnpj_cpf_do_socio: '***982247**', qualificacao_socio: 'Sócio-Administrador', codigo_qualificacao_socio: 49 }] })) };
    if (/parametros_municipais|parametrizacao/.test(u.pathname)) {
      rotas.push(u.pathname);
      if (u.pathname.endsWith('/parametros_municipais/3550308/010101000/2026-11-01/aliquota'))
        return { status: 200, headers: { 'content-type': 'application/json' }, body: utf8(JSON.stringify({ aliquotas: { '010101000': [{ Incidencia: 'Local', Aliq: 2.5, DtIni: '2026-01-01T00:00:00' }] } })) };
      return { status: 404, headers: { 'content-type': 'application/json' }, body: utf8(JSON.stringify({ message: 'No HTTP resource was found' })) };
    }
    return { status: 404, headers: {}, body: new Uint8Array() };
  };
  const raw = new SQL.Database();
  const api = criarApi({ nome: 't', db: adaptarSqlJs(raw, () => {}), cofre: criarCofre(randomBytes(32)), http });
  const call = async (method, path, body, token, ok = true) => {
    const [p, qs] = path.split('?');
    const r = await api.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body, token });
    if (ok) assert.ok(r.status < 300, `${path}: ${JSON.stringify(r.json)}`);
    return ok ? r.json : r;
  };
  const { token } = await call('POST', '/api/auth/registrar', { nome: 'U', email: 'u@t.com', senha: '12345678' });
  const cert = await call('POST', '/api/certificados', { pfx: b64(pfxAlfa), senha: '1234' }, token);
  const cCont = await call('POST', '/api/certificados', { pfx: b64(pfxContador), senha: '1234' }, token);
  const alfa = await call('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '11222333000181', razao_social: 'ALFA', cod_municipio: '3550308', regime: 'SN', aliq_sn: 6, ambiente: 'homologacao', certificado_id: cert.id }, token);
  const beta = await call('POST', '/api/contribuintes', { tipo_doc: 'CNPJ', documento: '60746948000112', razao_social: 'BETA', cod_municipio: '3304557', regime: 'LP', aliq_iss: 5, ambiente: 'simulacao' }, token);
  const tom = { tipo_doc: 'CNPJ', documento: '19131243000197', nome: 'CLIENTE', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '20040020', cod_municipio: '3304557' };

  // 1) clientes por empresa
  assert.equal((await call('POST', '/api/tomadores', tom, token, false)).status, 400); // sem empresa
  const tA = (await call('POST', '/api/tomadores', { ...tom, contribuinte_id: alfa.id }, token)).id;
  const tB = (await call('POST', '/api/tomadores', { ...tom, nome: 'CLIENTE NA BETA', contribuinte_id: beta.id }, token)).id;
  assert.notEqual(tA, tB);
  assert.deepEqual((await call('GET', `/api/tomadores?contribuinte_id=${alfa.id}`, null, token)).map(t => t.nome), ['CLIENTE']);
  assert.deepEqual((await call('GET', `/api/tomadores?contribuinte_id=${beta.id}`, null, token)).map(t => t.nome), ['CLIENTE NA BETA']);
  // emitir pela Beta usando o id do cliente da Alfa não altera o cadastro da Alfa
  await call('POST', '/api/notas/emitir', { contribuinte_id: beta.id, tomador: { ...tom, id: tA, nome: 'NOME NOVO' }, form: { competencia: '2026-11-01', ctribnac: '010101', descricao: 'S', valor_servico: 100, trib_issqn: '1', tp_ret_issqn: '1' } }, token);
  assert.equal((await call('GET', `/api/tomadores?contribuinte_id=${alfa.id}`, null, token))[0].nome, 'CLIENTE');
  assert.equal((await call('GET', `/api/tomadores?contribuinte_id=${beta.id}`, null, token))[0].nome, 'NOME NOVO');
  // copiar para outra empresa
  const tC = (await call('POST', '/api/tomadores', { ...tom, documento: '00000000000191', nome: 'BANCO', contribuinte_id: alfa.id }, token)).id;
  assert.equal((await call('POST', '/api/tomadores/copiar', { ids: [tC], contribuinte_id: beta.id }, token)).copiados, 1);
  assert.equal((await call('GET', `/api/tomadores?contribuinte_id=${beta.id}`, null, token)).length, 2);

  // migração: cadastro antigo (sem empresa) usado por duas empresas vira dois
  raw.run("INSERT INTO tomadores (usuario_id, tipo_doc, documento, nome) VALUES (1, 'CPF', '52998224725', 'ANTIGO')");
  const antigo = raw.exec("SELECT id FROM tomadores WHERE nome = 'ANTIGO'")[0].values[0][0];
  raw.run(`INSERT INTO notas (usuario_id, contribuinte_id, tomador_id, status, dados) VALUES (1, ${alfa.id}, ${antigo}, 'autorizada', '{}'), (1, ${beta.id}, ${antigo}, 'autorizada', '{}')`);
  raw.run("INSERT INTO tomadores (usuario_id, tipo_doc, documento, nome) VALUES (1, 'CPF', '11144477735', 'SEM NOTAS')");
  iniciarBanco(adaptarSqlJs(raw, () => {}));
  const antigos = raw.exec("SELECT contribuinte_id FROM tomadores WHERE nome = 'ANTIGO' ORDER BY contribuinte_id")[0].values.map(v => v[0]);
  assert.deepEqual(antigos, [alfa.id, beta.id]);
  assert.equal(raw.exec(`SELECT COUNT(DISTINCT tomador_id) FROM notas WHERE tomador_id IN (SELECT id FROM tomadores WHERE nome = 'ANTIGO')`)[0].values[0][0], 2);
  assert.deepEqual((await call('GET', '/api/tomadores?contribuinte_id=sem', null, token)).map(t => t.nome), ['SEM NOTAS']);

  // 2) parâmetros municipais: sem cTribNac não chama a Sefin; rota oficial com competência; 404 explicado
  const semServ = await call('GET', `/api/parametros-municipais?contribuinte_id=${alfa.id}&municipio=4119905`, null, token, false);
  assert.equal(semServ.status, 400);
  assert.match(semServ.json.erro, /cTribNac/);
  let p = await call('GET', `/api/parametros-municipais?contribuinte_id=${alfa.id}&servico=010101&competencia=2026-11-15`, null, token);
  assert.equal(p.ok, true);
  assert.equal(p.aliquotas[0].aliquota, 2.5);
  assert.ok(rotas.every(r => !r.endsWith('/')));
  p = await call('GET', `/api/parametros-municipais?contribuinte_id=${alfa.id}&municipio=4119905&servico=010101`, null, token);
  assert.equal(p.ok, false);
  assert.equal(p.status, 404);
  assert.match(p.mensagem, /não ter aderido|parametrizado/);
  assert.ok(p.tentativas.length >= 2);
  assert.ok((await call('GET', `/api/parametros-municipais?contribuinte_id=${alfa.id}&tipo=convenio`, null, token)).tentativas[0].url.endsWith('/3550308/convenio'));

  // 3) gov.br: validação do representante
  const nota = { contribuinte_id: alfa.id, tomador: { ...tom, nome: 'CLIENTE' }, form: { competencia: '2026-11-01', ctribnac: '010101', descricao: 'Consultoria', valor_servico: 1234.5, trib_issqn: '1', tp_ret_issqn: '1' } };
  const val = rep => call('POST', '/api/notas/govbr/validar-representante', { contribuinte_id: alfa.id, representante: { nivel_ok: true, ...rep } }, token);
  assert.match((await val({ papel: 'titular', cpf: '52998224725', nome: 'JOAO RESPONSAVEL' })).erros[0].msg, /pessoa jurídica/);
  assert.match((await val({ papel: 'responsavel', cpf: '11144477735', nome: 'CARLOS' })).erros[0].msg, /QSA/);
  let v = await val({ papel: 'responsavel', cpf: '52998224725', nome: 'Joao Responsavel' });
  assert.equal(v.erros.length, 0);
  assert.match(v.ok[0], /QSA/);
  assert.match((await val({ papel: 'responsavel', cpf: '52998224725', nome: 'JOAO', nivel_ok: false })).erros[0].msg, /prata ou ouro/);
  assert.match((await val({ papel: 'procurador', cpf: '11144477735', nome: 'CARLOS CONTADOR' })).erros[0].msg, /e-CAC/);
  assert.match((await val({ papel: 'procurador', cpf: '11144477735', nome: 'CARLOS CONTADOR', confirma_procuracao: true })).avisos[0], /declarada/);
  await call('POST', '/api/procuracoes', { contribuinte_id: alfa.id, certificado_id: cCont.id, valida_ate: '2020-01-01' }, token);
  assert.match((await val({ papel: 'procurador', cpf: '11144477735', nome: 'CARLOS CONTADOR', confirma_procuracao: true })).erros[0].msg, /vencida/);

  // preparar: valida a nota, guarda o rascunho e o representante
  const ruim = await call('POST', '/api/notas/govbr/preparar', { ...nota, form: { ...nota.form, valor_servico: 0 }, representante: { papel: 'responsavel', cpf: '52998224725', nome: 'JOAO RESPONSAVEL', nivel_ok: true } }, token, false);
  assert.equal(ruim.status, 422);
  const prep = await call('POST', '/api/notas/govbr/preparar', { ...nota, representante: { papel: 'responsavel', cpf: '52998224725', nome: 'JOAO RESPONSAVEL', nivel_ok: true } }, token);
  assert.match(prep.url, /producaorestrita\.nfse\.gov\.br\/EmissorNacional/);
  assert.equal((await call('GET', `/api/contribuintes/${alfa.id}`, null, token)).govbr_papel, 'responsavel');
  assert.equal((await call('GET', `/api/notas/${prep.rascunho_id}`, null, token)).status, 'rascunho');
  assert.equal((await call('POST', '/api/notas/govbr/preparar', { ...nota, contribuinte_id: beta.id, representante: {} }, token, false)).status, 400); // simulação

  // o XML baixado do Emissor Nacional substitui o rascunho
  const src = fs.readFileSync(new URL('./danfse.test.js', import.meta.url), 'utf8');
  const CH = src.match(/const CHAVE = '(\d+)'/)[1];
  const fn = src.slice(src.indexOf('function nfse'), src.indexOf('\n}\n', src.indexOf('function nfse')) + 2);
  let xml = new Function('CHAVE', fn + '; return nfse;')(CH)();
  const vServ = (xml.match(/<vServ>([\d.]+)<\/vServ>/) || [])[1];
  const tomaDoc = (xml.match(/<toma>[\s\S]*?<(?:CNPJ|CPF)>(\d+)</) || [])[1];
  await call('POST', '/api/notas/govbr/preparar', { ...nota, rascunho_id: prep.rascunho_id, tomador: { ...tom, documento: tomaDoc, nome: 'TOMADOR DO XML' }, form: { ...nota.form, valor_servico: +vServ }, representante: { papel: 'responsavel', cpf: '52998224725', nome: 'JOAO RESPONSAVEL', nivel_ok: true } }, token);
  const r = await call('POST', '/api/notas/importar-xml', { xmls: [xml], via: 'govbr' }, token);
  assert.equal(r.vinculadas, 1, JSON.stringify(r));
  assert.equal((await call('GET', `/api/notas/${prep.rascunho_id}`, null, token, false)).status, 404);
  const n = await call('GET', `/api/notas/${r.notas[0].id}`, null, token);
  assert.equal(n.status, 'autorizada');
  assert.equal(n.emitido_via, 'govbr');
  assert.match(JSON.stringify(n.mensagens), /responsável legal/);
});
