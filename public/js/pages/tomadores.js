import { get, post, put, del } from '../api.js';
import { preencherPelaReceita, completarCadastros } from '../receita.js';
import { $, $$, esc, icon, modal, toast, confirmar, lerForm, preencherForm, campo, opts, mascaras, autocomplete, so, fmtDoc, moeda, vazio } from '../ui.js';

export async function paginaTomadores(view) {
  view.innerHTML = `
  <div class="page-head"><div><h1>Tomadores / Clientes</h1><p>Cadastro reutilizado nas emissões (atualizado automaticamente ao emitir)</p></div>
    <div class="btns"><button class="btn" id="btnCompletar" title="Preenche endereço, contatos e inscrição municipal que estiverem vazios">${icon('refresh')}Completar pela Receita</button><button class="btn primary" id="btnNovo">${icon('plus')}Novo tomador</button></div></div>
  <div class="card"><div class="card-head"><input id="busca" placeholder="Buscar por nome, CNPJ/CPF ou e-mail…" style="max-width:420px"><span class="muted small" id="qtd"></span></div><div id="lista"></div></div>`;
  async function carregar() {
    const q = $('#busca').value.trim();
    const rows = await get(`/api/tomadores${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    $('#qtd').textContent = `${rows.length} cadastro(s)`;
    $('#lista').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Documento</th><th>Município</th><th>E-mail</th><th class="num">Notas</th><th class="num">Faturado</th><th></th></tr></thead><tbody>
      ${rows.map(t => `<tr><td><b>${esc(t.nome)}</b>${t.orgao_publico ? ' <span class="badge plain">órgão público</span>' : ''}${t.retem_federais ? ' <span class="badge plain">retém federais</span>' : ''}</td><td>${esc(t.tipo_doc)} ${fmtDoc(t.documento, t.tipo_doc)}</td><td>${esc(t.municipio)}</td><td>${esc(t.email || '')}</td>
      <td class="num">${t.qtd_notas}</td><td class="num">${moeda(t.total)}</td>
      <td class="nowrap"><button class="btn sm ghost" data-ed="${t.id}" title="Editar">${icon('edit')}</button><a class="btn sm ghost" title="Ver notas" href="#/notas?todas=1&q=${encodeURIComponent(t.nome)}">${icon('receipt')}</a><button class="btn sm ghost danger" data-del="${t.id}">${icon('trash')}</button></td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhum tomador cadastrado.', 'users');
    $$('[data-ed]').forEach(b => b.onclick = () => formTomador(rows.find(t => t.id === +b.dataset.ed), carregar));
    $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmar('Excluir', 'Excluir este tomador? As notas emitidas não são afetadas.', 'Excluir', 'danger')) { await del(`/api/tomadores/${b.dataset.del}`); carregar(); } });
  }
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 250); };
  $('#btnNovo').onclick = () => formTomador(null, carregar);
  $('#btnCompletar').onclick = () => completarCadastros('tomadores', carregar);
  carregar();
}

export async function formTomador(t, depois) {
  const corpo = `<form id="fTom" class="grid g4" autocomplete="off">
    ${campo('Tipo', `<select name="tipo_doc">${opts({ CNPJ: 'CNPJ', CPF: 'CPF', NIF: 'NIF (exterior)', SEM: 'Sem identificação' }, t?.tipo_doc || 'CNPJ')}</select>`)}
    ${campo('Documento', `<div class="input-group"><input name="documento" data-mask="doc"><button type="button" class="btn sm" id="bCnpj">${icon('search')}</button></div>`)}
    ${campo('Nome / Razão social', '<input name="nome" required>', { cls: 'span2', req: true })}
    ${campo('Inscrição municipal', '<input name="im">')}${campo('E-mail', '<input type="email" name="email">')}${campo('Telefone', '<input name="fone" data-mask="fone" inputmode="tel">')}
    ${campo('CEP', '<input name="cep" data-mask="cep">')}${campo('Logradouro', '<input name="logradouro">', { cls: 'span2' })}${campo('Número', '<input name="numero">')}${campo('Complemento', '<input name="complemento">')}
    ${campo('Bairro', '<input name="bairro">')}${campo('Município', '<input id="mNome"><input type="hidden" name="cod_municipio">', { cls: 'span2' })}
    ${campo('País (exterior)', '<input name="pais" value="BR" maxlength="2">')}${campo('Cidade exterior', '<input name="cidade_ext">')}${campo('Estado/província', '<input name="estado_ext">')}${campo('Código postal', '<input name="cod_postal_ext">')}
    <div class="full btns"><label class="check"><input type="checkbox" name="retem_iss"> Retém ISS (substituto tributário)</label><label class="check"><input type="checkbox" name="retem_federais"> Retém tributos federais</label>
    <label class="check"><input type="checkbox" name="orgao_publico"> Órgão público</label><select name="tp_ente_gov" style="width:auto"><option value="">Ente…</option><option value="1">União</option><option value="2">Estado</option><option value="3">DF</option><option value="4">Município</option></select></div>
  </form>`;
  await modal({
    titulo: t ? 'Editar tomador' : 'Novo tomador', corpo, wide: true,
    botoes: [{ texto: 'Cancelar', valor: null }, { texto: `${icon('save')}Salvar`, cls: 'primary', acao: async bg => {
      const f = $('#fTom', bg);
      if (!f.reportValidity()) return false;
      const d = lerForm(f);
      t ? await put(`/api/tomadores/${t.id}`, d) : await post('/api/tomadores', d);
      toast('Tomador salvo.', 'ok'); depois?.();
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
