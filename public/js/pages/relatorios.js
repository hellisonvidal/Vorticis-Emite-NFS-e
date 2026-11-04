import { get, baixarArquivo, imprimir, entregarArquivo } from '../api.js';
import { $, esc, icon, moeda, mesBR, toast, vazio, STATUS, hoje, fmtDoc } from '../ui.js';
import { estado } from '../estado.js';

const AGRUP = { mes: 'Mês de competência', tomador: 'Tomador', servico: 'Serviço (cTribNac)', empresa: 'Empresa emitente', status: 'Situação' };

export async function paginaRelatorios(view) {
  const c = estado.contrib();
  const ini = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  view.innerHTML = `
  <div class="page-head"><div><h1>Relatórios</h1><p>Apuração de ISS, retenções federais e IBS/CBS por período</p></div>
    <div class="btns"><button class="btn" id="bPrint">${icon('printer')}Imprimir</button><button class="btn" id="bCsv">${icon('download')}Notas detalhadas (CSV)</button><button class="btn" id="bCsvRes">${icon('download')}Resumo (CSV)</button></div></div>
  <div class="card"><form id="fRel" class="grid g6" style="align-items:end">
    <label class="f"><span>De</span><input type="date" name="de" value="${ini}"></label>
    <label class="f"><span>Até</span><input type="date" name="ate" value="${hoje()}"></label>
    <label class="f span2"><span>Empresa</span><select name="contribuinte_id"><option value="">Todas</option>${estado.contribs.map(x => `<option value="${x.id}" ${x.id === c?.id ? 'selected' : ''}>${esc(x.razao_social)} — ${fmtDoc(x.documento)}</option>`).join('')}</select></label>
    <label class="f"><span>Situação</span><select name="status"><option value="autorizada">Autorizadas</option><option value="">Todas</option>${Object.entries(STATUS).filter(([k]) => k !== 'autorizada').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="f"><span>Agrupar por</span><select name="agrupar">${Object.entries(AGRUP).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="f"><span>Ambiente</span><select name="ambiente"><option value="">Todos</option><option value="producao">Produção</option><option value="homologacao">Produção restrita</option><option value="simulacao">Simulação</option></select></label>
    <label class="f span2"><span>Tomador</span><input name="tomador" placeholder="Nome ou documento"></label>
    <div class="btns"><button class="btn primary">${icon('chart')}Gerar</button></div>
  </form></div>
  <div class="card print-area" id="out"></div>`;
  const filtros = () => Object.fromEntries([...new FormData($('#fRel'))].filter(([, v]) => v));
  let ultimo = [];
  async function gerar() {
    const f = filtros();
    const rows = await get(`/api/relatorios/resumo?${new URLSearchParams(f)}`);
    ultimo = rows;
    const T = rows.reduce((a, r) => { for (const k of Object.keys(r)) if (typeof r[k] === 'number') a[k] = (a[k] || 0) + r[k]; return a; }, {});
    const nome = g => f.agrupar === 'mes' || !f.agrupar ? mesBR(g) : f.agrupar === 'status' ? (STATUS[g] || g) : (g || '—');
    const col = ['qtd', 'servico', 'bc', 'iss', 'iss_retido', 'pis', 'cofins', 'irrf', 'csll', 'inss', 'retencoes', 'liquido', 'cbs', 'ibs'];
    const cab = ['Qtd', 'Serviços', 'BC ISS', 'ISS', 'ISS retido', 'PIS', 'COFINS', 'IRRF', 'CSLL', 'INSS', 'Retenções', 'Líquido', 'CBS', 'IBS'];
    const v = (k, x) => k === 'qtd' ? (x || 0) : moeda(x);
    $('#out').innerHTML = `<div class="card-head"><h2>Resumo por ${AGRUP[f.agrupar || 'mes'].toLowerCase()}</h2><span class="muted small">${f.de ? new Date(f.de + 'T12:00').toLocaleDateString('pt-BR') : ''} a ${f.ate ? new Date(f.ate + 'T12:00').toLocaleDateString('pt-BR') : ''}</span></div>
      ${rows.length ? `<div class="grid g4" style="margin-bottom:16px">
        <div class="card kpi"><div class="lbl">Total de serviços</div><div class="val">${moeda(T.servico)}</div><div class="delta muted">${T.qtd} nota(s)</div></div>
        <div class="card kpi"><div class="lbl">ISS apurado</div><div class="val">${moeda(T.iss)}</div><div class="delta muted">A recolher pelo prestador: ${moeda((T.iss || 0) - (T.iss_retido || 0))}</div></div>
        <div class="card kpi"><div class="lbl">Retenções sofridas</div><div class="val">${moeda(T.retencoes)}</div><div class="delta muted">IRRF ${moeda(T.irrf)} · CSRF ${moeda((T.pis || 0) + (T.cofins || 0) + (T.csll || 0))}</div></div>
        <div class="card kpi"><div class="lbl">IBS + CBS</div><div class="val">${moeda((T.ibs || 0) + (T.cbs || 0))}</div><div class="delta muted">CBS ${moeda(T.cbs)} · IBS ${moeda(T.ibs)}</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>${AGRUP[f.agrupar || 'mes']}</th>${cab.map(x => `<th class="num">${x}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(nome(r.grupo))}</td>${col.map(k => `<td class="num">${v(k, r[k])}</td>`).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td>${col.map(k => `<td class="num">${v(k, T[k])}</td>`).join('')}</tr></tfoot></table></div>` : vazio('Nenhuma nota no período/filtro selecionado.', 'chart')}`;
  }
  $('#fRel').onsubmit = e => { e.preventDefault(); gerar().catch(er => toast(er.message, 'error')); };
  $('#bPrint').onclick = () => imprimir($('#out').innerHTML, 'Relatório NFS-e');
  $('#bCsv').onclick = () => baixarArquivo(`/api/relatorios/notas.csv?${new URLSearchParams(filtros())}`, 'notas-nfse.csv').catch(e => toast(e.message, 'error'));
  $('#bCsvRes').onclick = () => {
    if (!ultimo.length) return toast('Gere o relatório primeiro.');
    const ks = Object.keys(ultimo[0]);
    const csv = '﻿' + ks.join(';') + '\n' + ultimo.map(r => ks.map(k => typeof r[k] === 'number' ? String(r[k]).replace('.', ',') : `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    entregarArquivo({ nome: 'resumo-nfse.csv', tipo: 'text/csv', dados: csv });
  };
  gerar();
}
