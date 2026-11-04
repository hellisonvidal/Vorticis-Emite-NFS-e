import { get } from '../api.js';
import { $, esc, icon, moeda, num, mesBR, badge, dataBR, fmtCTrib, fmtDoc, vazio, AMB } from '../ui.js';
import { estado } from '../estado.js';

const charts = [];
const cor = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function paginaDashboard(view, params) {
  charts.splice(0).forEach(c => c.destroy());
  const c = estado.contrib();
  const escopo = params.get('escopo') || 'empresa';
  const amb = params.get('amb') || '';
  const q = new URLSearchParams();
  if (escopo === 'empresa' && c) q.set('contribuinte_id', c.id);
  if (amb) q.set('ambiente', amb);
  const d = await get(`/api/dashboard?${q}`);
  const var_ = (a, b) => { if (!b) return a ? '<span class="up">novo</span>' : '<span class="muted">—</span>'; const p = (a - b) / b * 100; return `<span class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${num(Math.abs(p), 1)}%</span> <span class="muted">vs mês anterior</span>`; };
  const ticket = d.mes.qtd ? d.mes.total / d.mes.qtd : 0;
  const alertas = [
    ...d.alertas.certs.map(x => `Certificado <b>${esc(x.apelido || x.titular)}</b> ${x.situacao === 'vencido' ? 'vencido' : `vence em ${x.dias_restantes} dia(s)`} (${dataBR(x.valido_ate)}).`),
    ...d.alertas.procsVenc.map(p => `Procuração de <b>${esc(p.razao_social)}</b> vence em ${dataBR(p.valida_ate)}.`),
  ];

  view.innerHTML = `
  <div class="page-head"><div><h1>Painel</h1><p>${escopo === 'empresa' && c ? esc(c.razao_social) : 'Todas as empresas'} · ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p></div>
    <div class="btns">
      <select id="escopo" style="width:auto"><option value="empresa">Empresa ativa</option><option value="todas" ${escopo === 'todas' ? 'selected' : ''}>Todas as empresas</option></select>
      <select id="amb" style="width:auto"><option value="">Todos os ambientes</option>${Object.entries(AMB).map(([k, v]) => `<option value="${k}" ${amb === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <a class="btn primary" href="#/emitir">${icon('plus')}Emitir NFS-e</a><a class="btn" href="#/emitir?ultima=1">${icon('copy')}Copiar última</a>
    </div></div>
  ${alertas.length ? `<div class="alert warn" style="margin-bottom:16px">${icon('alert')}<ul style="margin:0">${alertas.map(a => `<li class="t">${a}</li>`).join('')}</ul></div>` : ''}
  <div class="grid g4">
    ${kpi('Faturamento no mês', moeda(d.mes.total), var_(d.mes.total, d.mesAnterior.total), 'money')}
    ${kpi('Notas autorizadas', d.mes.qtd, var_(d.mes.qtd, d.mesAnterior.qtd), 'receipt')}
    ${kpi('ISS do mês', moeda(d.mes.iss), `<span class="muted">Retenções: ${moeda(d.mes.ret)}</span>`, 'building')}
    ${kpi('IBS + CBS destacados', moeda(d.mes.ibs + d.mes.cbs), `<span class="muted">CBS ${moeda(d.mes.cbs)} · IBS ${moeda(d.mes.ibs)}</span>`, 'shield')}
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card span2"><div class="card-head"><h2>Faturamento — últimos 12 meses</h2><span class="muted small">Ticket médio no mês: <b>${moeda(ticket)}</b></span></div><div class="chart-box"><canvas id="chMensal"></canvas></div></div>
    <div class="card"><div class="card-head"><h2>Situação das notas</h2></div><div class="chart-box" style="height:220px"><canvas id="chStatus"></canvas></div>
      ${d.limite ? limiteHtml(d.limite) : `<div class="small muted" style="margin-top:12px">Faturamento 12 meses: <b>${moeda(d.fat12)}</b> · Ano: <b>${moeda(d.anoAtual)}</b></div>`}</div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><div class="card-head"><h2>Principais tomadores</h2></div>${d.topTomadores.length ? `<div class="chart-box" style="height:260px"><canvas id="chTom"></canvas></div>` : vazio('Sem dados no período', 'users')}</div>
    <div class="card"><div class="card-head"><h2>Por serviço (cTribNac)</h2></div>${d.porServico.length ? `<div class="table-wrap"><table><tbody>${d.porServico.map(s => `<tr><td><code>${fmtCTrib(s.ctribnac)}</code><div class="small muted">${esc(s.descricao.slice(0, 60))}</div></td><td class="num">${moeda(s.total)}<div class="small muted">${s.qtd} nota(s)</div></td></tr>`).join('')}</tbody></table></div>` : vazio('Sem dados', 'list')}</div>
    <div class="card"><div class="card-head"><h2>Últimas notas</h2><a href="#/notas" class="small">Ver todas</a></div>${d.ultimas.length ? `<div class="table-wrap"><table><tbody>${d.ultimas.map(n => `<tr class="clickable" onclick="location.hash='#/notas?id=${n.id}'"><td><div style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550">${esc(n.tomador_nome || 'Sem tomador')}</div><div class="small muted">${n.nnfse ? `Nº ${esc(n.nnfse)}` : '—'} · ${dataBR(n.competencia || n.criado_em)}</div></td><td class="num">${moeda(n.valor_servico)}<div>${badge(n.status)}</div></td></tr>`).join('')}</tbody></table></div>` : vazio('Nenhuma nota emitida ainda', 'receipt')}</div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-head"><h2>Tributos por mês</h2></div><div class="chart-box" style="height:240px"><canvas id="chTrib"></canvas></div></div>`;

  $('#escopo').onchange = e => { location.hash = `#/dashboard?escopo=${e.target.value}&amb=${amb}`; };
  $('#amb').onchange = e => { location.hash = `#/dashboard?escopo=${escopo}&amb=${e.target.value}`; };
  if (!window.Chart) return;

  // série de 12 meses completa
  const meses = [];
  const h = new Date();
  for (let i = 11; i >= 0; i--) { const m = new Date(h.getFullYear(), h.getMonth() - i, 15); meses.push(m.toISOString().slice(0, 7)); }
  const porMes = Object.fromEntries(d.mensal.map(m => [m.mes, m]));
  const serie = k => meses.map(m => +(porMes[m]?.[k] || 0).toFixed(2));
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = cor('--muted');
  Chart.defaults.borderColor = cor('--border');
  const fmt = v => moeda(v);
  const prim = cor('--primary');
  charts.push(new Chart($('#chMensal'), {
    type: 'bar',
    data: { labels: meses.map(mesBR), datasets: [
      { label: 'Faturamento', data: serie('total'), backgroundColor: prim + 'cc', borderRadius: 8, maxBarThickness: 36, order: 2 },
      { label: 'Qtd. notas', data: serie('qtd'), type: 'line', yAxisID: 'y1', borderColor: '#22d3ee', backgroundColor: '#22d3ee', tension: .35, pointRadius: 3, order: 1 },
    ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: x => x.dataset.yAxisID === 'y1' ? `${x.raw} nota(s)` : fmt(x.raw) } } },
      scales: { y: { ticks: { callback: v => v >= 1000 ? `${v / 1000}k` : v }, grid: { color: cor('--border') } }, y1: { position: 'right', grid: { display: false }, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  }));
  const ST = { autorizada: ['Autorizadas', '#10b981'], cancelada: ['Canceladas', '#ef4444'], rejeitada: ['Rejeitadas', '#f97316'], rascunho: ['Rascunhos', '#eab308'], substituida: ['Substituídas', '#0ea5e9'] };
  charts.push(new Chart($('#chStatus'), {
    type: 'doughnut',
    data: { labels: d.porStatus.map(s => ST[s.status]?.[0] || s.status), datasets: [{ data: d.porStatus.map(s => s.qtd), backgroundColor: d.porStatus.map(s => ST[s.status]?.[1] || '#94a3b8'), borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right' } } },
  }));
  if (d.topTomadores.length) charts.push(new Chart($('#chTom'), {
    type: 'bar',
    data: { labels: d.topTomadores.map(t => (t.nome || 'Sem tomador').slice(0, 22)), datasets: [{ data: d.topTomadores.map(t => t.total), backgroundColor: '#22d3eecc', borderRadius: 6 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => fmt(x.raw), afterLabel: x => fmtDoc(d.topTomadores[x.dataIndex].doc) } } }, scales: { x: { ticks: { callback: v => v >= 1000 ? `${v / 1000}k` : v } }, y: { grid: { display: false } } } },
  }));
  charts.push(new Chart($('#chTrib'), {
    type: 'line',
    data: { labels: meses.map(mesBR), datasets: [
      { label: 'ISS', data: serie('iss'), borderColor: prim, backgroundColor: prim + '22', fill: true, tension: .35 },
      { label: 'Retenções', data: serie('ret'), borderColor: '#f59e0b', tension: .35 },
      { label: 'IBS + CBS', data: serie('ibscbs'), borderColor: '#10b981', tension: .35 },
    ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${fmt(x.raw)}` } } }, scales: { x: { grid: { display: false } } } },
  }));
}

function kpi(lbl, val, delta, ic) {
  return `<div class="card kpi"><div class="ico">${icon(ic)}</div><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="delta">${delta}</div></div>`;
}
function limiteHtml(l) {
  const p = Math.min(l.usado / l.valor * 100, 100);
  return `<div style="margin-top:14px"><div class="card-head" style="margin-bottom:6px"><b>Limite ${esc(l.tipo)}</b><span class="small">${num(p, 1)}%</span></div>
    <div class="progress ${p > 80 ? 'warn' : ''}"><div style="width:${p}%"></div></div>
    <div class="small muted" style="margin-top:6px">${moeda(l.usado)} de ${moeda(l.valor)}${l.sublimite ? ` · sublimite ISS/ICMS ${moeda(l.sublimite)}${l.usado > l.sublimite ? ' <b class="down">ultrapassado</b>' : ''}` : ''}</div></div>`;
}
