// Representação da empresa perante o Sistema Nacional NFS-e (Guia do Emissor Nacional v1.3, item 11):
// responsável legal e mesma raiz de CNPJ (base CNPJ), procuração eletrônica e acesso gov.br (Emissor Web).
import { get, put } from '../api.js';
import { $, $$, esc, icon, modal, toast, fmtDoc, dataBR } from '../ui.js';
import { carregarContribs } from '../app.js';
import { abrirEmissorGovBr } from '../govbr.js';

const VIA = { certificado: ['Empresa', 'b-ok'], raiz: ['Mesma raiz de CNPJ', 'b-info'], responsavel: ['Responsável legal', 'b-info'], procuracao: ['Procurador', 'b-aviso'] };

export async function abrirRepresentacao(c, aoMudar) {
  let acessos = (await get(`/api/contribuintes/${c.id}/acessos`));
  let resp = c.responsavel_cpf ? { cpf: c.responsavel_cpf, nome: c.responsavel_nome, fonte: c.responsavel_fonte } : null;
  let info = null;
  const corpo = () => `
    <p class="small muted" style="margin-top:0">Desde 01/11/2026 o Sistema Nacional NFS-e aceita, também nas APIs usadas por este app, a emissão em nome da empresa pelo <b>responsável legal</b>, por <b>estabelecimento da mesma raiz de CNPJ</b> e por <b>procurador</b> com procuração eletrônica. A Sefin confere o vínculo pelo certificado da conexão e pela assinatura (Guia do Emissor Nacional v1.3, item 11).</p>
    <h3 style="margin:10px 0 6px">Como esta empresa pode emitir pelo app</h3>
    ${acessos.length ? `<div class="table-wrap"><table><tbody>${acessos.map(a => `<tr><td style="width:170px"><span class="badge ${VIA[a.via]?.[1] || ''}">${VIA[a.via]?.[0] || a.via}</span></td><td>${esc(a.rotulo.replace(/^[^:]+: /, ''))}</td><td class="small muted">certificado até ${dataBR(String(a.valido_ate).slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="alert warn">${icon('alert')}<div class="small">Nenhum certificado com vínculo com a empresa. Cadastre o certificado da empresa, o do responsável legal ou uma procuração, ou emita pela sua conta gov.br no Emissor Nacional.</div></div>`}

    <h3 style="margin:16px 0 6px">Responsável legal (e-CPF)</h3>
    <div class="small">${resp ? `Atual: <b>${esc(resp.nome || '')}</b> — CPF ${fmtDoc(resp.cpf)} <span class="muted">(${esc(resp.fonte || '')})</span>` : '<span class="muted">Não informado.</span>'}</div>
    <div id="rpCand" style="margin-top:8px">${info ? candidatos() : ''}</div>
    <div class="grid g3" style="margin-top:10px;align-items:end">
      <label class="f"><span>CPF do responsável legal</span><input id="rpCpf" data-mask="doc" inputmode="numeric" value="${resp ? fmtDoc(resp.cpf) : ''}"></label>
      <label class="f"><span>Nome</span><input id="rpNome" value="${esc(resp?.nome || '')}"></label>
      <div class="btns"><button class="btn" id="rpIdent">${icon('search')}Identificar</button><button class="btn primary" id="rpSalvar">${icon('save')}Salvar</button>${resp ? `<button class="btn ghost danger" id="rpRemover">${icon('trash')}</button>` : ''}</div>
    </div>
    <div class="small muted" style="margin-top:6px">"Identificar" usa o e-CNPJ da empresa (o certificado ICP-Brasil traz o CPF do responsável) e o quadro societário da Receita, comparado com os e-CPF cadastrados. Depois cadastre o e-CPF do responsável em <b>Certificados</b>: arquivo .pfx ou certificado instalado no computador.</div>

    <h3 style="margin:16px 0 6px">Procurador (contador / escritório)</h3>
    <div class="small">A empresa outorga a procuração no <a href="https://servicos.receitafederal.gov.br/" target="_blank" rel="noopener">Portal de Serviços da Receita Federal</a> → "Nova Autorização", informando o CPF/CNPJ do procurador, a vigência e o <b>serviço específico da NFS-e</b>. Depois, vincule o certificado do procurador em <b>Certificados e procurações → Nova procuração</b>. O vencimento pode ser conferido pelo Integra Contador.</div>

    <h3 style="margin:16px 0 6px">Conta gov.br (sem certificado)</h3>
    <div class="small">A conta gov.br (níveis prata ou ouro) dá acesso apenas ao <b>Emissor Nacional (web)</b>; as APIs exigem certificado. O app abre o Emissor Nacional com os dados da nota à mão e importa o XML que você baixar. No Emissor, use "Procuração/Representação" para atuar como responsável legal ou procurador.</div>
    <div class="btns" style="margin-top:8px"><button class="btn" id="rpGov">${icon('shield')}Abrir Emissor Nacional (gov.br)</button></div>`;
  function candidatos() {
    const l = info.candidatos || [];
    return `${l.length ? `<div class="small"><b>Encontrados:</b></div><div class="btns" style="margin-top:4px">${l.map((x, i) => `<button class="btn sm" data-cand="${i}" title="${esc(x.fonte)}">${esc(x.nome || 'CPF')} ${fmtDoc(x.cpf)} · ${esc(x.fonte)}${x.certificado_id ? ' · e-CPF cadastrado' : ''}</button>`).join('')}</div>`
      : '<div class="small muted">Nenhum responsável identificado automaticamente: o e-CPF do responsável precisa estar cadastrado, ou informe o CPF abaixo.</div>'}
      ${info.qsa?.length ? `<details class="collapse" style="margin-top:6px"><summary class="small">Quadro societário na Receita (${info.qsa.length})</summary><div class="small">${info.qsa.map(q => `${esc(q.nome)} — ${esc(q.cpf_mascarado)} — ${esc(q.qualificacao)}${q.responsavel ? ' <b>(qualificação do responsável)</b>' : ''}`).join('<br>')}</div></details>` : ''}`;
  }
  const salvar = async (cpf, nome, fonte) => {
    const r = await put(`/api/contribuintes/${c.id}/responsavel`, { cpf, nome, fonte });
    acessos = r.acessos;
    resp = cpf ? { cpf: cpf.replace(/\D/g, ''), nome, fonte: fonte || 'informado manualmente' } : null;
    await carregarContribs(); aoMudar?.();
  };
  await modal({
    titulo: `Representação — ${esc(c.nome_fantasia || c.razao_social)}`, wide: true, corpo: corpo(),
    botoes: [{ texto: 'Fechar', cls: 'primary', valor: true }],
    onOpen: bg => {
      const ligar = () => {
        $('#rpIdent', bg).onclick = async e => {
          e.target.disabled = true;
          try { info = await get(`/api/contribuintes/${c.id}/responsavel`); $('#rpCand', bg).innerHTML = candidatos(); ligarCand(); }
          catch (er) { toast(er.message, 'error'); } finally { e.target.disabled = false; }
        };
        $('#rpSalvar', bg).onclick = async () => {
          try { await salvar($('#rpCpf', bg).value, $('#rpNome', bg).value); toast('Responsável legal salvo.', 'ok'); render(); } catch (er) { toast(er.message, 'error'); }
        };
        if ($('#rpRemover', bg)) $('#rpRemover', bg).onclick = async () => { try { await salvar('', ''); toast('Responsável legal removido.'); render(); } catch (er) { toast(er.message, 'error'); } };
        $('#rpGov', bg).onclick = () => abrirEmissorGovBr(c);
        ligarCand();
      };
      const ligarCand = () => $$('[data-cand]', bg).forEach(b => b.onclick = async () => {
        const x = info.candidatos[+b.dataset.cand];
        try { await salvar(x.cpf, x.nome, x.fonte); toast('Responsável legal salvo.', 'ok'); render(); } catch (er) { toast(er.message, 'error'); }
      });
      const render = () => { $('.modal-body', bg).innerHTML = corpo(); ligar(); };
      ligar();
    },
  });
}
