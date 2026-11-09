// Numeração da DPS/NFS-e e diagnóstico para entrada em produção
import { get, post, put } from '../api.js';
import { $, esc, icon, modal, toast, badge, dataHoraBR, dataBR, confirmar, AMB } from '../ui.js';
import { carregarContribs } from '../app.js';

const ST = { ok: 'OK', aviso: 'Atenção', erro: 'Pendência', info: 'Info' };

export async function abrirNumeracao(c, aoMudar) {
  let seq = await get(`/api/contribuintes/${c.id}/sequencia`);
  const real = c.ambiente !== 'simulacao';
  const corpo = () => `
    <div class="grid g4">
      <div class="card kpi"><div class="lbl">Série da DPS</div><div class="val">${esc(seq.serie)}</div><div class="delta muted">${badge(seq.ambiente, AMB)}</div></div>
      <div class="card kpi"><div class="lbl">Último nº de DPS (neste aparelho)</div><div class="val">${seq.ultimoDPSLocal || '—'}</div>${seq.ultimoDPSSefin !== undefined ? `<div class="delta">Na Sefin: <b>${seq.ultimoDPSSefin || 'nenhum'}</b></div>` : ''}</div>
      <div class="card kpi"><div class="lbl">Próximo nº de DPS</div><div class="val">${seq.proxNDPS}</div><div class="delta muted">${seq.ajustado ? '<span class="up">ajustado pela Sefin</span>' : ''}</div></div>
      <div class="card kpi"><div class="lbl">Última NFS-e</div><div class="val">${esc(seq.ultimaNFSe?.nnfse || '—')}</div><div class="delta muted">${seq.ultimaNFSe ? dataBR(seq.ultimaNFSe.competencia) : ''}</div></div>
    </div>
    ${seq.pendentes ? `<div class="alert error" style="margin-top:12px">${icon('alert')}<div>${seq.pendentes} nota(s) <b>pendente(s)</b> sem resposta da Sefin. Abra-as em Notas emitidas e use "Consultar Sefin" antes de continuar emitindo.</div></div>` : ''}
    ${seq.outrasSeries?.length ? `<div class="small muted" style="margin-top:10px">Outras séries já usadas: ${seq.outrasSeries.map(s => `${esc(s.serie)} (até nº ${s.ultimo})`).join(', ')}</div>` : ''}
    <div class="alert info" style="margin-top:12px">${icon('info')}<div class="small">
      <b class="t">Como a numeração é controlada:</b> a DPS é única por <b>série + número + município + CNPJ/CPF</b>. A série deve ficar entre 00001 e 49999 (aplicativo próprio); o Emissor Web da Receita usa 70000–79999, então não há conflito com o portal.
      Se usar o Vorticis em mais de um aparelho (Windows e Android), <b>use uma série diferente em cada um</b>. O número da NFS-e é gerado pela Sefin, em sequência por emitente, e nunca se perde.
      Antes de cada envio o app consulta a Sefin para não reutilizar números; se a resposta se perder, a nota fica pendente e é recuperada pelo número da DPS.</div></div>
    <div class="grid g3" style="margin-top:14px;align-items:end">
      <label class="f"><span>Série</span><input id="nSerie" value="${esc(seq.serie)}" maxlength="5"></label>
      <label class="f"><span>Próximo número</span><input id="nProx" type="number" min="1" value="${seq.proxNDPS}"></label>
      <button class="btn" id="nSalvar">${icon('save')}Ajustar manualmente</button>
    </div>
    <div class="small muted" style="margin-top:10px">ADN: último NSU ${seq.ultimoNSU || 0}${seq.sincronizadoEm ? ` · importado em ${dataHoraBR(seq.sincronizadoEm)}` : ''}</div>`;
  await modal({
    titulo: `Numeração — ${esc(c.nome_fantasia || c.razao_social)}`, wide: true, corpo: corpo(),
    botoes: [
      { texto: `${icon('refresh')}Verificar na Sefin`, acao: async bg => {
        if (!real) throw new Error('Mude o ambiente da empresa para Produção restrita ou Produção para consultar a Sefin.');
        seq = await post(`/api/contribuintes/${c.id}/sequencia/verificar`);
        $('.modal-body', bg).innerHTML = corpo(); ligar(bg);
        toast(seq.ajustado ? `Próximo nº ajustado para ${seq.proxNDPS} (último na Sefin: ${seq.ultimoDPSSefin}).` : `Numeração em dia (último na Sefin: ${seq.ultimoDPSSefin || 'nenhum'}).`, 'ok');
        aoMudar?.(); return false;
      } },
      { texto: `${icon('download')}Importar notas do ADN`, acao: async bg => {
        if (!real) throw new Error('A importação do ADN funciona em Produção restrita ou Produção.');
        const r = await post(`/api/contribuintes/${c.id}/importar-adn`, {});
        seq = r.sequencia;
        $('.modal-body', bg).innerHTML = corpo(); ligar(bg);
        toast(`ADN: ${r.importadas} nova(s), ${r.atualizadas} atualizada(s), ${r.eventos} evento(s)${r.concluida ? '' : ' — há mais documentos, clique novamente'}.${r.erros.length ? ' Erros: ' + r.erros.map(e => e.descricao).join('; ') : ''}`, r.erros.length ? 'error' : 'ok');
        aoMudar?.(); return false;
      } },
      { texto: 'Fechar', cls: 'primary', valor: true },
    ],
    onOpen: bg => ligar(bg),
  });
  function ligar(bg) {
    $('#nSalvar', bg).onclick = async () => {
      try {
        const prox = +$('#nProx', bg).value;
        let forcar = false;
        if (prox <= seq.ultimoDPSLocal) forcar = await confirmar('Número já utilizado', `O nº ${prox} é menor ou igual ao último usado (${seq.ultimoDPSLocal}). Isso causará rejeição E0014 se a DPS já existir. Continuar mesmo assim?`, 'Continuar', 'danger');
        if (prox <= seq.ultimoDPSLocal && !forcar) return;
        seq = await put(`/api/contribuintes/${c.id}/sequencia`, { serie: $('#nSerie', bg).value, prox_ndps: prox, forcar });
        $('.modal-body', bg).innerHTML = corpo(); ligar(bg);
        toast('Numeração ajustada.', 'ok'); await carregarContribs(); aoMudar?.();
      } catch (e) { toast(e.message, 'error'); }
    };
  }
}

export async function abrirDiagnostico(c, aoMudar) {
  let d = await get(`/api/contribuintes/${c.id}/diagnostico`);
  const corpo = () => {
    const grupos = {};
    for (const x of d.checks) (grupos[x.grupo] ||= []).push(x);
    return `
    <div class="alert ${d.erros ? 'error' : d.avisos ? 'warn' : 'ok'}" style="margin-bottom:14px">${icon(d.erros ? 'alert' : 'check')}<div>
      ${d.erros ? `<b>${d.erros} pendência(s)</b> impedem a emissão em produção.` : d.prontoProducao ? '<b>Tudo pronto para emitir em produção.</b>' : 'Sem pendências críticas.'} ${d.avisos ? `${d.avisos} ponto(s) de atenção.` : ''}</div></div>
    ${Object.entries(grupos).map(([g, itens]) => `<h3 style="margin:14px 0 6px">${esc(g)}</h3><div class="table-wrap"><table><tbody>
      ${itens.map(x => `<tr><td style="width:120px">${badge(x.status, ST)}</td><td style="width:260px"><b>${esc(x.item)}</b></td><td class="small">${esc(x.detalhe)}</td></tr>`).join('')}</tbody></table></div>`).join('')}
    <details class="collapse" style="margin-top:16px"><summary>O que é necessário fora do sistema para emitir em produção</summary><div class="small" style="display:grid;gap:6px">
      <div>1. <b>Município aderido ao Sistema Nacional NFS-e</b> (convênio ativo). Se o município não tiver aderido, a emissão é feita no sistema próprio da prefeitura.</div>
      <div>2. <b>Certificado A1 ICP-Brasil</b> (e-CNPJ da empresa ou e-CPF/e-CNPJ do procurador). Certificados A3 (token/cartão) não podem ser usados por aplicativos via API.</div>
      <div>3. <b>Cadastro no CNC</b>: se a prefeitura mantém cadastro complementar do contribuinte, informe a Inscrição Municipal; se não mantém, deixe em branco.</div>
      <div>4. <b>Procuração eletrônica</b> (quando o certificado é de contador/procurador): cadastrada no e-CAC com o serviço <b>NFS-e</b> e dentro da validade.</div>
      <div>5. <b>Teste na Produção restrita</b>: emita, consulte e cancele ao menos uma nota com o certificado real e confira o DANFSe.</div>
      <div>6. <b>Numeração</b>: use uma série exclusiva por instalação e rode "Verificar na Sefin" antes da primeira nota em produção.</div>
      <div>7. Parametrização municipal: confira alíquota, regimes especiais e retenções exigidos pelo município (Consulta de códigos → Tributação Municipal).</div>
    </div></details>`;
  };
  await modal({
    titulo: `Diagnóstico de produção — ${esc(c.nome_fantasia || c.razao_social)}`, wide: true, corpo: corpo(),
    botoes: [
      { texto: `${icon('send')}Testar comunicação (Produção restrita)`, acao: async bg => { d = await get(`/api/contribuintes/${c.id}/diagnostico?remoto=1&ambiente=homologacao`); $('.modal-body', bg).innerHTML = corpo(); return false; } },
      { texto: `${icon('shield')}Testar comunicação (Produção)`, acao: async bg => { d = await get(`/api/contribuintes/${c.id}/diagnostico?remoto=1&ambiente=producao`); $('.modal-body', bg).innerHTML = corpo(); return false; } },
      ...(c.ambiente !== 'producao' ? [{ texto: 'Ativar Produção', cls: 'primary', acao: async bg => {
        if (d.erros) throw new Error('Resolva as pendências antes de ativar a produção.');
        const ok = await confirmar('Ativar ambiente de PRODUÇÃO', `A partir de agora as notas de <b>${esc(c.razao_social)}</b> terão validade fiscal. ${d.prontoProducao ? '' : '<br><b>Atenção:</b> ainda não há nota autorizada em Produção restrita.'}`, 'Ativar produção', 'danger');
        if (!ok) return false;
        await put(`/api/contribuintes/${c.id}`, { ambiente: 'producao' });
        await carregarContribs(); aoMudar?.();
        toast('Ambiente de produção ativado. Rode "Verificar na Sefin" na numeração antes da primeira nota.', 'ok');
        void bg; return true;
      } }] : []),
      { texto: 'Fechar', valor: true },
    ],
  });
}
