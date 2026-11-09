import { abrirRepresentacao } from './representacao.js';
import { get, post, put, del, cached } from '../api.js';
import { preencherPelaReceita, completarCadastros } from '../receita.js';
import { $, esc, icon, modal, toast, confirmar, lerForm, preencherForm, campo, opts, mascaras, autocomplete, so, fmtDoc, badge, AMB, dataBR, vazio } from '../ui.js';
import { estado } from '../estado.js';
import { carregarContribs } from '../app.js';
import { abrirNumeracao, abrirDiagnostico } from './producao.js';

export async function paginaEmpresas(view, params) {
  await carregarContribs();
  const lista = estado.contribs;
  view.innerHTML = `
  <div class="page-head"><div><h1>Empresas emitentes</h1><p>Prestadores de serviço que emitem NFS-e por este sistema (próprias ou de clientes via procuração)</p></div>
    <div class="btns"><button class="btn" id="btnCompletar" title="Preenche endereço, contatos e inscrição municipal que estiverem vazios">${icon('refresh')}Completar pela Receita</button><button class="btn primary" id="btnNova">${icon('plus')}Nova empresa</button></div></div>
  ${lista.length ? `<div class="grid g3">${lista.map(c => `
    <div class="card" style="${c.ativo ? '' : 'opacity:.55'}">
      <div class="card-head"><div><h3>${esc(c.nome_fantasia || c.razao_social)}</h3><div class="small muted">${fmtDoc(c.documento)} · ${esc(c.municipio)}</div></div>${badge(c.ambiente, AMB)}</div>
      <div class="small" style="display:grid;gap:4px">
        <div><span class="muted">Regime:</span> ${esc(c.regime_label)}</div>
        <div><span class="muted">DPS:</span> série ${esc(c.serie_dps)} · próximo nº ${c.prox_ndps}</div>
        <div><span class="muted">Acesso:</span> ${c.certificado ? `${icon('key', 'style="width:13px;vertical-align:-2px"')} ${esc(c.certificado.titular)} ${badge(c.certificado.situacao, { valido: 'válido', vencendo: 'vencendo', vencido: 'vencido' })}` : c.procuracoes.length ? `${c.procuracoes.length} procuração(ões)` : '<span class="muted">sem certificado (somente simulação)</span>'}</div>
        <div><span class="muted">IBS/CBS:</span> ${c.ibscbs_ativo ? `ativo · cClassTrib ${esc(c.cclasstrib_padrao)} · cIndOp ${esc(c.ind_op_padrao)}` : 'não informado'}</div>
      </div>
      <div class="btns" style="margin-top:14px"><button class="btn sm" data-ed="${c.id}">${icon('edit')}Editar</button><button class="btn sm" data-num="${c.id}">${icon('list')}Numeração</button><button class="btn sm" data-diag="${c.id}">${icon('shield')}Diagnóstico</button><button class="btn sm" data-rep="${c.id}">${icon('users')}Representação</button><button class="btn sm" data-sel="${c.id}">Usar esta</button>${c.ativo ? `<button class="btn sm ghost danger" data-del="${c.id}">${icon('trash')}</button>` : '<span class="badge">inativa</span>'}</div>
    </div>`).join('')}</div>` : `<div class="card">${vazio('Nenhuma empresa cadastrada. Cadastre a primeira para começar a emitir.', 'building')}</div>`}`;
  $('#btnNova').onclick = () => formEmpresa();
  $('#btnCompletar').onclick = () => completarCadastros('contribuintes', () => paginaEmpresas(view, params));
  view.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => formEmpresa(lista.find(c => c.id === +b.dataset.ed)));
  view.querySelectorAll('[data-num]').forEach(b => b.onclick = () => abrirNumeracao(lista.find(c => c.id === +b.dataset.num), () => paginaEmpresas(view, new URLSearchParams())).catch(e => toast(e.message, 'error')));
  view.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => abrirRepresentacao(lista.find(c => c.id === +b.dataset.rep), () => {}).catch(e => toast(e.message, 'error')));
  view.querySelectorAll('[data-diag]').forEach(b => b.onclick = () => abrirDiagnostico(lista.find(c => c.id === +b.dataset.diag), () => paginaEmpresas(view, new URLSearchParams())).catch(e => toast(e.message, 'error')));
  view.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { estado.setContrib(b.dataset.sel); location.hash = '#/dashboard'; location.reload(); });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Remover empresa', 'Empresas com notas autorizadas são apenas inativadas. Continuar?', 'Remover', 'danger')) return;
    const r = await del(`/api/contribuintes/${b.dataset.del}`);
    toast(r.inativado ? 'Empresa inativada (possui notas).' : 'Empresa removida.');
    paginaEmpresas(view, params);
  });
  if (params.get('novo')) formEmpresa();

  async function formEmpresa(c) {
    const meta = await cached('/api/tabelas/meta');
    const certs = await get('/api/certificados');
    const corpo = `<form id="fEmp" class="grid g4" autocomplete="off">
      ${campo('Tipo', `<select name="tipo_doc" ${c ? 'disabled' : ''}>${opts({ CNPJ: 'CNPJ', CPF: 'CPF' }, c?.tipo_doc || 'CNPJ')}</select>`)}
      ${campo('CNPJ/CPF', `<div class="input-group"><input name="documento" data-mask="doc" ${c ? 'readonly' : ''} required>${c ? '' : `<button type="button" class="btn sm" id="bCnpj" title="Consultar">${icon('search')}</button>`}</div>`, { req: true })}
      ${campo('Razão social / Nome', '<input name="razao_social" required>', { req: true, cls: 'span2' })}
      ${campo('Nome fantasia', '<input name="nome_fantasia">', { cls: 'span2' })}
      ${campo('Inscrição municipal', '<input name="im">', { hint: 'Informe apenas se cadastrada no CNC do município' })}
      ${campo('E-mail', '<input name="email" type="email">')}
      ${campo('CEP', '<input name="cep" data-mask="cep">')}
      ${campo('Logradouro', '<input name="logradouro">', { cls: 'span2' })}
      ${campo('Número', '<input name="numero">')}
      ${campo('Bairro', '<input name="bairro">')}
      ${campo('Município (emissor)', '<input id="munNome" required><input type="hidden" name="cod_municipio">', { req: true, cls: 'span2' })}
      ${campo('Telefone', '<input name="fone" data-mask="fone" inputmode="tel">')}
      <h3 class="full" style="margin-top:6px">Tributação</h3>
      ${campo('Regime tributário', `<select name="regime">${opts(meta.regimes, c?.regime || 'SN')}</select>`, { cls: 'span2', req: true })}
      ${campo('Regime especial (ISS)', `<select name="reg_esp_trib">${opts(meta.regEspTrib, c?.reg_esp_trib || '0')}</select>`, { cls: 'span2' })}
      ${campo('Alíquota efetiva Simples (%)', '<input type="number" step="0.01" min="0" name="aliq_sn">', { hint: 'Informada em pTotTribSN' })}
      ${campo('Alíquota ISS padrão (%)', '<input type="number" step="0.01" min="0" max="5" name="aliq_iss">')}
      ${campo('cClassTrib padrão', `<select name="cclasstrib_padrao">${meta.cclasstrib.map(i => `<option value="${i.codigo}">${i.codigo} - ${esc(i.nome.slice(0, 60))}</option>`).join('')}</select>`, { cls: 'span2' })}
      ${campo('cIndOp padrão', `<select name="ind_op_padrao">${meta.indop.map(i => `<option value="${i.codigo}">${i.codigo} - ${esc(i.caracteristica.slice(0, 60))}</option>`).join('')}</select>`, { cls: 'span2' })}
      <label class="check span2" style="align-self:end"><input type="checkbox" name="ibscbs_ativo"> Informar IBS/CBS nas notas (a partir de 2026)</label>
      <h3 class="full" style="margin-top:6px">Emissão</h3>
      ${campo('Ambiente', `<select name="ambiente">${opts(AMB, c?.ambiente || 'simulacao')}</select>`, { hint: 'Simulação não envia nada; Produção restrita = homologação oficial' })}
      ${campo('Série DPS', '<input name="serie_dps" maxlength="5">', { hint: 'Até 5 dígitos' })}
      ${campo('Próximo nº DPS', '<input type="number" min="1" name="prox_ndps">')}
      ${campo('Algoritmo de assinatura', '<select name="assinatura"><option value="">Padrão (SHA-1)</option><option value="sha256">RSA-SHA256</option><option value="sha1">RSA-SHA1</option></select>')}
      ${campo('Certificado da empresa', `<select name="certificado_id"><option value="">Nenhum / usar procuração</option>${certs.map(x => `<option value="${x.id}">${esc(x.apelido || x.titular)} — ${fmtDoc(x.documento)} (até ${dataBR(x.valido_ate)})</option>`).join('')}</select>`, { cls: 'span4', hint: 'Cadastre certificados e procurações em “Certificados e procurações”.' })}
    </form>`;
    await modal({
      titulo: c ? 'Editar empresa' : 'Nova empresa emitente', corpo, wide: true,
      botoes: [{ texto: 'Cancelar', valor: null }, { texto: `${icon('save')}Salvar`, cls: 'primary', acao: async bg => {
        const f = $('#fEmp', bg);
        if (!f.reportValidity()) return false;
        const d = lerForm(f);
        d.documento = so(d.documento); d.config = { ...(c?.config || {}), assinatura: d.assinatura || undefined }; delete d.assinatura;
        if (!d.cod_municipio) throw new Error('Selecione o município na lista.');
        const r = c ? await put(`/api/contribuintes/${c.id}`, d) : await post('/api/contribuintes', d);
        estado.setContrib(r.id);
        toast('Empresa salva.', 'ok');
        location.hash = '#/empresas';
        await carregarContribs();
        paginaEmpresas(view, new URLSearchParams());
      } }],
      onOpen: bg => {
        const f = $('#fEmp', bg);
        mascaras(f);
        preencherForm(f, c ? { ...c, documento: fmtDoc(c.documento), assinatura: c.config?.assinatura || '' } : { serie_dps: '00001', prox_ndps: 1, aliq_iss: 2, ibscbs_ativo: true, cclasstrib_padrao: '000001', ind_op_padrao: '100301' });
        if (c) $('#munNome', bg).value = c.municipio;
        autocomplete($('#munNome', bg), {
          buscar: async q => (await get(`/api/tabelas/municipios?q=${encodeURIComponent(q)}`)).itens,
          render: m => `<b>${m.codigo}</b>${esc(m.nome)}/${m.uf}`,
          escolher: m => { f.cod_municipio.value = m.codigo; f.uf && (f.uf.value = m.uf); $('#munNome', bg).value = `${m.nome}/${m.uf}`; },
        });
        $('#bCnpj', bg)?.addEventListener('click', async () => {
          try {
            await preencherPelaReceita(f, f.documento.value, { nome: 'razao_social', campoMun: $('#munNome', bg),
              extra: d => ({ nome_fantasia: d.nome_fantasia, regime: d.mei ? 'MEI' : d.simples ? 'SN' : f.regime.value }) });
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }
}
