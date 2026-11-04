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
    <div class="card-head"><h2>${icon('key', 'style="width:18px"')} Certificados digitais</h2><button class="btn primary" id="btnCert">${icon('plus')}Adicionar certificado A1</button></div>
    ${certs.length ? `<div class="table-wrap"><table><thead><tr><th>Apelido / Titular</th><th>Documento</th><th>Emissor</th><th>Validade</th><th>Situação</th><th></th></tr></thead><tbody>
      ${certs.map(c => `<tr><td><b>${esc(c.apelido || c.titular)}</b><div class="small muted">${esc(c.titular)}</div></td><td>${esc(c.tipo_doc)} ${fmtDoc(c.documento, c.tipo_doc)}</td><td class="small">${esc(c.emissor)}</td>
        <td>${dataBR(c.valido_ate)}<div class="small muted">${c.dias_restantes >= 0 ? `${c.dias_restantes} dias` : 'expirado'}</div></td><td>${badge(c.situacao, SIT)}</td>
        <td><button class="btn sm ghost danger" data-del="${c.id}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>`
      : vazio('Nenhum certificado cadastrado. Sem certificado é possível emitir apenas em modo simulação.', 'key')}
    <div class="alert info" style="margin-top:14px">${icon('info')}<div class="small"><b class="t">Como funciona:</b> a API da Sefin Nacional exige autenticação mútua TLS com certificado ICP-Brasil e assinatura XML da DPS. O certificado pode ser da própria empresa (e-CNPJ) ou de um procurador (e-CPF/e-CNPJ) com procuração eletrônica válida para NFS-e. Login com usuário e senha dá acesso a este sistema; a transmissão sempre usa um certificado.</div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>${icon('users', 'style="width:18px"')} Procurações eletrônicas</h2><button class="btn primary" id="btnProc" ${certs.length && estado.contribs.length ? '' : 'disabled'}>${icon('plus')}Nova procuração</button></div>
    ${procs.length ? `<div class="table-wrap"><table><thead><tr><th>Outorgante (empresa)</th><th>Procurador (certificado)</th><th>Escopo</th><th>Vigência</th><th>Situação</th><th></th></tr></thead><tbody>
      ${procs.map(p => { const venc = p.valida_ate && p.valida_ate < new Date().toISOString().slice(0, 10); return `<tr>
        <td><b>${esc(p.razao_social)}</b><div class="small muted">${fmtDoc(p.contrib_doc)}</div></td>
        <td>${esc(p.titular)}<div class="small muted">${fmtDoc(p.cert_doc)} · cert. até ${dataBR(p.cert_validade)}</div></td>
        <td>${p.escopo.split(',').map(e => `<span class="badge plain">${esc(e)}</span>`).join(' ')}</td>
        <td>${p.valida_de ? dataBR(p.valida_de) : '—'} a ${p.valida_ate ? dataBR(p.valida_ate) : 'indeterminado'}</td>
        <td>${!p.ativo ? '<span class="badge">inativa</span>' : venc ? badge('vencido', SIT) : badge('valido', SIT)}</td>
        <td class="nowrap"><button class="btn sm ghost" data-tog="${p.id}" data-at="${p.ativo}">${p.ativo ? 'Desativar' : 'Ativar'}</button><button class="btn sm ghost danger" data-pdel="${p.id}">${icon('trash')}</button></td></tr>`; }).join('')}
      </tbody></table></div>` : vazio('Nenhuma procuração cadastrada. Use quando um contador/procurador emite em nome de clientes — é possível ter várias procurações por empresa.', 'users')}
    <div class="alert warn" style="margin-top:14px">${icon('alert')}<div class="small"><b class="t">Importante:</b> a procuração precisa estar registrada oficialmente (Procuração Eletrônica no e-CAC/Sistema Nacional NFS-e) com o serviço de NFS-e. Aqui você apenas vincula o certificado do procurador à empresa outorgante para assinar e transmitir.</div></div>
  </div>`;

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
  $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmar('Excluir certificado', 'As procurações vinculadas a este certificado também serão removidas.', 'Excluir', 'danger')) { await del(`/api/certificados/${b.dataset.del}`); await carregarContribs(); paginaCertificados(view); } });
  $$('[data-pdel]').forEach(b => b.onclick = async () => { if (await confirmar('Excluir procuração', 'Remover esta procuração?', 'Excluir', 'danger')) { await del(`/api/procuracoes/${b.dataset.pdel}`); await carregarContribs(); paginaCertificados(view); } });
  $$('[data-tog]').forEach(b => b.onclick = async () => { await put(`/api/procuracoes/${b.dataset.tog}`, { ativo: b.dataset.at !== '1' }); await carregarContribs(); paginaCertificados(view); });
}
