import { get, post, sessao } from './api.js';
import { $, $$, esc, icon, fmtDoc, badge, AMB, toast } from './ui.js';
import { estado } from './estado.js';
import { telaLogin } from './pages/login.js';
import { paginaDashboard } from './pages/dashboard.js';
import { paginaEmitir } from './pages/emitir.js';
import { paginaNotas } from './pages/notas.js';
import { paginaEmpresas } from './pages/empresas.js';
import { paginaTomadores } from './pages/tomadores.js';
import { paginaCertificados } from './pages/certificados.js';
import { paginaTabelas } from './pages/tabelas.js';
import { paginaRelatorios } from './pages/relatorios.js';
import { paginaConfig } from './pages/config.js';

const ROTAS = {
  dashboard: { titulo: 'Painel', icone: 'dash', fn: paginaDashboard, sec: 'Visão geral' },
  emitir: { titulo: 'Emitir NFS-e', icone: 'plus', fn: paginaEmitir, sec: 'Visão geral' },
  notas: { titulo: 'Notas emitidas', icone: 'receipt', fn: paginaNotas, sec: 'Visão geral' },
  relatorios: { titulo: 'Relatórios', icone: 'chart', fn: paginaRelatorios, sec: 'Visão geral' },
  empresas: { titulo: 'Empresas emitentes', icone: 'building', fn: paginaEmpresas, sec: 'Cadastros' },
  tomadores: { titulo: 'Tomadores / Clientes', icone: 'users', fn: paginaTomadores, sec: 'Cadastros' },
  certificados: { titulo: 'Certificados e procurações', icone: 'key', fn: paginaCertificados, sec: 'Cadastros' },
  tabelas: { titulo: 'Consulta de códigos', icone: 'search', fn: paginaTabelas, sec: 'Consultas' },
  config: { titulo: 'Configurações', icone: 'cog', fn: paginaConfig, sec: 'Consultas' },
};

function tema(t) {
  try { if (t) localStorage.setItem('vorticis.tema', t); } catch { /* ignore */ }
  let atual = t;
  try { atual = atual || localStorage.getItem('vorticis.tema'); } catch { /* ignore */ }
  document.documentElement.dataset.theme = atual || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
tema();

function layout() {
  const secs = {};
  for (const [k, r] of Object.entries(ROTAS)) (secs[r.sec] ||= []).push([k, r]);
  document.body.innerHTML = `<div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><img class="logo" src="/img/icone.svg" alt=""><div><b>Vorticis Emite NFS</b><span>NFS-e Padrão Nacional · IBS/CBS</span></div></div>
      ${Object.entries(secs).map(([s, rs]) => `<div class="nav-sec">${s}</div><nav class="nav">${rs.map(([k, r]) => `<a href="#/${k}" data-r="${k}">${icon(r.icone)}${r.titulo}</a>`).join('')}</nav>`).join('')}
      <div class="foot">Leiaute DPS v1.01 · Tabelas oficiais gov.br/nfse</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn ghost sm menu-btn" id="menuBtn">${icon('menu')}</button>
        <select id="selContrib" title="Empresa emitente ativa"></select>
        <span id="ambBadge"></span>
        <div class="grow"></div>
        <a class="btn primary sm btn-nova" href="#/emitir">${icon('plus')}<span>Nova NFS-e</span></a>
        <button class="btn ghost sm" id="temaBtn" title="Alternar tema">${icon('moon')}</button>
        <span class="small muted nowrap" id="userBox"></span>
        <button class="btn ghost sm" id="sairBtn" title="Sair">${icon('logout')}</button>
      </header>
      <main class="content" id="view"></main>
    </div>
  </div>`;
  $('#temaBtn').onclick = () => tema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#sairBtn').onclick = async () => { await post('/api/auth/logout').catch(() => {}); sessao.token = null; location.hash = '#/login'; iniciar(); };
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#selContrib').onchange = e => { estado.setContrib(e.target.value); atualizarTopo(); rota(); };
}

export async function carregarContribs() {
  estado.contribs = await get('/api/contribuintes');
  atualizarTopo();
}

function atualizarTopo() {
  const sel = $('#selContrib');
  if (!sel) return;
  const ativos = estado.contribs.filter(c => c.ativo);
  if (!ativos.find(c => String(c.id) === String(estado.contribId)) && ativos[0]) estado.setContrib(ativos[0].id);
  sel.innerHTML = ativos.length ? ativos.map(c => `<option value="${c.id}" ${String(c.id) === String(estado.contribId) ? 'selected' : ''}>${esc(c.nome_fantasia || c.razao_social)} — ${fmtDoc(c.documento)}</option>`).join('')
    : '<option value="">Nenhuma empresa cadastrada</option>';
  const c = estado.contrib();
  $('#ambBadge').innerHTML = c ? badge(c.ambiente, AMB) : '';
  $('#userBox').textContent = estado.usuario?.nome || '';
}

async function rota() {
  const nome = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard').split('/')[0];
  if (nome === 'login') return;
  const r = ROTAS[nome] || ROTAS.dashboard;
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.r === nome));
  $('#sidebar')?.classList.remove('open');
  if (!location.hash.includes('id=')) $$('.modal-bg').forEach(m => m.remove());
  document.title = `${r.titulo} · Vorticis Emite NFS`;
  const view = $('#view');
  view.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  try { await r.fn(view, new URLSearchParams(location.hash.split('?')[1] || '')); }
  catch (e) { view.innerHTML = `<div class="alert error">${icon('alert')}<div>${esc(e.message)}</div></div>`; console.error(e); }
}

export async function iniciar() {
  if (!sessao.token) return telaLogin(iniciar);
  try { estado.usuario = await get('/api/auth/me'); } catch { sessao.token = null; return telaLogin(iniciar); }
  layout();
  await carregarContribs().catch(e => toast(e.message, 'error'));
  if (!location.hash || location.hash === '#/login') location.hash = estado.contribs.length ? '#/dashboard' : '#/empresas?novo=1';
  rota();
}

window.addEventListener('hashchange', () => { if (sessao.token && $('#view')) rota(); });
iniciar();
