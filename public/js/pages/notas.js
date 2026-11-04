import { get, post, del, baixarArquivo, imprimir } from '../api.js';
import { $, $$, esc, icon, moeda, pct, badge, dataBR, dataHoraBR, fmtDoc, fmtCTrib, fmtNBS, fmtChave, modal, toast, confirmar, vazio, STATUS, AMB, formatarXml, num } from '../ui.js';
import { estado } from '../estado.js';

const POR_PAG = 25;

export async function paginaNotas(view, params) {
  const c = estado.contrib();
  const f = { contribuinte_id: params.get('todas') ? '' : c?.id || '', status: params.get('status') || '', de: params.get('de') || '', ate: params.get('ate') || '', q: params.get('q') || '', ambiente: params.get('ambiente') || '' };
  let pagina = 0;
  view.innerHTML = `
  <div class="page-head"><div><h1>Notas emitidas</h1><p>Consulta de NFS-e, rascunhos e rejeições</p></div>
    <div class="btns"><button class="btn" id="btnCsv">${icon('download')}Exportar CSV</button><a class="btn primary" href="#/emitir">${icon('plus')}Nova NFS-e</a></div></div>
  <div class="card">
    <form id="fFiltro" class="grid g6" style="align-items:end">
      <label class="f span2"><span>Buscar</span><input name="q" value="${esc(f.q)}" placeholder="Nº, chave, tomador, descrição…"></label>
      <label class="f"><span>Situação</span><select name="status"><option value="">Todas</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f"><span>Competência de</span><input type="date" name="de" value="${f.de}"></label>
      <label class="f"><span>até</span><input type="date" name="ate" value="${f.ate}"></label>
      <label class="f"><span>Empresa</span><select name="contribuinte_id"><option value="">Todas</option>${estado.contribs.map(x => `<option value="${x.id}" ${String(f.contribuinte_id) === String(x.id) ? 'selected' : ''}>${esc(x.nome_fantasia || x.razao_social)}</option>`).join('')}</select></label>
      <label class="f"><span>Tomador</span><input name="tomador" placeholder="Nome ou CNPJ/CPF"></label>
      <label class="f"><span>cTribNac</span><input name="ctribnac" placeholder="010101"></label>
      <label class="f"><span>Ambiente</span><select name="ambiente"><option value="">Todos</option>${Object.entries(AMB).map(([k, v]) => `<option value="${k}" ${f.ambiente === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="btns span3"><button class="btn primary">${icon('search')}Filtrar</button><button type="button" class="btn ghost" id="btnLimpar">Limpar</button></div>
    </form>
  </div>
  <div class="card"><div id="lista"></div><div class="pager"><span class="muted small" id="info"></span><div class="btns"><button class="btn sm" id="ant">‹ Anterior</button><button class="btn sm" id="prox">Próxima ›</button></div></div></div>`;

  const filtros = () => Object.fromEntries(Object.entries(Object.fromEntries(new FormData($('#fFiltro')))).filter(([, v]) => v));
  async function carregar() {
    const qs = new URLSearchParams({ ...filtros(), limite: POR_PAG, offset: pagina * POR_PAG });
    const r = await get(`/api/notas?${qs}`);
    $('#info').textContent = `${r.total} registro(s) · página ${pagina + 1} de ${Math.max(1, Math.ceil(r.total / POR_PAG))}`;
    $('#ant').disabled = pagina === 0;
    $('#prox').disabled = (pagina + 1) * POR_PAG >= r.total;
    const tot = r.itens.reduce((a, n) => ({ v: a.v + n.valor_servico, iss: a.iss + n.valor_iss, liq: a.liq + n.valor_liquido }), { v: 0, iss: 0, liq: 0 });
    $('#lista').innerHTML = r.itens.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Situação</th><th>Nº NFS-e / DPS</th><th>Competência</th><th>Tomador</th><th>Serviço</th><th class="num">Valor</th><th class="num">ISS</th><th class="num">Líquido</th><th></th></tr></thead>
      <tbody>${r.itens.map(n => `<tr class="clickable" data-id="${n.id}">
        <td>${badge(n.status)}${n.ambiente !== 'producao' ? `<div style="margin-top:4px">${badge(n.ambiente, AMB)}</div>` : ''}</td>
        <td><b>${esc(n.nnfse || '—')}</b><div class="small muted">DPS ${esc(n.serie || '')}/${esc(n.ndps || '—')}</div></td>
        <td>${dataBR(n.competencia || n.criado_em)}</td>
        <td><div>${esc(n.tomador_nome || 'Sem tomador')}</div><div class="small muted">${fmtDoc(n.tomador_doc)}</div></td>
        <td><code>${fmtCTrib(n.ctribnac)}</code><div class="small muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.descricao || '')}</div></td>
        <td class="num">${moeda(n.valor_servico)}</td><td class="num">${moeda(n.valor_iss)}${n.iss_retido ? '<div class="small muted">retido</div>' : ''}</td><td class="num">${moeda(n.valor_liquido)}</td>
        <td class="nowrap">${n.status === 'autorizada' || n.status === 'cancelada' || n.status === 'substituida' ? `<button class="btn sm ghost" data-copy="${n.id}" title="Copiar nota">${icon('copy')}</button>` : `<button class="btn sm ghost" data-edit="${n.id}" title="Continuar">${icon('edit')}</button>`}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="5">Total da página</td><td class="num">${moeda(tot.v)}</td><td class="num">${moeda(tot.iss)}</td><td class="num">${moeda(tot.liq)}</td><td></td></tr></tfoot></table></div>`
      : vazio('Nenhuma nota encontrada com esses filtros.', 'receipt');
    $$('[data-id]').forEach(tr => tr.onclick = e => { if (!e.target.closest('button')) detalheNota(tr.dataset.id, carregar); });
    $$('[data-copy]').forEach(b => b.onclick = () => { location.hash = `#/emitir?copiar=${b.dataset.copy}`; });
    $$('[data-edit]').forEach(b => b.onclick = () => { location.hash = `#/emitir?rascunho=${b.dataset.edit}`; });
  }
  $('#fFiltro').onsubmit = e => { e.preventDefault(); pagina = 0; carregar(); };
  $('#btnLimpar').onclick = () => { $('#fFiltro').reset(); $$('#fFiltro input').forEach(i => { i.value = ''; }); pagina = 0; carregar(); };
  $('#ant').onclick = () => { pagina--; carregar(); };
  $('#prox').onclick = () => { pagina++; carregar(); };
  $('#btnCsv').onclick = () => baixarArquivo(`/api/relatorios/notas.csv?${new URLSearchParams(filtros())}`, 'notas-nfse.csv').catch(e => toast(e.message, 'error'));
  await carregar();
  if (params.get('id')) detalheNota(params.get('id'), carregar);
}

export async function detalheNota(id, recarregar) {
  const n = await get(`/api/notas/${id}`);
  const d = n.dados || {};
  const k = d.calc || {};
  const t = d.tomador || {};
  const fm = d.form || {};
  const linha = (l, v) => `<div><div class="muted small">${l}</div><div>${v || '—'}</div></div>`;
  const msgs = (n.mensagens || []).length ? `<div class="alert ${n.status === 'rejeitada' ? 'error' : 'info'}" style="margin-bottom:14px">${icon(n.status === 'rejeitada' ? 'alert' : 'info')}<ul style="margin:0">${n.mensagens.map(m => `<li><b>${esc(m.codigo || '')}</b> ${esc(m.descricao || '')}${m.complemento ? ` <span class="small">(${esc(m.complemento)})</span>` : ''}</li>`).join('')}</ul></div>` : '';
  const autorizada = n.status === 'autorizada';
  const corpo = `
    ${msgs}
    <div class="tabs"><button class="active" data-tab="resumo">Resumo</button><button data-tab="espelho">Espelho / impressão</button><button data-tab="xml">XML</button><button data-tab="eventos">Eventos (${n.eventos.length})</button></div>
    <div data-pane="resumo">
      <div class="grid g4">
        ${linha('Situação', badge(n.status) + ' ' + badge(n.ambiente, AMB))}${linha('Número NFS-e', `<b>${esc(n.nnfse || '—')}</b>`)}${linha('DPS', `${esc(n.serie)}/${esc(n.ndps || '—')}`)}${linha('Competência', dataBR(n.competencia))}
        ${linha('Chave de acesso', `<code>${esc(fmtChave(n.chave_acesso))}</code>`).replace('<div>', '<div class="span4">')}
        ${linha('Prestador', `${esc(n.contribuinte.razao_social)}<div class="small muted">${fmtDoc(n.contribuinte.documento)}</div>`)}
        ${linha('Tomador', `${esc(n.tomador_nome || 'Não identificado')}<div class="small muted">${fmtDoc(n.tomador_doc)}</div>`)}
        ${linha('Emitida via', n.emitido_via === 'procuracao' ? 'Procuração eletrônica' : n.emitido_via === 'certificado' ? 'Certificado do emitente' : 'Simulação')}
        ${linha('Processamento', dataHoraBR(n.dh_proc || n.criado_em))}
        ${linha('Serviço', `<code>${fmtCTrib(n.ctribnac)}</code> ${n.cnbs ? `· NBS <code>${fmtNBS(n.cnbs)}</code>` : ''}`)}
        <div class="span3">${linha('Descrição', esc(n.descricao))}</div>
      </div>
      <div class="table-wrap" style="margin-top:16px"><table><tbody>
        <tr><td>Valor do serviço</td><td class="num">${moeda(n.valor_servico)}</td><td>Base de cálculo ISS</td><td class="num">${moeda(n.base_calculo)}</td></tr>
        <tr><td>Desconto incondicionado</td><td class="num">${moeda(n.valor_desconto_incond)}</td><td>ISS ${n.aliq_iss ? pct(n.aliq_iss) : ''} ${n.iss_retido ? '(retido)' : ''}</td><td class="num">${moeda(n.valor_iss)}</td></tr>
        <tr><td>Deduções</td><td class="num">${moeda(n.valor_deducoes)}</td><td>PIS / COFINS</td><td class="num">${moeda(n.valor_pis)} / ${moeda(n.valor_cofins)}</td></tr>
        <tr><td>IRRF / CSLL / INSS</td><td class="num">${moeda(n.valor_irrf)} / ${moeda(n.valor_csll)} / ${moeda(n.valor_inss)}</td><td>CBS / IBS</td><td class="num">${moeda(n.valor_cbs)} / ${moeda(n.valor_ibs)}</td></tr>
        <tr><td><b>Total de retenções</b></td><td class="num"><b>${moeda(n.valor_retencoes)}</b></td><td><b>Valor líquido</b></td><td class="num"><b>${moeda(n.valor_liquido)}</b></td></tr>
      </tbody></table></div>
      ${k.ibscbs ? `<div class="small muted" style="margin-top:8px">IBS/CBS: cIndOp ${esc(k.ibscbs.cIndOp)} · cClassTrib ${esc(k.ibscbs.cClassTrib)} (CST ${esc(k.ibscbs.cst)}) · base ${moeda(k.ibscbs.vBC)} · CBS ${num(k.ibscbs.pCBS)}% · IBS ${num(k.ibscbs.pIBSUF + k.ibscbs.pIBSMun)}%</div>` : ''}
    </div>
    <div data-pane="espelho" class="hidden"><div class="print-area">${espelho(n, t, fm, k)}</div></div>
    <div data-pane="xml" class="hidden"><div class="btns" style="margin-bottom:10px"><button class="btn sm" data-dl="dps">${icon('download')}XML da DPS</button>${n.xml_nfse ? `<button class="btn sm" data-dl="nfse">${icon('download')}XML da NFS-e</button>` : ''}</div><pre class="xml">${esc(formatarXml(n.xml_nfse || n.xml_dps || '(sem XML)'))}</pre></div>
    <div data-pane="eventos" class="hidden">${n.eventos.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Status</th></tr></thead><tbody>${n.eventos.map(e => `<tr><td>${dataHoraBR(e.criado_em)}</td><td><code>${esc(e.tipo)}</code></td><td>${esc(e.descricao)}</td><td>${esc(e.status)}</td></tr>`).join('')}</tbody></table></div>` : vazio('Nenhum evento registrado.', 'list')}</div>`;

  const botoes = [
    ...(['rascunho', 'rejeitada'].includes(n.status) ? [
      { texto: `${icon('trash')}Excluir`, cls: 'danger', acao: async () => { if (!await confirmar('Excluir', 'Excluir este registro?', 'Excluir', 'danger')) return false; await del(`/api/notas/${n.id}`); recarregar?.(); toast('Excluído.'); } },
      { texto: `${icon('edit')}Corrigir e reenviar`, cls: 'primary', acao: () => { location.hash = `#/emitir?rascunho=${n.id}`; } },
    ] : []),
    ...(autorizada ? [
      { texto: `${icon('ban')}Cancelar`, cls: 'danger', acao: () => cancelar(n, recarregar) },
      { texto: `${icon('refresh')}Substituir`, acao: () => { location.hash = `#/emitir?copiar=${n.id}&subst=${n.chave_acesso}`; } },
    ] : []),
    ...(n.ambiente !== 'simulacao' && n.status !== 'rascunho' ? [{ texto: `${icon('refresh')}Consultar Sefin`, acao: async () => { const r = await post(`/api/notas/${n.id}/sincronizar`); toast(`Situação na Sefin: ${r.status}`, 'ok'); recarregar?.(); } }] : []),
    ...(n.chave_acesso ? [{ texto: `${icon('printer')}${n.ambiente === 'simulacao' ? 'Imprimir espelho' : 'DANFSe'}`, acao: async () => {
      if (n.ambiente === 'simulacao') { $$('[data-tab]').find(b => b.dataset.tab === 'espelho')?.click(); setTimeout(() => imprimir(document.querySelector('.modal .print-area').innerHTML, `NFS-e ${n.nnfse || ''}`), 100); return false; }
      await baixarArquivo(`/api/notas/${n.id}/danfse`); return false;
    } }] : []),
    ...(n.status !== 'rascunho' ? [{ texto: `${icon('copy')}Copiar nota`, cls: 'primary', acao: () => { location.hash = `#/emitir?copiar=${n.id}`; } }] : []),
  ];
  await modal({
    titulo: `NFS-e ${n.nnfse ? `nº ${esc(n.nnfse)}` : `DPS ${esc(n.ndps || n.id)}`}`, corpo, wide: true, botoes,
    onOpen: bg => {
      $$('[data-tab]', bg).forEach(b => b.onclick = () => {
        $$('[data-tab]', bg).forEach(x => x.classList.toggle('active', x === b));
        $$('[data-pane]', bg).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
      });
      $$('[data-dl]', bg).forEach(b => b.onclick = () => baixarArquivo(`/api/notas/${n.id}/xml?tipo=${b.dataset.dl}`).catch(e => toast(e.message, 'error')));
    },
  });
}

async function cancelar(n, recarregar) {
  const ok = await modal({
    titulo: 'Cancelar NFS-e', corpo: `<p>Cancelamento da NFS-e <b>${esc(n.nnfse || '')}</b> de ${moeda(n.valor_servico)} para ${esc(n.tomador_nome || '—')}.</p>
      <div class="grid"><label class="f"><span>Motivo</span><select id="cMot"><option value="1">1 - Erro na emissão</option><option value="2">2 - Serviço não prestado</option><option value="9">9 - Outros</option></select></label>
      <label class="f"><span>Justificativa (mín. 15 caracteres)</span><textarea id="cJust" maxlength="255"></textarea></label>
      <div class="alert warn small">${icon('alert')}<div>Prazos e regras de cancelamento seguem a parametrização do município. Após o prazo, pode ser necessário solicitar análise fiscal ou substituir a nota.</div></div></div>`,
    botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Confirmar cancelamento', cls: 'danger', acao: async bg => {
      await post(`/api/notas/${n.id}/cancelar`, { motivo: $('#cMot', bg).value, justificativa: $('#cJust', bg).value });
      return true;
    } }],
  });
  if (ok) { toast('NFS-e cancelada.', 'ok'); recarregar?.(); document.querySelector('.modal-bg')?.remove(); }
}

function espelho(n, t, f, k) {
  const c = n.contribuinte;
  const v = (l, x) => `<div><small>${l}</small>${x || '—'}</div>`;
  return `<div class="danfse">
    <div class="h"><div><b style="font-size:14px">DANFSe — Documento Auxiliar da NFS-e</b><div>Padrão Nacional · Leiaute 1.01</div></div><div style="text-align:right"><div>Nº <b style="font-size:16px">${esc(n.nnfse || '—')}</b></div><div>Competência ${dataBR(n.competencia)}</div></div></div>
    ${n.ambiente !== 'producao' ? `<div class="sim">${n.ambiente === 'simulacao' ? 'SIMULAÇÃO — DOCUMENTO SEM VALOR FISCAL' : 'PRODUÇÃO RESTRITA — SEM VALOR FISCAL'}</div>` : ''}
    ${n.status === 'cancelada' ? '<div class="sim">NFS-e CANCELADA</div>' : ''}
    <div class="sec"><h4>Chave de acesso</h4><div class="mono">${esc(fmtChave(n.chave_acesso))}</div></div>
    <div class="sec"><h4>Prestador</h4><div class="cols">${v('CNPJ/CPF', fmtDoc(c.documento))}${v('Inscrição municipal', esc(c.im))}${v('Nome/Razão social', esc(c.razao_social)).replace('<div>', '<div style="grid-column:span 2">')}${v('Município', esc(c.municipio))}${v('E-mail', esc(c.email))}${v('Regime', esc(c.regime_label))}</div></div>
    <div class="sec"><h4>Tomador</h4><div class="cols">${v('CNPJ/CPF', fmtDoc(t.documento))}${v('Nome/Razão social', esc(t.nome)).replace('<div>', '<div style="grid-column:span 2">')}${v('E-mail', esc(t.email))}${v('Endereço', esc([t.logradouro, t.numero, t.bairro].filter(Boolean).join(', '))).replace('<div>', '<div style="grid-column:span 3">')}${v('CEP', esc(t.cep))}</div></div>
    <div class="sec"><h4>Serviço</h4><div class="cols">${v('Cód. tributação nacional', fmtCTrib(n.ctribnac))}${v('Cód. tributação municipal', esc(f.ctribmun))}${v('NBS', fmtNBS(n.cnbs))}${v('Local da prestação', esc(f.local_prestacao))}</div><div style="margin-top:6px;white-space:pre-wrap">${esc(n.descricao)}</div></div>
    <div class="sec"><h4>Valores</h4><div class="cols">${v('Valor do serviço', moeda(n.valor_servico))}${v('Desconto incond.', moeda(n.valor_desconto_incond))}${v('Deduções', moeda(n.valor_deducoes))}${v('Base de cálculo', moeda(n.base_calculo))}
      ${v('Alíquota ISS', n.aliq_iss ? pct(n.aliq_iss) : '—')}${v(`ISSQN ${n.iss_retido ? 'retido' : ''}`, moeda(n.valor_iss))}${v('PIS / COFINS', `${moeda(n.valor_pis)} / ${moeda(n.valor_cofins)}`)}${v('IRRF / CSLL / CP', `${moeda(n.valor_irrf)} / ${moeda(n.valor_csll)} / ${moeda(n.valor_inss)}`)}
      ${k.ibscbs ? v('CBS', moeda(n.valor_cbs)) + v('IBS', moeda(n.valor_ibs)) + v('cClassTrib / cIndOp', `${esc(k.ibscbs.cClassTrib)} / ${esc(k.ibscbs.cIndOp)}`) : ''}${v('Total retenções', moeda(n.valor_retencoes))}${v('<b>Valor líquido</b>', `<b>${moeda(n.valor_liquido)}</b>`)}</div></div>
    ${f.info_compl ? `<div class="sec"><h4>Informações complementares</h4>${esc(f.info_compl)}</div>` : ''}
  </div>`;
}
