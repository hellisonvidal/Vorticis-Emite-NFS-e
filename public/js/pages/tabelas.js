import { get, post, del } from '../api.js';
import { $, $$, esc, icon, toast, fmtCTrib, fmtNBS, vazio, autocomplete, modal, num, confirmar } from '../ui.js';
import { estado } from '../estado.js';

const ABAS = {
  ctribnac: 'Tributação Nacional (LC 116)', nbs: 'NBS 2.0', correlacao: 'Correlação Item × NBS × IBS/CBS', municipal: 'Tributação Municipal',
  cclasstrib: 'cClassTrib (IBS/CBS)', indop: 'cIndOp (local da operação)', municipios: 'Municípios IBGE',
};
const LIM = 50;

export async function paginaTabelas(view, params) {
  const aba = params.get('aba') || 'ctribnac';
  const meta = await get('/api/tabelas/meta');
  view.innerHTML = `
  <div class="page-head"><div><h1>Consulta de códigos</h1><p>Tabelas oficiais do Sistema Nacional NFS-e: ${meta.totais.ctribnac} códigos de tributação nacional, ${meta.totais.nbs} códigos NBS e ${meta.totais.municipios} municípios</p></div></div>
  <div class="tabs">${Object.entries(ABAS).map(([k, v]) => `<button data-aba="${k}" class="${k === aba ? 'active' : ''}">${v}</button>`).join('')}</div>
  <div class="card"><div class="card-head"><input id="q" placeholder="Pesquisar por código ou palavra-chave…" style="max-width:520px" value="${esc(params.get('q') || '')}"><span class="muted small" id="tot"></span></div>
  <div id="extra"></div><div id="res"></div><div class="pager"><span></span><div class="btns"><button class="btn sm" id="ant">‹ Anterior</button><button class="btn sm" id="prox">Próxima ›</button></div></div></div>`;
  $$('[data-aba]').forEach(b => b.onclick = () => { location.hash = `#/tabelas?aba=${b.dataset.aba}`; });
  let off = 0;
  const q = () => encodeURIComponent($('#q').value.trim());
  const pag = (total) => { $('#tot').textContent = `${total} registro(s)`; $('#ant').disabled = off === 0; $('#prox').disabled = off + LIM >= total; };
  $('#ant').onclick = () => { off -= LIM; carregar(); };
  $('#prox').onclick = () => { off += LIM; carregar(); };
  let tm; $('#q').oninput = () => { clearTimeout(tm); tm = setTimeout(() => { off = 0; carregar(); }, 250); };

  const tabela = (cab, linhas) => linhas.length ? `<div class="table-wrap"><table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>` : vazio('Nada encontrado.', 'search');

  async function carregar() {
    if (aba === 'ctribnac') {
      const r = await get(`/api/tabelas/ctribnac?q=${q()}&hierarquia=${$('#q').value ? '' : '1'}&limite=${LIM}&offset=${off}`);
      pag(r.total);
      $('#res').innerHTML = tabela(['Código', 'Descrição', 'Incidência do ISSQN', ''], r.itens.map(i => i.nivel === 'item'
        ? `<tr style="background:var(--primary-soft)"><td><b>${i.item}</b></td><td colspan="3"><b>${esc(i.descricao)}</b></td></tr>`
        : i.nivel === 'subitem' ? `<tr><td class="muted">${i.subitem}</td><td colspan="3" class="muted">${esc(i.descricao)}</td></tr>`
        : `<tr><td><code>${fmtCTrib(i.codigo)}</code></td><td>${esc(i.descricao)}${i.grupoObrigatorio ? `<div class="small muted">Grupo obrigatório: ${esc(i.grupoObrigatorio)}</div>` : ''}</td><td class="small">${esc((i.incidencia || []).join(', '))}</td>
           <td class="nowrap"><button class="btn sm ghost" data-ver="${i.codigo}">NBS / IBS-CBS</button><a class="btn sm ghost" href="#/emitir" data-usar="${i.codigo}">Usar</a></td></tr>`));
      $$('[data-ver]').forEach(b => b.onclick = () => verCorrelacao(b.dataset.ver));
      $$('[data-usar]').forEach(b => b.onclick = e => { e.preventDefault(); salvarFavorito(b.dataset.usar); });
    } else if (aba === 'nbs') {
      const r = await get(`/api/tabelas/nbs?q=${q()}&hierarquia=1&limite=${LIM}&offset=${off}`);
      pag(r.total);
      $('#res').innerHTML = tabela(['Código NBS', 'Código DPS (cNBS)', 'Descrição'], r.itens.map(i => `<tr ${i.cNBS ? '' : 'style="background:var(--surface-2)"'}><td><code>${esc(i.codigo)}</code></td><td>${i.cNBS ? `<code>${i.cNBS}</code>` : '<span class="muted small">agrupador</span>'}</td><td>${i.cNBS ? '' : '<b>'}${esc(i.descricao)}${i.cNBS ? '' : '</b>'}</td></tr>`));
    } else if (aba === 'correlacao') {
      const r = await get(`/api/tabelas/correlacao?q=${q()}&limite=${LIM}&offset=${off}`);
      pag(r.total);
      $('#res').innerHTML = tabela(['Item LC 116', 'NBS', 'cIndOp', 'cClassTrib', 'Local de incidência IBS/CBS'], r.itens.map(i => `<tr><td><b>${esc(i.item)}</b><div class="small muted">${esc(i.descItem)}</div></td>
        <td><code>${esc(i.nbs)}</code><div class="small muted">${esc(i.descNbs)}</div></td><td>${i.indOp.map(x => `<code>${x}</code>`).join('<br>')}</td><td>${i.cClassTrib.map(x => `<code>${x}</code>`).join('<br>')}</td><td class="small">${esc(i.localIncidIBS)}</td></tr>`));
    } else if (aba === 'cclasstrib') {
      const r = await get(`/api/tabelas/cclasstrib?q=${q()}`);
      pag(r.total);
      $('#res').innerHTML = tabela(['cClassTrib', 'CST', 'Descrição', 'Redução alíquota'], r.itens.map(i => `<tr><td><code>${i.codigo}</code></td><td><code>${i.cst}</code><div class="small muted">${esc(i.descCst)}</div></td><td>${esc(i.nome)}</td><td class="num">${i.pRedAliq ? `${i.pRedAliq}%` : '—'}</td></tr>`));
      $('#extra').innerHTML = `<div class="alert info" style="margin-bottom:12px">${icon('info')}<div class="small">Alíquotas IBS/CBS por ano (editáveis na emissão): ${Object.entries(meta.aliqIbsCbs).map(([a, v]) => `<b>${a}</b>: CBS ${num(v.cbs)}% · IBS UF ${num(v.ibsUF)}% · IBS Mun ${num(v.ibsMun)}%`).join(' | ')}. Percentuais de redução são de referência (LC 214/2025) — confira antes de emitir.</div></div>`;
    } else if (aba === 'indop') {
      const r = await get(`/api/tabelas/indop?q=${q()}`);
      pag(r.total);
      $('#res').innerHTML = tabela(['cIndOp', 'Tipo de operação', 'Característica', 'Local do fornecimento', 'Base legal'], r.itens.map(i => `<tr><td><code>${i.codigo}</code>${i.nfse ? '' : '<div class="small muted">não NFS-e</div>'}</td><td>${esc(i.tipo)}</td><td class="small">${esc(i.caracteristica)}</td><td class="small">${esc(i.local)}</td><td class="small">${esc(i.legal)}</td></tr>`));
    } else if (aba === 'municipios') {
      const r = await get(`/api/tabelas/municipios?q=${q() || 'a'}&limite=${LIM}`);
      pag(r.total);
      $('#res').innerHTML = tabela(['Código IBGE', 'Município', 'UF'], r.itens.map(i => `<tr><td><code>${i.codigo}</code></td><td>${esc(i.nome)}</td><td>${i.uf}</td></tr>`));
    } else if (aba === 'municipal') await municipal();
  }

  async function municipal() {
    const c = estado.contrib();
    if (!$('#extra').innerHTML) {
      $('#extra').innerHTML = `<div class="grid g4" style="margin-bottom:14px;align-items:end">
        <label class="f"><span>Município</span><input id="mNome" value="${esc(c?.municipio || '')}"><input type="hidden" id="mCod" value="${c?.cod_municipio || ''}"></label>
        <label class="f"><span>cTribNac (6 dígitos)</span><input id="mTrib" placeholder="01.01.01" inputmode="numeric" maxlength="8"></label>
        <label class="f"><span>cTribMun (opcional)</span><input id="mMun" placeholder="000" inputmode="numeric" maxlength="3"></label>
        <label class="f"><span>Competência</span><input id="mComp" type="month" value="${new Date().toISOString().slice(0, 7)}"></label>
        <div class="btns full"><button class="btn" id="bSefin">${icon('refresh')}Alíquota do serviço</button><button class="btn" id="bHist">Histórico de alíquotas</button><button class="btn" id="bReg">Regimes especiais</button><button class="btn" id="bConv">Convênio do município</button><button class="btn primary" id="bAdd">${icon('plus')}Cadastrar código</button></div></div>
        <div class="alert info small" style="margin-bottom:12px">${icon('info')}<div>Os códigos de tributação municipal (3 dígitos) são definidos por cada município no Sistema Nacional. Consulte-os pela API de parâmetros municipais (exige certificado) ou cadastre-os manualmente para uso rápido na emissão.</div></div>`;
      autocomplete($('#mNome'), { buscar: async x => (await get(`/api/tabelas/municipios?q=${encodeURIComponent(x)}`)).itens, render: m => `<b>${m.codigo}</b>${esc(m.nome)}/${m.uf}`, escolher: m => { $('#mCod').value = m.codigo; $('#mNome').value = `${m.nome}/${m.uf}`; municipal(); } });
      const consultar = async (tipo, botao) => {
        if (!c) return toast('Selecione uma empresa.', 'error');
        const mun = $('#mCod').value, trib = $('#mTrib').value.replace(/\D/g, ''), cm = $('#mMun').value.replace(/\D/g, '');
        if (!/^\d{7}$/.test(mun)) { $('#mNome').focus(); return toast('Escolha o município na lista.', 'error'); }
        if (tipo !== 'convenio' && !/^\d{6}$/.test(trib)) { $('#mTrib').focus(); return toast('Informe o código de tributação nacional (cTribNac) com 6 dígitos, ex.: 01.01.01.', 'error'); }
        if (cm && !/^\d{3}$/.test(cm)) { $('#mMun').focus(); return toast('O código municipal tem 3 dígitos.', 'error'); }
        const txt = botao.innerHTML; botao.disabled = true; botao.innerHTML = `${icon('refresh')}Consultando…`;
        try {
          const r = await get(`/api/parametros-municipais?contribuinte_id=${c.id}&municipio=${mun}&servico=${trib}&ctribmun=${cm}&competencia=${$('#mComp').value}&tipo=${tipo}`);
          const tent = (r.tentativas || []).map(t => `<tr><td class="small"><code>${esc(t.url.replace(/^https:\/\/[^/]+/, ''))}</code></td><td class="num">${t.status || '—'}</td></tr>`).join('');
          modal({
            titulo: `Parâmetros municipais — ${esc(r.municipio?.nome || mun)}`, wide: true,
            corpo: (r.ok
              ? `<div class="alert ok small" style="margin-bottom:12px">${icon('check')}<div>Resposta da Sefin Nacional para a competência ${esc(r.competencia.slice(5, 7))}/${esc(r.competencia.slice(0, 4))}.</div></div>
                ${r.aliquotas?.length ? `<div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>Serviço</th><th class="num">Alíquota</th><th>Início</th><th>Fim</th></tr></thead><tbody>${r.aliquotas.map(a => `<tr><td><code>${esc(a.servico || '')}</code></td><td class="num">${num(a.aliquota)}%</td><td>${esc((a.inicio || '').slice(0, 10).split('-').reverse().join('/'))}</td><td>${esc((a.fim || '').slice(0, 10).split('-').reverse().join('/') || '—')}</td></tr>`).join('')}</tbody></table></div>` : ''}
                <details><summary class="small muted">Resposta completa</summary><pre class="xml">${esc(JSON.stringify(r.dados, null, 2))}</pre></details>`
              : `<div class="alert warn" style="margin-bottom:12px">${icon('alert')}<div>${esc(r.mensagem || `HTTP ${r.status}`)}</div></div>
                <p class="small muted">Sem parâmetros, a emissão continua possível: informe a alíquota do ISS manualmente ou cadastre o código municipal nesta tela.</p>`)
              + (tent ? `<details style="margin-top:10px"><summary class="small muted">Rotas consultadas</summary><div class="table-wrap"><table><thead><tr><th>Rota</th><th class="num">HTTP</th></tr></thead><tbody>${tent}</tbody></table></div></details>` : ''),
          });
          municipal();
        } catch (e) { toast(e.message, 'error'); } finally { botao.disabled = false; botao.innerHTML = txt; }
      };
      $('#bSefin').onclick = e => consultar('servico', e.currentTarget);
      $('#bHist').onclick = e => consultar('historico', e.currentTarget);
      $('#bReg').onclick = e => consultar('regimes', e.currentTarget);
      $('#bConv').onclick = e => consultar('convenio', e.currentTarget);
      $('#bAdd').onclick = () => modal({
        titulo: 'Cadastrar código de tributação municipal', corpo: `<div class="grid g2"><label class="f"><span>cTribNac (6 dígitos)</span><input id="aN" value="${$('#mTrib').value}"></label><label class="f"><span>cTribMun (3 dígitos)</span><input id="aM" maxlength="3"></label>
          <label class="f full"><span>Descrição</span><input id="aD"></label><label class="f"><span>Alíquota (%)</span><input id="aA" type="number" step="0.01"></label></div>`,
        botoes: [{ texto: 'Cancelar', valor: null }, { texto: 'Salvar', cls: 'primary', acao: async bg => { await post('/api/codigos-municipais', { cod_municipio: $('#mCod').value, ctribnac: $('#aN', bg).value, ctribmun: $('#aM', bg).value, descricao: $('#aD', bg).value, aliquota: $('#aA', bg).value }); municipal(); } }],
      });
    }
    const rows = await get(`/api/codigos-municipais?municipio=${$('#mCod').value}&q=${q()}`);
    pag(rows.length);
    $('#res').innerHTML = tabela(['Município', 'cTribNac', 'cTribMun', 'Descrição', 'Alíquota', 'Origem', ''], rows.map(r => `<tr><td>${esc(r.municipio)}</td><td><code>${fmtCTrib(r.ctribnac)}</code><div class="small muted">${esc(r.servico.slice(0, 60))}</div></td><td><code>${esc(r.ctribmun)}</code></td><td>${esc(r.descricao)}</td><td class="num">${r.aliquota != null ? `${num(r.aliquota)}%` : '—'}</td><td>${esc(r.origem)}</td><td><button class="btn sm ghost danger" data-d="${r.id}">${icon('trash')}</button></td></tr>`));
    $$('[data-d]').forEach(b => b.onclick = async () => { if (await confirmar('Excluir', 'Excluir este código?', 'Excluir', 'danger')) { await del(`/api/codigos-municipais/${b.dataset.d}`); municipal(); } });
  }

  async function verCorrelacao(cod) {
    const s = await get(`/api/tabelas/sugestoes/${cod}`);
    modal({
      titulo: `${fmtCTrib(cod)} — ${esc(s.servico?.descricao || '')}`, wide: true,
      corpo: s.correlacao.length ? `<div class="table-wrap"><table><thead><tr><th>NBS</th><th>cIndOp</th><th>cClassTrib</th><th>Atividade Simples Nacional</th><th>Local IBS/CBS</th></tr></thead><tbody>
        ${s.correlacao.map(r => `<tr><td><code>${fmtNBS(r.cNBS)}</code><div class="small">${esc(r.descNbs)}</div></td><td>${r.indOp.map(x => `<code>${x}</code>`).join('<br>')}</td><td>${r.cClassTribDet.map(x => `<code>${x.codigo}</code> <span class="small muted">${esc((x.nome || '').slice(0, 50))}</span>`).join('<br>')}</td><td class="small">${esc(r.ativSN)}</td><td class="small">${esc(r.localIncidIBS)}</td></tr>`).join('')}
        </tbody></table></div>` : vazio('Sem correlação na tabela oficial para este código.'),
    });
  }
  async function salvarFavorito(cod) {
    const s = await get(`/api/tabelas/sugestoes/${cod}`);
    const nome = s.servico?.descricao?.slice(0, 60) || cod;
    await post('/api/servicos', { nome, ctribnac: cod, cnbs: s.correlacao[0]?.cNBS || '', descricao: s.servico?.descricao || '', ind_op: s.correlacao[0]?.indOp[0] || '', cclasstrib: s.correlacao[0]?.cClassTrib[0] || '' });
    toast(`“${nome}” salvo como serviço favorito. Selecione-o em “Serviço favorito…” na emissão.`, 'ok');
  }
  carregar();
}
