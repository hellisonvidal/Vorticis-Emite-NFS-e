// Emissão pela conta gov.br. A conta gov.br (prata/ouro) só é aceita no Emissor Nacional web: as APIs da Sefin exigem
// certificado ICP-Brasil. O app faz o que dá para fazer por dentro:
//  1. valida quem vai emitir (titular, responsável legal pelo QSA da Receita, procurador pela procuração cadastrada
//     ou declarada) e a própria nota, com as mesmas regras da emissão por API, e guarda um rascunho vinculado;
//  2. abre o Emissor Nacional (no Windows, numa janela do app com login gov.br salvo) com um painel "Vorticis"
//     dentro da página para inserir cada dado no campo do Emissor;
//  3. o XML baixado volta para o app (Windows: automaticamente; navegador/Android: "Importar XML") e substitui o
//     rascunho pela nota autorizada.
import { post } from './api.js';
import { $, $$, esc, icon, modal, toast, fmtDoc, fmtCTrib, fmtNBS, moeda, dataBR, mascaras, so } from './ui.js';

export const URL_EMISSOR = 'https://www.nfse.gov.br/EmissorNacional';
const ehDesktop = () => /Electron/i.test(navigator.userAgent);
const PAPEIS = {
  titular: ['Titular', 'Sou o próprio prestador pessoa física (CPF).'],
  responsavel: ['Responsável legal', 'Sou sócio/administrador responsável pelo CNPJ (vínculo pela base CNPJ na Receita).'],
  procurador: ['Procurador', 'Tenho procuração eletrônica no e-CAC com o serviço NFS-e (ex.: contador).'],
};

/** Importa XML de NFS-e (texto) e mostra o resultado; usado pelo Windows (download capturado) e pelo seletor de arquivos. */
export async function importarXmls(xmls, via = 'govbr') {
  const r = await post('/api/notas/importar-xml', { xmls, via });
  const ok = r.importadas + r.atualizadas;
  if (ok) dispatchEvent(new Event('vorticis:notas-importadas'));
  if (ok) toast(`${ok} NFS-e importada(s)${r.notas[0] ? `: nº ${r.notas.map(n => n.nnfse).join(', ')}` : ''}.${r.vinculadas ? ' O rascunho preparado no app foi substituído pela nota autorizada.' : ''}`, 'ok');
  if (r.eventos) toast(`${r.eventos} evento(s) de cancelamento/substituição aplicado(s).`, 'ok');
  if (r.erros.length) toast(r.erros.map(e => e.erro).join(' · '), 'error');
  return r;
}
// Chamado pelo processo principal do Windows quando um XML é baixado na janela do Emissor Nacional
globalThis.__vorticisImportarXml = async xml => {
  try {
    const r = await importarXmls([xml], 'govbr');
    if (r.notas[0]) { const { detalheNota } = await import('./pages/notas.js'); detalheNota(r.notas[0].id); }
  } catch (e) { toast(`XML baixado no Emissor Nacional não foi importado: ${e.message}`, 'error'); }
};

/** Seletor de arquivos XML (vários) para importar notas emitidas no Emissor Nacional. */
export function escolherXmls(via = 'govbr') {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xml,text/xml,application/xml'; inp.multiple = true;
  inp.onchange = async () => {
    try {
      const xmls = await Promise.all([...inp.files].map(f => f.text()));
      if (xmls.length) await importarXmls(xmls, via);
    } catch (e) { toast(e.message, 'error'); }
  };
  inp.click();
}

const dec = v => Number(v).toFixed(2).replace('.', ',');
function linhasDaNota(c, p, k) {
  const f = p?.form || {}, t = p?.tomador || {};
  const L = [];
  const add = (rot, val, copia = val) => { if (val !== undefined && val !== null && String(val).trim() !== '') L.push([rot, String(val), String(copia)]); };
  add('Prestador (CNPJ/CPF a representar)', fmtDoc(c.documento), String(c.documento));
  add('Competência', f.competencia ? dataBR(f.competencia) : '');
  if (t.documento || t.nome) {
    add('Tomador — CPF/CNPJ', fmtDoc(t.documento), so(t.documento));
    add('Tomador — nome', t.nome);
    add('Tomador — inscrição municipal', t.im);
    add('Tomador — CEP', t.cep, so(t.cep));
    add('Tomador — logradouro', t.logradouro);
    add('Tomador — número', t.numero);
    add('Tomador — complemento', t.complemento);
    add('Tomador — bairro', t.bairro);
    add('Tomador — e-mail', t.email);
    add('Tomador — telefone', t.fone, so(t.fone));
  }
  add('Código de tributação nacional', f.ctribnac ? fmtCTrib(f.ctribnac) : '', f.ctribnac);
  add('Código de tributação municipal', f.ctribmun);
  add('NBS', f.cnbs ? fmtNBS(f.cnbs) : '', f.cnbs);
  add('Descrição do serviço', f.descricao);
  add('Valor do serviço', f.valor_servico ? moeda(f.valor_servico) : '', f.valor_servico ? dec(f.valor_servico) : '');
  if (+f.desconto_incond) add('Desconto incondicionado', moeda(f.desconto_incond), dec(f.desconto_incond));
  if (+f.desconto_cond) add('Desconto condicionado', moeda(f.desconto_cond), dec(f.desconto_cond));
  if (k) {
    add('Alíquota do ISS', k.aliq ? `${String(k.aliq).replace('.', ',')}%` : '', k.aliq ? String(k.aliq).replace('.', ',') : '');
    add('ISS retido pelo tomador?', k.retido ? 'Sim' : 'Não');
    if (k.fed?.vIRRF) add('IRRF retido', moeda(k.fed.vIRRF), dec(k.fed.vIRRF));
    if (k.fed?.vCSLL) add('CSLL retida', moeda(k.fed.vCSLL), dec(k.fed.vCSLL));
    if (k.fed?.vCP) add('INSS/CP retido', moeda(k.fed.vCP), dec(k.fed.vCP));
  }
  add('cIndOp (IBS/CBS)', f.ind_op);
  add('cClassTrib (IBS/CBS)', f.cclasstrib);
  add('Informações complementares', f.info_compl);
  return L;
}

/**
 * Emissão com a conta gov.br, por dentro do app: pede e valida os dados de quem vai emitir (titular, responsável
 * legal ou procurador), valida a nota, guarda o rascunho e abre o Emissor Nacional com o painel de preenchimento.
 * @returns o resultado da preparação ({ rascunho_id, ... }) ou null se cancelado
 */
export async function emitirPeloGovBr(c, p, { rascunhoId } = {}) {
  const papelPadrao = c.govbr_papel || (c.tipo_doc === 'CPF' ? 'titular' : c.responsavel_cpf ? 'responsavel' : 'responsavel');
  const procs = (c.procuracoes || []).filter(x => x.ativo);
  const corpo = `
    <p class="small muted" style="margin-top:0">A conta gov.br não é aceita pelas APIs da Sefin (que exigem certificado digital). Por isso a nota é emitida no <b>Emissor Nacional</b>, e o app valida antes quem vai emitir e os dados da nota.</p>
    <form id="fGov" autocomplete="off">
      <div class="small" style="font-weight:600;margin:4px 0 8px">Você vai atuar como</div>
      <div class="papeis">${Object.entries(PAPEIS).map(([k, [t, d]]) => {
        const off = (k === 'titular' && c.tipo_doc !== 'CPF') || (k === 'responsavel' && c.tipo_doc !== 'CNPJ');
        return `<label class="papel ${off ? 'off' : ''}"><input type="radio" name="papel" value="${k}" ${off ? 'disabled' : ''} ${k === papelPadrao && !off ? 'checked' : ''}><b>${t}</b><span>${d}</span></label>`;
      }).join('')}</div>
      <div class="grid g3" style="margin-top:12px">
        <label class="f"><span>CPF do usuário gov.br <b class="req">*</b></span><input name="cpf" data-mask="doc" inputmode="numeric" value="${esc(fmtDoc(c.govbr_cpf || ''))}" required></label>
        <label class="f span2"><span>Nome completo <b class="req">*</b></span><input name="nome" value="${esc(c.govbr_nome || '')}" required></label>
      </div>
      <div id="gvProc" class="small" style="margin-top:10px"></div>
      <div class="btns" style="margin-top:10px;flex-direction:column;align-items:flex-start;gap:6px">
        <label class="check"><input type="checkbox" name="nivel_ok"><span>Minha conta gov.br é nível <b>prata</b> ou <b>ouro</b> (exigido pelo Emissor Nacional)</span></label>
        <label class="check hidden" id="gvConf"><input type="checkbox" name="confirma_procuracao"><span>Confirmo que há procuração eletrônica vigente no e-CAC, com o serviço <b>NFS-e</b>, outorgada por ${esc(c.razao_social)}</span></label>
      </div>
    </form>
    <div id="gvRes" style="margin-top:12px"></div>`;
  let prep = null;
  await modal({
    titulo: 'Emitir com a conta gov.br', wide: true, corpo,
    botoes: [
      { texto: 'Cancelar', valor: null },
      { texto: `${icon('check')}Validar dados`, acao: async bg => { await validar(bg); return false; } },
      { texto: `${icon('send')}Validar e abrir o Emissor Nacional`, cls: 'primary', acao: async bg => {
        const f = $('#fGov', bg);
        if (!f.reportValidity()) return false;
        try {
          prep = await post('/api/notas/govbr/preparar', { ...p, rascunho_id: rascunhoId || undefined, representante: dadosRep(f) });
          return true;
        } catch (e) { mostrar(bg, { erros: e.dados?.erros?.length ? e.dados.erros : [{ msg: e.message }], avisos: e.dados?.avisos || [], ok: [] }); return false; }
      } },
    ],
    onOpen: bg => {
      const f = $('#fGov', bg);
      mascaras(f);
      const atualizar = () => {
        const papel = f.papel.value;
        $('#gvConf', bg).classList.toggle('hidden', papel !== 'procurador');
        $('#gvProc', bg).innerHTML = papel === 'procurador'
          ? (procs.length ? `Procurações cadastradas: ${procs.map(x => `<a href="#" data-pr="${esc(x.procurador_doc || '')}" data-nm="${esc(x.procurador_nome || x.titular || '')}">${esc(x.procurador_nome || x.titular || '')} (${fmtDoc(x.procurador_doc || '')})${x.valida_ate ? ` até ${dataBR(x.valida_ate)}` : ''}</a>`).join(' · ')}` : '<span class="muted">Nenhuma procuração cadastrada no app para esta empresa: será preciso confirmar a procuração do e-CAC.</span>')
          : papel === 'responsavel' && c.responsavel_cpf ? `<span class="muted">Responsável legal cadastrado: ${esc(c.responsavel_nome || '')} (CPF ***.${esc(c.responsavel_cpf.slice(3, 6))}.${esc(c.responsavel_cpf.slice(6, 9))}-**).</span> <a href="#" id="gvUsarResp">Usar</a>`
          : papel === 'titular' ? `<span class="muted">O CPF deve ser o do prestador: ${fmtDoc(c.documento)}.</span>` : '';
        $$('[data-pr]', bg).forEach(a => a.onclick = e => { e.preventDefault(); f.cpf.value = fmtDoc(a.dataset.pr); f.nome.value = a.dataset.nm; });
        const ur = $('#gvUsarResp', bg);
        if (ur) ur.onclick = e => { e.preventDefault(); f.cpf.value = fmtDoc(c.responsavel_cpf); f.nome.value = c.responsavel_nome || ''; };
        if (papel === 'titular' && !so(f.cpf.value)) { f.cpf.value = fmtDoc(c.documento); f.nome.value = f.nome.value || c.razao_social; }
      };
      $$('[name=papel]', f).forEach(r => r.onchange = atualizar);
      atualizar();
    },
  });
  if (!prep) return null;
  toast(`Rascunho nº ${prep.rascunho_id} preparado. Conclua a emissão no Emissor Nacional.`, 'ok');
  await abrirEmissorGovBr(c, p, prep.calc, prep);
  return prep;

  function dadosRep(f) {
    return { papel: f.papel.value, cpf: so(f.cpf.value), nome: f.nome.value.trim(), nivel_ok: f.nivel_ok.checked, confirma_procuracao: f.confirma_procuracao.checked };
  }
  async function validar(bg) {
    const f = $('#fGov', bg);
    try { mostrar(bg, await post('/api/notas/govbr/validar-representante', { contribuinte_id: c.id, representante: dadosRep(f) })); } catch (e) { toast(e.message, 'error'); }
  }
  function mostrar(bg, v) {
    const li = (cls, ic, arr) => arr.length ? `<div class="alert ${cls} small" style="margin-top:8px">${icon(ic)}<div>${arr.map(x => esc(x.msg || x)).join('<br>')}</div></div>` : '';
    $('#gvRes', bg).innerHTML = li('error', 'alert', v.erros || []) + li('warn', 'info', v.avisos || []) + li('ok', 'check', v.ok || [])
      + (!(v.erros || []).length ? '<div class="small muted" style="margin-top:6px">Representante validado. A nota será validada ao abrir o Emissor Nacional.</div>' : '');
  }
}

/**
 * Abre o Emissor Nacional (gov.br) e o assistente com os dados da nota.
 * @param c empresa emitente; @param p payload da emissão (opcional); @param k cálculo (opcional);
 * @param prep resultado de /api/notas/govbr/preparar (opcional: representante, URL do ambiente, rascunho)
 */
export async function abrirEmissorGovBr(c, p = null, k = null, prep = null) {
  const linhas = linhasDaNota(c, p, k);
  const rep = prep?.representante;
  const url = prep?.url || URL_EMISSOR;
  const passoRep = !rep ? `No menu do usuário, use <b>Procuração/Representação</b> e informe <b>${fmtDoc(c.documento)}</b> (${esc(c.razao_social)}), se for responsável legal ou procurador.`
    : rep.papel === 'titular' ? `Você entra como o próprio prestador (${fmtDoc(c.documento)}): não é preciso trocar de perfil.`
    : `No menu do usuário, use <b>Procuração/Representação</b> (alternar perfil) e escolha <b>${fmtDoc(c.documento)}</b> (${esc(c.razao_social)}) — você atua como <b>${rep.papel === 'procurador' ? 'procurador' : 'responsável legal'}</b>.`;
  // Windows: os dados vão junto para o painel "Vorticis" mostrado dentro da página do Emissor Nacional
  const painel = { empresa: `${c.razao_social} — ${fmtDoc(c.documento)}`, representante: rep ? `${rep.nome} (${fmtDoc(rep.cpf)}) · ${rep.papel_label.split(' (')[0]}` : '', rascunho: prep?.rascunho_id || null, linhas };
  const alvo = ehDesktop() ? `${url}#vorticis=${encodeURIComponent(JSON.stringify(painel))}` : url;
  window.open(alvo, ehDesktop() ? 'vorticis-emissor-nacional' : '_blank', ehDesktop() ? 'width=1200,height=900' : 'noopener');
  await modal({
    titulo: 'Emitir pelo Emissor Nacional (conta gov.br)', wide: true,
    corpo: `${rep ? `<div class="alert ok small" style="margin-bottom:10px">${icon('check')}<div><b>${esc(rep.nome)}</b> (${fmtDoc(rep.cpf)}) — ${esc(rep.papel_label)}. Nota validada e guardada como rascunho nº ${prep.rascunho_id}.${(prep.avisos || []).length ? `<br><span style="color:var(--warning)">${prep.avisos.map(esc).join('<br>')}</span>` : ''}</div></div>` : ''}
      <ol class="small" style="margin-top:0;padding-left:18px;display:grid;gap:4px">
        <li>Entre no Emissor Nacional com a <b>conta gov.br</b> (nível prata ou ouro)${ehDesktop() ? ' na janela aberta ao lado. O login fica salvo neste computador' : ' na aba aberta'}.</li>
        <li>${passoRep}</li>
        <li>Emita a nota com os dados abaixo.${ehDesktop() ? ' No Emissor há um <b>painel Vorticis</b> (canto inferior direito): clique no campo do Emissor e depois em <b>Inserir</b> no painel.' : ' Use o botão de copiar ao lado de cada campo.'}</li>
        <li>Baixe o <b>XML</b> da NFS-e. ${ehDesktop() ? 'O app importa automaticamente, substitui o rascunho e abre a nota aqui.' : 'Depois clique em "Importar XML" para trazê-la ao app (o rascunho é substituído pela nota autorizada).'}</li></ol>
      <div class="alert info small" style="margin:10px 0">${icon('info')}<div>O Emissor Nacional usa a série de DPS do Emissor Web (70000–79999), separada da série deste app: a numeração não conflita.</div></div>
      ${linhas.length ? `<div class="table-wrap"><table class="copiar"><tbody>${linhas.map(([r, v], i) => `<tr><td style="width:240px" class="small muted">${esc(r)}</td><td>${esc(v)}</td><td style="width:44px"><button class="btn sm ghost" data-cp="${i}" title="Copiar">${icon('copy')}</button></td></tr>`).join('')}</tbody></table></div>` : ''}`,
    botoes: [
      { texto: `${icon('download')}Importar XML`, acao: () => { escolherXmls('govbr'); return false; } },
      { texto: `${icon('send')}Abrir o Emissor novamente`, acao: () => { window.open(alvo, ehDesktop() ? 'vorticis-emissor-nacional' : '_blank'); return false; } },
      { texto: 'Fechar', cls: 'primary', valor: true },
    ],
    onOpen: bg => $$('[data-cp]', bg).forEach(b => b.onclick = async () => {
      const v = linhas[+b.dataset.cp][2];
      try { await navigator.clipboard.writeText(v); } catch {
        const ta = document.createElement('textarea'); ta.value = v; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      b.innerHTML = icon('check'); setTimeout(() => { b.innerHTML = icon('copy'); }, 1200);
    }),
  });
}
