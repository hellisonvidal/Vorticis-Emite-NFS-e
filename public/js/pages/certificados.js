import { get, post, put, del } from '../api.js';
import { $, $$, esc, icon, modal, toast, confirmar, campo, fmtDoc, dataBR, badge, vazio, arquivoBase64 } from '../ui.js';
import { estado } from '../estado.js';
import { carregarContribs } from '../app.js';

const SIT = { valido: 'Válido', vencendo: 'Vencendo', vencido: 'Vencido' };

export async function paginaCertificados(view) {
  const [certs, procs] = await Promise.all([get('/api/certificados'), get('/api/procuracoes')]);
  view.innerHTML = `
  <div class="page-head"><div><h1>Certificados e procurações</h1><p>Certificados A1 ICP-Brasil (armazenados criptografados) e procurações eletrônicas para emitir em nome de terceiros</p></div></div>
  <div class="card">
    <div class="card-head"><h2>${icon('key', 'style="width:18px"')} Certificados digitais</h2><div class="btns"><button class="btn" id="btnSis" title="Certificados do repositório do Windows ou do Android, inclusive token/cartão A3 no Windows">${icon('shield')}Usar certificado instalado</button><button class="btn primary" id="btnCert">${icon('plus')}Adicionar arquivo A1 (.pfx)</button></div></div>
    ${certs.length ? `<div class="table-wrap"><table><thead><tr><th>Apelido / Titular</th><th>Documento</th><th>Emissor</th><th>Validade</th><th>Situação</th><th>Cadeia ICP-Brasil</th><th></th></tr></thead><tbody>
      ${certs.map(c => `<tr><td><b>${esc(c.apelido || c.titular)}</b><div class="small muted">${esc(c.titular)}</div><div class="small">${c.origem === 'sistema' ? '<span class="badge b-info">instalado no sistema</span>' : '<span class="badge plain">arquivo .pfx</span>'}</div></td><td>${esc(c.tipo_doc)} ${fmtDoc(c.documento, c.tipo_doc)}</td><td class="small">${esc(c.emissor)}</td>
        <td>${dataBR(c.valido_ate)}<div class="small muted">${c.dias_restantes >= 0 ? `${c.dias_restantes} dias` : 'expirado'}</div></td><td>${badge(c.situacao, SIT)}</td>
        <td>${c.origem === 'sistema' ? '<span class="badge b-ok">pelo sistema</span><div class="small muted">gerenciada pelo Windows/Android</div>' : c.cadeia?.completa ? `<span class="badge b-ok">completa</span><div class="small muted">${c.cadeia.niveis} nível(is)${c.cadeia.complementada ? ' · baixada via AIA' : ''}</div>` : `<span class="badge b-erro">incompleta</span><div class="small muted">${esc(c.cadeia?.aviso || 'o ADN pode recusar a conexão')}</div>`}</td>
        <td class="nowrap">${c.cadeia?.completa ? '' : `<button class="btn sm" data-cad="${c.id}" title="Baixar ACs intermediárias pelo endereço AIA do certificado">${icon('refresh')}Completar cadeia</button>`}<button class="btn sm ghost danger" data-del="${c.id}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>`
      : vazio('Nenhum certificado cadastrado. Sem certificado é possível emitir apenas em modo simulação.', 'key')}
    <div class="alert info" style="margin-top:14px">${icon('info')}<div class="small"><b class="t">Como funciona:</b> a API da Sefin Nacional exige autenticação mútua TLS com certificado ICP-Brasil e assinatura XML da DPS. O certificado pode ser da própria empresa (e-CNPJ) ou de um procurador (e-CPF/e-CNPJ) com procuração eletrônica válida para NFS-e. Login com usuário e senha dá acesso a este sistema; a transmissão sempre usa um certificado.</div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>${icon('users', 'style="width:18px"')} Procurações eletrônicas</h2><div class="btns"><button class="btn" id="btnReceita" ${procs.length ? '' : 'disabled'} title="Consulta as procurações eletrônicas na Receita Federal via Integra Contador (SERPRO)">${icon('search')}Consultar vencimentos na Receita</button><button class="btn primary" id="btnProc" ${certs.length && estado.contribs.length ? '' : 'disabled'}>${icon('plus')}Nova procuração</button></div></div>
    ${procs.length ? `<div class="table-wrap"><table><thead><tr><th>Outorgante (empresa)</th><th>Procurador (certificado)</th><th>Escopo</th><th>Vigência</th><th>Situação</th><th></th></tr></thead><tbody>
      ${procs.map(p => { const venc = p.valida_ate && p.valida_ate < new Date().toISOString().slice(0, 10); return `<tr>
        <td><b>${esc(p.razao_social)}</b><div class="small muted">${fmtDoc(p.contrib_doc)}</div></td>
        <td>${esc(p.titular)}<div class="small muted">${fmtDoc(p.cert_doc)} · cert. até ${dataBR(p.cert_validade)}</div></td>
        <td>${p.escopo.split(',').map(e => `<span class="badge plain">${esc(e)}</span>`).join(' ')}</td>
        <td>${p.valida_de ? dataBR(p.valida_de) : '—'} a ${p.valida_ate ? dataBR(p.valida_ate) : 'indeterminado'}<div class="small muted">${p.fonte_validade === 'receita' ? `confirmada na Receita${p.verificada_em ? ' em ' + dataBR(p.verificada_em.slice(0, 10)) : ''}` : 'informada manualmente'}</div>${p.sistemas ? `<div class="small muted" title="${esc(p.sistemas)}">${esc(p.sistemas.slice(0, 60))}</div>` : ''}</td>
        <td>${!p.ativo ? '<span class="badge">inativa</span>' : venc ? badge('vencido', SIT) : badge('valido', SIT)}</td>
        <td class="nowrap"><button class="btn sm ghost" data-tog="${p.id}" data-at="${p.ativo}">${p.ativo ? 'Desativar' : 'Ativar'}</button><button class="btn sm ghost danger" data-pdel="${p.id}">${icon('trash')}</button></td></tr>`; }).join('')}
      </tbody></table></div>` : vazio('Nenhuma procuração cadastrada. Use quando um contador/procurador emite em nome de clientes — é possível ter várias procurações por empresa.', 'users')}
    <div class="alert warn" style="margin-top:14px">${icon('alert')}<div class="small"><b class="t">Importante:</b> a procuração precisa estar registrada oficialmente (Procuração Eletrônica no e-CAC/Sistema Nacional NFS-e) com o serviço de NFS-e. Aqui você apenas vincula o certificado do procurador à empresa outorgante para assinar e transmitir.</div></div>
  </div>`;

  $('#btnSis').onclick = async () => {
    let r;
    try { r = await get('/api/certificados/sistema'); } catch (e) { return toast(e.message, 'error'); }
    if (!r.suportado) return toast(r.erro || 'Certificados instalados podem ser usados no aplicativo Windows ou Android. No navegador, use o arquivo .pfx.', 'error');
    const importar = async id => { const c = await post('/api/certificados/sistema', { id }); toast(`Certificado de ${c.titular} vinculado.`, 'ok'); paginaCertificados(view); };
    if (r.escolhaNativa) { try { await importar(null); } catch (e) { toast(e.message, 'error'); } return; }
    await modal({ titulo: 'Certificados instalados neste computador', wide: true, corpo: r.certificados.length ? `<p class="small muted" style="margin-top:0">Repositório pessoal do Windows. A chave privada continua no Windows: o app pede ao sistema para assinar e para autenticar na Sefin. Se for token ou cartão (A3), o Windows pedirá o PIN.</p>
      <div class="cert-lista">${r.certificados.map(c => `<button type="button" class="cert-item" data-sid="${esc(c.id)}" ${c.vencido || !c.documento ? 'disabled' : ''}><span class="ci-ic">${icon('key')}</span><span class="ci-tx"><b>${esc(c.titular)}</b>
        <span class="small muted">${c.documento ? `${c.tipo_doc} ${fmtDoc(c.documento)}` : 'sem CPF/CNPJ ICP-Brasil'} · ${esc(c.emissor)}</span><span class="small ${c.vencido ? 'neg' : 'muted'}">${c.vencido ? 'Vencido em' : 'Válido até'} ${dataBR(c.valido_ate.slice(0, 10))}</span></span></button>`).join('')}</div>`
      : `<div class="alert warn">${icon('alert')}<div class="small">Nenhum certificado com chave privada no repositório do Windows. Instale o certificado (duplo clique no arquivo .pfx) ou adicione o arquivo diretamente.</div></div>`,
      botoes: [{ texto: 'Fechar', valor: true }],
      onOpen: bg => $$('[data-sid]', bg).forEach(b => b.onclick = async () => { b.disabled = true; try { await importar(b.dataset.sid); bg.remove(); } catch (e) { toast(e.message, 'error'); b.disabled = false; } }) });
  };
  $('#btnCert').onclick = () => modal({
    titulo: 'Adicionar certificado A1', corpo: `<div class="grid">
      ${campo('Arquivo (.pfx / .p12)', '<input type="file" id="arq" accept=".pfx,.p12">', { req: true })}
      ${campo('Senha do certificado', '<input type="password" id="sen">', { req: true })}
      ${campo('Apelido', '<input id="ape" placeholder="Ex.: e-CNPJ Matriz">')}
      <div class="alert info small">${icon('shield')}<div>O arquivo e a senha são criptografados (AES-256-GCM) com a chave mestra do servidor local.</div></div></div>`,
    botoes: [{ texto: 'Cancelar', valor: null }, { texto: 'Validar e salvar', cls: 'primary', acao: async bg => {
      const f = $('#arq', bg).files[0];
      if (!f) throw new Error('Selecione o arquivo.');
      const r = await post('/api/certificados', { pfx: await arquivoBase64(f), senha: $('#sen', bg).value, apelido: $('#ape', bg).value });
      toast(`Certificado de ${r.titular} (${fmtDoc(r.documento)}) válido até ${dataBR(r.valido_ate)}.`, 'ok');
      // vincula automaticamente à empresa de mesmo documento
      const emp = estado.contribs.find(c => c.documento === r.documento && !c.certificado_id);
      if (emp) { await put(`/api/contribuintes/${emp.id}`, { certificado_id: r.id }); toast(`Vinculado à empresa ${emp.razao_social}.`); await carregarContribs(); }
      paginaCertificados(view);
    } }],
  });
  $('#btnProc').onclick = () => modal({
    titulo: 'Nova procuração eletrônica', corpo: `<div class="grid g2">
      ${campo('Empresa outorgante', `<select id="pEmp">${estado.contribs.map(c => `<option value="${c.id}">${esc(c.razao_social)} — ${fmtDoc(c.documento)}</option>`).join('')}</select>`, { cls: 'full' })}
      ${campo('Certificado do procurador', `<select id="pCert">${certs.map(c => `<option value="${c.id}">${esc(c.apelido || c.titular)} — ${fmtDoc(c.documento)}</option>`).join('')}</select>`, { cls: 'full' })}
      ${campo('Válida de', '<input type="date" id="pDe">')}${campo('Válida até', '<input type="date" id="pAte">')}
      <div class="full btns"><span class="muted small">Escopo:</span>${['emissao', 'consulta', 'cancelamento'].map(e => `<label class="check"><input type="checkbox" class="pEsc" value="${e}" checked> ${e}</label>`).join('')}</div>
      ${campo('Observação', '<input id="pObs" placeholder="Ex.: Procuração e-CAC nº …">', { cls: 'full' })}</div>`,
    botoes: [{ texto: 'Cancelar', valor: null }, { texto: 'Salvar', cls: 'primary', acao: async bg => {
      await post('/api/procuracoes', { contribuinte_id: $('#pEmp', bg).value, certificado_id: $('#pCert', bg).value, valida_de: $('#pDe', bg).value, valida_ate: $('#pAte', bg).value,
        escopo: $$('.pEsc', bg).filter(i => i.checked).map(i => i.value).join(','), observacao: $('#pObs', bg).value });
      toast('Procuração cadastrada.', 'ok'); await carregarContribs(); paginaCertificados(view);
    } }],
  });
  $$('[data-cad]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await post(`/api/certificados/${b.dataset.cad}/cadeia`); toast(r.cadeia?.completa ? 'Cadeia ICP-Brasil completada.' : `Não foi possível completar: ${r.cadeia?.aviso || 'AIA indisponível'}`, r.cadeia?.completa ? 'ok' : 'error'); paginaCertificados(view); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
  $('#btnReceita').onclick = async () => {
    const btn = $('#btnReceita'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Consultando…';
    try {
      const r = await post('/api/procuracoes/verificar-receita', {});
      await modal({ titulo: 'Procurações na Receita Federal (Integra Contador)', wide: true, corpo: `
        ${r.trial ? `<div class="alert warn" style="margin-bottom:12px">${icon('alert')}<div>Modo <b>trial</b> do SERPRO: os dados abaixo são fictícios e as datas não foram gravadas. Configure a contratação em <b>Configurações → Integra Contador</b>.</div></div>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Procurador</th><th>Válida até</th><th>Sistemas</th></tr></thead><tbody>
        ${r.resultados.map(x => `<tr><td>${esc(x.empresa)}</td><td>${esc(x.procurador || '')}</td><td>${x.erro ? `<span class="badge b-erro">erro</span><div class="small">${esc(x.erro)}</div>` : x.validaAte ? dataBR(x.validaAte) : '<span class="badge b-aviso">não encontrada</span>'}</td><td class="small">${esc((x.sistemas || []).join('; '))}</td></tr>`).join('')}
        </tbody></table></div>`, botoes: [{ texto: 'OK', cls: 'primary' }] });
      await carregarContribs(); paginaCertificados(view);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Consultar vencimentos na Receita'; }
  };
  $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmar('Excluir certificado', 'As procurações vinculadas a este certificado também serão removidas.', 'Excluir', 'danger')) { await del(`/api/certificados/${b.dataset.del}`); await carregarContribs(); paginaCertificados(view); } });
  $$('[data-pdel]').forEach(b => b.onclick = async () => { if (await confirmar('Excluir procuração', 'Remover esta procuração?', 'Excluir', 'danger')) { await del(`/api/procuracoes/${b.dataset.pdel}`); await carregarContribs(); paginaCertificados(view); } });
  $$('[data-tog]').forEach(b => b.onclick = async () => { await put(`/api/procuracoes/${b.dataset.tog}`, { ativo: b.dataset.at !== '1' }); await carregarContribs(); paginaCertificados(view); });
}
