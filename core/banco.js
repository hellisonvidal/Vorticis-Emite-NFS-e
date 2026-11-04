// Esquema do banco e adaptadores. O núcleo usa uma interface mínima síncrona:
//   db.exec(sql) · db.prepare(sql).get(...p) / .all(...p) / .run(...p) -> { lastInsertRowid, changes }
// Implementações: node:sqlite (Windows/servidor) e sql.js/WASM (Android).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT UNIQUE,
  senha_hash TEXT,
  documento TEXT,              -- CPF/CNPJ vinculado ao certificado (login por certificado)
  perfil TEXT DEFAULT 'admin',
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  metodo TEXT,                 -- senha | certificado
  expira_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS certificados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  apelido TEXT,
  titular TEXT, documento TEXT, tipo_doc TEXT,  -- CNPJ | CPF
  emissor TEXT, serial TEXT, valido_de TEXT, valido_ate TEXT,
  pfx_enc TEXT NOT NULL, senha_enc TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contribuintes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo_doc TEXT DEFAULT 'CNPJ', documento TEXT NOT NULL,
  razao_social TEXT NOT NULL, nome_fantasia TEXT, im TEXT,
  cep TEXT, logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT, cod_municipio TEXT, uf TEXT,
  fone TEXT, email TEXT,
  regime TEXT NOT NULL DEFAULT 'SN',        -- MEI | SN | SN_EXCESSO_ISS | SN_EXCESSO | LP | LR | LA | IMUNE | ISENTA
  reg_esp_trib TEXT DEFAULT '0',
  aliq_sn REAL DEFAULT 0,                   -- alíquota efetiva do Simples (%)
  aliq_iss REAL DEFAULT 0,                  -- alíquota ISS padrão (%)
  pis_cofins_regime TEXT DEFAULT '',        -- cumulativo | nao_cumulativo
  serie_dps TEXT DEFAULT '00001',
  prox_ndps INTEGER DEFAULT 1,
  ambiente TEXT DEFAULT 'simulacao',        -- simulacao | homologacao | producao
  acesso TEXT DEFAULT 'certificado',        -- certificado | procuracao | manual
  certificado_id INTEGER REFERENCES certificados(id) ON DELETE SET NULL,
  ibscbs_ativo INTEGER DEFAULT 1,
  cclasstrib_padrao TEXT DEFAULT '000001',
  ind_op_padrao TEXT DEFAULT '100301',
  config TEXT DEFAULT '{}',
  ativo INTEGER DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now')),
  UNIQUE(usuario_id, documento)
);
CREATE TABLE IF NOT EXISTS procuracoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  contribuinte_id INTEGER NOT NULL REFERENCES contribuintes(id) ON DELETE CASCADE,
  certificado_id INTEGER NOT NULL REFERENCES certificados(id) ON DELETE CASCADE,
  procurador_nome TEXT, procurador_doc TEXT,
  escopo TEXT DEFAULT 'emissao,consulta,cancelamento',
  valida_de TEXT, valida_ate TEXT,
  observacao TEXT, ativo INTEGER DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tomadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo_doc TEXT DEFAULT 'CNPJ',           -- CNPJ | CPF | NIF | SEM
  documento TEXT, nome TEXT NOT NULL, im TEXT,
  cep TEXT, logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT, cod_municipio TEXT, uf TEXT,
  pais TEXT DEFAULT 'BR', cidade_ext TEXT, estado_ext TEXT, cod_postal_ext TEXT,
  fone TEXT, email TEXT,
  orgao_publico INTEGER DEFAULT 0, tp_ente_gov TEXT,
  retem_iss INTEGER DEFAULT 0, retem_federais INTEGER DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  contribuinte_id INTEGER REFERENCES contribuintes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, ctribnac TEXT NOT NULL, ctribmun TEXT, cnbs TEXT,
  descricao TEXT, aliq_iss REAL, valor_padrao REAL,
  ind_op TEXT, cclasstrib TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS codigos_municipais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_municipio TEXT NOT NULL, ctribnac TEXT NOT NULL, ctribmun TEXT NOT NULL,
  descricao TEXT, aliquota REAL, origem TEXT DEFAULT 'manual', atualizado_em TEXT DEFAULT (datetime('now')),
  UNIQUE(cod_municipio, ctribnac, ctribmun)
);
CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  contribuinte_id INTEGER NOT NULL REFERENCES contribuintes(id) ON DELETE CASCADE,
  tomador_id INTEGER REFERENCES tomadores(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | autorizada | rejeitada | cancelada | substituida
  ambiente TEXT, serie TEXT, ndps INTEGER, id_dps TEXT,
  chave_acesso TEXT, nnfse TEXT, dh_emi TEXT, competencia TEXT, dh_proc TEXT,
  tomador_doc TEXT, tomador_nome TEXT,
  ctribnac TEXT, cnbs TEXT, descricao TEXT,
  valor_servico REAL DEFAULT 0, valor_deducoes REAL DEFAULT 0, valor_desconto_incond REAL DEFAULT 0,
  base_calculo REAL DEFAULT 0, aliq_iss REAL DEFAULT 0, valor_iss REAL DEFAULT 0, iss_retido INTEGER DEFAULT 0,
  valor_pis REAL DEFAULT 0, valor_cofins REAL DEFAULT 0, valor_irrf REAL DEFAULT 0, valor_csll REAL DEFAULT 0, valor_inss REAL DEFAULT 0,
  valor_retencoes REAL DEFAULT 0, valor_liquido REAL DEFAULT 0,
  valor_ibs REAL DEFAULT 0, valor_cbs REAL DEFAULT 0,
  emitido_via TEXT,                       -- certificado | procuracao | simulacao
  procuracao_id INTEGER, certificado_id INTEGER,
  dados TEXT NOT NULL,                    -- JSON completo do formulário
  xml_dps TEXT, xml_nfse TEXT, resposta TEXT, mensagens TEXT,
  substitui_chave TEXT,
  criado_em TEXT DEFAULT (datetime('now')), atualizado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notas_contrib ON notas(contribuinte_id, criado_em);
CREATE INDEX IF NOT EXISTS ix_notas_status ON notas(status);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  tipo TEXT, descricao TEXT, xml TEXT, resposta TEXT, status TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER, acao TEXT, detalhe TEXT, criado_em TEXT DEFAULT (datetime('now'))
);
`;

const normaliza = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

// Colunas acrescentadas após a versão 1.0.0 (aplicadas automaticamente em bancos existentes)
const MIGRACOES = [
  ['certificados', 'cadeia', "TEXT DEFAULT '{}'"],
  ['notas', 'origem', "TEXT DEFAULT 'app'"],
  ['contribuintes', 'ultimo_nsu', 'INTEGER DEFAULT 0'],
  ['contribuintes', 'sincronizado_em', 'TEXT'],
  ['procuracoes', 'sistemas', 'TEXT'],
  ['procuracoes', 'verificada_em', 'TEXT'],
  ['procuracoes', 'fonte_validade', "TEXT DEFAULT 'manual'"],
];

export function iniciarBanco(db) {
  db.exec(SCHEMA);
  db.exec(`CREATE TABLE IF NOT EXISTS configuracoes (
    usuario_id INTEGER NOT NULL, chave TEXT NOT NULL, valor TEXT, PRIMARY KEY (usuario_id, chave));
  CREATE INDEX IF NOT EXISTS ix_notas_dps ON notas(contribuinte_id, serie, ndps);
  CREATE INDEX IF NOT EXISTS ix_notas_chave ON notas(chave_acesso);`);
  for (const [tabela, coluna, def] of MIGRACOES) {
    const cols = db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
    if (!cols.includes(coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${def}`);
  }
  return db;
}

/** Adaptador para node:sqlite (DatabaseSync). */
export function adaptarNodeSqlite(raw) {
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    exec: sql => raw.exec(sql),
    prepare(sql) {
      const st = raw.prepare(sql);
      return {
        get: (...p) => st.get(...normaliza(p)),
        all: (...p) => st.all(...normaliza(p)),
        run: (...p) => { const r = st.run(...normaliza(p)); return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
      };
    },
  };
}

/** Adaptador para sql.js (SQLite compilado em WebAssembly). `aoAlterar` é chamado após cada escrita. */
export function adaptarSqlJs(raw, aoAlterar = () => {}) {
  raw.exec('PRAGMA foreign_keys = ON;');
  let emTx = 0;
  const linhas = (sql, p) => {
    const st = raw.prepare(sql);
    try {
      st.bind(normaliza(p));
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  };
  return {
    exec(sql) {
      raw.exec(sql);
      if (/^\s*BEGIN/i.test(sql)) emTx++;
      else if (/^\s*(COMMIT|ROLLBACK)/i.test(sql)) { emTx = Math.max(0, emTx - 1); if (!emTx) aoAlterar(); }
      else if (!emTx) aoAlterar();
    },
    prepare: sql => ({
      get: (...p) => linhas(sql, p)[0],
      all: (...p) => linhas(sql, p),
      run: (...p) => {
        raw.run(sql, normaliza(p));
        const id = raw.exec('SELECT last_insert_rowid() id')[0]?.values[0][0] ?? 0;
        const changes = raw.getRowsModified();
        if (!emTx) aoAlterar();
        return { lastInsertRowid: Number(id), changes };
      },
    }),
  };
}
