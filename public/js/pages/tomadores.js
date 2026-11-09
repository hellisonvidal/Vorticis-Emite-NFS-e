import { get, post, put, del } from '../api.js';
import { preencherPelaReceita, completarCadastros } from '../receita.js';
import { $, $$, esc, icon, modal, toast, confirmar, lerForm, preencherForm, campo, opts, mascaras, autocomplete, so, fmtDoc, moeda, vazio } from '../ui.js';
import { estado } from '../estado.js';

const nomeEmp = c => c ? (c.nome_fantasia || c.razao_social) : '';

export async function paginaTomadores(view) {
  const c = estado.contrib();
  if (!c) { view.innerHTML = vazio('Cadastre uma empresa emitente para cadastrar os clientes dela.', 'users'); return; }
  const outras = estado.contribs.filter(x => x.id !== c.id);
  view.innerHTML = `
  <div class="page-head"><div><h1>Tomadores / Clientes</h1><p>Clientes de <b>${esc(nomeEmp(c))}</b> — cada empresa emitente tem o seu cadastro (troque a empresa no topo da tela)</p></div>
    <div class="btns"><button class="btn" id="btnCompletar" title="Preenche endereço, contatos e inscrição municipal que estiverem vazios">${icon('refresh')}Completar pela Receita</button><button class="btn primary" id="btnNovo">${icon('plus')}Novo cliente</button></div></div>
  <div id="orfaos"></div>
  <div class="card"><div class="card-head"><input id="busca" placeholder="Buscar por nome, CNPJ/CPF ou e-mail…" style="max-width:420px"><span class="muted small" id="qtd"></span></div><div id="lista"></div></div>`;
  async function orfaos() {
    const sem = await get('/api/tomadores?contribuinte_id=sem');
    $('#orfaos').innerHTML = sem.length ? `<div class="alert warn" style="margin-bottom:14px">${icon('alert')}<div style="flex:1"><b>${sem.length} cliente(s) cadastrado(s) antes da separação por empresa</b> e sem notas emitidas. Eles não aparecem na emissão até serem vinculados a uma empresa.
      <div class="btns" style="margin-top:8px"><button class="btn sm" id="vincTodos">${icon('check')}Vincular todos a ${esc(nomeEmp(c))}</button><button class="btn sm ghost" id="verOrf">Ver lista</button></div><div id="listaOrf" class="hidden small" style="margin-top:8px">${sem.map(t => `${esc(t.nome)} (${fmtDoc(t.documento, t.tipo_doc)})`).join(' · ')}</div></div></div>` : '';
    if (!sem.length) return;
    $('#verOrf').onclick = () => $('#listaOrf').classList.toggle('hidden');
    $('#vincTodos').onclick = async () => {
      for (const t of sem) {
        const d = { ...t };
        for (const k of ['id', 'usuario_id', 'criado_em', 'municipio', 'empresa', 'empresa_fantasia', 'qtd_notas', 'total']) delete d[k];
        await put(`/api/tomadores/${t.id}`, { ...d, contribuinte_id: c.id });
      }
      toast(`${sem.length} cliente(s) vinculado(s) a ${nomeEmp(c)}.`, 'ok'); orfaos(); carregar();
    };
  }
  async function carregar() {
    const q = $('#busca').value.trim();
    const rows = await get(`/api/tomadores?contribuinte_id=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    $('#qtd').textContent = `${rows.length} cliente(s) de ${nomeEmp(c)}`;
    $('#lista').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Documento</th><th>Município</th><th>E-mail</th><th class="num">Notas</th><th class="num">Faturado</th><th></th></tr></thead><tbody>
      ${rows.map(t => `<tr><td><b>${esc(t.nome)}</b>${t.orgao_publico ? ' <span class="badge plain">órgão público</span>' : ''}${t.retem_federais ? ' <span class="badge plain">retém federais</span>' : ''}</td><td>${esc(t.tipo_doc)} ${fmtDoc(t.documento, t.tipo_doc)}</td><td>${esc(t.municipio)}</td><td>${esc(t.email || '')}</td>
      <td class="num">${t.qtd_notas}</td><td class="num">${moeda(t.total)}</td>
      <td class="nowrap"><button class="btn sm ghost" data-ed="${t.id}" title="Editar">${icon('edit')}</button><a class="btn sm ghost" title="Ver notas" href="#/notas?q=${encodeURIComponent(t.nome)}">${icon('receipt')}</a>${outras.length ? `<button class="btn sm ghost" data-cp="${t.id}" title="Copiar para outra empresa">${icon('copy')}</button>` : ''}<button class="btn sm ghost danger" data-del="${t.id}">${icon('trash')}</button></td></tr>`).join('')}
      </tbody></table></div>` : vazio(`Nenhum cliente cadastrado para ${esc(nomeEmp(c))}. Os clientes são salvos automaticamente ao emitir.`, 'users');
    $$('[data-ed]').forEach(b => b.onclick = () => formTomador(rows.find(t => t.id === +b.dataset.ed), carregar));
    $$('[data-cp]').forEach(b => b.onclick = async () => {
      const t = rows.find(x => x.id === +b.dataset.cp);
      const r = await modal({ titulo: 'Copiar cliente para outra empresa', corpo: `<p>Copiar <b>${esc(t.nome)}</b> para:</p>${outras.map(o => `<label class="check" style="display:flex;margin:6px 0"><input type="checkbox" value="${o.id}"> ${esc(nomeEmp(o))} — ${fmtDoc(o.documento)}</label>`).join('')}
        <p class="small muted">Cada empresa fica com o seu cadastro; alterações em uma não afetam a outra.</p>`,
        botoes: [{ texto: 'Cancelar', valor: null }, { texto: `${icon('copy')}Copiar`, cls: 'primary', acao: bg => [...bg.querySelectorAll('input:checked')].map(i => +i.value) }] });
      if (!r?.length) return;
      for (const id of r) await post('/api/tomadores/copiar', { ids: [t.id], contribuinte_id: id });
      toast(`Cliente copiado para ${r.length} empresa(s).`, 'ok');
    });
    $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmar('Excluir', 'Excluir este tomador? As notas emitidas não são afetadas.', 'Excluir', 'danger')) { await del(`/api/tomadores/${b.dataset.del}`); carregar(); } });
  }
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 250); };
  $('#btnNovo').onclick = () => formTomador(null, carregar);
  $('#btnCompletar').onclick = () => completarCadastros('tomadores', carregar);
  carregar(); orfaos();
}

export async function formTomador(t, depois) {
  const cid = t?.contribuinte_id || estado.contrib()?.id;
  const corpo = `<form id="fTom" class="grid g4" autocomplete="off">
    ${campo('Empresa emitente (dona do cadastro)', `<select name="contribuinte_id">${estado.contribs.map(o => `<option value="${o.id}" ${String(o.id) === String(cid) ? 'selected' : ''}>${esc(nomeEmp(o))} — ${fmtDoc(o.documento)}</option>`).join('')}</select>`, { cls: 'span4' })}
    ${campo('Tipo', `<select name="tipo_doc">${opts({ CNPJ: 'CNPJ', CPF: 'CPF', NIF: 'NIF (exterior)', SEM: 'Sem identificação' }, t?.tipo_doc || 'CNPJ')}</select>`)}
    ${campo('CNPJ / CPF', `<div class="input-group"><input name="documento" data-mask="doc" inputmode="numeric"><button type="button" class="btn sm" id="bCnpj" title="Buscar na Receita">${icon('search')}</button></div>`, { cls: 'span2' })}
    ${campo('Inscrição municipal', '<input name="im">')}
    ${campo('Nome / Razão social', '<input name="nome" required>', { cls: 'span4', req: true })}
    ${campo('E-mail', '<input type="email" name="email">', { cls: 'span2' })}${campo('Telefone', '<input name="fone" data-mask="fone" inputmode="tel">')}
    ${campo('CEP', '<input name="cep" data-mask="cep">')}${campo('Logradouro', '<input name="logradouro">', { cls: 'span2' })}${campo('Número', '<input name="numero">')}${campo('Complemento', '<input name="complemento">')}
    ${campo('Bairro', '<input name="bairro">')}${campo('Município', '<input id="mNome"><input type="hidden" name="cod_municipio">', { cls: 'span2' })}
    ${campo('País (exterior)', '<input name="pais" value="BR" maxlength="2">')}${campo('Cidade exterior', '<input name="cidade_ext">')}${campo('Estado/província', '<input name="estado_ext">')}${campo('Código postal', '<input name="cod_postal_ext">')}
    <div class="full btns"><label class="check"><input type="checkbox" name="retem_iss"> Retém ISS (substituto tributário)</label><label class="check"><input type="checkbox" name="retem_federais"> Retém tributos federais</label>
    <label class="check"><input type="checkbox" name="orgao_publico"> Órgão público</label><select name="tp_ente_gov" style="width:auto"><option value="">Ente…</option><option value="1">União</option><option value="2">Estado</option><option value="3">DF</option><option value="4">Município</option></select></div>
  </form>`;
  await modal({
    titulo: t ? 'Editar cliente' : 'Novo cliente', corpo, wide: true,
    botoes: [{ texto: 'Cancelar', valor: null }, { texto: `${icon('save')}Salvar`, cls: 'primary', acao: async bg => {
      const f = $('#fTom', bg);
      if (!f.reportValidity()) return false;
      const d = lerForm(f);
      t ? await put(`/api/tomadores/${t.id}`, d) : await post('/api/tomadores', d);
      toast('Cliente salvo.', 'ok'); depois?.();
    } }],
    onOpen: bg => {
      const f = $('#fTom', bg);
      mascaras(f);
      if (t) { preencherForm(f, { ...t, documento: fmtDoc(t.documento, t.tipo_doc) }); $('#mNome', bg).value = t.municipio || ''; }
      autocomplete($('#mNome', bg), { buscar: async q => (await get(`/api/tabelas/municipios?q=${encodeURIComponent(q)}`)).itens, render: m => `<b>${m.codigo}</b>${esc(m.nome)}/${m.uf}`, escolher: m => { f.cod_municipio.value = m.codigo; $('#mNome', bg).value = `${m.nome}/${m.uf}`; } });
      $('#bCnpj', bg).onclick = async () => {
        try {
          await preencherPelaReceita(f, f.documento.value, { campoMun: $('#mNome', bg), extra: () => ({}) });
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}
