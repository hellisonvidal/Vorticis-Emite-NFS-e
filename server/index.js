// Vorticis Emite NFS - servidor local (usado pela versão Windows/Electron e pelo modo navegador).
import express from 'express';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { criarApi } from '../core/api.js';
import { adaptarNodeSqlite } from '../core/banco.js';
import { criarCofre, randomBytes, hex, unhex } from '../core/seguranca.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, '..');
const VERSAO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version;

// Transporte HTTPS com certificado de cliente (mTLS) para a Sefin/ADN; sem certificado para consultas públicas
function http({ url, method = 'GET', headers = {}, body, pfx, senha, timeout = 60000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? Buffer.from(body) : null;
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, timeout,
      ...(pfx ? { pfx: Buffer.from(pfx), passphrase: senha } : {}),
      headers: { 'User-Agent': `VorticisEmiteNFS/${VERSAO}`, ...headers, ...(data ? { 'Content-Length': data.length } : {}) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: new Uint8Array(Buffer.concat(chunks)) }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado na comunicação com o Sistema Nacional NFS-e.')));
    req.on('error', e => reject(new Error(`Falha de comunicação com ${u.hostname}: ${e.message}`)));
    if (data) req.write(data);
    req.end();
  });
}

function chaveMestra(dataDir) {
  if (process.env.NFSE_MASTER_KEY) return unhex(process.env.NFSE_MASTER_KEY.padEnd(64, '0').slice(0, 64));
  const f = path.join(dataDir, '.master.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, hex(randomBytes(32)), { mode: 0o600 });
  return unhex(fs.readFileSync(f, 'utf8').trim());
}

export function criarAplicacao({ dataDir = process.env.NFSE_DATA_DIR || path.resolve('data'), nome = 'servidor' } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const arquivoDb = path.join(dataDir, 'vorticis.db');
  const raw = new DatabaseSync(arquivoDb);
  const api = criarApi({
    nome, versao: VERSAO, db: adaptarNodeSqlite(raw), cofre: criarCofre(chaveMestra(dataDir)), http,
    exportarBanco: () => { raw.exec('PRAGMA wal_checkpoint(FULL)'); return new Uint8Array(fs.readFileSync(arquivoDb)); },
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '15mb' }));
  app.use(express.static(path.join(RAIZ, 'public')));
  app.use('/vendor/chart.js', express.static(path.join(RAIZ, 'node_modules', 'chart.js', 'dist')));
  app.use('/api', async (req, res) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
    const r = await api.handle({ method: req.method, path: '/api' + req.path, query: req.query, body: req.body, token });
    if (r.arquivo) {
      const { nome: n, tipo, dados, inline } = r.arquivo;
      res.setHeader('Content-Type', `${tipo}${tipo.startsWith('text') || tipo.includes('xml') ? '; charset=utf-8' : ''}`);
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${n}"`);
      return res.send(typeof dados === 'string' ? dados : Buffer.from(dados));
    }
    res.status(r.status).json(r.json);
  });
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(RAIZ, 'public', 'index.html')));
  return { app, api, fechar: () => raw.close() };
}

export function iniciarServidor({ porta = +process.env.PORT || 3000, host = process.env.HOST || '127.0.0.1', ...opts } = {}) {
  const { app, fechar } = criarAplicacao(opts);
  return new Promise((resolve, reject) => {
    const srv = app.listen(porta, host, () => resolve({ srv, porta: srv.address().port, fechar }));
    srv.on('error', reject);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { porta } = await iniciarServidor();
  console.log(`Vorticis Emite NFS rodando em http://localhost:${porta}`);
}
