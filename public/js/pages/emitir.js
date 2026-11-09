import { get, post, cached, ErroApi } from '../api.js';
import { preencherPelaReceita } from '../receita.js';
import { abrirEmissorGovBr } from '../govbr.js';
import { $, $$, esc, icon, moeda, pct, num, toast, modal, lerForm, preencherForm, campo, opts, mascaras, autocomplete, so, fmtDoc, fmtCTrib, fmtNBS, fmtChave, hoje, formatarXml, AMB, badge, dataBR } from '../ui.js';
import { estado } from '../estado.js';

const TRIB_ISSQN = { 1: 'Operação tributável', 2: 'Imunidade', 3: 'Exportação de serviço', 4: 'Não incidência' };
const RET_ISSQN = { 1: 'Não retido', 2: 'Retido pelo tomador', 3: 'Retido pelo intermediário' };
const IMUNIDADE = { 0: 'Não informado', 1: 'Patrimônio, renda ou serviços (art. 150, VI, a)', 2: 'Templos de qualquer culto (b)', 3: 'Partidos, sindicatos, educação e assistência social (c)', 4: 'Livros, jornais e periódicos (d)', 5: 'Fonogramas e videofonogramas (e)' };
const CST_PIS = { '00': '00 - Nenhum', '01': '01 - Tributável alíquota básica', '02': '02 - Alíquota diferenciada', '06': '06 - Alíquota zero', '07': '07 - Isenta', '08': '08 - Sem incidência', '09': '09 - Suspensão', '49': '49 - Outras saídas', '99': '99 - Outras' };
const TP_DOC = { CNPJ: 'CNPJ', CPF: 'CPF', NIF: 'NIF (exterior)', SEM: 'Sem identificação' };
const SUBST = { '01': '01 - Desenquadramento do Simples Nacional', '02': '02 - Enquadramento no Simples Nacional', '03': '03 - Inclusão retroativa de imunidade/isenção', '04': '04 - Exclusão retroativa de imunidade/isenção', '05': '05 - Rejeição pelo tomador/intermediário', '99': '99 - Outros' };

export async function paginaEmitir(view, params) {
  const c = estado.contrib();
  if (!c) { view.innerHTML = `<div class="alert warn">${icon('alert')}<div>Cadastre uma empresa emitente antes de emitir. <a href="#/empresas?novo=1">Cadastrar agora</a></div></div>`; return; }
  const meta = await cached('/api/tabelas/meta');
  const servicos = await get('/api/servicos');
  let tomadorId = null, rascunhoId = null, sugestoesCache = [];

  // Emitir como: certificado da empresa, e-CNPJ da mesma raiz, responsável legal (e-CPF) ou procurador
  const acessoOpts = (c.acessos || []).map(a => [a.valor, a.rotulo]);
  if (!acessoOpts.length) acessoOpts.push(['', c.ambiente === 'simulacao' ? 'Simulação (sem certificado)' : 'Nenhum certificado vinculado — veja Empresas → Representação']);

  view.innerHTML = `
  <div class="page-head"><div><h1>Emitir NFS-e</h1><p>${esc(c.razao_social)} · ${fmtDoc(c.documento)} · ${esc(c.regime_label || '')} · ${badge(c.ambiente, AMB)}</p></div>
    <div class="btns">
      <button class="btn" id="btnUltima">${icon('copy')}Copiar última nota</button>
      <select id="selServ" style="width:auto"><option value="">Serviço favorito…</option>${servicos.filter(s => !s.contribuinte_id || s.contribuinte_id === c.id).map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}</select>
      <button class="btn ghost" id="btnLimpar">${icon('refresh')}Limpar</button>
    </div></div>
  ${c.ambiente === 'producao' ? `<div class="alert warn" style="margin-bottom:16px">${icon('alert')}<div><b>Ambiente de PRODUÇÃO</b> — a nota terá validade jurídica e será transmitida à Sefin Nacional.</div></div>` : ''}
  <div class="emit-layout">
  <form id="fEmit" autocomplete="off">
    <div class="card">
      <div class="section-title"><span class="n">1</span><h2>Emitente e forma de acesso</h2></div>
      <div class="grid g3">
        ${campo('Emitir como', `<select name="acesso">${acessoOpts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`, { cls: 'span2', hint: 'Empresa, responsável legal (e-CPF), estabelecimento da mesma raiz ou procurador. A emissão pela conta gov.br é feita no Emissor Nacional (botão abaixo).' })}
        ${campo('Competência', `<input type="date" name="competencia" max="${hoje()}" value="${hoje()}" required>`, { req: true })}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="section-title" style="margin:0"><span class="n">2</span><h2>Tomador do serviço</h2></div>
        <label class="check"><input type="checkbox" id="semTomador"> Sem tomador identificado</label></div>
      <div id="tomBox">
        <div class="grid g4" style="margin-bottom:12px">
          ${campo('Buscar cliente cadastrado', '<input id="buscaTom" placeholder="Nome, CNPJ/CPF ou e-mail…">', { cls: 'span4' })}
        </div>
        <div class="grid g4">
          ${campo('Tipo', `<select name="t_tipo_doc">${opts(TP_DOC, 'CNPJ')}</select>`)}
          ${campo('CPF/CNPJ/NIF', `<div class="input-group"><input name="t_documento" data-mask="doc" inputmode="numeric" style="min-width:170px"><button type="button" class="btn sm" id="btnCnpj" title="Consultar CNPJ">${icon('search')}</button></div>`)}
          ${campo('Nome / Razão social', '<input name="t_nome">', { cls: 'span2', req: true })}
          ${campo('Inscrição municipal', '<input name="t_im">')}
          ${campo('E-mail', '<input name="t_email" type="email">')}
          ${campo('Telefone', '<input name="t_fone" data-mask="fone" inputmode="tel">')}
          ${campo('CEP', `<div class="input-group"><input name="t_cep" data-mask="cep"><button type="button" class="btn sm" id="btnCep" title="Buscar CEP">${icon('search')}</button></div>`)}
          ${campo('Logradouro', '<input name="t_logradouro">', { cls: 'span2' })}
          ${campo('Número', '<input name="t_numero">')}
          ${campo('Complemento', '<input name="t_complemento">')}
          ${campo('Bairro', '<input name="t_bairro">')}
          ${campo('Município', '<input id="tMunNome" placeholder="Digite o nome…"><input type="hidden" name="t_cod_municipio">', { cls: 'span2' })}
          <div class="full grid g4 hidden" id="tomExt">
            ${campo('País (ISO)', `<select name="t_pais">${meta.paises.map(p => `<option value="${p.codigo}" ${p.codigo === 'BR' ? 'selected' : ''}>${p.codigo} - ${esc(p.nome)}</option>`).join('')}</select>`)}
            ${campo('Cidade (exterior)', '<input name="t_cidade_ext">')}
            ${campo('Estado/Província', '<input name="t_estado_ext">')}
            ${campo('Código postal', '<input name="t_cod_postal_ext">')}
          </div>
        </div>
        <div class="btns" style="margin-top:12px">
          <label class="check"><input type="checkbox" name="t_retem_federais"> Tomador PJ retém tributos federais</label>
          <label class="check"><input type="checkbox" name="t_orgao_publico"> Órgão público</label>
          <select name="t_tp_ente_gov" style="width:auto" class="hidden"><option value="1">União</option><option value="2">Estado</option><option value="3">Distrito Federal</option><option value="4">Município</option></select>
          <label class="check"><input type="checkbox" name="salvar_tomador" checked> Salvar/atualizar cadastro</label>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-title"><span class="n">3</span><h2>Serviço prestado</h2></div>
      <div class="grid g4">
        ${campo('Código de Tributação Nacional (cTribNac)', '<input id="ctribBusca" placeholder="Ex.: 01.01.01 ou “desenvolvimento”"><input type="hidden" name="ctribnac">', { cls: 'span3', req: true, hint: '<span id="ctribDesc"></span>' })}
        ${campo('Cód. Tributação Municipal', '<input name="ctribmun" maxlength="3" inputmode="numeric" placeholder="3 dígitos" autocomplete="off">', { hint: 'Opcional / conforme município' })}
        ${campo('Código NBS', '<input id="nbsBusca" placeholder="Digite código ou descrição"><input type="hidden" name="cnbs">', { cls: 'span3', hint: '<span id="nbsDesc"></span>' })}
        ${campo('Local da prestação', `<input id="locNome" value="${esc(c.municipio)}"><input type="hidden" name="local_prestacao" value="${c.cod_municipio}">`)}
        <div class="full" id="sugBox"></div>
        ${campo('Descrição do serviço', '<textarea name="descricao" maxlength="2000" rows="4" placeholder="Descreva o serviço prestado…"></textarea>', { cls: 'full', req: true, hint: '<span id="descCount">0</span>/2000' })}
        ${campo('Informações complementares', '<input name="info_compl" maxlength="2000">', { cls: 'span2' })}
        ${campo('Nº do pedido / OS', '<input name="num_pedido" maxlength="15">')}
        ${campo('Documento de referência', '<input name="doc_ref" maxlength="255">')}
      </div>
    </div>

    <div class="card">
      <div class="section-title"><span class="n">4</span><h2>Valores e tributação</h2></div>
      <div class="grid g4">
        ${campo('Valor do serviço (R$)', '<input type="text" inputmode="numeric" data-mask="moeda" placeholder="R$ 0,00" name="valor_servico" required>', { req: true })}
        ${campo('Desconto incondicionado', '<input type="text" inputmode="numeric" data-mask="moeda" placeholder="R$ 0,00" name="desconto_incond">')}
        ${campo('Desconto condicionado', '<input type="text" inputmode="numeric" data-mask="moeda" placeholder="R$ 0,00" name="desconto_cond">')}
        ${campo('Dedução/redução da BC', '<div class="input-group"><select name="deducao_tipo"><option value="">Nenhuma</option><option value="valor">R$</option><option value="percentual">%</option></select><input type="text" inputmode="numeric" data-mask="moeda" data-mask-tipo="deducao_tipo" name="deducao_valor"></div>')}
      </div>
      <h3 style="margin:18px 0 10px">ISSQN</h3>
      <div class="grid g4">
        ${campo('Tributação do ISSQN', `<select name="trib_issqn">${opts(TRIB_ISSQN, 1)}</select>`)}
        ${campo('Retenção do ISSQN', `<select name="tp_ret_issqn">${opts(RET_ISSQN, 1)}</select>`)}
        ${campo('Alíquota ISS (%)', `<input type="number" step="0.01" min="0" max="5" name="aliq_iss" value="${c.aliq_iss || ''}">`, { hint: '<span id="aliqHint"></span>' })}
        <div id="imunBox" class="hidden">${campo('Tipo de imunidade', `<select name="tp_imunidade">${opts(IMUNIDADE, 0)}</select>`)}</div>
        <div id="expBox" class="hidden">${campo('País do resultado', `<select name="pais_resultado">${meta.paises.map(p => `<option value="${p.codigo}">${p.codigo} - ${esc(p.nome)}</option>`).join('')}</select>`)}</div>
      </div>
      <label class="check" style="margin-top:10px"><input type="checkbox" name="convenio_ativo" checked> Município conveniado ao Sistema Nacional (alíquota vem da parametrização municipal)</label>

      <div id="fedBox">
        <div class="card-head" style="margin:18px 0 10px"><h3>Tributos federais e retenções</h3><button type="button" class="btn sm" id="btnSugRet">${icon('check')}Sugerir retenções</button></div>
        <div class="grid g4" id="pisBox">
          ${campo('CST PIS/COFINS', `<select name="pis_cst">${opts(CST_PIS, '01')}</select>`)}
          ${campo('Alíquota PIS (%)', '<input type="number" step="0.01" min="0" name="aliq_pis">')}
          ${campo('Alíquota COFINS (%)', '<input type="number" step="0.01" min="0" name="aliq_cofins">')}
          <div class="btns" style="align-self:end;padding-bottom:8px"><label class="check"><input type="checkbox" name="ret_pis"> PIS retido</label><label class="check"><input type="checkbox" name="ret_cofins"> COFINS retida</label></div>
        </div>
        <div class="grid g3" style="margin-top:12px">
          ${['irrf:IRRF', 'csll:CSLL', 'inss:INSS / CP'].map(x => { const [k, l] = x.split(':'); return campo(`Retenção ${l}`, `<div class="input-group"><input type="text" inputmode="numeric" data-mask="moeda" data-mask-tipo="ret_${k}_tipo" name="ret_${k}"><select name="ret_${k}_tipo" style="max-width:80px"><option value="v">R$</option><option value="p">%</option></select></div>`); }).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="section-title" style="margin:0"><span class="n">5</span><h2>IBS / CBS — Reforma Tributária</h2></div>
        <label class="check"><input type="checkbox" name="ibscbs_ativo" ${c.ibscbs_ativo ? 'checked' : ''}> Informar grupo IBS/CBS</label></div>
      <div id="ibsBox" class="grid g4">
        ${campo('Indicador da operação (cIndOp)', `<select name="ind_op">${meta.indop.map(i => `<option value="${i.codigo}" ${i.codigo === c.ind_op_padrao ? 'selected' : ''}>${i.codigo} - ${esc(i.caracteristica.slice(0, 90))}</option>`).join('')}</select>`, { cls: 'span2' })}
        ${campo('Classificação tributária (cClassTrib)', `<select name="cclasstrib">${meta.cclasstrib.map(i => `<option value="${i.codigo}" data-red="${i.pRedAliq}" ${i.codigo === c.cclasstrib_padrao ? 'selected' : ''}>${i.codigo} (CST ${i.cst}) - ${esc(i.nome.slice(0, 80))}</option>`).join('')}</select>`, { cls: 'span2' })}
        ${campo('Redução de alíquota (%)', '<input type="number" step="0.01" min="0" max="100" name="ibscbs_pred">', { hint: 'Preenchido pelo cClassTrib; confira' })}
        ${campo('Destinatário', '<select name="ind_dest"><option value="0">O próprio tomador</option><option value="1">Outro destinatário</option></select>')}
        ${campo('Tipo de operação (gov./imóveis)', '<select name="tp_oper"><option value="">Não se aplica</option><option value="1">1 - Fornecimento c/ pagamento posterior</option><option value="2">2 - Recebimento c/ fornecimento já realizado</option><option value="3">3 - Fornecimento c/ pagamento já realizado</option><option value="4">4 - Recebimento c/ fornecimento posterior</option><option value="5">5 - Fornecimento e pagamento concomitantes</option></select>')}
        <div style="align-self:end;padding-bottom:8px"><label class="check"><input type="checkbox" name="ind_final"> Uso/consumo pessoal</label></div>
        <div class="full grid g4 hidden" id="destBox">
          ${campo('Tipo doc. destinatário', `<select name="dest_tipo_doc">${opts({ CNPJ: 'CNPJ', CPF: 'CPF' })}</select>`)}
          ${campo('Documento', '<input name="dest_documento" data-mask="doc">')}
          ${campo('Nome do destinatário', '<input name="dest_nome">', { cls: 'span2' })}
        </div>
        <details class="collapse full"><summary>Alíquotas (padrão do ano da competência — edite se necessário)</summary><div class="grid g4">
          ${campo('CBS (%)', '<input type="number" step="0.0001" name="aliq_cbs" placeholder="auto">')}
          ${campo('IBS UF (%)', '<input type="number" step="0.0001" name="aliq_ibsuf" placeholder="auto">')}
          ${campo('IBS Município (%)', '<input type="number" step="0.0001" name="aliq_ibsmun" placeholder="auto">')}
          ${campo('NFS-e referenciada', '<input name="ref_nfse" maxlength="50" placeholder="chave (opcional)">')}
        </div></details>
      </div>
    </div>

    <div class="card">
      <details class="collapse"><summary>Informações adicionais: obra, evento, comércio exterior, benefício municipal, substituição</summary><div class="grid g4">
        <fieldset class="full"><legend>Obra de construção civil</legend><div class="grid g4">
          ${campo('Código da obra (CNO/CEI)', '<input name="obra_cobra">')}${campo('Inscrição imobiliária', '<input name="obra_insc_imob">')}${campo('CEP da obra', '<input name="obra_cep" data-mask="cep">')}${campo('Logradouro', '<input name="obra_logradouro">')}
          ${campo('Número', '<input name="obra_numero">')}${campo('Bairro', '<input name="obra_bairro">')}</div></fieldset>
        <fieldset class="full"><legend>Evento (artístico, cultural, esportivo…)</legend><div class="grid g4">
          ${campo('Nome do evento', '<input name="evento_nome">', { cls: 'span2' })}${campo('Início', '<input type="date" name="evento_ini">')}${campo('Fim', '<input type="date" name="evento_fim">')}
          ${campo('Identificação do evento', '<input name="evento_id">')}${campo('CEP', '<input name="evento_cep" data-mask="cep">')}${campo('Logradouro', '<input name="evento_logradouro">')}${campo('Bairro', '<input name="evento_bairro">')}</div></fieldset>
        <fieldset class="full"><legend><label class="check"><input type="checkbox" name="comext_ativo"> Comércio exterior</label></legend><div class="grid g4">
          ${campo('Modo de prestação', '<select name="comext_modo"><option value="1">1 - Transfronteiriço</option><option value="2">2 - Consumo no Brasil</option><option value="3">3 - Presença comercial no exterior</option><option value="4">4 - Movimento temporário de PF</option></select>')}
          ${campo('Vínculo entre as partes', '<select name="comext_vinculo"><option value="0">0 - Sem vínculo</option><option value="1">1 - Controlada</option><option value="2">2 - Controladora</option><option value="3">3 - Coligada</option><option value="4">4 - Matriz</option><option value="5">5 - Filial</option><option value="6">6 - Outro</option></select>')}
          ${campo('Moeda (BACEN)', '<input name="comext_moeda" value="220" maxlength="3">', { hint: '220 = Dólar EUA, 978 = Euro' })}
          ${campo('Valor na moeda', '<input type="number" step="0.01" name="comext_valor_moeda">')}
          ${campo('País da prestação', `<select name="local_prestacao_pais"><option value="">Brasil</option>${meta.paises.filter(p => p.codigo !== 'BR').map(p => `<option value="${p.codigo}">${p.codigo} - ${esc(p.nome)}</option>`).join('')}</select>`)}
        </div></fieldset>
        <fieldset class="full"><legend>Benefício municipal / exigibilidade suspensa</legend><div class="grid g4">
          ${campo('Nº benefício municipal', '<input name="bm_numero">')}${campo('Redução BC (%)', '<input type="number" step="0.01" name="bm_pred">')}
          ${campo('Exigibilidade suspensa', '<select name="exig_susp_tipo"><option value="">Não</option><option value="1">Decisão judicial</option><option value="2">Processo administrativo</option></select>')}${campo('Nº processo', '<input name="exig_susp_processo">')}
          <label class="check full"><input type="checkbox" name="beneficio_isencao"> Benefício de isenção / alíquota diferenciada (não envia alíquota)</label></div></fieldset>
        <fieldset class="full"><legend>Substituição de NFS-e</legend><div class="grid g3">
          ${campo('Chave da NFS-e substituída', '<input name="subst_chave" maxlength="50">', { cls: 'span2' })}${campo('Motivo', `<select name="subst_motivo">${opts(SUBST, '99')}</select>`)}
          ${campo('Justificativa', '<input name="subst_xmotivo">', { cls: 'full' })}</div></fieldset>
      </div></details>
    </div>
  </form>

  <aside class="summary">
    <div class="card">
      <div class="card-head"><h2>Resumo da nota</h2><span class="small muted" id="dpsNum">DPS ${esc(c.serie_dps)}/${c.prox_ndps}</span></div>
      <div id="resumo">${'<div class="muted small">Preencha os valores…</div>'}</div>
      <div id="avisos" style="margin-top:12px"></div>
      <div class="grid" style="margin-top:16px">
        <button class="btn primary lg" id="btnEmitir">${icon('send')}${c.ambiente === 'simulacao' ? 'Emitir (simulação)' : 'Emitir NFS-e'}</button>
        <div class="grid g2"><button class="btn" id="btnXml">${icon('file')}Prévia XML</button><button class="btn" id="btnRasc">${icon('save')}Rascunho</button></div>
        <button class="btn" id="btnGovBr" title="Sem certificado: emitir no Emissor Nacional com a conta gov.br, como responsável legal ou procurador">${icon('shield')}Emitir pelo gov.br (Emissor Nacional)</button>
      </div>
    </div>
  </aside></div>`;

  const form = $('#fEmit');
  mascaras(form);

  // ---------- Autocompletes ----------
  const setCtrib = async (codigo, desc) => {
    form.ctribnac.value = codigo;
    $('#ctribBusca').value = `${fmtCTrib(codigo)} - ${desc || ''}`;
    $('#ctribDesc').textContent = '';
    const s = await get(`/api/tabelas/sugestoes/${codigo}`);
    sugestoesCache = s.correlacao;
    if (s.servico?.incidencia?.length) $('#ctribDesc').textContent = `Incidência do ISSQN: ${s.servico.incidencia.join(', ')}${s.servico.grupoObrigatorio ? ` · Grupo obrigatório: ${s.servico.grupoObrigatorio}` : ''}`;
    $('#sugBox').innerHTML = s.correlacao.length ? `<div class="alert info">${icon('info')}<div style="flex:1"><b class="t">Sugestões da tabela de correlação oficial (Anexo VIII)</b> — clique para aplicar NBS, cIndOp e cClassTrib:
      <div class="btns" style="margin-top:8px">${s.correlacao.slice(0, 8).map((r, i) => `<button type="button" class="btn sm" data-sug="${i}" title="${esc(r.descNbs)}">${fmtNBS(r.cNBS)} · ${esc(r.descNbs.slice(0, 48))}${r.descNbs.length > 48 ? '…' : ''}</button>`).join('')}</div></div></div>` : '';
    $$('[data-sug]').forEach(b => b.onclick = () => aplicarSug(sugestoesCache[+b.dataset.sug]));
    await carregarOpcoesMun();
    const lista = opcoesMun.filter(m => m.ctribnac === codigo);
    if (lista.length === 1 && !form.ctribmun.value) form.ctribmun.value = lista[0].ctribmun;
    recalc();
  };
  const aplicarSug = r => {
    form.cnbs.value = r.cNBS; $('#nbsBusca').value = `${fmtNBS(r.cNBS)} - ${r.descNbs}`;
    if (r.indOp[0]) form.ind_op.value = r.indOp[0];
    if (r.cClassTrib[0]) { form.cclasstrib.value = r.cClassTrib[0]; aplicarRed(); }
    $('#nbsDesc').textContent = r.localIncidIBS ? `Local de incidência IBS/CBS: ${r.localIncidIBS}` : '';
    recalc();
  };
  // cTribNac: digitação com busca por código/descrição ou seta para ver a lista completa da Lista Nacional
  autocomplete($('#ctribBusca'), {
    seta: true, min: 1,
    buscar: async (q, { todos } = {}) => (await get(`/api/tabelas/ctribnac?q=${encodeURIComponent(todos ? '' : q)}&limite=${todos ? 1000 : 60}`)).itens,
    render: it => `<b>${fmtCTrib(it.codigo)}</b>${esc(it.descricao)}`,
    escolher: it => setCtrib(it.codigo, it.descricao),
  });
  // cTribMun: códigos do município (tabela local/Sefin), favoritos e usados em notas; aceita digitação livre
  let opcoesMun = null;
  const carregarOpcoesMun = async () => (opcoesMun = await get(`/api/codigos-municipais/opcoes?contribuinte_id=${c.id}&ctribnac=${form.ctribnac.value || ''}`));
  autocomplete(form.ctribmun, {
    seta: true, min: 1, vazio: 'Nenhum código municipal cadastrado para este município. Digite o código ou consulte a Sefin.',
    buscar: async (q, { todos } = {}) => {
      const l = opcoesMun || await carregarOpcoesMun();
      const t = todos ? '' : q.toLowerCase();
      return l.filter(o => !t || o.ctribmun.includes(t) || o.ctribnac.includes(so(t) || '¬') || o.descricao.toLowerCase().includes(t) || o.servico.toLowerCase().includes(t)).slice(0, 300);
    },
    render: o => `<b>${esc(o.ctribmun)}</b>${o.ctribnac === form.ctribnac.value ? '' : `<span class="muted">${fmtCTrib(o.ctribnac)} · </span>`}${esc(o.descricao || o.servico)} <span class="badge plain">${esc(o.origem)}</span>${o.aliquota != null && o.aliquota !== '' ? ` <span class="muted small">${pct(o.aliquota)}</span>` : ''}`,
    escolher: o => { form.ctribmun.value = o.ctribmun; if (o.aliquota != null && o.aliquota !== '' && !form.aliq_iss.value) form.aliq_iss.value = o.aliquota; recalc(); },
    rodape: () => (c.ambiente !== 'simulacao' && form.ctribnac.value ? [{ html: `Consultar códigos municipais de ${fmtCTrib(form.ctribnac.value)} na Sefin…`, acao: async () => {
      try {
        await get(`/api/parametros-municipais?contribuinte_id=${c.id}&servico=${form.ctribnac.value}`);
        await carregarOpcoesMun();
        const n = opcoesMun.filter(o => o.ctribnac === form.ctribnac.value).length;
        toast(n ? `${n} código(s) municipal(is) disponível(is).` : 'O município não informou códigos municipais para este serviço.', n ? 'ok' : undefined);
        form.ctribmun.focus();
      } catch (e) { toast(e.message, 'error'); }
    } }] : []),
  });
  autocomplete($('#nbsBusca'), {
    buscar: async q => {
      const sug = sugestoesCache.filter(s => (s.cNBS + s.descNbs.toLowerCase()).includes(q.toLowerCase().replace(/\./g, ''))).map(s => ({ cNBS: s.cNBS, descricao: s.descNbs, sug: true }));
      const r = (await get(`/api/tabelas/nbs?q=${encodeURIComponent(q)}&limite=40`)).itens;
      return [...sug, ...r.filter(x => !sug.find(s => s.cNBS === x.cNBS))];
    },
    render: it => `<b>${fmtNBS(it.cNBS)}</b>${it.sug ? '<span class="badge plain">sugerido</span> ' : ''}${esc(it.descricao)}`,
    escolher: it => { form.cnbs.value = it.cNBS; $('#nbsBusca').value = `${fmtNBS(it.cNBS)} - ${it.descricao}`; const s = sugestoesCache.find(x => x.cNBS === it.cNBS); if (s) aplicarSug(s); },
  });
  const munAC = (inp, hidden) => autocomplete(inp, {
    buscar: async q => (await get(`/api/tabelas/municipios?q=${encodeURIComponent(q)}`)).itens,
    render: m => `<b>${m.codigo}</b>${esc(m.nome)}/${m.uf}`,
    escolher: m => { hidden.value = m.codigo; inp.value = `${m.nome}/${m.uf}`; recalc(); },
  });
  munAC($('#locNome'), form.local_prestacao);
  munAC($('#tMunNome'), form.t_cod_municipio);
  autocomplete($('#buscaTom'), {
    buscar: async q => get(`/api/tomadores?q=${encodeURIComponent(q)}`),
    render: t => `<b>${fmtDoc(t.documento, t.tipo_doc)}</b>${esc(t.nome)} <span class="muted small">${esc(t.municipio || '')}</span>`,
    escolher: t => setTomador(t),
  });

  function setTomador(t) {
    tomadorId = t?.id || null;
    const o = {};
    for (const k of ['tipo_doc', 'documento', 'nome', 'im', 'email', 'fone', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cod_municipio', 'pais', 'cidade_ext', 'estado_ext', 'cod_postal_ext', 'retem_federais', 'orgao_publico', 'tp_ente_gov']) o[`t_${k}`] = t?.[k] ?? '';
    if (!o.t_tipo_doc) o.t_tipo_doc = 'CNPJ';
    if (!o.t_pais) o.t_pais = 'BR';
    o.t_documento = fmtDoc(o.t_documento, o.t_tipo_doc);
    preencherForm(form, o);
    $('#tMunNome').value = t?.municipio || '';
    $('#buscaTom').value = '';
    atualizarVisibilidade();
    if (t?.retem_iss) form.tp_ret_issqn.value = '2';
    recalc();
  }

  // ---------- Consultas CNPJ / CEP ----------
  $('#btnCnpj').onclick = async () => {
    try {
      await preencherPelaReceita(form, form.t_documento.value, { prefixo: 't_', campoMun: $('#tMunNome'), extra: () => ({}) });
      recalc();
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#btnCep').onclick = async () => {
    try {
      const d = await get(`/api/consulta/cep/${so(form.t_cep.value)}`);
      preencherForm(form, { t_logradouro: d.logradouro, t_bairro: d.bairro, t_cod_municipio: d.cod_municipio });
      const m = (await get(`/api/tabelas/municipios?q=${d.cod_municipio}`)).itens[0];
      if (m) $('#tMunNome').value = `${m.nome}/${m.uf}`;
    } catch (e) { toast(e.message, 'error'); }
  };

  // ---------- Visibilidade condicional ----------
  function atualizarVisibilidade() {
    const tp = form.t_tipo_doc.value;
    $('#tomExt').classList.toggle('hidden', tp !== 'NIF');
    if (tp !== 'NIF') form.t_pais.value = 'BR';
    form.t_tp_ente_gov.classList.toggle('hidden', !form.t_orgao_publico.checked);
    $('#tomBox').style.opacity = $('#semTomador').checked ? .4 : 1;
    $$('input,select', $('#tomBox')).forEach(i => { i.disabled = $('#semTomador').checked; });
    $('#imunBox').classList.toggle('hidden', form.trib_issqn.value !== '2');
    $('#expBox').classList.toggle('hidden', form.trib_issqn.value !== '3');
    $('#ibsBox').style.display = form.ibscbs_ativo.checked ? '' : 'none';
    $('#destBox').classList.toggle('hidden', form.ind_dest.value !== '1');
    const simples = ['MEI', 'SN', 'SN_EXCESSO_ISS'].includes(c.regime);
    $('#pisBox').classList.toggle('hidden', simples);
    $('#fedBox').classList.toggle('hidden', c.tipo_doc === 'CPF' || c.regime === 'MEI');
  }
  const aplicarRed = () => { const o = form.cclasstrib.selectedOptions[0]; form.ibscbs_pred.value = o?.dataset.red && +o.dataset.red ? o.dataset.red : ''; };
  form.cclasstrib.addEventListener('change', aplicarRed);
  aplicarRed();
  if (!['MEI', 'SN', 'SN_EXCESSO_ISS'].includes(c.regime)) {
    const def = { LP: [0.65, 3], LA: [0.65, 3], LR: [1.65, 7.6], SN_EXCESSO: [0.65, 3], IMUNE: [0, 0], ISENTA: [0, 0] }[c.regime] || [0.65, 3];
    form.aliq_pis.value = def[0]; form.aliq_cofins.value = def[1];
    if (['IMUNE', 'ISENTA'].includes(c.regime)) form.pis_cst.value = c.regime === 'IMUNE' ? '08' : '07';
  }
  $('#semTomador').onchange = atualizarVisibilidade;
  form.addEventListener('change', e => { if (['t_tipo_doc', 't_orgao_publico', 'trib_issqn', 'ibscbs_ativo', 'ind_dest'].includes(e.target.name)) atualizarVisibilidade(); });
  form.descricao.addEventListener('input', () => { $('#descCount').textContent = form.descricao.value.length; });

  // ---------- Montagem do payload ----------
  function payload() {
    const d = lerForm(form);
    const tomador = $('#semTomador').checked ? null : {
      id: tomadorId || undefined,
      ...Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith('t_')).map(([k, v]) => [k.slice(2), typeof v === 'boolean' ? +v : v])),
    };
    if (tomador && !tomador.documento && tomador.tipo_doc !== 'SEM' && !tomador.nome) tomador.vazio = true;
    const f = Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('t_') && !['acesso', 'salvar_tomador'].includes(k)));
    if (d.aliq_cbs !== '') f.ibscbs_aliq = { cbs: d.aliq_cbs, ibsUF: d.aliq_ibsuf || 0, ibsMun: d.aliq_ibsmun || 0 };
    return { contribuinte_id: c.id, tomador: tomador?.vazio ? null : tomador, salvar_tomador: d.salvar_tomador, form: f, acesso: { procuracao_id: d.acesso?.startsWith('p:') ? +d.acesso.slice(2) : null, certificado_id: d.acesso?.startsWith('c:') ? +d.acesso.slice(2) : null },
      substituir: d.subst_chave ? { chave: so(d.subst_chave), motivo: d.subst_motivo, xMotivo: d.subst_xmotivo } : undefined, rascunho_id: rascunhoId };
  }

  // ---------- Cálculo ao vivo ----------
  let tCalc;
  function recalc() { clearTimeout(tCalc); tCalc = setTimeout(calcAgora, 250); }
  async function calcAgora() {
    if (!document.body.contains(form)) return;
    const p = payload();
    if (!p.form.valor_servico) { $('#resumo').innerHTML = '<div class="muted small">Informe o valor do serviço…</div>'; return; }
    try {
      const { calc: k } = await post('/api/notas/calcular', { contribuinte_id: c.id, form: p.form });
      const linha = (l, v, cls = '') => `<div class="row ${cls}"><span>${l}</span><b>${v}</b></div>`;
      const f = k.fed;
      $('#aliqHint').textContent = k.enviarAliq ? 'Será enviada na DPS' : 'Não enviada (definida pelo município/regime)';
      $('#resumo').innerHTML = `
        ${linha('Valor do serviço', moeda(k.vServ))}
        ${k.vDescIncond ? linha('(-) Desconto incondicionado', moeda(k.vDescIncond)) : ''}${k.vDescCond ? linha('(-) Desconto condicionado', moeda(k.vDescCond)) : ''}
        ${k.vDR ? linha('(-) Deduções da BC', moeda(k.vDR)) : ''}
        <div class="sec">ISSQN</div>
        ${linha('Base de cálculo', moeda(k.bcISS))}${linha(`ISS ${k.aliq ? pct(k.aliq) : ''}`, moeda(k.vISS))}${linha('Situação', k.retido ? '<span class="badge b-rascunho">Retido</span>' : 'A recolher pelo prestador')}
        ${f.vPis || f.vCofins || f.vIRRF || f.vCSLL || f.vCP ? `<div class="sec">Federais</div>
          ${f.vPis ? linha(`PIS ${pct(f.pAliqPis)}${k.vRetPis ? ' (retido)' : ''}`, moeda(f.vPis)) : ''}${f.vCofins ? linha(`COFINS ${pct(f.pAliqCofins)}${k.vRetCofins ? ' (retida)' : ''}`, moeda(f.vCofins)) : ''}
          ${f.vIRRF ? linha('IRRF retido', moeda(f.vIRRF)) : ''}${f.vCSLL ? linha('CSLL retida', moeda(f.vCSLL)) : ''}${f.vCP ? linha('INSS/CP retido', moeda(f.vCP)) : ''}` : ''}
        ${k.ibscbs ? `<div class="sec">IBS / CBS ${k.ibscbs.ano}</div>${linha('Base IBS/CBS', moeda(k.ibscbs.vBC))}
          ${linha(`CBS ${num(k.ibscbs.pCBS, 2)}%`, moeda(k.ibscbs.vCBS))}${linha(`IBS UF ${num(k.ibscbs.pIBSUF, 2)}% + Mun ${num(k.ibscbs.pIBSMun, 2)}%`, moeda(k.ibscbs.vIBS))}
          ${k.ibscbs.obs ? `<div class="hint">${esc(k.ibscbs.obs)}</div>` : ''}` : ''}
        ${linha('Total de retenções', moeda(k.vTotalRet))}
        ${linha('Valor líquido', moeda(k.vLiq), 'total')}
        ${k.totTrib.pTotTribSN !== undefined ? `<div class="hint">Alíquota do Simples Nacional informada: ${pct(k.totTrib.pTotTribSN)}</div>` : ''}`;
      $('#avisos').innerHTML = k.avisos.length ? `<div class="alert warn">${icon('alert')}<ul>${k.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : '';
    } catch (e) { $('#resumo').innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
  }
  form.addEventListener('input', recalc);
  form.addEventListener('change', recalc);

  // ---------- Sugestão de retenções ----------
  $('#btnSugRet').onclick = () => {
    const ret = form.t_retem_federais.checked && form.t_tipo_doc.value === 'CNPJ';
    if (!ret) return toast('Marque “Tomador PJ retém tributos federais” para sugerir retenções.');
    if (['MEI', 'SN', 'SN_EXCESSO_ISS'].includes(c.regime)) return toast('Optante do Simples Nacional: não há retenção de IRRF/CSRF (IN RFB 1.234/2012).');
    preencherForm(form, { ret_irrf: 1.5, ret_irrf_tipo: 'p', ret_csll: 1, ret_csll_tipo: 'p', ret_pis: true, ret_cofins: true });
    toast('Retenções aplicadas: IRRF 1,5% e CSRF 4,65% (PIS 0,65% / COFINS 3% / CSLL 1%). Confira o enquadramento do serviço.', 'ok');
    recalc();
  };

  // ---------- Carregar nota (copiar / rascunho / favorito) ----------
  function carregarDados(dados, { copia = true } = {}) {
    const f = { ...(dados.form || {}) };
    if (copia) { f.competencia = hoje(); delete f.subst_chave; delete f.subst_xmotivo; }
    preencherForm(form, f);
    if (f.ctribnac) setCtrib(f.ctribnac, '').then(async () => {
      const r = (await get(`/api/tabelas/ctribnac?q=${f.ctribnac}`)).itens[0];
      if (r) $('#ctribBusca').value = `${fmtCTrib(r.codigo)} - ${r.descricao}`;
    });
    if (f.cnbs) get(`/api/tabelas/nbs?q=${f.cnbs}`).then(r => { const n = r.itens[0]; $('#nbsBusca').value = n ? `${fmtNBS(n.cNBS)} - ${n.descricao}` : f.cnbs; });
    if (f.local_prestacao) get(`/api/tabelas/municipios?q=${f.local_prestacao}`).then(r => { const m = r.itens[0]; if (m) $('#locNome').value = `${m.nome}/${m.uf}`; });
    if (dados.tomador) setTomador({ ...dados.tomador, municipio: '' });
    if (dados.tomador?.cod_municipio) get(`/api/tabelas/municipios?q=${dados.tomador.cod_municipio}`).then(r => { const m = r.itens[0]; if (m) $('#tMunNome').value = `${m.nome}/${m.uf}`; });
    const ac = dados.acesso?.procuracao_id ? `p:${dados.acesso.procuracao_id}` : dados.acesso?.certificado_id ? `c:${dados.acesso.certificado_id}` : '';
    if (ac && [...form.acesso.options].some(o => o.value === ac)) form.acesso.value = ac;
    $('#semTomador').checked = !dados.tomador;
    atualizarVisibilidade(); aplicarRedSeVazio(f); recalc();
    $('#descCount').textContent = form.descricao.value.length;
  }
  const aplicarRedSeVazio = f => { if (f.ibscbs_pred === undefined || f.ibscbs_pred === '') aplicarRed(); };

  $('#btnUltima').onclick = async () => {
    const tId = tomadorId;
    const escolha = await modal({
      titulo: 'Copiar última nota', corpo: `<p>Os dados da última NFS-e autorizada serão carregados. Altere tomador, valores ou o que precisar antes de emitir.</p>
        <div class="grid"><label class="check"><input type="radio" name="o" value="emp" checked> Última nota de <b>${esc(c.razao_social)}</b></label>
        ${tId ? '<label class="check"><input type="radio" name="o" value="tom"> Última nota para o tomador selecionado</label>' : ''}
        <label class="check"><input type="checkbox" id="manterTom"> Manter apenas o serviço (limpar tomador)</label>
        <label class="check"><input type="checkbox" id="limparValor"> Limpar valores</label></div>`,
      botoes: [{ texto: 'Cancelar', valor: null }, { texto: `${icon('copy')}Copiar`, cls: 'primary', acao: bg => ({ o: $('[name=o]:checked', bg).value, semTom: $('#manterTom', bg).checked, semValor: $('#limparValor', bg).checked }) }],
    });
    if (!escolha) return;
    const n = await get(`/api/notas/ultima?contribuinte_id=${c.id}${escolha.o === 'tom' ? `&tomador_id=${tId}` : ''}`);
    if (!n) return toast('Nenhuma nota anterior encontrada para copiar.');
    const dados = structuredClone(n.dados);
    if (escolha.semTom) dados.tomador = null;
    if (escolha.semValor) Object.assign(dados.form, { valor_servico: '', desconto_incond: '', desconto_cond: '', deducao_valor: '' });
    carregarDados(dados);
    toast(`Dados da NFS-e nº ${n.nnfse || n.ndps} copiados. Revise e emita.`, 'ok');
  };
  $('#selServ').onchange = e => {
    const s = servicos.find(x => String(x.id) === e.target.value);
    if (!s) return;
    preencherForm(form, { descricao: s.descricao || form.descricao.value, ctribmun: s.ctribmun || '', aliq_iss: s.aliq_iss ?? form.aliq_iss.value, valor_servico: s.valor_padrao || form.valor_servico.value, ...(s.ind_op ? { ind_op: s.ind_op } : {}), ...(s.cclasstrib ? { cclasstrib: s.cclasstrib } : {}) });
    setCtrib(s.ctribnac, s.servico);
    if (s.cnbs) { form.cnbs.value = s.cnbs; $('#nbsBusca').value = `${fmtNBS(s.cnbs)} - ${s.nbs || ''}`; }
    aplicarRed(); e.target.value = '';
  };
  $('#btnLimpar').onclick = () => { location.hash = '#/emitir?t=' + Date.now(); };

  // ---------- Ações ----------
  const mostrarErros = (e) => {
    const lista = e.dados?.erros || [];
    modal({ titulo: `${icon('alert', 'style="width:20px;color:var(--danger)"')} ${esc(e.message)}`, corpo: lista.length ? `<div class="alert error"><ul>${lista.map(x => `<li><b>${esc(x.codigo || '')}</b> ${esc(x.descricao || x)}${x.complemento ? ` <span class="small">(${esc(x.complemento)})</span>` : ''}</li>`).join('')}</ul></div>` : '', botoes: [{ texto: 'Entendi', cls: 'primary' }] });
  };
  $('#btnXml').onclick = async () => {
    try {
      const p = payload();
      const r = await post('/api/notas/previa-xml', { contribuinte_id: c.id, form: p.form, tomador: p.tomador });
      modal({ titulo: `Prévia da DPS ${r.id}`, wide: true, corpo: `${r.erros.length ? `<div class="alert warn" style="margin-bottom:12px">${icon('alert')}<ul>${r.erros.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : `<div class="alert ok" style="margin-bottom:12px">${icon('check')}<div>Validações locais OK. A assinatura digital é aplicada no envio.</div></div>`}<pre class="xml">${esc(formatarXml(r.xml))}</pre>`, botoes: [{ texto: 'Fechar' }] });
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#btnGovBr').onclick = async () => {
    const p = payload();
    let k = null;
    try { if (p.form.valor_servico) k = (await post('/api/notas/calcular', { contribuinte_id: c.id, form: p.form })).calc; } catch { /* sem cálculo */ }
    abrirEmissorGovBr(c, p, k);
  };
  $('#btnRasc').onclick = async () => {
    try { const r = await post('/api/notas/rascunho', { ...payload(), id: rascunhoId }); rascunhoId = r.id; toast('Rascunho salvo.', 'ok'); } catch (e) { toast(e.message, 'error'); }
  };
  $('#btnEmitir').onclick = async () => {
    const p = payload();
    if (!form.ctribnac.value) return toast('Selecione o código de tributação nacional.', 'error');
    if (c.ambiente === 'producao') {
      const ok = await modal({ titulo: 'Confirmar emissão em produção', corpo: `<p>Emitir NFS-e de <b>${moeda(p.form.valor_servico)}</b> para <b>${esc(p.tomador?.nome || 'tomador não identificado')}</b>?</p><p class="muted">A nota terá validade fiscal.</p>`, botoes: [{ texto: 'Voltar', valor: false }, { texto: 'Emitir agora', cls: 'primary', valor: true }] });
      if (!ok) return;
    }
    const btn = $('#btnEmitir'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Transmitindo…';
    try {
      const r = await post('/api/notas/emitir', p);
      if (r.status === 'pendente') {
        const ac = await modal({
          titulo: `${icon('alert', 'style="width:22px;color:var(--warning)"')} Sem resposta da Sefin Nacional`,
          corpo: `<p>A DPS <b>${esc(r.idDps)}</b> foi enviada, mas a resposta não chegou (falha de rede ou tempo esgotado).</p>
            <div class="alert warn">${icon('info')}<div>A nota ficou <b>PENDENTE</b>. <b>Não emita outra nota igual</b>: a Sefin pode ter autorizado esta DPS. Clique em "Consultar agora" (ou depois, em Notas emitidas) para confirmar pelo número da DPS — se ela não tiver sido processada, a nota volta para correção sem perder a numeração.</div></div>`,
          botoes: [{ texto: 'Depois', valor: 'depois' }, { texto: `${icon('refresh')}Consultar agora`, cls: 'primary', valor: 'consultar' }],
        });
        if (ac === 'consultar') { try { const s = await post(`/api/notas/${r.id}/sincronizar`); toast(s.mensagem || `Situação: ${s.status}`, 'ok'); } catch (e) { toast(e.message, 'error'); } }
        location.hash = `#/notas?id=${r.id}`;
        return;
      }
      const acao = await modal({
        titulo: `${icon('check', 'style="width:22px;color:var(--success)"')} NFS-e autorizada`,
        corpo: `<div class="grid g2"><div><div class="muted small">Número</div><h2>${esc(r.nNFSe || '—')}</h2></div><div><div class="muted small">DPS</div><b>${esc(r.idDps)}</b></div>
          <div class="full"><div class="muted small">Chave de acesso</div><code>${esc(fmtChave(r.chave))}</code></div></div>
          ${r.mensagens?.length ? `<div class="alert info" style="margin-top:12px">${icon('info')}<ul>${r.mensagens.map(m => `<li>${esc(m.codigo)} ${esc(m.descricao)}</li>`).join('')}</ul></div>` : ''}`,
        botoes: [{ texto: 'Ver nota', valor: 'ver' }, { texto: `${icon('copy')}Emitir outra igual`, valor: 'copiar' }, { texto: 'Nova nota', cls: 'primary', valor: 'nova' }],
      });
      if (acao === 'ver') location.hash = `#/notas?id=${r.id}`;
      else if (acao === 'copiar') { rascunhoId = null; form.valor_servico.focus(); refreshNum(); }
      else location.hash = '#/emitir?t=' + Date.now();
    } catch (e) {
      if (e instanceof ErroApi) mostrarErros(e); else toast(e.message, 'error');
      refreshNum();
    } finally { btn.disabled = false; btn.innerHTML = `${icon('send')}${c.ambiente === 'simulacao' ? 'Emitir (simulação)' : 'Emitir NFS-e'}`; }
  };
  async function refreshNum() {
    const atual = await get(`/api/contribuintes/${c.id}`);
    Object.assign(c, atual);
    $('#dpsNum').textContent = `DPS ${c.serie_dps}/${c.prox_ndps}`;
  }

  atualizarVisibilidade();
  if (params.get('copiar')) {
    const n = await get(`/api/notas/${params.get('copiar')}`);
    carregarDados(n.dados);
    if (params.get('subst')) {
      form.subst_chave.value = params.get('subst');
      form.subst_chave.closest('details').open = true;
      toast('Substituição: ajuste os dados. A nota original será cancelada por substituição ao autorizar a nova.', 'ok');
    } else toast('Dados copiados. Altere tomador e valores e emita.', 'ok');
  }
  else if (params.get('rascunho')) { const n = await get(`/api/notas/${params.get('rascunho')}`); rascunhoId = n.id; carregarDados(n.dados, { copia: false }); }
  else if (params.get('ultima')) $('#btnUltima').click();
}
