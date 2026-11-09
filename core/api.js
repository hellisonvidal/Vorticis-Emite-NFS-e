// Vorticis Emite NFS - API de aplicação independente de plataforma.
// O mesmo código atende o servidor HTTP (Windows/Electron) e o app Android (chamado direto no WebView).
//
// criarApi(plataforma) -> { handle(req) }
//   plataforma = { db, cofre: {encrypt, decrypt}, http(req), versao }
//   req = { method, path, query, body, token }
//   resposta = { status, json } | { status, arquivo: { nome, tipo, dados: Uint8Array|string, inline } }
import { iniciarBanco } from './banco.js';
import { hashSenha, conferirSenha, novoToken, unb64, randomBytes } from './seguranca.js';
import { lerPfx, resumoCert, completarCadeia, lerCertificadoDer, conferirAssinatura } from './certificado.js';
import { calcular, sugerirRetencoes, REGIMES, REG_ESP_TRIB, ALIQ_IBSCBS } from './tributos.js';
import { montarDPS, montarCancelamento, assinarXml, chaveSimulada, nfseSimulada, dataHoraBR, idDPS } from './dps.js';
import { criarSefin, decodificarXml } from './sefin.js';
import { gerarDANFSe, gerarDANFSeLote, OPCOES_DANFSE } from './danfse.js';
import { resumoNFSe, parseXml, busca, no, txt } from './xml.js';
import { criarIntegraContador, procuracaoNFSe } from './integra-contador.js';
import { T, buscar, sugestoes, nomeMunicipio, MUN, CTRIB, NBS } from './tabelas.js';
import { so, docValido, validarEmissao } from './validacao.js';

export const APP_NOME = 'Vorticis Emite NFS';

class ErroUsuario extends Error { constructor(msg, status = 400, extra) { super(msg); this.status = status; this.extra = extra; } }
const falha = (msg, status, extra) => { throw new ErroUsuario(msg, status, extra); };
const fmtDocTxt = d => { const x = so(d); return x.length === 14 ? x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : x.length === 11 ? x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d; };
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
  // Baixa um arquivo público (ex.: AC intermediária via AIA) usando o transporte da plataforma
  async function baixar(url) {
    const r = await P.http({ url, method: 'GET', headers: { Accept: '*/*' }, publico: true });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return r.body;
  }
  // Completa a cadeia ICP-Brasil (AIA) quando o .pfx traz só o certificado do titular
  async function prepararPfx(bytes, senha, info) {
    let cadeia = { completa: info.cadeiaCompleta, icp: info.cadeiaICP, niveis: info.cadeiaNiveis, raiz: info.cadeiaRaiz };
    if (info.cadeiaCompleta) return { bytes, cadeia };
    try {
      const r = await completarCadeia(bytes, senha || '', baixar);
      cadeia = { completa: r.completa, icp: r.icp, niveis: r.niveis, raiz: r.raiz, aviso: r.aviso, complementada: r.alterado };
      return { bytes: r.pfx, cadeia };
    } catch (e) {
      return { bytes, cadeia: { ...cadeia, aviso: `Não foi possível completar a cadeia: ${e.message}` } };
    }
  }
  async function guardarCertificado(uid, bytes, senha, info, apelido) {
    const prep = await prepararPfx(bytes, senha, info);
    return db.prepare(`INSERT INTO certificados (usuario_id, apelido, titular, documento, tipo_doc, emissor, serial, valido_de, valido_ate, pfx_enc, senha_enc, cadeia) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid, apelido || info.titular, info.titular, info.documento, info.tipo_doc, info.emissor, info.serial, info.valido_de, info.valido_ate,
        await P.cofre.encrypt(prep.bytes), await P.cofre.encrypt(senha || ''), JSON.stringify(prep.cadeia)).lastInsertRowid;
  }
  async function carregarCertificado(id, uid) {
    const row = db.prepare('SELECT * FROM certificados WHERE id = ? AND usuario_id = ?').get(id, uid);
    if (!row) falha('Certificado não encontrado.');
    if (row.origem === 'sistema') {
      // Certificado instalado no Windows/Android: a chave privada fica no sistema; assinatura e TLS são feitos por ele
      if (!P.certSistema) falha(`O certificado "${row.apelido || row.titular}" está instalado em outro dispositivo (repositório do sistema) e não pode ser usado nesta versão.`);
      if (new Date(row.valido_ate) < new Date()) falha(`Certificado "${row.apelido || row.titular}" vencido em ${row.valido_ate.slice(0, 10)}.`);
      return { titular: row.titular, documento: row.documento, tipo_doc: row.tipo_doc, valido_ate: row.valido_ate, certPem: row.cert_pem, row,
        sistema: row.ref_sistema, assinador: (dados, alg) => P.certSistema.assinar(row.ref_sistema, dados, alg) };
    }
    const pfx = await P.cofre.decrypt(row.pfx_enc, true);
    const senha = await P.cofre.decrypt(row.senha_enc);
    const info = lerPfx(pfx, senha);
    if (new Date(info.valido_ate) < new Date()) falha(`Certificado "${row.apelido || row.titular}" vencido em ${info.valido_ate.slice(0, 10)}.`);
    return { ...info, pfx, senha, row };
  }

  GET('/api/status', () => ({ ok: true, app: APP_NOME, versao: P.versao || '1.0.0', plataforma: P.nome || 'servidor', pdf: !!P.gerarPdf, usuarios: db.prepare('SELECT COUNT(*) n FROM usuarios').get().n }), true);

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
  // ---- Responsável legal (representação pela base CNPJ)
  GET('/api/contribuintes/:id/acessos', ({ user, params }) => acessosContrib(user.id, contribuinte(user.id, params.id)));
  /** Identifica o responsável legal: e-CNPJ da empresa (o certificado ICP-Brasil traz o CPF do responsável) e QSA da Receita. */
  GET('/api/contribuintes/:id/responsavel', async ({ user, params }) => {
    const c = contribuinte(user.id, params.id);
    const candidatos = [];
    const add = o => { if (!candidatos.some(x => x.cpf && x.cpf === o.cpf && x.fonte === o.fonte)) candidatos.push(o); };
    const ecpfs = certsValidos(user.id).filter(r => r.tipo_doc === 'CPF');
    // 1) e-CNPJ da própria empresa ou da mesma raiz: campo ICP-Brasil "responsável" (OID 2.16.76.1.3.4)
    for (const r of certsValidos(user.id).filter(x => x.tipo_doc === 'CNPJ' && x.documento.slice(0, 8) === String(c.documento).slice(0, 8))) {
      try {
        const info = r.origem === 'sistema' ? lerCertificadoDer(unb64(r.cert_pem.replace(/-----[^-]+-----|\s/g, '')))
          : lerPfx(await P.cofre.decrypt(r.pfx_enc, true), await P.cofre.decrypt(r.senha_enc));
        if (info.responsavelCpf && /^\d{11}$/.test(info.responsavelCpf)) {
          const ec = ecpfs.find(x => x.documento === info.responsavelCpf);
          add({ cpf: info.responsavelCpf, nome: ec?.titular || '', fonte: `e-CNPJ ${fmtDocTxt(r.documento)} (ICP-Brasil)`, certificado_id: ec?.id || null, confiavel: true });
        }
      } catch { /* ignora */ }
    }
    // 2) QSA da Receita (CPF mascarado): confere nome e dígitos centrais com os e-CPF cadastrados
    let qsa = [];
    if (c.tipo_doc === 'CNPJ') {
      const d = await obterJson(`https://brasilapi.com.br/api/cnpj/v1/${c.documento}`) || await obterJson(`https://minhareceita.org/${c.documento}`);
      const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
      qsa = (d?.qsa || []).filter(q => /\*\*\*\d{6}\*\*/.test(q.cnpj_cpf_do_socio || '')).map(q => ({ nome: q.nome_socio, cpf_mascarado: q.cnpj_cpf_do_socio, qualificacao: q.qualificacao_socio,
        responsavel: d.qualificacao_do_responsavel != null && +q.codigo_qualificacao_socio === +d.qualificacao_do_responsavel }));
      for (const q of qsa) {
        const meio = q.cpf_mascarado.replace(/\D/g, '');
        const ec = ecpfs.find(x => x.documento.slice(3, 9) === meio && norm(x.titular) === norm(q.nome));
        if (ec) add({ cpf: ec.documento, nome: ec.titular, fonte: `QSA da Receita: ${q.qualificacao}${q.responsavel ? ' (qualificação do responsável)' : ''}`, certificado_id: ec.id, confiavel: q.responsavel });
      }
    }
    return { atual: c.responsavel_cpf ? { cpf: c.responsavel_cpf, nome: c.responsavel_nome, fonte: c.responsavel_fonte } : null, candidatos, qsa,
      ecpfs: ecpfs.map(r => ({ id: r.id, cpf: r.documento, nome: r.titular, valido_ate: r.valido_ate })) };
  });
  PUT('/api/contribuintes/:id/responsavel', ({ user, params, body }) => {
    const c = contribuinte(user.id, params.id);
    if (c.tipo_doc === 'CPF') falha('Representação por responsável legal se aplica a empresas (CNPJ).');
    const cpf = so(body.cpf);
    if (cpf && !docValido('CPF', cpf)) falha('CPF do responsável legal inválido.');
    db.prepare('UPDATE contribuintes SET responsavel_cpf = ?, responsavel_nome = ?, responsavel_fonte = ? WHERE id = ?')
      .run(cpf || null, cpf ? String(body.nome || '').slice(0, 150) : null, cpf ? String(body.fonte || 'informado manualmente').slice(0, 200) : null, c.id);
    audit(user.id, 'contribuinte.responsavel', `${c.documento} -> ${cpf || '(removido)'}`);
    const n = contribuinte(user.id, c.id);
    return { ok: true, acessos: acessosContrib(user.id, n) };
  });

  // Opções de código de tributação municipal para a emissão: tabela do município (inclusive importada da Sefin),
  // serviços favoritos e códigos já usados em notas da empresa – os do cTribNac escolhido primeiro.
  GET('/api/codigos-municipais/opcoes', ({ user, query: { contribuinte_id, ctribnac } }) => {
    const c = contribuinte(user.id, contribuinte_id);
    const cn = so(ctribnac);
    const mapa = new Map();
    const add = (o, origem) => {
      const k = `${so(o.ctribnac)}|${so(o.ctribmun)}`;
      if (!/^\d{3}$/.test(so(o.ctribmun)) || mapa.has(k)) return;
      mapa.set(k, { ctribmun: so(o.ctribmun), ctribnac: so(o.ctribnac), descricao: o.descricao || '', aliquota: o.aliquota ?? null, origem });
    };
    db.prepare('SELECT * FROM codigos_municipais WHERE cod_municipio = ?').all(c.cod_municipio).forEach(r => add(r, r.origem === 'sefin' ? 'Sefin' : 'tabela do município'));
    db.prepare('SELECT ctribnac, ctribmun, nome AS descricao, aliq_iss AS aliquota FROM servicos WHERE usuario_id = ? AND (contribuinte_id = ? OR contribuinte_id IS NULL) AND ctribmun <> \'\'').all(user.id, c.id).forEach(r => add(r, 'serviço favorito'));
    for (const n of db.prepare("SELECT dados FROM notas WHERE usuario_id = ? AND contribuinte_id = ? AND status IN ('autorizada','cancelada','substituida') ORDER BY id DESC LIMIT 500").all(user.id, c.id)) {
      const f = json(n.dados).form || {};
      if (f.ctribmun) add({ ctribnac: f.ctribnac, ctribmun: f.ctribmun, descricao: (f.descricao || '').slice(0, 80), aliquota: f.aliq_iss }, 'usado em notas');
    }
    return [...mapa.values()].map(o => ({ ...o, servico: CTRIB.get(o.ctribnac)?.descricao || '' }))
      .sort((a, b) => (b.ctribnac === cn) - (a.ctribnac === cn) || a.ctribnac.localeCompare(b.ctribnac) || a.ctribmun.localeCompare(b.ctribmun));
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

  // Rotas da API de parâmetros municipais (Sefin Nacional / ADN): /{cMun}/convenio, /{cMun}/{cServ}/{competencia}/aliquota,
  // /{cMun}/{cServ}/historicoaliquotas, /{cMun}/{cServ}/{competencia}/regimes_especiais, /{cMun}/{competencia}/retencoes.
  // O código do serviço é o cTribNac (6 dígitos) seguido do cTribMun (3 dígitos, "000" quando o município não detalha).
  GET('/api/parametros-municipais', async ({ user, query: { contribuinte_id, municipio, servico, ctribmun, competencia, tipo, procuracao_id } }) => {
    const c = contribuinte(user.id, contribuinte_id);
    const cMun = so(municipio || c.cod_municipio);
    if (!/^\d{7}$/.test(cMun)) falha('Informe o município (código IBGE de 7 dígitos).');
    const comp = /^\d{4}-\d{2}(-\d{2})?$/.test(competencia || '') ? `${competencia.slice(0, 7)}-01` : `${new Date().toISOString().slice(0, 7)}-01`;
    const trib = so(servico), mun = so(ctribmun);
    const modo = ['convenio', 'retencoes', 'regimes', 'historico'].includes(tipo) ? tipo : 'servico';
    if (['servico', 'regimes', 'historico'].includes(modo) && !/^\d{6}$/.test(trib)) falha('Informe o código de tributação nacional (cTribNac, 6 dígitos) para consultar alíquotas e regimes do serviço.');
    if (mun && !/^\d{3}$/.test(mun)) falha('O código de tributação municipal tem 3 dígitos.');
    const servs = [...new Set([`${trib}${mun || '000'}`, trib])];
    const sufixos = modo === 'convenio' ? ['convenio']
      : modo === 'retencoes' ? [`${comp}/retencoes`]
      : modo === 'regimes' ? servs.map(s => `${s}/${comp}/regimes_especiais`)
      : modo === 'historico' ? servs.map(s => `${s}/historicoaliquotas`)
      : [...servs.map(s => `${s}/${comp}/aliquota`), ...servs.map(s => `${s}/historicoaliquotas`)];
    const cred = await credencial(user.id, c, procuracao_id, 'consulta');
    if (!cred.cert) falha('Consulta de parâmetros municipais exige certificado digital (próprio, de responsável legal ou de procurador).');
    const amb = c.ambiente === 'producao' ? 'producao' : 'homologacao';
    const r = await sefin.parametrosMunicipais(amb, cred.cert, cMun, sufixos);
    r.municipio = { codigo: cMun, nome: nomeMunicipio(cMun) };
    r.competencia = comp;
    if (!r.ok) r.mensagem = r.status === 404
      ? `A Sefin não retornou parâmetros de ${nomeMunicipio(cMun) || cMun} para ${modo === 'convenio' ? 'o convênio' : `o serviço ${trib}${mun ? `/${mun}` : ''} na competência ${comp.slice(5, 7)}/${comp.slice(0, 4)}`}. O município pode não ter aderido ao emissor nacional ou não ter parametrizado este serviço no ambiente ${amb === 'producao' ? 'de produção' : 'de produção restrita (homologação)'}.`
      : r.status === 401 || r.status === 403 ? 'A Sefin recusou o certificado para esta consulta (HTTP ' + r.status + ').' : `A Sefin respondeu HTTP ${r.status}.`;
    try {
      // Alíquotas encontradas em qualquer nível da resposta (o formato varia entre as rotas)
      const achadas = [];
      const andar = (v, rot) => {
        if (achadas.length > 50 || v === null || typeof v !== 'object') return;
        if (Array.isArray(v)) return v.forEach(x => andar(x, rot));
        const aliq = Object.keys(v).find(k => /^(aliq|aliquota|paliq)$/i.test(k));
        if (aliq && v[aliq] !== null && v[aliq] !== '' && !Number.isNaN(+v[aliq])) achadas.push({ servico: rot, aliquota: +v[aliq], inicio: v.DtIni || v.dataInicio || v.dtIni || null, fim: v.DtFim || v.dataFim || v.dtFim || null });
        for (const [k, x] of Object.entries(v)) andar(x, /^\d{6,9}$/.test(k) ? k : rot);
        const cm = v.codigoTributacaoMunicipal || v.cTribMun;
        if (cm && /^\d{3}$/.test(so(cm))) db.prepare(`INSERT OR REPLACE INTO codigos_municipais (cod_municipio, ctribnac, ctribmun, descricao, aliquota, origem) VALUES (?,?,?,?,?,'sefin')`)
          .run(cMun, trib, so(cm), v.descricao || '', v.aliquota ?? v.Aliq ?? null);
      };
      if (r.ok) andar(r.dados, trib);
      r.aliquotas = achadas;
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
  // ---- certificados instalados no sistema (repositório do Windows / KeyChain do Android)
  async function certificadosSistema() {
    if (!P.certSistema) return null;
    const lista = await P.certSistema.listar();
    return lista.map(c => {
      try {
        const info = lerCertificadoDer(c.der);
        return { id: c.id, a3: !!c.a3, info, titular: info.titular || c.nome || '', documento: info.documento, tipo_doc: info.tipo_doc, emissor: info.emissor,
          valido_ate: info.valido_ate, vencido: new Date(info.valido_ate) < new Date() };
      } catch { return null; }
    }).filter(Boolean);
  }
  async function certSistemaPorId(id) {
    const lista = await certificadosSistema();
    if (!lista) falha('Esta versão não acessa certificados instalados no sistema. Use o arquivo .pfx.', 501);
    // Android: listar() abre o seletor do sistema e devolve apenas o escolhido
    const c = id ? lista.find(x => x.id === id) : lista[0];
    if (!c) falha(id ? 'Certificado não encontrado no repositório do sistema.' : 'Nenhum certificado foi escolhido.');
    if (c.vencido) falha(`Certificado vencido em ${c.valido_ate.slice(0, 10)}.`);
    if (!c.documento) falha('Certificado sem CPF/CNPJ ICP-Brasil identificável.');
    return c;
  }
  // Prova de posse: a chave do certificado assina um desafio aleatório (pode pedir o PIN do token/cartão)
  async function provarPosse(c) {
    const desafio = randomBytes(32);
    let sig;
    try { sig = await P.certSistema.assinar(c.id, desafio, 'sha256'); }
    catch (e) { falha(`O sistema não permitiu usar a chave do certificado: ${e.message}`); }
    if (!conferirAssinatura(c.info.certPem, desafio, sig)) falha('A assinatura feita com o certificado não confere.');
  }
  function guardarCertSistema(uid, c, apelido) {
    const ex = db.prepare('SELECT id FROM certificados WHERE usuario_id = ? AND serial = ?').get(uid, c.info.serial);
    if (ex) { db.prepare("UPDATE certificados SET origem = 'sistema', ref_sistema = ?, cert_pem = ? WHERE id = ? AND origem = 'sistema'").run(c.id, c.info.certPem, ex.id); return ex.id; }
    return db.prepare(`INSERT INTO certificados (usuario_id, apelido, titular, documento, tipo_doc, emissor, serial, valido_de, valido_ate, pfx_enc, senha_enc, cadeia, origem, ref_sistema, cert_pem)
      VALUES (?,?,?,?,?,?,?,?,?,'','',?,'sistema',?,?)`).run(uid, apelido || c.titular, c.titular, c.documento, c.tipo_doc, c.emissor, c.info.serial, c.info.valido_de, c.info.valido_ate,
      JSON.stringify({ completa: true, sistema: true, aviso: 'Cadeia gerenciada pelo sistema operacional' }), c.id, c.info.certPem).lastInsertRowid;
  }
  GET('/api/certificados/sistema', async () => {
    if (!P.certSistema) return { suportado: false };
    if (P.certSistema.escolhaNativa) return { suportado: true, escolhaNativa: true, certificados: [] };
    try {
      return { suportado: true, certificados: (await certificadosSistema()).map(({ info, ...c }) => c) };
    } catch (e) { return { suportado: false, erro: `Não foi possível ler os certificados instalados: ${e.message}` }; }
  }, true);
  POST('/api/auth/certificado-sistema', async ({ body }) => {
    const c = await certSistemaPorId(body.id);
    await provarPosse(c);
    let u = db.prepare('SELECT * FROM usuarios WHERE documento = ?').get(c.documento)
      || db.prepare('SELECT u.* FROM usuarios u JOIN certificados c ON c.usuario_id = u.id WHERE c.documento = ? LIMIT 1').get(c.documento);
    if (!u) u = { id: db.prepare('INSERT INTO usuarios (nome, documento) VALUES (?,?)').run(c.titular, c.documento).lastInsertRowid, nome: c.titular };
    guardarCertSistema(u.id, c);
    audit(u.id, 'login', `certificado instalado ${c.documento}`);
    return { token: criarSessao(u.id, 'certificado'), usuario: { nome: u.nome, documento: c.documento } };
  }, true);
  POST('/api/certificados/sistema', async ({ user, body }) => {
    const c = await certSistemaPorId(body.id);
    await provarPosse(c);
    const id = guardarCertSistema(user.id, c, body.apelido);
    audit(user.id, 'certificado.add', `sistema ${c.titular} ${c.documento}`);
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
    return { ...c, config: json(c.config), municipio: nomeMunicipio(c.cod_municipio), regime_label: REGIMES[c.regime]?.label, certificado: cert ? resumoCert(cert) : null, procuracoes: procs, acessos: acessosContrib(c.usuario_id, c) };
  }
  function normalizarContrib(b) {
    const o = {};
    for (const k of CAMPOS_CONTRIB) if (b[k] !== undefined) o[k] = k === 'config' ? JSON.stringify(b[k] || {}) : b[k];
    for (const k of ['documento', 'cep', 'im', 'cod_municipio']) if (o[k] !== undefined) o[k] = so(o[k]);
    if (o.ibscbs_ativo !== undefined) o.ibscbs_ativo = o.ibscbs_ativo ? 1 : 0;
    if (o.certificado_id === '') o.certificado_id = null;
    if (o.serie_dps !== undefined) {
      const n = +so(o.serie_dps);
      if (!(n >= 1 && n <= 49999)) falha('Série da DPS deve estar entre 00001 e 49999 (faixa de aplicativo próprio – E0010). Use uma série diferente em cada instalação (ex.: Windows 00001, Android 00002).');
      o.serie_dps = String(n).padStart(5, '0');
    }
    if (o.prox_ndps !== undefined && !(+o.prox_ndps >= 1)) falha('Próximo número da DPS inválido.');
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
  // Representação perante a Sefin/ADN (Guia do Emissor Nacional v1.3, item 11 – vigente desde 01/11/2026): além da
  // procuração eletrônica (serviço NFS-e no Portal de Serviços da RFB), a base CNPJ autoriza o RESPONSÁVEL LEGAL (e-CPF)
  // e estabelecimentos da MESMA RAIZ de CNPJ (e-CNPJ). A Sefin valida pelo certificado da conexão e pela assinatura.
  const VIAS = { certificado: 'certificado da empresa', raiz: 'e-CNPJ da mesma raiz de CNPJ', responsavel: 'responsável legal (e-CPF)', procuracao: 'procuração eletrônica', simulacao: 'simulação' };
  function vinculoCert(c, row) {
    if (!row) return null;
    if (row.documento === c.documento) return 'certificado';
    if (c.tipo_doc !== 'CPF' && row.tipo_doc === 'CNPJ' && row.documento.slice(0, 8) === String(c.documento).slice(0, 8)) return 'raiz';
    if (row.tipo_doc === 'CPF' && c.responsavel_cpf && row.documento === c.responsavel_cpf) return 'responsavel';
    return null;
  }
  const certsValidos = uid => db.prepare('SELECT * FROM certificados WHERE usuario_id = ? AND valido_ate > ? ORDER BY valido_ate DESC').all(uid, new Date().toISOString());
  /** Opções de acesso (assinatura/transmissão) da empresa: vínculos da base CNPJ e procurações. */
  function acessosContrib(uid, c) {
    const out = [];
    const vistos = new Set();
    const ordem = { certificado: 0, raiz: 1, responsavel: 2 };
    const certs = certsValidos(uid).map(r => ({ r, via: vinculoCert(c, r) || (r.id === c.certificado_id ? 'certificado' : null) })).filter(x => x.via).sort((a, b) => ordem[a.via] - ordem[b.via] || (b.r.id === c.certificado_id) - (a.r.id === c.certificado_id));
    for (const { r, via } of certs) {
      if (vistos.has(r.id)) continue; vistos.add(r.id);
      out.push({ valor: `c:${r.id}`, via, certificado_id: r.id, rotulo: `${via === 'responsavel' ? 'Responsável legal' : via === 'raiz' ? 'Mesma raiz de CNPJ' : 'Certificado da empresa'}: ${r.apelido || r.titular} — ${r.tipo_doc} ${r.documento}`, valido_ate: r.valido_ate });
    }
    const hoje = new Date().toISOString().slice(0, 10);
    for (const p of db.prepare('SELECT p.*, ce.titular, ce.documento cert_doc, ce.valido_ate cert_validade FROM procuracoes p JOIN certificados ce ON ce.id = p.certificado_id WHERE p.contribuinte_id = ? AND p.usuario_id = ? AND p.ativo = 1').all(c.id, uid)) {
      if (p.valida_ate && p.valida_ate < hoje) continue;
      out.push({ valor: `p:${p.id}`, via: 'procuracao', procuracao_id: p.id, certificado_id: p.certificado_id, rotulo: `Procurador: ${p.titular} — ${p.cert_doc}${p.valida_ate ? ` (procuração até ${p.valida_ate.split('-').reverse().join('/')})` : ''}`, valido_ate: p.cert_validade });
    }
    return out;
  }
  async function credencial(uid, c, procuracaoId, escopo = 'emissao', certificadoId = null) {
    if (!procuracaoId && certificadoId) {
      const row = db.prepare('SELECT * FROM certificados WHERE id = ? AND usuario_id = ?').get(certificadoId, uid);
      const via = vinculoCert(c, row) || (row && row.id === c.certificado_id ? 'certificado' : null);
      if (!via) falha('Este certificado não tem vínculo com a empresa na base CNPJ (não é dela, de estabelecimento da mesma raiz nem do responsável legal). Cadastre uma procuração eletrônica ou o responsável legal.');
      return { cert: await carregarCertificado(row.id, uid), via };
    }
    if (procuracaoId) {
      const p = db.prepare('SELECT * FROM procuracoes WHERE id = ? AND contribuinte_id = ? AND usuario_id = ?').get(procuracaoId, c.id, uid);
      if (!p || !p.ativo) falha('Procuração não encontrada ou inativa.');
      const hoje = new Date().toISOString().slice(0, 10);
      if (p.valida_ate && p.valida_ate < hoje) falha(`Procuração vencida em ${p.valida_ate}.`);
      if (p.valida_de && p.valida_de > hoje) falha(`Procuração válida somente a partir de ${p.valida_de}.`);
      if (!String(p.escopo).includes(escopo)) falha(`A procuração não contempla a operação "${escopo}".`);
      return { cert: await carregarCertificado(p.certificado_id, uid), via: 'procuracao', procuracao: p };
    }
    if (c.certificado_id) {
      const row = db.prepare('SELECT * FROM certificados WHERE id = ?').get(c.certificado_id);
      return { cert: await carregarCertificado(c.certificado_id, uid), via: vinculoCert(c, row) || 'certificado' };
    }
    // automático: certificado da própria empresa → mesma raiz → responsável legal → procuração
    const auto = acessosContrib(uid, c).find(a => a.via !== 'procuracao');
    if (auto) return { cert: await carregarCertificado(auto.certificado_id, uid), via: auto.via };
    const proc = db.prepare('SELECT id FROM procuracoes WHERE contribuinte_id = ? AND ativo = 1 ORDER BY id').get(c.id);
    if (proc) return credencial(uid, c, proc.id, escopo);
    return { cert: null, via: 'simulacao' };
  }

  // ------------------------------------------------------------ tomadores
  const CAMPOS_TOMA = ['tipo_doc', 'documento', 'nome', 'im', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cod_municipio', 'uf', 'pais', 'cidade_ext', 'estado_ext', 'cod_postal_ext', 'fone', 'email', 'orgao_publico', 'tp_ente_gov', 'retem_iss', 'retem_federais'];
  /** Salva o cliente na empresa `t.contribuinte_id`. Cada empresa tem seus próprios clientes: o mesmo CNPJ em duas
   *  empresas são dois cadastros. `mover` permite trocar a empresa de um cadastro existente (tela de clientes). */
  function salvarTomador(uid, t, { mover = false } = {}) {
    const cid = +t.contribuinte_id || null;
    if (!cid) falha('Selecione a empresa emitente do cliente.');
    contribuinte(uid, cid);
    const o = {};
    for (const k of CAMPOS_TOMA) if (t[k] !== undefined) o[k] = typeof t[k] === 'boolean' ? +t[k] : t[k];
    if (['CNPJ', 'CPF'].includes(o.tipo_doc)) o.documento = so(o.documento);
    for (const k of ['cep', 'cod_municipio', 'im']) if (o[k]) o[k] = so(o[k]);
    if (!o.nome) falha('Nome do tomador é obrigatório.');
    if (o.documento && !docValido(o.tipo_doc, o.documento)) falha('CPF/CNPJ do tomador inválido.');
    let existente = t.id ? db.prepare('SELECT id, contribuinte_id FROM tomadores WHERE id = ? AND usuario_id = ?').get(t.id, uid) : null;
    // cadastro de outra empresa: na emissão, não altera o cliente da outra empresa (usa/cria o desta)
    if (existente && existente.contribuinte_id && existente.contribuinte_id !== cid && !mover) existente = null;
    if (!existente && o.documento) existente = db.prepare('SELECT id FROM tomadores WHERE usuario_id = ? AND contribuinte_id = ? AND documento = ?').get(uid, cid, o.documento);
    if (!existente && t.id && !mover) {
      // cadastro antigo sem empresa: passa a ser desta empresa
      existente = db.prepare('SELECT id FROM tomadores WHERE id = ? AND usuario_id = ? AND contribuinte_id IS NULL').get(t.id, uid);
    }
    o.contribuinte_id = cid;
    const ks = Object.keys(o);
    if (existente) { db.prepare(`UPDATE tomadores SET ${ks.map(k => `${k} = ?`).join(',')} WHERE id = ?`).run(...ks.map(k => o[k]), existente.id); return existente.id; }
    return db.prepare(`INSERT INTO tomadores (usuario_id, ${ks.join(',')}) VALUES (?, ${ks.map(() => '?').join(',')})`).run(uid, ...ks.map(k => o[k])).lastInsertRowid;
  }
  // ?contribuinte_id=N → clientes da empresa; ?contribuinte_id=sem → cadastros antigos sem empresa; sem parâmetro → todos
  GET('/api/tomadores', ({ user, query }) => {
    const cid = query.contribuinte_id;
    const filtro = cid === 'sem' ? ' AND t.contribuinte_id IS NULL' : cid ? ' AND t.contribuinte_id = ?' : '';
    const rows = db.prepare(`SELECT t.*, c.razao_social empresa, c.nome_fantasia empresa_fantasia, (SELECT COUNT(*) FROM notas n WHERE n.tomador_id = t.id AND n.status='autorizada') qtd_notas,
      (SELECT SUM(valor_servico) FROM notas n WHERE n.tomador_id = t.id AND n.status='autorizada') total FROM tomadores t LEFT JOIN contribuintes c ON c.id = t.contribuinte_id
      WHERE t.usuario_id = ?${filtro} ORDER BY t.nome`).all(user.id, ...(cid && cid !== 'sem' ? [+cid] : []));
    return (query.q ? buscar(rows, query.q, ['nome', 'documento', 'email'], 200).itens : rows).map(t => ({ ...t, municipio: nomeMunicipio(t.cod_municipio) }));
  });
  POST('/api/tomadores', ({ user, body }) => ({ id: salvarTomador(user.id, body) }));
  PUT('/api/tomadores/:id', ({ user, params, body }) => ({ id: salvarTomador(user.id, { ...body, id: params.id }, { mover: true }) }));
  /** Copia clientes para outra empresa (ex.: cliente atendido pelas duas). */
  POST('/api/tomadores/copiar', ({ user, body }) => {
    const destino = contribuinte(user.id, body.contribuinte_id);
    let n = 0;
    for (const id of (body.ids || []).slice(0, 1000)) {
      const t = db.prepare('SELECT * FROM tomadores WHERE id = ? AND usuario_id = ?').get(id, user.id);
      if (!t) continue;
      const { id: _i, usuario_id: _u, criado_em: _c, ...dados } = t;
      salvarTomador(user.id, { ...dados, contribuinte_id: destino.id }); n++;
    }
    return { copiados: n };
  });
  DEL('/api/tomadores/:id', ({ user, params }) => { db.prepare('DELETE FROM tomadores WHERE id = ? AND usuario_id = ?').run(params.id, user.id); return { ok: true }; });

  async function obterJson(url) {
    const r = await P.http({ url, method: 'GET', headers: { Accept: 'application/json' } }).catch(() => null);
    if (!r || r.status !== 200) return null;
    try { return JSON.parse(new TextDecoder().decode(r.body)); } catch { return null; }
  }
  // ---- Cadastro da Receita Federal (CNPJ): BrasilAPI → Minha Receita, completando campos vazios pelo CNPJ.ws
  const limpo = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  function normalizarReceita(d, fonte) {
    if (!d) return null;
    if (d.estabelecimento) { // CNPJ.ws
      const e = d.estabelecimento;
      return { fonte, documento: so(e.cnpj), nome: d.razao_social, nome_fantasia: e.nome_fantasia, cep: so(e.cep), tipo_logradouro: e.tipo_logradouro, logradouro: e.logradouro, numero: e.numero, complemento: e.complemento,
        bairro: e.bairro, uf: e.estado?.sigla, cod_municipio: String(e.cidade?.ibge_id || ''), municipio: e.cidade?.nome, email: e.email, fone: so(`${e.ddd1 || ''}${e.telefone1 || ''}`),
        situacao: e.situacao_cadastral, simples: d.simples?.simples === 'Sim', mei: d.simples?.mei === 'Sim', cnae: e.atividade_principal?.descricao };
    }
    if (!d.cnpj) return null; // BrasilAPI / Minha Receita
    return { fonte, documento: so(d.cnpj), nome: d.razao_social, nome_fantasia: d.nome_fantasia, cep: so(d.cep), tipo_logradouro: d.descricao_tipo_de_logradouro, logradouro: d.logradouro, numero: d.numero,
      complemento: d.complemento, bairro: d.bairro, uf: d.uf, cod_municipio: String(d.codigo_municipio_ibge || ''), municipio: d.municipio, email: d.email, fone: so(d.ddd_telefone_1),
      situacao: d.descricao_situacao_cadastral, simples: !!d.opcao_pelo_simples, mei: !!d.opcao_pelo_mei, cnae: d.cnae_fiscal_descricao };
  }
  async function consultarCnpj(cnpj, { completar = true } = {}) {
    const doc = so(cnpj);
    if (!docValido('CNPJ', doc)) falha('CNPJ inválido.');
    let r = normalizarReceita(await obterJson(`https://brasilapi.com.br/api/cnpj/v1/${doc}`), 'BrasilAPI')
      || normalizarReceita(await obterJson(`https://minhareceita.org/${doc}`), 'Minha Receita');
    const faltando = x => !x || !x.email || !x.fone || !x.logradouro;
    if (completar && faltando(r)) {
      const w = normalizarReceita(await obterJson(`https://publica.cnpj.ws/cnpj/${doc}`), 'CNPJ.ws');
      if (w) r = r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined || v === '' ? w[k] : v])) : w;
    }
    if (!r) falha('Não foi possível consultar o CNPJ na Receita agora (serviços públicos indisponíveis). Tente novamente em instantes.', 502);
    // Endereço completo: tipo + logradouro sem repetir o número que algumas bases trazem colado ("PAULISTA 37")
    let lg = limpo(r.logradouro);
    if (r.numero && lg.endsWith(' ' + limpo(r.numero))) lg = lg.slice(0, -limpo(r.numero).length - 1);
    const tipo = limpo(r.tipo_logradouro);
    const logradouro = tipo && !lg.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${lg}` : lg;
    const mun = MUN.get(so(r.cod_municipio));
    return { ...r, logradouro, numero: limpo(r.numero) || 'S/N', complemento: limpo(r.complemento), bairro: limpo(r.bairro), email: limpo(r.email).toLowerCase(),
      municipio: mun?.nome || limpo(r.municipio), uf: r.uf || mun?.uf || '', ativa: !r.situacao || /ativa/i.test(r.situacao) };
  }

  // ---- Inscrição municipal: o CNC (cadastro nacional de contribuintes) só é acessível pelos municípios. A IM é obtida
  // das próprias NFS-e (a Sefin grava a IM do CNC no grupo emit) e dos cadastros locais, e aprendida a cada nota.
  const papeis = ['emit', 'DPS/infDPS/prest', 'DPS/infDPS/toma', 'DPS/infDPS/interm'];
  function inscricaoMunicipal(uid, documento) {
    const doc = so(documento);
    if (!doc) return null;
    const loc = db.prepare("SELECT im, 'empresa emitente' AS f FROM contribuintes WHERE usuario_id = ? AND documento = ? AND COALESCE(im,'') <> '' UNION ALL SELECT im, 'cadastro de clientes' FROM tomadores WHERE usuario_id = ? AND documento = ? AND COALESCE(im,'') <> '' LIMIT 1").get(uid, doc, uid, doc);
    if (loc) return { im: loc.im, fonte: loc.f };
    const rows = db.prepare(`SELECT nnfse, competencia, xml_nfse, xml_dps FROM notas WHERE usuario_id = ? AND (xml_nfse LIKE ? OR xml_dps LIKE ?) ORDER BY id DESC LIMIT 30`).all(uid, `%>${doc}<%`, `%>${doc}<%`);
    for (const n of rows) {
      try {
        const x = parseXml(n.xml_nfse || n.xml_dps);
        const inf = busca(x, 'infNFSe') || busca(x, 'DPS');
        for (const p of papeis) {
          const el = p === 'emit' ? no(inf, 'emit') : (busca(x, p.split('/').pop()));
          if (el && so(txt(el, 'CNPJ') || txt(el, 'CPF')) === doc && txt(el, 'IM')) return { im: txt(el, 'IM'), fonte: `NFS-e${n.nnfse ? ' nº ' + n.nnfse : ''} de ${String(n.competencia || '').slice(0, 7)}` };
        }
      } catch { /* XML ilegível */ }
    }
    return null;
  }
  /** Aprende a IM (e completa cadastros sem IM) a partir de uma NFS-e autorizada ou importada. */
  function aprenderIM(uid, xml) {
    try {
      const x = parseXml(xml);
      const emit = no(busca(x, 'infNFSe'), 'emit');
      const pares = [[emit, 'contribuintes'], [busca(x, 'prest'), 'contribuintes'], [busca(x, 'toma'), 'tomadores'], [busca(x, 'interm'), 'tomadores']];
      for (const [el, tab] of pares) {
        const doc = so(txt(el, 'CNPJ') || txt(el, 'CPF')), im = so(txt(el, 'IM'));
        if (doc && im) db.prepare(`UPDATE ${tab} SET im = ? WHERE usuario_id = ? AND documento = ? AND COALESCE(im,'') = ''`).run(im, uid, doc);
      }
    } catch { /* ignora */ }
  }

  GET('/api/consulta/cnpj/:cnpj', async ({ user, params }) => {
    const r = await consultarCnpj(params.cnpj);
    const im = inscricaoMunicipal(user.id, r.documento);
    return { ...r, im: im?.im || '', im_fonte: im?.fonte || '',
      im_aviso: im ? '' : 'Inscrição municipal não localizada: ela não consta do cadastro da Receita e o cadastro nacional (CNC) só é aberto às prefeituras. Informe-a manualmente; após a primeira NFS-e autorizada ou importada do ADN o sistema a preenche sozinho.' };
  });
  // Completa em lote os cadastros (empresas ou clientes) com CNPJ: só preenche campos vazios, nunca sobrescreve
  POST('/api/cadastros/completar', async ({ user, body }) => {
    const tab = body.tipo === 'contribuintes' ? 'contribuintes' : 'tomadores';
    const nomeCol = tab === 'contribuintes' ? 'razao_social' : 'nome';
    const ids = (body.ids || []).map(Number).filter(Boolean);
    let rows = db.prepare(`SELECT * FROM ${tab} WHERE usuario_id = ? AND tipo_doc = 'CNPJ'`).all(user.id);
    if (ids.length) rows = rows.filter(r => ids.includes(r.id));
    const campos = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cod_municipio', 'uf', 'email', 'fone', ...(tab === 'contribuintes' ? ['nome_fantasia'] : [])];
    const res = { total: rows.length, atualizados: 0, ims: 0, erros: [], itens: [] };
    for (const r of rows.slice(0, 200)) {
      const alt = {};
      let im = null;
      try {
        if (campos.some(k => !r[k])) {
          const d = await consultarCnpj(r.documento, { completar: rows.length <= 3 });
          for (const k of campos) if (!r[k] && d[k]) alt[k] = ['cep', 'fone', 'cod_municipio'].includes(k) ? so(d[k]) : d[k];
          if (!r[nomeCol] && d.nome) alt[nomeCol] = d.nome;
        }
        if (!r.im) { im = inscricaoMunicipal(user.id, r.documento); if (im) alt.im = so(im.im); }
        const ks = Object.keys(alt).filter(k => tab === 'contribuintes' ? CAMPOS_CONTRIB.includes(k) : CAMPOS_TOMA.includes(k));
        if (ks.length) {
          db.prepare(`UPDATE ${tab} SET ${ks.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...ks.map(k => alt[k]), r.id);
          res.atualizados++; if (alt.im) res.ims++;
        }
        res.itens.push({ id: r.id, nome: r[nomeCol], campos: ks, im_fonte: im?.fonte || '' });
      } catch (e) { res.erros.push({ id: r.id, nome: r[nomeCol], erro: e.message }); }
    }
    audit(user.id, 'cadastros.completar', `${tab}: ${res.atualizados}/${res.total}`);
    return res;
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
    if (b.salvar_tomador !== false && t.nome) t.id = salvarTomador(uid, { ...t, contribuinte_id: b.contribuinte_id });
    else if (t.id && !db.prepare('SELECT 1 FROM tomadores WHERE id = ? AND usuario_id = ? AND (contribuinte_id = ? OR contribuinte_id IS NULL)').get(t.id, uid, +b.contribuinte_id)) delete t.id;
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

  // ---- Emissão pela conta gov.br (Emissor Nacional web). As APIs da Sefin exigem certificado ICP-Brasil; com a conta
  // gov.br a nota é emitida no Emissor Nacional. O app valida antes quem vai emitir (titular, responsável legal ou
  // procurador) e a própria nota (mesmas regras da emissão por API), guarda um rascunho vinculado e, quando o XML da
  // NFS-e volta (download capturado no Windows ou "Importar XML"), o rascunho vira a nota autorizada.
  const PAPEIS_GOVBR = { titular: 'Titular (o próprio prestador pessoa física)', responsavel: 'Responsável legal da empresa (vínculo pela base CNPJ)', procurador: 'Procurador (procuração eletrônica no e-CAC com o serviço NFS-e)' };
  const URL_EMISSOR = { producao: 'https://www.nfse.gov.br/EmissorNacional', homologacao: 'https://www.producaorestrita.nfse.gov.br/EmissorNacional' };
  async function validarRepresentanteGovBr(uid, c, rep) {
    const erros = [], avisos = [], ok = [];
    const cpf = so(rep.cpf), nome = String(rep.nome || '').trim(), papel = rep.papel;
    if (!PAPEIS_GOVBR[papel]) erros.push({ campo: 'papel', msg: 'Informe como você vai atuar: titular, responsável legal ou procurador.' });
    if (!docValido('CPF', cpf)) erros.push({ campo: 'cpf', msg: 'CPF do usuário gov.br inválido.' });
    if (nome.length < 3) erros.push({ campo: 'nome', msg: 'Informe o nome completo do usuário gov.br.' });
    if (!rep.nivel_ok) erros.push({ campo: 'nivel_ok', msg: 'A emissão no Emissor Nacional exige conta gov.br nível prata ou ouro: confirme o nível da conta.' });
    if (erros.length) return { erros, avisos, ok };
    const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (papel === 'titular') {
      if (c.tipo_doc !== 'CPF') erros.push({ campo: 'papel', msg: `${c.razao_social} é pessoa jurídica: com a conta gov.br, emita como responsável legal (sócio/administrador) ou procurador.` });
      else if (cpf !== c.documento) erros.push({ campo: 'cpf', msg: 'O CPF do usuário gov.br é diferente do CPF do prestador. Para emitir por outra pessoa, use "Procurador".' });
      else ok.push('CPF do usuário gov.br é o do próprio prestador.');
    } else if (papel === 'responsavel') {
      if (c.tipo_doc !== 'CNPJ') erros.push({ campo: 'papel', msg: 'Responsável legal se aplica a empresas (CNPJ). Para prestador pessoa física use "Titular" ou "Procurador".' });
      else if (c.responsavel_cpf) {
        if (c.responsavel_cpf !== cpf) erros.push({ campo: 'cpf', msg: `O responsável legal cadastrado para ${c.razao_social} é outro CPF (${fmtDocTxt(c.responsavel_cpf).replace(/^\d{3}/, '***')}). Confira em Empresas → Representação ou use "Procurador".` });
        else ok.push(`CPF confere com o responsável legal cadastrado (${c.responsavel_fonte || 'informado'}).`);
      } else {
        const d = await obterJson(`https://brasilapi.com.br/api/cnpj/v1/${c.documento}`) || await obterJson(`https://minhareceita.org/${c.documento}`);
        const qsa = (d?.qsa || []).filter(q => /\*\*\*\d{6}\*\*/.test(q.cnpj_cpf_do_socio || ''));
        if (!d) avisos.push('Não foi possível consultar o quadro societário (QSA) na Receita agora: o vínculo do CPF com a empresa será conferido pelo Emissor Nacional.');
        else if (!qsa.length) avisos.push('A Receita não divulga sócios/administradores pessoa física desta empresa: o vínculo será conferido pelo Emissor Nacional.');
        else {
          const meio = cpf.slice(3, 9);
          const achou = qsa.find(q => q.cnpj_cpf_do_socio.replace(/\D/g, '') === meio && (!nome || norm(q.nome_socio) === norm(nome)))
            || qsa.find(q => q.cnpj_cpf_do_socio.replace(/\D/g, '') === meio);
          if (!achou) erros.push({ campo: 'cpf', msg: `O CPF informado não consta do quadro de sócios/administradores (QSA) de ${c.razao_social} na Receita. O Emissor Nacional só permite atuar como responsável legal a quem é o responsável pelo CNPJ; para outras pessoas é preciso procuração eletrônica.` });
          else {
            if (norm(achou.nome_socio) !== norm(nome)) avisos.push(`No QSA o titular desse CPF é "${achou.nome_socio}": confira o nome.`);
            const resp = d.qualificacao_do_responsavel != null && +achou.codigo_qualificacao_socio === +d.qualificacao_do_responsavel;
            (resp ? ok : avisos).push(resp ? `CPF consta do QSA como ${achou.qualificacao_socio} (qualificação do responsável pelo CNPJ).`
              : `CPF consta do QSA como ${achou.qualificacao_socio}, mas o responsável perante a Receita tem outra qualificação. Se o Emissor Nacional não liberar a empresa, use procuração eletrônica.`);
          }
        }
      }
    } else if (papel === 'procurador') {
      if (cpf === c.documento) erros.push({ campo: 'cpf', msg: 'O procurador não pode ser o próprio prestador: use "Titular".' });
      const hoje = new Date().toISOString().slice(0, 10);
      const procs = db.prepare('SELECT * FROM procuracoes WHERE contribuinte_id = ? AND usuario_id = ? AND procurador_doc = ?').all(c.id, uid, cpf);
      const valida = procs.find(x => x.ativo && (!x.valida_ate || x.valida_ate >= hoje) && (!x.valida_de || x.valida_de <= hoje) && String(x.escopo || 'emissao').includes('emissao'));
      if (valida) ok.push(`Procuração cadastrada para este CPF${valida.valida_ate ? `, válida até ${valida.valida_ate.split('-').reverse().join('/')}` : ''}.`);
      else if (procs.some(x => x.valida_ate && x.valida_ate < hoje)) erros.push({ campo: 'cpf', msg: 'A procuração cadastrada para este CPF está vencida. Renove-a no e-CAC (Portal de Serviços da Receita) e atualize o cadastro.' });
      else if (procs.length) erros.push({ campo: 'cpf', msg: 'A procuração cadastrada para este CPF está inativa, fora da vigência ou não inclui emissão.' });
      else if (!rep.confirma_procuracao) erros.push({ campo: 'confirma_procuracao', msg: 'Não há procuração deste CPF cadastrada no app. Confirme que existe procuração eletrônica vigente no Portal de Serviços da Receita (e-CAC) com o serviço "NFS-e" para este prestador.' });
      else avisos.push('Procuração declarada pelo usuário (não cadastrada no app): o Emissor Nacional confere a procuração no login.');
    }
    return { erros, avisos, ok };
  }
  POST('/api/notas/govbr/validar-representante', async ({ user, body }) => {
    const c = contribuinte(user.id, body.contribuinte_id);
    return validarRepresentanteGovBr(user.id, c, body.representante || {});
  });
  POST('/api/notas/govbr/preparar', async ({ user, body }) => {
    const uid = user.id;
    const c = contribuinte(uid, body.contribuinte_id);
    if (!c.ativo) falha('Empresa inativa.');
    if (c.ambiente === 'simulacao') falha('A empresa está em modo simulação. Para emitir pelo gov.br, altere o ambiente da empresa para produção (ou homologação, que usa o Emissor Nacional de produção restrita).');
    const rep = body.representante || {};
    const v = await validarRepresentanteGovBr(uid, c, rep);
    if (v.erros.length) falha(v.erros[0].msg, 422, { erros: v.erros, avisos: v.avisos });
    const f = body.form || {};
    const t = tomadorDoForm(uid, body);
    const calc = calcular(f, c);
    const errosNota = validarEmissao({ contrib: c, tomador: t, form: f, calc });
    if (errosNota.length) falha('Corrija os campos antes de emitir.', 422, { erros: errosNota });
    db.prepare('UPDATE contribuintes SET govbr_cpf = ?, govbr_nome = ?, govbr_papel = ? WHERE id = ?').run(so(rep.cpf), String(rep.nome).trim().slice(0, 150), rep.papel, c.id);
    const govbr = { cpf: so(rep.cpf), nome: String(rep.nome).trim(), papel: rep.papel, preparado_em: new Date().toISOString(), validacao: v.ok.concat(v.avisos) };
    const dados = JSON.stringify({ form: f, tomador: t, acesso: { govbr: true }, govbr });
    const ant = body.rascunho_id ? db.prepare("SELECT id FROM notas WHERE id = ? AND usuario_id = ? AND status IN ('rascunho','rejeitada')").get(body.rascunho_id, uid) : null;
    let id;
    if (ant) {
      db.prepare(`UPDATE notas SET dados = ?, status = 'rascunho', tomador_id = ?, tomador_nome = ?, tomador_doc = ?, valor_servico = ?, descricao = ?, ctribnac = ?, competencia = ?, atualizado_em = datetime('now') WHERE id = ?`)
        .run(dados, t?.id || null, t?.nome || '', t?.documento || '', calc.vServ, f.descricao || '', so(f.ctribnac), f.competencia || null, ant.id);
      id = ant.id;
    } else id = db.prepare('INSERT INTO notas (usuario_id, contribuinte_id, tomador_id, status, dados, tomador_nome, tomador_doc, valor_servico, descricao, ctribnac, competencia) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(uid, c.id, t?.id || null, 'rascunho', dados, t?.nome || '', t?.documento || '', calc.vServ, f.descricao || '', so(f.ctribnac), f.competencia || null).lastInsertRowid;
    audit(uid, 'nota.govbr.preparar', `${c.documento} por ${PAPEIS_GOVBR[rep.papel].split(' (')[0]} ${so(rep.cpf).slice(0, 3)}***`);
    return { rascunho_id: id, calc, ok: v.ok, avisos: v.avisos, url: URL_EMISSOR[c.ambiente] || URL_EMISSOR.producao, representante: { cpf: govbr.cpf, nome: govbr.nome, papel: govbr.papel, papel_label: PAPEIS_GOVBR[govbr.papel] } };
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
    try { cred = await credencial(uid, c, acesso.procuracao_id, 'emissao', acesso.certificado_id); } catch (e) { if (!simulacao) throw e; }
    if (!simulacao && !cred.cert) falha('Para emitir em homologação/produção é necessário um certificado digital A1 do emitente ou de um procurador com procuração cadastrada.');

    // Reserva o número da DPS. Em homologação/produção confirma na Sefin (HEAD /dps/{id}) que o número
    // ainda não foi usado (ex.: outra instalação com a mesma série) para não perder a sequência (E0014).
    const reservar = () => tx(() => {
      const atual = db.prepare('SELECT prox_ndps FROM contribuintes WHERE id = ?').get(c.id).prox_ndps;
      const usadoLocal = db.prepare("SELECT MAX(ndps) m FROM notas WHERE contribuinte_id = ? AND serie = ? AND ambiente = ? AND status <> 'rascunho'").get(c.id, c.serie_dps, c.ambiente).m || 0;
      const n = Math.max(atual, usadoLocal + 1);
      db.prepare('UPDATE contribuintes SET prox_ndps = ? WHERE id = ?').run(n + 1, c.id);
      return n;
    });
    const idDe = n => montarDPS({ contrib: c, tomador: t, form: f, calc, serie: c.serie_dps, nDPS: n, ambiente: c.ambiente }).id;
    let nDPS = reservar();
    const avisosSeq = [];
    if (!simulacao) {
      for (let tent = 0; tent < 30; tent++) {
        let existe = false;
        try { existe = await sefin.existeDPS(c.ambiente, cred.cert, idDe(nDPS)); } catch { break; } // sem resposta: segue e trata E0014 no envio
        if (!existe) break;
        avisosSeq.push(nDPS);
        nDPS = reservar();
      }
      if (avisosSeq.length) audit(uid, 'sequencia.pulo', `DPS já usadas na Sefin: ${avisosSeq.join(', ')}`);
    }
    const subst = body.substituir ? { chave: body.substituir.chave, motivo: body.substituir.motivo, xMotivo: body.substituir.xMotivo } : null;
    const { xml, id, dhEmi, tpAmb } = montarDPS({ contrib: c, tomador: t, form: f, calc, serie: c.serie_dps, nDPS, ambiente: c.ambiente, subst });
    const xmlAssinado = cred.cert ? await assinarXml(xml, 'infDPS', cred.cert, json(c.config).assinatura) : xml;

    let status, chave = null, nNFSe = null, xmlNFSe = null, resposta = null, mensagens = [], dhProc = null;
    if (avisosSeq.length) mensagens.push({ codigo: 'SEQ', descricao: `Número(s) de DPS ${avisosSeq.join(', ')} já utilizado(s) na Sefin (série ${c.serie_dps}); a DPS foi emitida com o nº ${nDPS}.` });
    if (simulacao) {
      const seq = db.prepare("SELECT COUNT(*) n FROM notas WHERE contribuinte_id = ? AND ambiente = 'simulacao' AND chave_acesso IS NOT NULL").get(c.id).n + 1;
      nNFSe = String(seq);
      chave = chaveSimulada({ cMun: c.cod_municipio, tipoDoc: c.tipo_doc, doc: c.documento, nNFSe: seq });
      xmlNFSe = nfseSimulada({ chave, nNFSe, dpsAssinada: xmlAssinado, contrib: c, calc, municipio: nomeMunicipio(c.cod_municipio), xTribNac: CTRIB.get(so(f.ctribnac))?.descricao });
      status = 'autorizada'; dhProc = dataHoraBR();
      mensagens.push({ codigo: 'SIM', descricao: 'Nota gerada em modo SIMULAÇÃO: sem validade fiscal, nada foi enviado à Receita/Sefin.' });
    } else {
      let r;
      try { r = await sefin.emitirNFSe(c.ambiente, cred.cert, xmlAssinado); } catch (e) {
        // Sem resposta (queda de rede/timeout): a DPS pode ter sido processada. Fica PENDENTE e é conferida pelo id da DPS.
        r = { ok: false, pendente: true, erros: [{ codigo: 'COM', descricao: `${e.message}. A nota ficou PENDENTE: use "Consultar Sefin" para confirmar se foi autorizada (não reenvie com outro número).` }] };
      }
      resposta = r.bruto || null;
      if (!r.ok && r.duplicada) {
        // E0014: esta DPS já gerou NFS-e (ex.: resposta perdida num envio anterior) -> recupera a nota autorizada
        const d = await sefin.consultarDPS(c.ambiente, cred.cert, id).catch(() => ({ ok: false }));
        const n = d.ok && d.chave ? await sefin.consultarNFSe(c.ambiente, cred.cert, d.chave).catch(() => ({ ok: false })) : { ok: false };
        if (n.ok) r = { ok: true, chave: d.chave, xmlNFSe: n.xml, recuperada: true, alertas: [{ codigo: 'E0014', descricao: 'DPS já processada anteriormente: NFS-e recuperada da Sefin Nacional.' }] };
      }
      if (r.ok) {
        status = 'autorizada'; chave = r.chave; xmlNFSe = r.xmlNFSe; dhProc = r.dhProc || dataHoraBR();
        nNFSe = (xmlNFSe.match(/<nNFSe>(\d+)<\/nNFSe>/) || [])[1] || null;
        mensagens.push(...(r.alertas || []).map(a => ({ codigo: a.Codigo || a.codigo, descricao: a.Descricao || a.descricao })));
      } else { status = r.pendente ? 'pendente' : 'rejeitada'; mensagens.push(...r.erros); }
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
    if (status === 'autorizada' && xmlNFSe && c.ambiente !== 'simulacao') aprenderIM(uid, xmlNFSe);
    audit(uid, 'nota.emitir', `${status} ${chave || id} via ${cred.via}`);
    const out = { id: notaId, status, chave, nNFSe, mensagens, idDps: id, tpAmb };
    if (status === 'rejeitada') return { __status: 422, ...out, erro: 'NFS-e rejeitada pela Sefin Nacional.', erros: mensagens };
    if (status === 'pendente') return { __status: 202, ...out, erro: 'Sem resposta da Sefin Nacional: nota PENDENTE de confirmação.', erros: mensagens };
    return out;
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
  // DANFSe v2.0 gerado localmente a partir do XML (NT 008/2026: a API oficial foi suspensa em 03/08/2026)
  const opcoesDanfse = uid => ({ ...OPCOES_DANFSE, ...(cfgLer(uid, 'danfse') || {}) });
  // Entrega o DANFSe como HTML (pré-visualização/impressão) ou PDF (quando a plataforma sabe gerar PDF)
  async function entregaDanfse(html, nome, formato) {
    if (formato !== 'pdf') return { html, nome: `${nome}.html`, pdf: !!P.gerarPdf };
    if (!P.gerarPdf) falha('Esta plataforma não gera PDF diretamente: use "Imprimir DANFSe" e escolha "Salvar como PDF".', 501);
    const pagina = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${nome}</title></head><body style="margin:0;background:#fff">${html}</body></html>`;
    return { arquivo: { nome: `${nome}.pdf`, tipo: 'application/pdf', dados: await P.gerarPdf(pagina), inline: true } };
  }
  GET('/api/config/danfse', ({ user }) => ({ ...opcoesDanfse(user.id), pdf: !!P.gerarPdf }));
  PUT('/api/config/danfse', ({ user, body }) => {
    const v = {};
    for (const k of Object.keys(OPCOES_DANFSE)) v[k] = body[k] === undefined ? opcoesDanfse(user.id)[k] : !!body[k] && body[k] !== 'false';
    cfgGravar(user.id, 'danfse', v);
    return v;
  });
  GET('/api/notas/:id/danfse', ({ user, params, query }) => {
    const n = nota(user.id, params.id);
    if (!n.xml_nfse) falha('DANFSe disponível apenas para notas autorizadas (com XML da NFS-e).', 404);
    const html = gerarDANFSe(n.xml_nfse, { ...opcoesDanfse(user.id), situacao: n.status, simulacao: n.ambiente === 'simulacao' });
    return entregaDanfse(html, `DANFSe-${n.nnfse ? n.nnfse + '-' : ''}${n.chave_acesso || n.id}`, query.formato);
  });
  // Vários DANFSe num só documento (uma página por nota): por lista de ids ou pelos mesmos filtros da listagem
  POST('/api/danfse/lote', ({ user, body, query }) => {
    let ids = (body.ids || []).map(Number).filter(Boolean);
    if (!ids.length) falha('Selecione ao menos uma nota.');
    if (ids.length > 200) falha('Máximo de 200 notas por lote.');
    const ph = ids.map(() => '?').join(',');
    const notas = db.prepare(`SELECT id, xml_nfse, status, ambiente FROM notas WHERE usuario_id = ? AND id IN (${ph}) AND xml_nfse IS NOT NULL ORDER BY competencia, CAST(nnfse AS INTEGER), id`).all(user.id, ...ids);
    if (!notas.length) falha('Nenhuma das notas selecionadas tem XML de NFS-e autorizada.', 404);
    const html = gerarDANFSeLote(notas.map(n => ({ xml: n.xml_nfse, situacao: n.status, simulacao: n.ambiente === 'simulacao' })), opcoesDanfse(user.id));
    return entregaDanfse(html, `DANFSe-lote-${notas.length}-notas`, query.formato || body.formato).then(r => ({ ...r, quantidade: notas.length, ignoradas: ids.length - notas.length }));
  });
  // DANFSe de qualquer XML de NFS-e (ex.: notas recebidas como tomador ou baixadas do portal)
  POST('/api/danfse/xml', ({ user, body, query }) => {
    let xml = String(body.xml || '').replace(/^\uFEFF/, '').trim();
    if (!xml) falha('Informe o XML da NFS-e.');
    if (!xml.startsWith('<')) { try { xml = decodificarXml(xml); } catch { falha('Conteúdo não é um XML de NFS-e.'); } }
    let html;
    try { html = gerarDANFSe(xml, { ...opcoesDanfse(user.id), situacao: ['cancelada', 'substituida'].includes(body.situacao) ? body.situacao : 'autorizada' }); }
    catch (e) { falha(`Não foi possível gerar o DANFSe: ${e.message}`); }
    const chave = (xml.match(/Id="NFS(\d{50})"/) || [])[1] || 'nfse';
    return entregaDanfse(html, `DANFSe-${chave}`, query.formato || body.formato);
  });
  POST('/api/notas/:id/sincronizar', async ({ user, params }) => {
    const n = nota(user.id, params.id);
    if (n.ambiente === 'simulacao') falha('Notas simuladas não existem na Sefin.');
    const c = contribuinte(user.id, n.contribuinte_id);
    const cred = await credencial(user.id, c, n.procuracao_id, 'consulta', n.certificado_id);
    let chave = n.chave_acesso;
    if (!chave && n.id_dps) {
      const d = await sefin.consultarDPS(n.ambiente, cred.cert, n.id_dps);
      if (d.ok) chave = d.chave;
      else if (n.status === 'pendente' && d.status === 404) {
        db.prepare("UPDATE notas SET status = 'rejeitada', mensagens = ?, atualizado_em = datetime('now') WHERE id = ?")
          .run(JSON.stringify([{ codigo: 'DPS', descricao: 'A Sefin Nacional não gerou NFS-e para esta DPS. Corrija e reenvie.' }]), n.id);
        return { ok: true, status: 'rejeitada', mensagem: 'A DPS não foi processada pela Sefin: a nota pode ser reenviada.' };
      }
    }
    if (!chave) falha('Nota não localizada na Sefin Nacional.');
    const r = await sefin.consultarNFSe(n.ambiente, cred.cert, chave);
    if (!r.ok) falha('Falha na consulta.', 502, { erros: r.erros });
    const sit = await sefin.situacaoEventos(n.ambiente, cred.cert, chave);
    const nNFSe = (r.xml.match(/<nNFSe>(\d+)<\/nNFSe>/) || [])[1] || null;
    db.prepare("UPDATE notas SET chave_acesso = ?, xml_nfse = ?, status = ?, nnfse = COALESCE(?, nnfse), dh_proc = COALESCE(dh_proc, ?), atualizado_em = datetime('now') WHERE id = ?")
      .run(chave, r.xml, sit.status, nNFSe, (r.xml.match(/<dhProc>([^<]+)<\/dhProc>/) || [])[1] || null, n.id);
    aprenderIM(user.id, r.xml);
    return { ok: true, status: sit.status };
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
      const cred = await credencial(uid, c, body.procuracao_id || n.procuracao_id, 'cancelamento', body.procuracao_id ? null : n.certificado_id);
      xmlAss = await assinarXml(xml, 'infPedReg', cred.cert, json(c.config).assinatura);
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
        pendentes: db.prepare("SELECT COUNT(*) n FROM notas WHERE usuario_id = ? AND status = 'pendente'").get(user.id).n,
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

  // ------------------------------------------------------------ numeração (DPS / NFS-e)
  // Regras (Anexo I): a DPS é única por série + número + município emissor + CPF/CNPJ (E0014);
  // série 00001–49999 = aplicativo próprio (o Emissor Web usa 70000–79999); o nº da NFS-e é gerado pela Sefin.
  const ambSefin = c => (c.ambiente === 'producao' ? 'producao' : 'homologacao');
  function sequenciaLocal(c) {
    const q = (sql, ...p) => db.prepare(sql).get(...p);
    const ultDps = q("SELECT MAX(ndps) m FROM notas WHERE contribuinte_id = ? AND serie = ? AND ambiente = ? AND status <> 'rascunho'", c.id, c.serie_dps, c.ambiente).m || 0;
    const ultNota = q("SELECT nnfse, chave_acesso, dh_proc, competencia FROM notas WHERE contribuinte_id = ? AND ambiente = ? AND nnfse IS NOT NULL ORDER BY CAST(nnfse AS INTEGER) DESC LIMIT 1", c.id, c.ambiente);
    const pendentes = q("SELECT COUNT(*) n FROM notas WHERE contribuinte_id = ? AND status = 'pendente'", c.id).n;
    const outrasSeries = db.prepare("SELECT serie, MAX(ndps) ultimo, COUNT(*) qtd FROM notas WHERE contribuinte_id = ? AND ambiente = ? AND status <> 'rascunho' AND serie <> ? GROUP BY serie").all(c.id, c.ambiente, c.serie_dps);
    return { ambiente: c.ambiente, serie: c.serie_dps, proxNDPS: c.prox_ndps, ultimoDPSLocal: ultDps, ultimaNFSe: ultNota || null, pendentes, outrasSeries,
      ultimoNSU: c.ultimo_nsu || 0, sincronizadoEm: c.sincronizado_em || null };
  }
  GET('/api/contribuintes/:id/sequencia', ({ user, params }) => sequenciaLocal(contribuinte(user.id, params.id)));
  PUT('/api/contribuintes/:id/sequencia', ({ user, params, body }) => {
    const c = contribuinte(user.id, params.id);
    const o = normalizarContrib({ serie_dps: body.serie ?? c.serie_dps, prox_ndps: body.prox_ndps ?? c.prox_ndps });
    const loc = sequenciaLocal({ ...c, serie_dps: o.serie_dps });
    if (+o.prox_ndps <= loc.ultimoDPSLocal && !body.forcar) falha(`O próximo número precisa ser maior que o último usado nesta série (${loc.ultimoDPSLocal}).`);
    db.prepare('UPDATE contribuintes SET serie_dps = ?, prox_ndps = ? WHERE id = ?').run(o.serie_dps, +o.prox_ndps, c.id);
    audit(user.id, 'sequencia.ajuste', `${c.documento} série ${o.serie_dps} próximo ${o.prox_ndps}`);
    return sequenciaLocal(contribuinte(user.id, c.id));
  });
  // Descobre na Sefin o último nº de DPS já utilizado na série (HEAD /dps/{id}: busca exponencial + binária)
  POST('/api/contribuintes/:id/sequencia/verificar', async ({ user, params }) => {
    const c = contribuinte(user.id, params.id);
    if (c.ambiente === 'simulacao') falha('No modo simulação não há numeração na Sefin. Mude o ambiente para Produção restrita ou Produção.');
    const cred = await credencial(user.id, c, null, 'consulta');
    if (!cred.cert) falha('A consulta exige certificado digital (próprio ou de procurador).');
    const amb = ambSefin(c);
    let consultas = 0;
    const existe = async n => { consultas++; return sefin.existeDPS(amb, cred.cert, idDPS({ cLocEmi: c.cod_municipio, tipoDoc: c.tipo_doc, doc: c.documento, serie: c.serie_dps, nDPS: n })); };
    const loc = sequenciaLocal(c);
    let lo = 0, hi = null;
    const inicio = Math.max(1, loc.ultimoDPSLocal, c.prox_ndps - 1);
    if (await existe(inicio)) lo = inicio;
    else if (inicio > 1 && await existe(1)) lo = 1;
    if (lo > 0) {
      let passo = 1;
      while (consultas < 60) {
        const cand = lo + passo;
        if (await existe(cand)) { lo = cand; passo *= 2; } else { hi = cand; break; }
      }
      while (hi !== null && hi - lo > 1 && consultas < 90) {
        const meio = Math.floor((lo + hi) / 2);
        if (await existe(meio)) lo = meio; else hi = meio;
      }
    }
    const prox = Math.max(lo, loc.ultimoDPSLocal) + 1;
    const ajustado = prox > c.prox_ndps;
    if (ajustado) {
      db.prepare('UPDATE contribuintes SET prox_ndps = ? WHERE id = ?').run(prox, c.id);
      audit(user.id, 'sequencia.sefin', `série ${c.serie_dps}: último na Sefin ${lo}; próximo ajustado para ${prox}`);
    }
    return { ...sequenciaLocal(contribuinte(user.id, c.id)), ultimoDPSSefin: lo, consultas, ajustado };
  });

  // Importa do ADN (distribuição por NSU) as NFS-e do CNPJ, inclusive as emitidas fora do app (ex.: Emissor Web)
  /** Grava (ou completa) uma NFS-e autorizada vinda de fora do app: ADN, Emissor Nacional (gov.br) ou arquivo. */
  /** Rascunho preparado para o gov.br que corresponde à NFS-e (mesma empresa, valor e tomador). */
  function rascunhoGovBr(uid, c, x) {
    return db.prepare(`SELECT id, tomador_id, dados FROM notas WHERE usuario_id = ? AND contribuinte_id = ? AND status = 'rascunho' AND dados LIKE '%"govbr":{%'
      AND ABS(COALESCE(valor_servico, 0) - ?) < 0.005 AND COALESCE(tomador_doc, '') = ? ORDER BY atualizado_em DESC, id DESC LIMIT 1`).get(uid, c.id, +x.vServ || 0, so(x.tomaDoc || ''));
  }
  function registrarNFSe(uid, c, xml, x, { origem, via, ambiente, msg }) {
    const ex = db.prepare('SELECT id, status FROM notas WHERE usuario_id = ? AND chave_acesso = ?').get(uid, x.chave);
    if (ex) {
      db.prepare("UPDATE notas SET xml_nfse = COALESCE(xml_nfse, ?), nnfse = COALESCE(nnfse, ?), atualizado_em = datetime('now') WHERE id = ?").run(xml, x.nNFSe, ex.id);
      return 'atualizada';
    }
    const rasc = rascunhoGovBr(uid, c, x);
    if (rasc) {
      const g = json(rasc.dados).govbr || {};
      msg += ` Rascunho nº ${rasc.id} preparado no app; emitida por ${g.nome || ''} (${{ titular: 'titular', responsavel: 'responsável legal', procurador: 'procurador' }[g.papel] || g.papel}).`;
    }
    const retido = x.tpRetISSQN && x.tpRetISSQN !== '1';
    db.prepare(`INSERT INTO notas (usuario_id, contribuinte_id, status, ambiente, serie, ndps, id_dps, chave_acesso, nnfse, dh_emi, competencia, dh_proc, tomador_doc, tomador_nome,
      ctribnac, cnbs, descricao, valor_servico, valor_desconto_incond, base_calculo, aliq_iss, valor_iss, iss_retido, valor_pis, valor_cofins, valor_irrf, valor_csll, valor_inss,
      valor_retencoes, valor_liquido, valor_ibs, valor_cbs, emitido_via, origem, dados, xml_nfse, mensagens)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      uid, c.id, 'autorizada', ambiente, String(x.serie || '').padStart(5, '0'), +x.nDPS || null, x.idDps, x.chave, x.nNFSe, x.dhEmi, x.dCompet, x.dhProc,
      x.tomaDoc, x.tomaNome, x.cTribNac, x.cNBS, x.xDescServ, x.vServ, x.vDescIncond, x.vBC, x.pAliq, x.vISSQN, retido ? 1 : 0, x.vPis, x.vCofins, x.vIRRF, x.vCSLL, x.vCP,
      x.vTotalRet, x.vLiq, x.vIBS, x.vCBS, via, origem,
      JSON.stringify({ form: { competencia: x.dCompet, ctribnac: x.cTribNac, cnbs: x.cNBS, descricao: x.xDescServ, valor_servico: x.vServ, trib_issqn: '1', tp_ret_issqn: x.tpRetISSQN || '1', aliq_iss: x.pAliq },
        tomador: x.tomaDoc ? { tipo_doc: x.tomaTipo, documento: x.tomaDoc, nome: x.tomaNome } : null }),
      xml, JSON.stringify([{ codigo: origem.toUpperCase(), descricao: msg }]));
    if (rasc) {
      const nova = db.prepare('SELECT id, dados FROM notas WHERE usuario_id = ? AND chave_acesso = ?').get(uid, x.chave);
      const dr = json(rasc.dados);
      // mantém os dados digitados no app (tomador completo, IBS/CBS, retenções) para a cópia da última nota
      db.prepare('UPDATE notas SET tomador_id = ?, dados = ? WHERE id = ?').run(rasc.tomador_id, JSON.stringify({ ...json(nova.dados), form: { ...json(nova.dados).form, ...dr.form }, tomador: dr.tomador || json(nova.dados).tomador, govbr: dr.govbr }), nova.id);
      db.prepare('DELETE FROM notas WHERE id = ?').run(rasc.id);
      return 'vinculada';
    }
    return 'importada';
  }

  // NFS-e emitidas no Emissor Nacional (login gov.br, como responsável legal ou procurador) ou recebidas em arquivo:
  // importa os XML baixados para relatórios, DANFSe, cópia da última nota e cancelamento/consulta posteriores.
  POST('/api/notas/importar-xml', ({ user, body }) => {
    const lista = (Array.isArray(body.xmls) ? body.xmls : [body.xml]).filter(Boolean).slice(0, 500);
    if (!lista.length) falha('Selecione ao menos um XML de NFS-e.');
    const via = ['govbr', 'portal', 'arquivo'].includes(body.via) ? body.via : 'arquivo';
    const res = { importadas: 0, atualizadas: 0, eventos: 0, erros: [], notas: [] };
    lista.forEach((bruto, i) => {
      try {
        let xml = String(bruto).replace(/^\uFEFF/, '').trim();
        if (!xml.startsWith('<')) xml = decodificarXml(xml);
        if (/e101101|e105102/.test(xml) && !/<(\w+:)?NFSe[\s>]/.test(xml)) {
          const ch = (xml.match(/<chNFSe>(\d{50})<\/chNFSe>/) || [])[1];
          const u = ch ? db.prepare('UPDATE notas SET status = ? WHERE usuario_id = ? AND chave_acesso = ?').run(/e105102/.test(xml) ? 'substituida' : 'cancelada', user.id, ch) : { changes: 0 };
          if (u.changes) res.eventos++; else res.erros.push({ arquivo: i + 1, erro: 'Evento de uma NFS-e que não está no app: importe primeiro a nota.' });
          return;
        }
        const x = resumoNFSe(xml);
        const doc = so(x.prestDoc || x.emitDoc);
        const c = db.prepare('SELECT * FROM contribuintes WHERE usuario_id = ? AND documento = ?').get(user.id, doc)
          || db.prepare('SELECT * FROM contribuintes WHERE usuario_id = ? AND documento = ?').get(user.id, so(x.emitDoc));
        if (!c) { res.erros.push({ arquivo: i + 1, erro: `Prestador ${fmtDocTxt(doc)} não está cadastrado em Empresas emitentes.` }); return; }
        const ambiente = x.tpAmb === '1' ? 'producao' : 'homologacao';
        const r = registrarNFSe(user.id, c, xml, x, { origem: via === 'arquivo' ? 'arquivo' : 'portal', via, ambiente,
          msg: via === 'arquivo' ? 'Importada de arquivo XML.' : 'Emitida no Emissor Nacional (acesso gov.br) e importada pelo app.' });
        if (x.chSubstda) db.prepare("UPDATE notas SET status = 'substituida' WHERE usuario_id = ? AND chave_acesso = ?").run(user.id, x.chSubstda);
        aprenderIM(user.id, xml);
        res[r === 'atualizada' ? 'atualizadas' : 'importadas']++;
        if (r === 'vinculada') res.vinculadas = (res.vinculadas || 0) + 1;
        res.notas.push({ vinculada: r === 'vinculada', id: db.prepare('SELECT id FROM notas WHERE usuario_id = ? AND chave_acesso = ?').get(user.id, x.chave).id, nnfse: x.nNFSe, empresa: c.razao_social, chave: x.chave });
      } catch (e) { res.erros.push({ arquivo: i + 1, erro: e.message }); }
    });
    audit(user.id, 'notas.importar-xml', `${via}: ${res.importadas} novas, ${res.atualizadas} atualizadas, ${res.eventos} eventos`);
    return res;
  });

  POST('/api/contribuintes/:id/importar-adn', async ({ user, params, body }) => {
    const c = contribuinte(user.id, params.id);
    if (c.ambiente === 'simulacao') falha('Importação do ADN disponível apenas em Produção restrita ou Produção.');
    const cred = await credencial(user.id, c, null, 'consulta');
    if (!cred.cert) falha('A distribuição do ADN exige certificado digital.');
    const amb = ambSefin(c);
    let nsu = body?.reiniciar ? 0 : (c.ultimo_nsu || 0);
    const res = { lotes: 0, documentos: 0, importadas: 0, atualizadas: 0, eventos: 0, ignoradas: 0, concluida: false, erros: [] };
    while (res.lotes < (+body?.maxLotes || 20)) {
      const r = await sefin.distribuicaoDFe(amb, cred.cert, nsu, c.tipo_doc === 'CNPJ' ? c.documento : undefined);
      if (!r.ok) { res.erros.push(...r.erros); break; }
      if (!r.docs.length) { res.concluida = true; break; }
      res.lotes++;
      for (const d of r.docs) {
        res.documentos++;
        if (d.nsu > nsu) nsu = d.nsu;
        try {
          if (/<(\w+:)?NFSe[\s>]/.test(d.xml)) {
            const x = resumoNFSe(d.xml);
            if (so(x.prestDoc || x.emitDoc) !== so(c.documento)) { res.ignoradas++; continue; }
            if (registrarNFSe(user.id, c, d.xml, x, { origem: 'adn', via: 'adn', ambiente: c.ambiente, msg: 'Importada da distribuição do Ambiente de Dados Nacional (ADN).' }) === 'atualizada') res.atualizadas++;
            else res.importadas++;
            if (x.chSubstda) db.prepare("UPDATE notas SET status = 'substituida' WHERE usuario_id = ? AND chave_acesso = ?").run(user.id, x.chSubstda);
            aprenderIM(user.id, d.xml);
            // Mantém a numeração à frente do maior nº de DPS encontrado nesta série
            if (x.serie && +x.serie === +c.serie_dps && +x.nDPS >= contribuinte(user.id, c.id).prox_ndps) db.prepare('UPDATE contribuintes SET prox_ndps = ? WHERE id = ?').run(+x.nDPS + 1, c.id);
          } else if (/e101101|e105102/.test(d.xml)) {
            const ch = (d.xml.match(/<chNFSe>(\d{50})<\/chNFSe>/) || [])[1] || d.chave;
            const st = /e105102/.test(d.xml) ? 'substituida' : 'cancelada';
            const u = db.prepare('UPDATE notas SET status = ? WHERE usuario_id = ? AND chave_acesso = ?').run(st, user.id, ch);
            if (u.changes) res.eventos++; else res.ignoradas++;
          } else res.ignoradas++;
        } catch (e) { res.erros.push({ codigo: 'XML', descricao: `NSU ${d.nsu}: ${e.message}` }); }
      }
      if (r.docs.length < 50) { res.concluida = true; break; }
    }
    db.prepare("UPDATE contribuintes SET ultimo_nsu = ?, sincronizado_em = datetime('now') WHERE id = ?").run(nsu, c.id);
    audit(user.id, 'adn.importar', `${c.documento}: ${res.importadas} novas, ${res.eventos} eventos, NSU ${nsu}`);
    return { ...res, ultimoNSU: nsu, sequencia: sequenciaLocal(contribuinte(user.id, c.id)) };
  });

  // ------------------------------------------------------------ cadeia do certificado
  POST('/api/certificados/:id/cadeia', async ({ user, params }) => {
    const row = db.prepare('SELECT * FROM certificados WHERE id = ? AND usuario_id = ?').get(params.id, user.id);
    if (!row) falha('Certificado não encontrado.');
    if (row.origem === 'sistema') falha('A cadeia de certificados instalados é gerenciada pelo sistema operacional.');
    const pfx = await P.cofre.decrypt(row.pfx_enc, true), senha = await P.cofre.decrypt(row.senha_enc);
    const prep = await prepararPfx(pfx, senha, lerPfx(pfx, senha));
    db.prepare('UPDATE certificados SET pfx_enc = ?, cadeia = ? WHERE id = ?').run(await P.cofre.encrypt(prep.bytes), JSON.stringify(prep.cadeia), row.id);
    return resumoCert(db.prepare('SELECT * FROM certificados WHERE id = ?').get(row.id));
  });

  // ------------------------------------------------------------ diagnóstico de produção
  GET('/api/contribuintes/:id/diagnostico', async ({ user, params, query }) => {
    const c = contribuinte(user.id, params.id);
    const ck = [];
    const add = (grupo, item, status, detalhe = '') => ck.push({ grupo, item, status, detalhe });
    // Cadastro
    add('Cadastro', 'CPF/CNPJ do emitente', docValido(c.tipo_doc, c.documento) ? 'ok' : 'erro', c.documento);
    add('Cadastro', 'Município emissor (IBGE)', MUN.has(c.cod_municipio) ? 'ok' : 'erro', nomeMunicipio(c.cod_municipio));
    add('Cadastro', 'Regime tributário', REGIMES[c.regime] ? 'ok' : 'erro', REGIMES[c.regime]?.label || c.regime);
    add('Cadastro', 'Inscrição municipal', c.im ? 'ok' : 'aviso', c.im ? c.im : 'Não informada. Só deixe em branco se o município NÃO tiver cadastro complementar no CNC (senão a DPS é rejeitada).');
    if (c.regime === 'SN' && !(+c.aliq_sn > 0)) add('Cadastro', 'Alíquota efetiva do Simples (pTotTribSN)', 'aviso', 'Informe a alíquota efetiva do Simples Nacional.');
    // Numeração
    const seq = sequenciaLocal(c);
    add('Numeração', 'Série da DPS', +c.serie_dps >= 1 && +c.serie_dps <= 49999 ? 'ok' : 'erro', `${c.serie_dps} (faixa 00001–49999 de aplicativo próprio). Use séries diferentes no Windows e no Android.`);
    add('Numeração', 'Próximo nº da DPS', c.prox_ndps > seq.ultimoDPSLocal ? 'ok' : 'erro', `próximo ${c.prox_ndps}; último usado neste aparelho ${seq.ultimoDPSLocal}`);
    add('Numeração', 'Notas pendentes de confirmação', seq.pendentes ? 'erro' : 'ok', seq.pendentes ? `${seq.pendentes} nota(s) sem resposta da Sefin: consulte-as antes de continuar.` : 'nenhuma');
    // Certificado / acesso
    let cred = null;
    try { cred = await credencial(user.id, c, query.procuracao_id || null, 'emissao'); } catch (e) { add('Certificado', 'Certificado para assinatura/transmissão', 'erro', e.message); }
    if (cred && !cred.cert) add('Certificado', 'Certificado para assinatura/transmissão', 'erro', 'Nenhum certificado vinculado: da empresa, de estabelecimento da mesma raiz, do responsável legal (e-CPF) ou de procurador com procuração eletrônica.');
    if (cred?.cert) {
      const r = cred.cert.row, rc = resumoCert(r);
      add('Certificado', 'Validade', rc.situacao === 'valido' ? 'ok' : rc.situacao === 'vencendo' ? 'aviso' : 'erro', `${rc.titular} — até ${r.valido_ate.slice(0, 10)} (${rc.dias_restantes} dias)`);
      const titular = {
        procuracao: ['ok', `Procurador ${fmtDocTxt(r.documento)} (procuração eletrônica com o serviço NFS-e)`],
        certificado: so(r.documento) === so(c.documento) ? ['ok', 'Certificado do próprio emitente'] : ['aviso', `Documento do certificado (${fmtDocTxt(r.documento)}) não tem vínculo identificado com o emitente: cadastre o responsável legal ou uma procuração.`],
        raiz: ['ok', `e-CNPJ ${fmtDocTxt(r.documento)} da mesma raiz de CNPJ (representação pela base CNPJ)`],
        responsavel: [c.responsavel_fonte && !/informado/i.test(c.responsavel_fonte) ? 'ok' : 'aviso', `Responsável legal ${fmtDocTxt(r.documento)} (e-CPF). Vínculo: ${c.responsavel_fonte || 'informado manualmente'}. A Sefin confere o vínculo na base CNPJ.`],
      }[cred.via] || ['info', cred.via];
      add('Certificado', 'Titular / representação', ...titular);
      const cad = rc.cadeia || {};
      add('Certificado', 'Cadeia ICP-Brasil', cad.completa && cad.icp ? 'ok' : cad.completa ? 'aviso' : 'erro',
        cad.completa ? `${cad.niveis} nível(is) até ${cad.raiz}${cad.icp ? '' : ' (raiz não identificada como ICP-Brasil)'}` : `Cadeia incompleta${cad.aviso ? ': ' + cad.aviso : ''}. Use "Completar cadeia" em Certificados.`);
      if (cred.via === 'procuracao') {
        const p = cred.procuracao;
        add('Procuração', 'Vigência', p.valida_ate ? 'ok' : 'aviso', p.valida_ate ? `até ${p.valida_ate} (${p.fonte_validade === 'receita' ? 'confirmada na Receita' : 'informada manualmente'})` : 'Sem data de validade cadastrada: confira no e-CAC ou pelo Integra Contador.');
        add('Procuração', 'Serviço NFS-e na procuração (e-CAC)', p.sistemas ? (/nfs/i.test(p.sistemas) ? 'ok' : 'aviso') : 'info', p.sistemas || 'A procuração no e-CAC precisa incluir o serviço "NFS-e". Verifique pelo Integra Contador ou no e-CAC.');
      }
    }
    // Ambiente
    const homolog = db.prepare("SELECT COUNT(*) n FROM notas WHERE contribuinte_id = ? AND ambiente = 'homologacao' AND status = 'autorizada'").get(c.id).n;
    add('Ambiente', 'Ambiente atual', c.ambiente === 'producao' ? 'ok' : 'info', { simulacao: 'Simulação (nada é transmitido)', homologacao: 'Produção restrita (homologação oficial)', producao: 'Produção' }[c.ambiente]);
    add('Ambiente', 'Testes na Produção restrita', homolog ? 'ok' : 'aviso', homolog ? `${homolog} nota(s) autorizada(s) em homologação` : 'Nenhuma nota autorizada em Produção restrita ainda: valide ao menos uma emissão e um cancelamento antes de ir para Produção.');
    // Verificações remotas (opcionais)
    const alvo = query.ambiente === 'producao' ? 'producao' : query.ambiente === 'homologacao' ? 'homologacao' : ambSefin(c);
    if (query.remoto && cred?.cert) {
      try {
        const existe = await sefin.existeDPS(alvo, cred.cert, idDPS({ cLocEmi: c.cod_municipio, tipoDoc: c.tipo_doc, doc: c.documento, serie: c.serie_dps, nDPS: c.prox_ndps }));
        add('Comunicação', `Conexão mTLS com a Sefin (${alvo === 'producao' ? 'Produção' : 'Produção restrita'})`, 'ok', 'Certificado aceito pela Sefin Nacional.');
        add('Comunicação', 'Próximo nº de DPS livre na Sefin', existe ? 'erro' : 'ok', existe ? `O nº ${c.prox_ndps} já foi usado: rode "Verificar numeração na Sefin".` : `nº ${c.prox_ndps} disponível`);
      } catch (e) { add('Comunicação', 'Conexão mTLS com a Sefin', 'erro', e.message); }
      try {
        const cv = await sefin.convenio(alvo, cred.cert, c.cod_municipio);
        const txtCv = typeof cv.dados === 'string' ? cv.dados : JSON.stringify(cv.dados || {});
        const ativo = cv.ok && !/inativ|n[aã]o convenia|desativ/i.test(txtCv);
        add('Comunicação', `Convênio do município ${nomeMunicipio(c.cod_municipio)}`, cv.ok ? (ativo ? 'ok' : 'aviso') : 'erro', cv.ok ? txtCv.slice(0, 300) : `HTTP ${cv.status}: ${cv.erros?.[0]?.descricao || ''} — o município pode não ter aderido ao Sistema Nacional.`);
      } catch (e) { add('Comunicação', 'Convênio do município', 'erro', e.message); }
    } else if (query.remoto) add('Comunicação', 'Testes de comunicação', 'erro', 'Sem certificado: não é possível testar a comunicação com a Sefin.');
    else add('Comunicação', 'Testes de comunicação', 'info', 'Clique em "Testar comunicação" para validar o certificado na Sefin e o convênio do município.');
    const erros = ck.filter(x => x.status === 'erro').length;
    return { checks: ck, erros, avisos: ck.filter(x => x.status === 'aviso').length, prontoProducao: erros === 0 && homolog > 0, ambiente: c.ambiente };
  });

  // ------------------------------------------------------------ Integra Contador (SERPRO) – procurações
  const integra = criarIntegraContador(P.http);
  const cfgLer = (uid, k) => json(db.prepare('SELECT valor FROM configuracoes WHERE usuario_id = ? AND chave = ?').get(uid, k)?.valor, null);
  const cfgGravar = (uid, k, v) => db.prepare('INSERT INTO configuracoes (usuario_id, chave, valor) VALUES (?,?,?) ON CONFLICT(usuario_id, chave) DO UPDATE SET valor = excluded.valor').run(uid, k, JSON.stringify(v));
  GET('/api/config/integra-contador', ({ user }) => {
    const c = cfgLer(user.id, 'integra') || {};
    return { ambiente: c.ambiente || 'trial', consumerKey: c.consumerKey || '', temSecret: !!c.secretEnc, certificado_id: c.certificado_id || null, contratante: c.contratante || '' };
  });
  PUT('/api/config/integra-contador', async ({ user, body }) => {
    const atual = cfgLer(user.id, 'integra') || {};
    const novo = { ...atual, ambiente: body.ambiente === 'producao' ? 'producao' : 'trial', consumerKey: body.consumerKey ?? atual.consumerKey, certificado_id: body.certificado_id || null, contratante: so(body.contratante || '') };
    if (body.consumerSecret) novo.secretEnc = await P.cofre.encrypt(body.consumerSecret);
    cfgGravar(user.id, 'integra', novo);
    return { ok: true };
  });
  POST('/api/procuracoes/verificar-receita', async ({ user, body }) => {
    const cfg = cfgLer(user.id, 'integra') || {};
    const trial = (cfg.ambiente || 'trial') === 'trial';
    let cert = null;
    if (!trial) {
      if (!cfg.consumerKey || !cfg.secretEnc || !cfg.certificado_id) falha('Configure o Integra Contador (Consumer Key/Secret e certificado do contratante) em Configurações.');
      cert = await carregarCertificado(cfg.certificado_id, user.id);
    }
    const lista = db.prepare(`SELECT p.*, ct.documento contrib_doc, ct.razao_social FROM procuracoes p JOIN contribuintes ct ON ct.id = p.contribuinte_id WHERE p.usuario_id = ? ${body?.procuracao_id ? 'AND p.id = ?' : ''}`)
      .all(...[user.id, ...(body?.procuracao_id ? [body.procuracao_id] : [])]);
    const out = [];
    for (const p of lista) {
      try {
        const r = await integra.obterProcuracoes({ ambiente: trial ? 'trial' : 'producao', consumerKey: cfg.consumerKey, consumerSecret: trial ? '' : await P.cofre.decrypt(cfg.secretEnc), cert,
          contratante: cfg.contratante || cert?.row?.documento || p.procurador_doc, outorgante: p.contrib_doc, outorgado: p.procurador_doc });
        const esc = procuracaoNFSe(r.procuracoes);
        if (esc && !trial) {
          db.prepare("UPDATE procuracoes SET valida_ate = ?, sistemas = ?, verificada_em = datetime('now'), fonte_validade = 'receita' WHERE id = ?").run(esc.validaAte, esc.sistemas.join('; '), p.id);
        }
        out.push({ id: p.id, empresa: p.razao_social, procurador: p.procurador_nome, encontradas: r.procuracoes.length, validaAte: esc?.validaAte || null, sistemas: esc?.sistemas || [], mensagens: r.mensagens, trial });
      } catch (e) { out.push({ id: p.id, empresa: p.razao_social, procurador: p.procurador_nome, erro: e.message }); }
    }
    audit(user.id, 'procuracao.receita', `${out.length} consultada(s)${trial ? ' (trial)' : ''}`);
    return { resultados: out, trial };
  });

  // Backup completo do banco (útil principalmente no Android)
  if (P.exportarBanco) GET('/api/backup', ({ user }) => ({ arquivo: { nome: `vorticis-backup-${new Date().toISOString().slice(0, 10)}.sqlite`, tipo: 'application/octet-stream', dados: P.exportarBanco(user) } }));

  return { handle, db };
}
