// Consulta ao cadastro da Receita Federal (CNPJ) + inscrição municipal conhecida, preenchendo formulários.
import { get, post } from './api.js';
import { $, esc, icon, modal, toast, preencherForm, so } from './ui.js';

/**
 * Consulta o CNPJ e preenche o formulário. `prefixo` é o prefixo dos campos (ex.: 't_' na emissão);
 * `nome` é o nome do campo da razão social; campos já preenchidos de IM não são sobrescritos.
 */
export async function preencherPelaReceita(form, documento, { prefixo = '', nome = 'nome', extra = () => ({}), campoMun } = {}) {
  const d = await get(`/api/consulta/cnpj/${so(documento)}`);
  const n = k => prefixo + k;
  const val = { [n(nome)]: d.nome, [n('cep')]: d.cep, [n('logradouro')]: d.logradouro, [n('numero')]: d.numero, [n('complemento')]: d.complemento, [n('bairro')]: d.bairro,
    [n('cod_municipio')]: d.cod_municipio, [n('uf')]: d.uf, ...extra(d) };
  if (d.email) val[n('email')] = d.email;
  if (d.fone) val[n('fone')] = d.fone;
  const im = form.querySelector(`[name="${n('im')}"]`);
  if (im && !im.value && d.im) val[n('im')] = d.im;
  preencherForm(form, val);
  if (campoMun && d.cod_municipio) campoMun.value = `${d.municipio}/${d.uf}`;
  const partes = [`${esc(d.nome)}${d.ativa ? '' : ` — <b>situação: ${esc(d.situacao)}</b>`}`];
  partes.push(d.im ? `IM ${esc(d.im)} (${esc(d.im_fonte)})` : 'IM não localizada: informe manualmente');
  toast(`${partes.join(' · ')}`, d.ativa ? 'ok' : 'error');
  if (im && !im.value && !d.im) { im.placeholder = 'não localizada – informe'; im.title = d.im_aviso; }
  return d;
}

/** Completa em lote (empresas ou clientes) pelo cadastro da Receita e pelas NFS-e já registradas. */
export async function completarCadastros(tipo, aoTerminar) {
  const ok = await modal({ titulo: 'Completar cadastros pela Receita', corpo: `<p>Para cada ${tipo === 'contribuintes' ? 'empresa' : 'cliente'} com CNPJ, o sistema consulta o cadastro da Receita Federal e preenche <b>apenas os campos vazios</b>: endereço completo, município, UF, telefone e e-mail.</p>
    <p>A <b>inscrição municipal</b> não consta do cadastro da Receita e o cadastro nacional de contribuintes (CNC) é exclusivo das prefeituras. Por isso ela é buscada nas NFS-e já emitidas, recebidas ou importadas do ADN, em que a Sefin grava a IM do CNC.</p>`,
    botoes: [{ texto: 'Cancelar', valor: false }, { texto: `${icon('refresh')}Completar agora`, cls: 'primary', valor: true }] });
  if (!ok) return;
  toast('Consultando a Receita… isso pode levar alguns segundos por cadastro.');
  try {
    const r = await post('/api/cadastros/completar', { tipo });
    await modal({ titulo: 'Cadastros completados', wide: true, corpo: `<p>${r.atualizados} de ${r.total} cadastro(s) atualizado(s), ${r.ims} inscrição(ões) municipal(is) encontrada(s).</p>
      ${r.itens.filter(i => i.campos.length).length ? `<div class="table-wrap"><table><thead><tr><th>Cadastro</th><th>Campos preenchidos</th></tr></thead><tbody>${r.itens.filter(i => i.campos.length).map(i => `<tr><td>${esc(i.nome)}</td><td class="small">${esc(i.campos.join(', '))}${i.im_fonte ? ` <span class="muted">(IM: ${esc(i.im_fonte)})</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${r.erros.length ? `<div class="alert error" style="margin-top:10px">${icon('alert')}<div class="small">${r.erros.map(e => `${esc(e.nome)}: ${esc(e.erro)}`).join('<br>')}</div></div>` : ''}`, botoes: [{ texto: 'OK', cls: 'primary' }] });
    aoTerminar?.();
  } catch (e) { toast(e.message, 'error'); }
}
