// Vorticis Emite NFS - API de aplicação independente de plataforma.
// O mesmo código atende o servidor HTTP (Windows/Electron) e o app Android (chamado direto no WebView).
//
// criarApi(plataforma) -> { handle(req) }
//   plataforma = { db, cofre: {encrypt, decrypt}, http(req), versao }
//   req = { method, path, query, body, token }
//   resposta = { status, json } | { status, arquivo: { nome, tipo, dados: Uint8Array|string, inline } }
import { iniciarBanco } from './banco.js';
import { hashSenha, conferirSenha, novoToken, unb64 } from './seguranca.js';
import { lerPfx, resumoCert } from './certificado.js';
import { calcular, sugerirRetencoes, REGIMES, REG_ESP_TRIB, ALIQ_IBSCBS } from './tributos.js';
import { montarDPS, montarCancelamento, assinar, chaveSimulada, nfseSimulada, dataHoraBR } from './dps.js';
import { criarSefin } from './sefin.js';
import { T, buscar, sugestoes, nomeMunicipio, MUN, CTRIB, NBS } from './tabelas.js';
import { so, docValido, validarEmissao } from './validacao.js';

export const APP_NOME = 'Vorticis Emite NFS';

class ErroUsuario extends Error { constructor(msg, status = 400, extra) { super(msg); this.status = status; this.extra = extra; } }
const falha = (msg, status, extra) => { throw new ErroUsuario(msg, status, extra); };
const json = (v, def = {}) => { try { return v ? JSON.parse(v) : def; } catch { return def; } };

export function criarApi(P) {
  const db = iniciarBanco(P.db);
  const sefin = criarSefin(P.http);
  const audit = (uid, acao, det = '') => db.prepare('INSERT INTO auditoria (usuario_id, acao, detalhe) VALUES (?,?,?)').run(uid ?? null, acao, String(det).slice(0, 2000));
  const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // ------------------------------------------------------------ roteador
  const rotas = [];
  const rota = (method, padrao, fn, publico = false) => {
    const keys = [];
    const re = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    rotas.push({ method, re, keys, fn, publico });
  };
  const GET = (p, f, pub) => rota('GET', p, f, pub), POST = (p, f, pub) => rota('POST', p, f, pub);
  const PUT = (p, f) => rota('PUT', p, f), DEL = (p, f) => rota('DELETE', p, f);

  async function handle({ method = 'GET', path, query = {}, body = {}, token }) {
    try {
      const url = path.split('?')[0];
      for (const r of rotas) {
        if (r.method !== method) continue;
        const m = url.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const ctx = { params, query, body: body || {}, token };
        if (!r.publico) ctx.user = autenticar(token);
        const out = await r.fn(ctx);
        if (out && out.arquivo) return { status: 200, arquivo: out.arquivo };
        if (out && out.__status) { const { __status, ...rest } = out; return { status: __status, json: rest }; }
        return { status: 200, json: out ?? null };
      }
      return { status: 404, json: { erro: 'Rota não encontrada.' } };
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      return { status, json: { erro: e.message || 'Erro interno', ...(e.extra || {}) } };
    }
  }

  // ------------------------------------------------------------ autenticação
  function criarSessao(uid, metodo) {
    const token = novoToken();
    db.prepare('INSERT INTO sessoes (token, usuario_id, metodo, expira_em) VALUES (?,?,?,?)').run(token, uid, metodo, new Date(Date.now() + 12 * 3600e3).toISOString());
    db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(new Date().toISOString());
    return token;
  }
  function autenticar(token) {
    const s = token && db.prepare('SELECT s.*, u.nome, u.email, u.documento FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE token = ?').get(token);
    if (!s || s.expira_em < new Date().toISOString()) falha('Sessão expirada. Faça login novamente.', 401);
    return { id: s.usuario_id, nome: s.nome, email: s.email, documento: s.documento, metodo: s.metodo };
  }
  async function guardarCertificado(uid, bytes, senha, info, apelido) {
    return db.prepare(`INSERT INTO certificados (usuario_id, apelido, titular, documento, tipo_doc, emissor, serial, valido_de, valido_ate, pfx_enc, senha_enc) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid, apelido || info.titular, info.titular, info.documento, info.tipo_doc, info.emissor, info.serial, info.valido_de, info.valido_ate, await P.cofre.encrypt(bytes), await P.cofre.encrypt(senha || '')).lastInsertRowid;
  }
  async function carregarCertificado(id, uid) {
    const row = db.prepare('SELECT * FROM certificados WHERE id = ? AND usuario_id = ?').get(id, uid);
    if (!row) falha('Certificado não encontrado.');
    const pfx = await P.cofre.decrypt(row.pfx_enc, true);
    const senha = await P.cofre.decrypt(row.senha_enc);
    const info = lerPfx(pfx, senha);
    if (new Date(info.valido_ate) < new Date()) falha(`Certificado "${row.apelido || row.titular}" vencido em ${info.valido_ate.slice(0, 10)}.`);
    return { ...info, pfx, senha, row };
  }

  GET('/api/status', () => ({ ok: true, app: APP_NOME, versao: P.versao || '1.0.0', plataforma: P.nome || 'servidor', usuarios: db.prepare('SELECT COUNT(*) n FROM usuarios').get().n }), true);

  POST('/api/auth/registrar', async ({ body: { nome, email, senha } }) => {
    if (!nome || !email || !senha) falha('Informe nome, e-mail e senha.');
    if (senha.length < 8) falha('A senha deve ter pelo menos 8 caracteres.');
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email.toLowerCase())) falha('E-mail já cadastrado.');
    const id = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?,?,?)').run(nome, email.toLowerCase(), await hashSenha(senha)).lastInsertRowid;
    audit(id, 'registro', email);
    return { token: criarSessao(id, 'senha'), usuario: { nome, email } };
  }, true);

  POST('/api/auth/login', async ({ body: { email, senha } }) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email || '').toLowerCase());
    if (!u || !(await conferirSenha(String(senha || ''), u.senha_hash))) falha('E-mail ou senha inválidos.', 401);
    audit(u.id, 'login', 'senha');
    return { token: criarSessao(u.id, 'senha'), usuario: { nome: u.nome, email: u.email } };
  }, true);

  POST('/api/auth/certificado', async ({ body: { pfx, senha } }) => {
    if (!pfx) falha('Selecione o arquivo do certificado (.pfx/.p12).');
    const bytes = unb64(pfx);
    const info = lerPfx(bytes, senha || '');
    if (new Date(info.valido_ate) < new Date()) falha('Certificado vencido.');
    if (!info.documento) falha('Certificado sem CPF/CNPJ ICP-Brasil identificável.');
    let u = db.prepare('SELECT * FROM usuarios WHERE documento = ?').get(info.documento)
      || db.prepare('SELECT u.* FROM usuarios u JOIN certificados c ON c.usuario_id = u.id WHERE c.documento = ? LIMIT 1').get(info.documento);
    if (!u) u = { id: db.prepare('INSERT INTO usuarios (nome, documento) VALUES (?,?)').run(info.titular, info.documento).lastInsertRowid, nome: info.titular };
    if (!db.prepare('SELECT 1 FROM certificados WHERE usuario_id = ? AND serial = ?').get(u.id, info.serial)) await guardarCertificado(u.id, bytes, senha, info);
    audit(u.id, 'login', `certificado ${info.documento}`);
    return { token: criarSessao(u.id, 'certificado'), usuario: { nome: u.nome, documento: info.documento } };
  }, true);

  POST('/api/auth/logout', ({ token }) => { db.prepare('DELETE FROM sessoes WHERE token = ?').run(token); return { ok: true }; });
  GET('/api/auth/me', ({ user }) => user);
  POST('/api/auth/senha', async ({ user, body: { atual, nova, email } }) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(user.id);
    if (u.senha_hash && !(await conferirSenha(String(atual || ''), u.senha_hash))) falha('Senha atual incorreta.');
    if (!nova || nova.length < 8) falha('A nova senha deve ter pelo menos 8 caracteres.');
    db.prepare('UPDATE usuarios SET senha_hash = ?, email = COALESCE(?, email) WHERE id = ?').run(await hashSenha(nova), email ? email.toLowerCase() : null, u.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ tabelas oficiais
  GET('/api/tabelas/meta', () => ({
    regimes: Object.fromEntries(Object.entries(REGIMES).map(([k, v]) => [k, v.label])), regEspTrib: REG_ESP_TRIB, aliqIbsCbs: ALIQ_IBSCBS,
    cclasstrib: T.cclasstrib, indop: T.indop.filter(i => i.nfse || i.codigo.startsWith('1')), paises: T.paises,
    totais: { ctribnac: T.ctribnac.filter(c => c.nivel === 'desdobro').length, nbs: T.nbs.filter(n => n.cNBS).length, municipios: T.municipios.length },
  }), true);
  GET('/api/tabelas/ctribnac', ({ query: q }) => buscar(q.todos ? T.ctribnac : T.ctribnac.filter(c => c.nivel === 'desdobro' || q.hierarquia), q.q, ['codigo', 'descricao', 'subitem'], +q.limite || 50, +q.offset || 0), true);
  GET('/api/tabelas/nbs', ({ query: q }) => buscar(q.todos ? T.nbs : T.nbs.filter(n => n.cNBS || q.hierarquia), q.q, ['codigo', 'descricao', 'cNBS'], +q.limite || 50, +q.offset || 0), true);
  GET('/api/tabelas/municipios', ({ query: q }) => buscar(T.municipios, q.q, ['nome', 'uf', 'codigo'], +q.limite || 30), true);
  GET('/api/tabelas/indop', ({ query: q }) => buscar(T.indop, q.q, ['codigo', 'tipo', 'caracteristica', 'local'], 100), true);
  GET('/api/tabelas/cclasstrib', ({ query: q }) => buscar(T.cclasstrib, q.q, ['codigo', 'nome', 'descCst'], 100), true);
  GET('/api/tabelas/correlacao', ({ query: q }) => buscar(T.correlacao, q.q, ['item', 'descItem', 'nbs', 'descNbs'], +q.limite || 50, +q.offset || 0), true);
  GET('/api/tabelas/sugestoes/:c', ({ params }) => ({ servico: CTRIB.get(so(params.c)) || null, correlacao: sugestoes(params.c) }), true);

  GET('/api/codigos-municipais', ({ query: { municipio, q } }) => {
    let rows = db.prepare(`SELECT * FROM codigos_municipais ${municipio ? 'WHERE cod_municipio = ?' : ''} ORDER BY cod_municipio, ctribnac, ctribmun`).all(...(municipio ? [municipio] : []));
    if (q) rows = buscar(rows, q, ['ctribnac', 'ctribmun', 'descricao']).itens;
    return rows.map(r => ({ ...r, municipio: nomeMunicipio(r.cod_municipio), servico: CTRIB.get(r.ctribnac)?.descricao || '' }));
  });
  POST('/api/codigos-municipais', ({ body: { cod_municipio, ctribnac, ctribmun, descricao, aliquota } }) => {
    if (!MUN.has(String(cod_municipio))) falha('Município inválido.');
    if (!/^\d{6}$/.test(so(ctribnac)) || !/^\d{3}$/.test(so(ctribmun))) falha('Informe cTribNac (6 dígitos) e cTribMun (3 dígitos).');
    db.prepare(`INSERT INTO codigos_municipais (cod_municipio, ctribnac, ctribmun, descricao, aliquota) VALUES (?,?,?,?,?)
      ON CONFLICT(cod_municipio, ctribnac, ctribmun) DO UPDATE SET descricao = excluded.descricao, aliquota = excluded.aliquota, atualizado_em = datetime('now')`)
      .run(cod_municipio, so(ctribnac), so(ctribmun), descricao || '', aliquota === '' || aliquota === undefined ? null : +aliquota);
    return { ok: true };
  });
  DEL('/api/codigos-municipais/:id', ({ params }) => { db.prepare('DELETE FROM codigos_municipais WHERE id = ?').run(params.id); return { ok: true }; });

  GET('/api/parametros-municipais', async ({ user, query: { contribuinte_id, municipio, servico, tipo, procuracao_id } }) => {
    const c = contribuinte(user.id, contribuinte_id);
    const cred = await credencial(user.id, c, procuracao_id);
    if (!cred.cert) falha('Consulta de parâmetros municipais exige certificado digital (próprio ou de procurador).');
    const amb = c.ambiente === 'producao' ? 'producao' : 'homologacao';
    const suf = tipo === 'convenio' ? 'convenio' : tipo === 'contribuinte' ? so(c.documento) : so(servico);
    const r = await sefin.parametrosMunicipais(amb, cred.cert, municipio || c.cod_municipio, suf);
    try {
      const lista = r.dados?.aliquotas || r.dados?.servicos || [];
      for (const it of Array.isArray(lista) ? lista : []) {
        if (it.codigoTributacaoMunicipal || it.cTribMun) {
          db.prepare(`INSERT OR REPLACE INTO codigos_municipais (cod_municipio, ctribnac, ctribmun, descricao, aliquota, origem) VALUES (?,?,?,?,?,'sefin')`)
            .run(municipio || c.cod_municipio, so(servico), so(it.codigoTributacaoMunicipal || it.cTribMun), it.descricao || '', it.aliquota ?? null);
        }
      }
    } catch { /* formato inesperado */ }
    return r;
  });

  // ------------------------------------------------------------ certificados
  GET('/api/certificados', ({ user }) => db.prepare('SELECT * FROM certificados WHERE usuario_id = ? ORDER BY valido_ate DESC').all(user.id).map(resumoCert));
  POST('/api/certificados', async ({ user, body: { pfx, senha, apelido } }) => {
    if (!pfx) falha('Selecione o arquivo .pfx/.p12.');
    const bytes = unb64(pfx);
    const info = lerPfx(bytes, senha || '');
    if (db.prepare('SELECT 1 FROM certificados WHERE usuario_id = ? AND serial = ?').get(user.id, info.serial)) falha('Este certificado já está cadastrado.');
    const id = await guardarCertificado(user.id, bytes, senha, info, apelido);
    audit(user.id, 'certificado.add', `${info.titular} ${info.documento}`);
    return resumoCert(db.prepare('SELECT * FROM certificados WHERE id = ?').get(id));
  });
  DEL('/api/certificados/:id', ({ user, params }) => { db.prepare('DELETE FROM certificados WHERE id = ? AND usuario_id = ?').run(params.id, user.id); audit(user.id, 'certificado.del', params.id); return { ok: true }; });

  // ------------------------------------------------------------ contribuintes
  const CAMPOS_CONTRIB = ['tipo_doc', 'documento', 'razao_social', 'nome_fantasia', 'im', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cod_municipio', 'uf', 'fone', 'email',
    'regime', 'reg_esp_trib', 'aliq_sn', 'aliq_iss', 'pis_cofins_regime', 'serie_dps', 'prox_ndps', 'ambiente', 'acesso', 'certificado_id', 'ibscbs_ativo', 'cclasstrib_padrao', 'ind_op_padrao', 'config', 'ativo'];
  function contribuinte(uid, id) {
    const c = db.prepare('SELECT * FROM contribuintes WHERE id = ? AND usuario_id = ?').get(id, uid);
    if (!c) falha('Empresa emitente não encontrada.', 404);
    return c;
  }
  function exibirContrib(c) {
    const cert = c.certificado_id ? db.prepare('SELECT * FROM certificados WHERE id = ?').get(c.certificado_id) : null;
    const procs = db.prepare('SELECT p.*, c.titular, c.valido_ate cert_validade FROM procuracoes p JOIN certificados c ON c.id = p.certificado_id WHERE p.contribuinte_id = ? ORDER BY p.id').all(c.id);
    return { ...c, config: json(c.config), municipio: nomeMunicipio(c.cod_municipio), regime_label: REGIMES[c.regime]?.label, certificado: cert ? resumoCert(cert) : null, procuracoes: procs };
  }
  function normalizarContrib(b) {
    const o = {};
    for (const k of CAMPOS_CONTRIB) if (b[k] !== undefined) o[k] = k === 'config' ? JSON.stringify(b[k] || {}) : b[k];
    for (const k of ['documento', 'cep', 'im', 'cod_municipio']) if (o[k] !== undefined) o[k] = so(o[k]);
    if (o.ibscbs_ativo !== undefined) o.ibscbs_ativo = o.ibscbs_ativo ? 1 : 0;
    if (o.certificado_id === '') o.certificado_id = null;
    return o;
  }
  GET('/api/contribuintes', ({ user }) => db.prepare('SELECT * FROM contribuintes WHERE usuario_id = ? ORDER BY razao_social').all(user.id).map(exibirContrib));
  GET('/api/contribuintes/:id', ({ user, params }) => exibirContrib(contribuinte(user.id, params.id)));
  POST('/api/contribuintes', ({ user, body }) => {
    const o = normalizarContrib(body);
    if (!o.documento || !o.razao_social) falha('Informe CPF/CNPJ e razão social.');
    if (!docValido(o.tipo_doc || 'CNPJ', o.documento)) falha('CPF/CNPJ inválido.');
    if (o.cod_municipio && !MUN.has(o.cod_municipio)) falha('Código de município IBGE inválido.');
    if (db.prepare('SELECT 1 FROM contribuintes WHERE usuario_id = ? AND documento = ?').get(user.id, o.documento)) falha('Empresa já cadastrada.');
    const ks = Object.keys(o);
    const id = db.prepare(`INSERT INTO contribuintes (usuario_id, ${ks.join(',')}) VALUES (?, ${ks.map(() => '?').join(',')})`).run(user.id, ...ks.map(k => o[k])).lastInsertRowid;
    audit(user.id, 'contribuinte.add', o.documento);
    return exibirContrib(contribuinte(user.id, id));
  });
  PUT('/api/contribuintes/:id', ({ user, params, body }) => {
    contribuinte(user.id, params.id);
    const o = normalizarContrib(body);
    delete o.documento;
    if (o.cod_municipio && !MUN.has(o.cod_municipio)) falha('Código de município IBGE inválido.');
    const ks = Object.keys(o);
    if (ks.length) db.prepare(`UPDATE contribuintes SET ${ks.map(k => `${k} = ?`).join(',')} WHERE id = ?`).run(...ks.map(k => o[k]), params.id);
    return exibirContrib(contribuinte(user.id, params.id));
  });
  DEL('/api/contribuintes/:id', ({ user, params }) => {
    contribuinte(user.id, params.id);
    const n = db.prepare("SELECT COUNT(*) n FROM notas WHERE contribuinte_id = ? AND status = 'autorizada'").get(params.id).n;
    if (n) db.prepare('UPDATE contribuintes SET ativo = 0 WHERE id = ?').run(params.id);
    else db.prepare('DELETE FROM contribuintes WHERE id = ?').run(params.id);
    return { ok: true, inativado: !!n };
  });

  // ------------------------------------------------------------ procurações
  GET('/api/procuracoes', ({ user }) => db.prepare(`SELECT p.*, ct.razao_social, ct.documento contrib_doc, c.titular, c.documento cert_doc, c.valido_ate cert_validade
    FROM procuracoes p JOIN contribuintes ct ON ct.id = p.contribuinte_id JOIN certificados c ON c.id = p.certificado_id WHERE p.usuario_id = ? ORDER BY ct.razao_social`).all(user.id));
  POST('/api/procuracoes', ({ user, body: { contribuinte_id, certificado_id, escopo, valida_de, valida_ate, observacao } }) => {
    contribuinte(user.id, contribuinte_id);
    const cert = db.prepare('SELECT * FROM certificados WHERE id = ? AND usuario_id = ?').get(certificado_id, user.id);
    if (!cert) falha('Certificado do procurador não encontrado.');
    const id = db.prepare('INSERT INTO procuracoes (usuario_id, contribuinte_id, certificado_id, procurador_nome, procurador_doc, escopo, valida_de, valida_ate, observacao) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(user.id, contribuinte_id, certificado_id, cert.titular, cert.documento, escopo || 'emissao,consulta,cancelamento', valida_de || null, valida_ate || null, observacao || '').lastInsertRowid;
    audit(user.id, 'procuracao.add', `contrib ${contribuinte_id} cert ${certificado_id}`);
    return { id };
  });
  PUT('/api/procuracoes/:id', ({ user, params, body: b }) => {
    const sets = [], vals = [];
    for (const k of ['escopo', 'valida_de', 'valida_ate', 'observacao']) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k] || null); }
    if (b.ativo !== undefined) { sets.push('ativo = ?'); vals.push(b.ativo ? 1 : 0); }
    if (sets.length) db.prepare(`UPDATE procuracoes SET ${sets.join(', ')} WHERE id = ? AND usuario_id = ?`).run(...vals, params.id, user.id);
    return { ok: true };
  });
  DEL('/api/procuracoes/:id', ({ user, params }) => { db.prepare('DELETE FROM procuracoes WHERE id = ? AND usuario_id = ?').run(params.id, user.id); return { ok: true }; });

  // Certificado a usar: próprio da empresa ou de procurador (uma entre várias procurações)
  async function credencial(uid, c, procuracaoId, escopo = 'emissao') {
    if (procuracaoId) {
      const p = db.prepare('SELECT * FROM procuracoes WHERE id = ? AND contribuinte_id = ? AND usuario_id = ?').get(procuracaoId, c.id, uid);
      if (!p || !p.ativo) falha('Procuração não encontrada ou inativa.');
      const hoje = new Date().toISOString().slice(0, 10);
      if (p.valida_ate && p.valida_ate < hoje) falha(`Procuração vencida em ${p.valida_ate}.`);
      if (p.valida_de && p.valida_de > hoje) falha(`Procuração válida somente a partir de ${p.valida_de}.`);
      if (!String(p.escopo).includes(escopo)) falha(`A procuração não contempla a operação "${escopo}".`);
      return { cert: await carregarCertificado(p.certificado_id, uid), via: 'procuracao', procuracao: p };
    }
    if (c.certificado_id) return { cert: await carregarCertificado(c.certificado_id, uid), via: 'certificado' };
    const own = db.prepare('SELECT id FROM certificados WHERE usuario_id = ? AND documento = ? ORDER BY valido_ate DESC').get(uid, c.documento);
    if (own) return { cert: await carregarCertificado(own.id, uid), via: 'certificado' };
    const proc = db.prepare('SELECT id FROM procuracoes WHERE contribuinte_id = ? AND ativo = 1 ORDER BY id').get(c.id);
    if (proc) return credencial(uid, c, proc.id, escopo);
    return { cert: null, via: 'simulacao' };
  }

  // ------------------------------------------------------------ tomadores
  const CAMPOS_TOMA = ['tipo_doc', 'documento', 'nome', 'im', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cod_municipio', 'uf', 'pais', 'cidade_ext', 'estado_ext', 'cod_postal_ext', 'fone', 'email', 'orgao_publico', 'tp_ente_gov', 'retem_iss', 'retem_federais'];
  function salvarTomador(uid, t) {
    const o = {};
    for (const k of CAMPOS_TOMA) if (t[k] !== undefined) o[k] = typeof t[k] === 'boolean' ? +t[k] : t[k];
    if (['CNPJ', 'CPF'].includes(o.tipo_doc)) o.documento = so(o.documento);
    for (const k of ['cep', 'cod_municipio', 'im']) if (o[k]) o[k] = so(o[k]);
    if (!o.nome) falha('Nome do tomador é obrigatório.');
    if (o.documento && !docValido(o.tipo_doc, o.documento)) falha('CPF/CNPJ do tomador inválido.');
    const existente = t.id ? db.prepare('SELECT id FROM tomadores WHERE id = ? AND usuario_id = ?').get(t.id, uid)
      : (o.documento ? db.prepare('SELECT id FROM tomadores WHERE usuario_id = ? AND documento = ?').get(uid, o.documento) : null);
    const ks = Object.keys(o);
    if (existente) { db.prepare(`UPDATE tomadores SET ${ks.map(k => `${k} = ?`).join(',')} WHERE id = ?`).run(...ks.map(k => o[k]), existente.id); return existente.id; }
    return db.prepare(`INSERT INTO tomadores (usuario_id, ${ks.join(',')}) VALUES (?, ${ks.map(() => '?').join(',')})`).run(uid, ...ks.map(k => o[k])).lastInsertRowid;
  }
  GET('/api/tomadores', ({ user, query }) => {
    const rows = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM notas n WHERE n.tomador_id = t.id AND n.status='autorizada') qtd_notas,
      (SELECT SUM(valor_servico) FROM notas n WHERE n.tomador_id = t.id AND n.status='autorizada') total FROM tomadores t WHERE usuario_id = ? ORDER BY nome`).all(user.id);
    return (query.q ? buscar(rows, query.q, ['nome', 'documento', 'email'], 200).itens : rows).map(t => ({ ...t, municipio: nomeMunicipio(t.cod_municipio) }));
  });
  POST('/api/tomadores', ({ user, body }) => ({ id: salvarTomador(user.id, body) }));
  PUT('/api/tomadores/:id', ({ user, params, body }) => ({ id: salvarTomador(user.id, { ...body, id: params.id }) }));
  DEL('/api/tomadores/:id', ({ user, params }) => { db.prepare('DELETE FROM tomadores WHERE id = ? AND usuario_id = ?').run(params.id, user.id); return { ok: true }; });

  async function obterJson(url) {
    const r = await P.http({ url, method: 'GET', headers: { Accept: 'application/json' } }).catch(() => null);
    if (!r || r.status !== 200) return null;
    try { return JSON.parse(new TextDecoder().decode(r.body)); } catch { return null; }
  }
  GET('/api/consulta/cnpj/:cnpj', async ({ params }) => {
    const d = await obterJson(`https://brasilapi.com.br/api/cnpj/v1/${so(params.cnpj)}`);
    if (!d || !d.cnpj) falha('Não foi possível consultar o CNPJ agora.');
    return {
      documento: so(d.cnpj), nome: d.razao_social, nome_fantasia: d.nome_fantasia, cep: so(d.cep), logradouro: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' '),
      numero: d.numero, complemento: d.complemento, bairro: d.bairro, uf: d.uf, cod_municipio: String(d.codigo_municipio_ibge || ''), email: d.email, fone: d.ddd_telefone_1,
      simples: d.opcao_pelo_simples, mei: d.opcao_pelo_mei,
    };
  });
  GET('/api/consulta/cep/:cep', async ({ params }) => {
    const d = await obterJson(`https://viacep.com.br/ws/${so(params.cep)}/json/`);
    if (!d || d.erro) falha('CEP não encontrado.');
    return { cep: so(d.cep), logradouro: d.logradouro, bairro: d.bairro, uf: d.uf, cod_municipio: d.ibge, complemento: d.complemento };
  });

  // ------------------------------------------------------------ serviços favoritos
  GET('/api/servicos', ({ user }) => db.prepare('SELECT * FROM servicos WHERE usuario_id = ? ORDER BY nome').all(user.id).map(s => ({ ...s, servico: CTRIB.get(s.ctribnac)?.descricao, nbs: NBS.get(s.cnbs)?.descricao })));
  POST('/api/servicos', ({ user, body: b }) => {
    if (!b.nome || !/^\d{6}$/.test(so(b.ctribnac))) falha('Informe nome e código de tributação nacional.');
    const vals = [b.contribuinte_id || null, b.nome, so(b.ctribnac), so(b.ctribmun), so(b.cnbs), b.descricao || '', b.aliq_iss === '' ? null : b.aliq_iss, b.valor_padrao || null, b.ind_op || '', b.cclasstrib || ''];
    if (b.id) db.prepare('UPDATE servicos SET contribuinte_id=?, nome=?, ctribnac=?, ctribmun=?, cnbs=?, descricao=?, aliq_iss=?, valor_padrao=?, ind_op=?, cclasstrib=? WHERE id=? AND usuario_id=?').run(...vals, b.id, user.id);
    else db.prepare('INSERT INTO servicos (usuario_id, contribuinte_id, nome, ctribnac, ctribmun, cnbs, descricao, aliq_iss, valor_padrao, ind_op, cclasstrib) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(user.id, ...vals);
    return { ok: true };
  });
  DEL('/api/servicos/:id', ({ user, params }) => { db.prepare('DELETE FROM servicos WHERE id = ? AND usuario_id = ?').run(params.id, user.id); return { ok: true }; });

  // ------------------------------------------------------------ notas
  function tomadorDoForm(uid, b) {
    if (b.tomador_id && !b.tomador) return db.prepare('SELECT * FROM tomadores WHERE id = ? AND usuario_id = ?').get(b.tomador_id, uid);
    const t = b.tomador;
    if (!t || (!t.documento && t.tipo_doc !== 'SEM' && !t.nome)) return null;
    if (b.salvar_tomador !== false && t.nome) t.id = salvarTomador(uid, t);
    return { ...t, documento: ['CNPJ', 'CPF'].includes(t.tipo_doc) ? so(t.documento) : t.documento };
  }
  POST('/api/notas/calcular', ({ user, body }) => {
    const c = contribuinte(user.id, body.contribuinte_id);
    const calc = calcular(body.form || {}, c);
    return { calc, sugestaoRetencoes: body.tomador ? sugerirRetencoes(c, body.tomador, calc.vServ) : null };
  });
  POST('/api/notas/previa-xml', ({ user, body }) => {
    const c = contribuinte(user.id, body.contribuinte_id);
    const f = body.form || {}, t = body.tomador || null;
    const calc = calcular(f, c);
    const { xml, id } = montarDPS({ contrib: c, tomador: t, form: f, calc, serie: c.serie_dps, nDPS: c.prox_ndps, ambiente: c.ambiente });
    return { xml, id, calc, erros: validarEmissao({ contrib: c, tomador: t, form: f, calc }) };
  });
  POST('/api/notas/rascunho', ({ user, body }) => {
    const c = contribuinte(user.id, body.contribuinte_id);
    const t = tomadorDoForm(user.id, body);
    const f = body.form || {};
    const k = calcular(f, c);
    const dados = JSON.stringify({ form: f, tomador: t, acesso: body.acesso || {} });
    if (body.id) {
      db.prepare(`UPDATE notas SET dados = ?, tomador_id = ?, tomador_nome = ?, tomador_doc = ?, valor_servico = ?, descricao = ?, ctribnac = ?, atualizado_em = datetime('now') WHERE id = ? AND usuario_id = ? AND status IN ('rascunho','rejeitada')`)
        .run(dados, t?.id || null, t?.nome || '', t?.documento || '', k.vServ, f.descricao || '', so(f.ctribnac), body.id, user.id);
      return { id: +body.id };
    }
    return { id: db.prepare('INSERT INTO notas (usuario_id, contribuinte_id, tomador_id, status, dados, tomador_nome, tomador_doc, valor_servico, descricao, ctribnac, competencia) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(user.id, c.id, t?.id || null, 'rascunho', dados, t?.nome || '', t?.documento || '', k.vServ, f.descricao || '', so(f.ctribnac), f.competencia || null).lastInsertRowid };
  });

  POST('/api/notas/emitir', async ({ user, body }) => {
    const uid = user.id;
    const c = contribuinte(uid, body.contribuinte_id);
    if (!c.ativo) falha('Empresa inativa.');
    const f = body.form || {};
    const t = tomadorDoForm(uid, body);
    const calc = calcular(f, c);
    const erros = validarEmissao({ contrib: c, tomador: t, form: f, calc });
    if (erros.length) falha('Corrija os campos antes de emitir.', 422, { erros });
    const acesso = body.acesso || {};
    const simulacao = c.ambiente === 'simulacao';
    let cred = { cert: null, via: 'simulacao' };
    try { cred = await credencial(uid, c, acesso.procuracao_id); } catch (e) { if (!simulacao) throw e; }
    if (!simulacao && !cred.cert) falha('Para emitir em homologação/produção é necessário um certificado digital A1 do emitente ou de um procurador com procuração cadastrada.');

    const nDPS = tx(() => {
      const atual = db.prepare('SELECT prox_ndps FROM contribuintes WHERE id = ?').get(c.id).prox_ndps;
      db.prepare('UPDATE contribuintes SET prox_ndps = ? WHERE id = ?').run(atual + 1, c.id);
      return atual;
    });
    const subst = body.substituir ? { chave: body.substituir.chave, motivo: body.substituir.motivo, xMotivo: body.substituir.xMotivo } : null;
    const { xml, id, dhEmi, tpAmb } = montarDPS({ contrib: c, tomador: t, form: f, calc, serie: c.serie_dps, nDPS, ambiente: c.ambiente, subst });
    const xmlAssinado = cred.cert ? assinar(xml, 'infDPS', cred.cert, json(c.config).assinatura) : xml;

    let status, chave = null, nNFSe = null, xmlNFSe = null, resposta = null, mensagens = [], dhProc = null;
    if (simulacao) {
      const seq = db.prepare("SELECT COUNT(*) n FROM notas WHERE contribuinte_id = ? AND ambiente = 'simulacao' AND chave_acesso IS NOT NULL").get(c.id).n + 1;
      nNFSe = String(seq);
      chave = chaveSimulada({ cMun: c.cod_municipio, tipoDoc: c.tipo_doc, doc: c.documento, nNFSe: seq });
      xmlNFSe = nfseSimulada({ chave, nNFSe, dpsAssinada: xmlAssinado, contrib: c, calc, municipio: nomeMunicipio(c.cod_municipio) });
      status = 'autorizada'; dhProc = dataHoraBR();
      mensagens = [{ codigo: 'SIM', descricao: 'Nota gerada em modo SIMULAÇÃO: sem validade fiscal, nada foi enviado à Receita/Sefin.' }];
    } else {
      const r = await sefin.emitirNFSe(c.ambiente, cred.cert, xmlAssinado);
      resposta = r.bruto;
      if (r.ok) {
        status = 'autorizada'; chave = r.chave; xmlNFSe = r.xmlNFSe; dhProc = r.dhProc;
        nNFSe = (xmlNFSe.match(/<nNFSe>(\d+)<\/nNFSe>/) || [])[1] || null;
        mensagens = (r.alertas || []).map(a => ({ codigo: a.Codigo || a.codigo, descricao: a.Descricao || a.descricao }));
      } else { status = 'rejeitada'; mensagens = r.erros; }
    }
    const ib = calc.ibscbs || {};
    const vals = {
      usuario_id: uid, contribuinte_id: c.id, tomador_id: t?.id || null, status, ambiente: c.ambiente, serie: c.serie_dps, ndps: nDPS, id_dps: id,
      chave_acesso: chave, nnfse: nNFSe, dh_emi: dhEmi, competencia: f.competencia, dh_proc: dhProc, tomador_doc: t?.documento || '', tomador_nome: t?.nome || '',
      ctribnac: so(f.ctribnac), cnbs: so(f.cnbs), descricao: f.descricao, valor_servico: calc.vServ, valor_deducoes: calc.vDR, valor_desconto_incond: calc.vDescIncond,
      base_calculo: calc.bcISS, aliq_iss: calc.aliq, valor_iss: calc.vISS, iss_retido: calc.retido ? 1 : 0,
      valor_pis: calc.fed.vPis, valor_cofins: calc.fed.vCofins, valor_irrf: calc.fed.vIRRF, valor_csll: calc.fed.vCSLL, valor_inss: calc.fed.vCP,
      valor_retencoes: calc.vTotalRet, valor_liquido: calc.vLiq, valor_ibs: ib.vIBS || 0, valor_cbs: ib.vCBS || 0,
      emitido_via: cred.via, procuracao_id: cred.procuracao?.id || null, certificado_id: cred.cert?.row?.id || null,
      dados: JSON.stringify({ form: f, tomador: t, acesso, calc }), xml_dps: xmlAssinado, xml_nfse: xmlNFSe,
      resposta: resposta ? JSON.stringify(resposta) : null, mensagens: JSON.stringify(mensagens), substitui_chave: subst?.chave || null,
    };
    const ks = Object.keys(vals);
    let notaId;
    if (body.rascunho_id) {
      notaId = +body.rascunho_id;
      db.prepare(`UPDATE notas SET ${ks.map(k => `${k} = ?`).join(',')}, atualizado_em = datetime('now') WHERE id = ? AND usuario_id = ?`).run(...ks.map(k => vals[k]), notaId, uid);
    } else notaId = db.prepare(`INSERT INTO notas (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...ks.map(k => vals[k])).lastInsertRowid;
    if (status === 'autorizada' && subst?.chave) db.prepare("UPDATE notas SET status = 'substituida' WHERE chave_acesso = ? AND usuario_id = ?").run(subst.chave, uid);
    audit(uid, 'nota.emitir', `${status} ${chave || id} via ${cred.via}`);
    const out = { id: notaId, status, chave, nNFSe, mensagens, idDps: id, tpAmb };
    return status === 'rejeitada' ? { __status: 422, ...out, erro: 'NFS-e rejeitada pela Sefin Nacional.', erros: mensagens } : out;
  });

  const FILTROS = (q, uid) => {
    const w = ['n.usuario_id = ?'], p = [uid];
    if (q.contribuinte_id) { w.push('n.contribuinte_id = ?'); p.push(q.contribuinte_id); }
    if (q.status) { w.push(`n.status IN (${q.status.split(',').map(() => '?').join(',')})`); p.push(...q.status.split(',')); }
    if (q.de) { w.push('COALESCE(n.competencia, date(n.criado_em)) >= ?'); p.push(q.de); }
    if (q.ate) { w.push('COALESCE(n.competencia, date(n.criado_em)) <= ?'); p.push(q.ate); }
    if (q.tomador) { w.push('(n.tomador_nome LIKE ? OR n.tomador_doc LIKE ?)'); p.push(`%${q.tomador}%`, `%${so(q.tomador) || q.tomador}%`); }
    if (q.ctribnac) { w.push('n.ctribnac = ?'); p.push(so(q.ctribnac)); }
    if (q.ambiente) { w.push('n.ambiente = ?'); p.push(q.ambiente); }
    if (q.q) { w.push('(n.descricao LIKE ? OR n.chave_acesso LIKE ? OR n.nnfse = ? OR n.tomador_nome LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, q.q, `%${q.q}%`); }
    return { where: w.join(' AND '), params: p };
  };
  GET('/api/notas', ({ user, query }) => {
    const { where, params } = FILTROS(query, user.id);
    const limite = Math.min(+query.limite || 50, 1000), offset = +query.offset || 0;
    const total = db.prepare(`SELECT COUNT(*) n FROM notas n WHERE ${where}`).get(...params).n;
    const itens = db.prepare(`SELECT n.id, n.status, n.ambiente, n.serie, n.ndps, n.nnfse, n.chave_acesso, n.dh_emi, n.competencia, n.tomador_nome, n.tomador_doc, n.ctribnac, n.descricao,
      n.valor_servico, n.valor_iss, n.iss_retido, n.valor_retencoes, n.valor_liquido, n.valor_ibs, n.valor_cbs, n.emitido_via, n.criado_em, c.razao_social contribuinte, c.documento contrib_doc
      FROM notas n JOIN contribuintes c ON c.id = n.contribuinte_id WHERE ${where} ORDER BY n.id DESC LIMIT ? OFFSET ?`).all(...params, limite, offset);
    return { total, itens };
  });
  GET('/api/notas/ultima', ({ user, query }) => {
    const p = [user.id];
    let w = "usuario_id = ? AND status IN ('autorizada','cancelada','substituida')";
    if (query.contribuinte_id) { w += ' AND contribuinte_id = ?'; p.push(query.contribuinte_id); }
    if (query.tomador_id) { w += ' AND tomador_id = ?'; p.push(query.tomador_id); }
    const n = db.prepare(`SELECT * FROM notas WHERE ${w} ORDER BY id DESC LIMIT 1`).get(...p);
    return n ? { ...n, dados: json(n.dados), mensagens: json(n.mensagens, []) } : null;
  });
  function nota(uid, id) {
    const n = db.prepare('SELECT * FROM notas WHERE id = ? AND usuario_id = ?').get(id, uid);
    if (!n) falha('Nota não encontrada.', 404);
    return n;
  }
  GET('/api/notas/:id', ({ user, params }) => {
    const n = nota(user.id, params.id);
    const c = db.prepare('SELECT * FROM contribuintes WHERE id = ?').get(n.contribuinte_id);
    return { ...n, dados: json(n.dados), mensagens: json(n.mensagens, []), resposta: json(n.resposta, n.resposta), contribuinte: exibirContrib(c), eventos: db.prepare('SELECT * FROM eventos WHERE nota_id = ? ORDER BY id').all(n.id) };
  });
  DEL('/api/notas/:id', ({ user, params }) => {
    const n = nota(user.id, params.id);
    if (!['rascunho', 'rejeitada'].includes(n.status)) falha('Somente rascunhos e notas rejeitadas podem ser excluídos.');
    db.prepare('DELETE FROM notas WHERE id = ?').run(n.id);
    return { ok: true };
  });
  GET('/api/notas/:id/xml', ({ user, params, query }) => {
    const n = nota(user.id, params.id);
    const tipo = query.tipo === 'dps' ? 'dps' : 'nfse';
    const xml = tipo === 'dps' ? n.xml_dps : (n.xml_nfse || n.xml_dps);
    if (!xml) falha('XML indisponível.', 404);
    return { arquivo: { nome: `${tipo.toUpperCase()}-${n.chave_acesso || n.id_dps || n.id}.xml`, tipo: 'application/xml', dados: xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>${xml}` } };
  });
  GET('/api/notas/:id/danfse', async ({ user, params }) => {
    const n = nota(user.id, params.id);
    if (n.ambiente === 'simulacao' || !n.chave_acesso) falha('DANFSe oficial disponível apenas para notas autorizadas na Sefin. Use o espelho para impressão.', 404);
    const c = contribuinte(user.id, n.contribuinte_id);
    const cred = await credencial(user.id, c, n.procuracao_id, 'consulta');
    const r = await sefin.baixarDANFSe(n.ambiente, cred.cert, n.chave_acesso);
    if (!r.ok) falha('Não foi possível obter o DANFSe no ADN.', 502, { erros: r.erros });
    return { arquivo: { nome: `DANFSe-${n.chave_acesso}.pdf`, tipo: 'application/pdf', dados: r.pdf, inline: true } };
  });
  POST('/api/notas/:id/sincronizar', async ({ user, params }) => {
    const n = nota(user.id, params.id);
    if (n.ambiente === 'simulacao') falha('Notas simuladas não existem na Sefin.');
    const c = contribuinte(user.id, n.contribuinte_id);
    const cred = await credencial(user.id, c, n.procuracao_id, 'consulta');
    let chave = n.chave_acesso;
    if (!chave && n.id_dps) { const d = await sefin.consultarDPS(n.ambiente, cred.cert, n.id_dps); if (d.ok) chave = d.chave; }
    if (!chave) falha('Nota não localizada na Sefin Nacional.');
    const r = await sefin.consultarNFSe(n.ambiente, cred.cert, chave);
    if (!r.ok) falha('Falha na consulta.', 502, { erros: r.erros });
    const ev = await sefin.consultarEventos(n.ambiente, cred.cert, chave);
    const evs = JSON.stringify(ev.bruto || '');
    const cancelada = evs.includes('101101') || evs.includes('105102');
    db.prepare("UPDATE notas SET chave_acesso = ?, xml_nfse = ?, status = ?, nnfse = COALESCE(?, nnfse), atualizado_em = datetime('now') WHERE id = ?")
      .run(chave, r.xml, cancelada ? 'cancelada' : 'autorizada', (r.xml.match(/<nNFSe>(\d+)<\/nNFSe>/) || [])[1] || null, n.id);
    return { ok: true, status: cancelada ? 'cancelada' : 'autorizada' };
  });
  POST('/api/notas/:id/cancelar', async ({ user, params, body }) => {
    const uid = user.id;
    const n = nota(uid, params.id);
    if (n.status !== 'autorizada') falha('Somente notas autorizadas podem ser canceladas.');
    const { motivo = '1', justificativa } = body;
    if (!justificativa || justificativa.length < 15) falha('Informe uma justificativa com pelo menos 15 caracteres.');
    const c = contribuinte(uid, n.contribuinte_id);
    const { xml } = montarCancelamento({ chave: n.chave_acesso, tpAmb: n.ambiente === 'producao' ? '1' : '2', tipoDoc: c.tipo_doc, doc: c.documento, motivo, xMotivo: justificativa });
    let ok, resposta, xmlAss = xml;
    if (n.ambiente === 'simulacao') { ok = true; resposta = { simulacao: true }; }
    else {
      const cred = await credencial(uid, c, body.procuracao_id || n.procuracao_id, 'cancelamento');
      xmlAss = assinar(xml, 'infPedReg', cred.cert, json(c.config).assinatura);
      const r = await sefin.registrarEvento(n.ambiente, cred.cert, n.chave_acesso, xmlAss);
      ok = r.ok; resposta = r.ok ? r.bruto : { erros: r.erros };
    }
    db.prepare('INSERT INTO eventos (nota_id, tipo, descricao, xml, resposta, status) VALUES (?,?,?,?,?,?)').run(n.id, '101101', `Cancelamento: ${justificativa}`, xmlAss, JSON.stringify(resposta), ok ? 'registrado' : 'rejeitado');
    if (ok) db.prepare("UPDATE notas SET status = 'cancelada', atualizado_em = datetime('now') WHERE id = ?").run(n.id);
    audit(uid, 'nota.cancelar', `${n.chave_acesso} ${ok ? 'ok' : 'rejeitado'}`);
    if (!ok) falha('Cancelamento rejeitado pela Sefin Nacional.', 422, { erros: resposta.erros });
    return { ok: true };
  });

  // ------------------------------------------------------------ dashboard e relatórios
  GET('/api/dashboard', ({ user, query }) => {
    const cond = ['usuario_id = ?'], p0 = [user.id];
    if (query.contribuinte_id) { cond.push('contribuinte_id = ?'); p0.push(+query.contribuinte_id); }
    if (['simulacao', 'homologacao', 'producao'].includes(query.ambiente)) { cond.push('ambiente = ?'); p0.push(query.ambiente); }
    const base = `FROM notas WHERE ${cond.join(' AND ')}`;
    const comp = "substr(COALESCE(competencia, criado_em),1,7)";
    const q = (sql, ...p) => db.prepare(sql).all(...p0, ...p);
    const q1 = (sql, ...p) => db.prepare(sql).get(...p0, ...p);
    const hoje = new Date();
    const mes = hoje.toISOString().slice(0, 7);
    const mesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 15).toISOString().slice(0, 7);
    const ini12 = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1).toISOString().slice(0, 7);
    const k = m => q1(`SELECT COUNT(*) qtd, COALESCE(SUM(valor_servico),0) total, COALESCE(SUM(valor_iss),0) iss, COALESCE(SUM(valor_retencoes),0) ret,
      COALESCE(SUM(valor_ibs),0) ibs, COALESCE(SUM(valor_cbs),0) cbs, COALESCE(SUM(valor_liquido),0) liquido ${base} AND status = 'autorizada' AND ${comp} = ?`, m);
    const fat12 = q1(`SELECT COALESCE(SUM(valor_servico),0) v ${base} AND status = 'autorizada' AND ${comp} >= ?`, ini12).v;
    const anoAtual = q1(`SELECT COALESCE(SUM(valor_servico),0) v ${base} AND status = 'autorizada' AND substr(COALESCE(competencia, criado_em),1,4) = ?`, String(hoje.getFullYear())).v;
    let limite = null;
    if (query.contribuinte_id) {
      const c = db.prepare('SELECT regime FROM contribuintes WHERE id = ?').get(+query.contribuinte_id);
      if (c?.regime === 'MEI') limite = { tipo: 'MEI (anual)', valor: 81000, usado: anoAtual };
      else if (c?.regime?.startsWith('SN')) limite = { tipo: 'Simples Nacional (12 meses)', valor: 4800000, sublimite: 3600000, usado: fat12 };
    }
    return {
      mes: k(mes), mesAnterior: k(mesAnt), fat12, anoAtual, limite,
      mensal: q(`SELECT ${comp} mes, COUNT(*) qtd, SUM(valor_servico) total, SUM(valor_iss) iss, SUM(valor_retencoes) ret, SUM(valor_ibs + valor_cbs) ibscbs ${base} AND status = 'autorizada' AND ${comp} >= ? GROUP BY 1 ORDER BY 1`, ini12),
      topTomadores: q(`SELECT tomador_nome nome, tomador_doc doc, COUNT(*) qtd, SUM(valor_servico) total ${base} AND status = 'autorizada' AND ${comp} >= ? GROUP BY tomador_doc, tomador_nome ORDER BY total DESC LIMIT 8`, ini12),
      porServico: q(`SELECT ctribnac, COUNT(*) qtd, SUM(valor_servico) total ${base} AND status = 'autorizada' AND ${comp} >= ? GROUP BY ctribnac ORDER BY total DESC LIMIT 8`, ini12).map(s => ({ ...s, descricao: CTRIB.get(s.ctribnac)?.descricao || s.ctribnac })),
      porStatus: q(`SELECT status, COUNT(*) qtd, SUM(valor_servico) total ${base} GROUP BY status`),
      ultimas: q(`SELECT id, status, nnfse, tomador_nome, valor_servico, competencia, ambiente, criado_em ${base} ORDER BY id DESC LIMIT 8`),
      alertas: {
        certs: db.prepare('SELECT * FROM certificados WHERE usuario_id = ?').all(user.id).map(resumoCert).filter(c => c.situacao !== 'valido'),
        procsVenc: db.prepare(`SELECT p.*, ct.razao_social FROM procuracoes p JOIN contribuintes ct ON ct.id = p.contribuinte_id WHERE p.usuario_id = ? AND p.ativo = 1 AND p.valida_ate IS NOT NULL AND p.valida_ate <= date('now','+30 day')`).all(user.id),
      },
    };
  });

  GET('/api/relatorios/notas.csv', ({ user, query }) => {
    const { where, params } = FILTROS(query, user.id);
    const rows = db.prepare(`SELECT n.*, c.razao_social contribuinte, c.documento contrib_doc FROM notas n JOIN contribuintes c ON c.id = n.contribuinte_id WHERE ${where} ORDER BY n.competencia, n.id`).all(...params);
    const cols = [['contribuinte', 'Prestador'], ['contrib_doc', 'CNPJ/CPF Prestador'], ['status', 'Situação'], ['ambiente', 'Ambiente'], ['nnfse', 'Nº NFS-e'], ['serie', 'Série DPS'], ['ndps', 'Nº DPS'],
      ['chave_acesso', 'Chave de acesso'], ['competencia', 'Competência'], ['dh_emi', 'Emissão'], ['tomador_nome', 'Tomador'], ['tomador_doc', 'CNPJ/CPF Tomador'], ['ctribnac', 'cTribNac'], ['cnbs', 'NBS'],
      ['descricao', 'Descrição'], ['valor_servico', 'Valor serviço'], ['valor_desconto_incond', 'Desc. incond.'], ['valor_deducoes', 'Deduções'], ['base_calculo', 'BC ISS'], ['aliq_iss', 'Alíq. ISS'],
      ['valor_iss', 'ISS'], ['iss_retido', 'ISS retido'], ['valor_pis', 'PIS'], ['valor_cofins', 'COFINS'], ['valor_irrf', 'IRRF'], ['valor_csll', 'CSLL'], ['valor_inss', 'INSS'],
      ['valor_retencoes', 'Total retenções'], ['valor_liquido', 'Valor líquido'], ['valor_ibs', 'IBS'], ['valor_cbs', 'CBS'], ['emitido_via', 'Emitido via']];
    const fmt = v => typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + cols.map(c => c[1]).join(';') + '\n' + rows.map(r => cols.map(([k]) => k === 'iss_retido' ? (r[k] ? 'Sim' : 'Não') : fmt(r[k])).join(';')).join('\n');
    return { arquivo: { nome: 'relatorio-nfse.csv', tipo: 'text/csv', dados: csv } };
  });
  GET('/api/relatorios/resumo', ({ user, query }) => {
    const { where, params } = FILTROS(query, user.id);
    const agrup = { mes: 'substr(COALESCE(n.competencia, n.criado_em),1,7)', tomador: 'n.tomador_nome', servico: 'n.ctribnac', empresa: 'c.razao_social', status: 'n.status' }[query.agrupar] || 'substr(COALESCE(n.competencia, n.criado_em),1,7)';
    const rows = db.prepare(`SELECT ${agrup} grupo, COUNT(*) qtd, SUM(n.valor_servico) servico, SUM(n.base_calculo) bc, SUM(n.valor_iss) iss, SUM(CASE WHEN n.iss_retido THEN n.valor_iss ELSE 0 END) iss_retido,
      SUM(n.valor_pis) pis, SUM(n.valor_cofins) cofins, SUM(n.valor_irrf) irrf, SUM(n.valor_csll) csll, SUM(n.valor_inss) inss, SUM(n.valor_retencoes) retencoes, SUM(n.valor_liquido) liquido,
      SUM(n.valor_ibs) ibs, SUM(n.valor_cbs) cbs FROM notas n JOIN contribuintes c ON c.id = n.contribuinte_id WHERE ${where} GROUP BY 1 ORDER BY 1`).all(...params);
    return query.agrupar === 'servico' ? rows.map(r => ({ ...r, grupo: `${r.grupo} - ${CTRIB.get(r.grupo)?.descricao || ''}` })) : rows;
  });
  GET('/api/auditoria', ({ user }) => db.prepare('SELECT * FROM auditoria WHERE usuario_id = ? ORDER BY id DESC LIMIT 200').all(user.id));

  // Backup completo do banco (útil principalmente no Android)
  if (P.exportarBanco) GET('/api/backup', ({ user }) => ({ arquivo: { nome: `vorticis-backup-${new Date().toISOString().slice(0, 10)}.sqlite`, tipo: 'application/octet-stream', dados: P.exportarBanco(user) } }));

  return { handle, db };
}
