import { get, post, put, del, baixarArquivo } from '../api.js';
import { $, $$, esc, icon, toast, dataHoraBR, vazio, fmtCTrib, fmtNBS, moeda, confirmar } from '../ui.js';
import { estado } from '../estado.js';

export async function paginaConfig(view) {
  const [servicos, audit] = await Promise.all([get('/api/servicos'), get('/api/auditoria')]);
  view.innerHTML = `
  <div class="page-head"><div><h1>Configurações</h1><p>Conta de acesso, serviços favoritos e trilha de auditoria</p></div></div>
  <div class="grid g2">
    <div class="card"><h2 style="margin-bottom:12px">Usuário e senha</h2>
      <p class="muted small">Conectado como <b>${esc(estado.usuario?.nome)}</b> ${estado.usuario?.email ? `(${esc(estado.usuario.email)})` : ''} via ${esc(estado.usuario?.metodo || '')}. ${estado.usuario?.metodo === 'certificado' ? 'Defina e-mail e senha para também acessar sem o certificado.' : ''}</p>
      <form id="fSenha" class="grid">
        ${estado.usuario?.email ? '' : '<label class="f"><span>E-mail de acesso</span><input type="email" name="email" required></label>'}
        <label class="f"><span>Senha atual</span><input type="password" name="atual" autocomplete="current-password"></label>
        <label class="f"><span>Nova senha (mín. 8)</span><input type="password" name="nova" minlength="8" required autocomplete="new-password"></label>
        <button class="btn primary">${icon('save')}Salvar senha</button></form></div>
    <div class="card"><h2 style="margin-bottom:12px">Sobre</h2>
      <div class="small" style="display:grid;gap:6px">
        <div><b>Vorticis Emite NFS</b> <span id="verApp"></span></div>
        <div>Leiaute DPS/NFS-e <b>v1.01</b> (Sistema Nacional NFS-e), com grupo <b>IBSCBS</b> da Reforma Tributária (LC 214/2025).</div>
        <div>APIs: Sefin Nacional (<code>/nfse</code>, <code>/dps</code>, <code>/nfse/{chave}/eventos</code>, <code>/parametros_municipais</code>) e ADN (<code>/danfse</code>), com mTLS ICP-Brasil.</div>
        <div>Tabelas: Anexo A (municípios/países), Anexo B (lista nacional e NBS 2.0), Anexo C/VII (cIndOp) e Anexo VIII (correlação item × NBS × cClassTrib).</div>
        <div class="muted">Ambientes: Simulação (local), Produção restrita (homologação oficial) e Produção.</div>
        <div class="btns" style="margin-top:8px"><button class="btn sm" id="bBackup">${icon('download')}Backup do banco de dados</button></div>
      </div></div>
  </div>
  <div class="card"><div class="card-head"><h2>DANFSe v2.0 (NT 008/2026)</h2></div>
    <p class="small muted" style="margin-top:0">O DANFSe é gerado no próprio aplicativo, conforme a Nota Técnica SE/CGNFS-e nº 008/2026, porque a API oficial de geração foi suspensa em 03/08/2026. As opções abaixo são as supressões e o bloco opcional permitidos pela NT.</p>
    <form id="fDanfse" class="grid" style="gap:8px">
      <label class="check"><input type="checkbox" name="canhoto"> Incluir o <b>canhoto</b> (data de cientificação, identificação e assinatura, nº/chave da NFS-e) – item 2.1.13</label>
      <label class="check"><input type="checkbox" name="suprimirLinhasVazias"> Suprimir as linhas sem dados de regime especial, imunidade, suspensão e benefício municipal – Nota 5</label>
      <label class="check"><input type="checkbox" name="suprimirEndereco"> Suprimir a linha de endereço e e-mail do prestador, tomador, destinatário e intermediário – Nota 1</label>
      <div class="btns"><button class="btn primary">${icon('save')}Salvar</button></div>
    </form></div>
  <div class="card"><div class="card-head"><h2>Integra Contador (SERPRO) — procurações da Receita</h2><a class="small" href="https://loja.serpro.gov.br/integracontador" target="_blank" rel="noopener">Contratar na Loja SERPRO</a></div>
    <p class="small muted" style="margin-top:0">Consulta oficial das procurações eletrônicas (serviço OBTERPROCURACAO41): data de vencimento e sistemas autorizados, como a NFS-e. É preciso contratar o Integra Contador e usar o e-CNPJ do contratante, que é o escritório ou procurador. No modo trial, a SERPRO devolve dados fictícios para teste.</p>
    <form id="fIntegra" class="grid g4" style="align-items:end">
      <label class="f"><span>Ambiente</span><select name="ambiente"><option value="trial">Trial (dados fictícios)</option><option value="producao">Produção</option></select></label>
      <label class="f"><span>Consumer Key</span><input name="consumerKey" autocomplete="off"></label>
      <label class="f"><span>Consumer Secret</span><input name="consumerSecret" type="password" autocomplete="new-password" placeholder="(mantido)"></label>
      <label class="f"><span>Certificado do contratante (e-CNPJ)</span><select name="certificado_id"><option value="">Selecione…</option></select></label>
      <label class="f"><span>CNPJ do contratante</span><input name="contratante" placeholder="se diferente do certificado"></label>
      <div class="btns"><button class="btn primary">${icon('save')}Salvar</button></div>
    </form></div>
  <div class="card"><div class="card-head"><h2>Serviços favoritos</h2><span class="muted small">Adicione pela “Consulta de códigos” → Usar</span></div>
    ${servicos.length ? `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>cTribNac</th><th>NBS</th><th>cTribMun</th><th class="num">Valor padrão</th><th></th></tr></thead><tbody>
      ${servicos.map(s => `<tr><td><b>${esc(s.nome)}</b><div class="small muted">${esc((s.descricao || '').slice(0, 80))}</div></td><td><code>${fmtCTrib(s.ctribnac)}</code></td><td><code>${fmtNBS(s.cnbs)}</code></td><td>${esc(s.ctribmun || '—')}</td><td class="num">${s.valor_padrao ? moeda(s.valor_padrao) : '—'}</td><td><button class="btn sm ghost danger" data-d="${s.id}">${icon('trash')}</button></td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhum serviço favorito.', 'list')}</div>
  <div class="card"><h2 style="margin-bottom:12px">Auditoria (últimas 200 ações)</h2>
    ${audit.length ? `<div class="table-wrap" style="max-height:380px"><table><thead><tr><th>Data</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>${audit.map(a => `<tr><td class="nowrap">${dataHoraBR(a.criado_em)}</td><td><code>${esc(a.acao)}</code></td><td class="small">${esc(a.detalhe)}</td></tr>`).join('')}</tbody></table></div>` : vazio('Sem registros.')}</div>`;
  get('/api/status').then(s => { $('#verApp').textContent = `versão ${s.versao} · ${s.plataforma}`; }).catch(() => {});
  $('#bBackup').onclick = () => baixarArquivo('/api/backup').catch(e => toast(e.message, 'error'));
  get('/api/config/danfse').then(cfg => {
    const f = $('#fDanfse');
    for (const k of ['canhoto', 'suprimirLinhasVazias', 'suprimirEndereco']) f[k].checked = !!cfg[k];
    f.onsubmit = async e => { e.preventDefault(); try { await put('/api/config/danfse', { canhoto: f.canhoto.checked, suprimirLinhasVazias: f.suprimirLinhasVazias.checked, suprimirEndereco: f.suprimirEndereco.checked }); toast('Opções do DANFSe salvas.', 'ok'); } catch (er) { toast(er.message, 'error'); } };
  }).catch(() => {});
  Promise.all([get('/api/config/integra-contador'), get('/api/certificados')]).then(([cfg, certs]) => {
    const f = $('#fIntegra');
    f.certificado_id.innerHTML = '<option value="">Selecione…</option>' + certs.map(c => `<option value="${c.id}">${esc(c.apelido || c.titular)} — ${esc(c.documento)}</option>`).join('');
    f.ambiente.value = cfg.ambiente; f.consumerKey.value = cfg.consumerKey; f.certificado_id.value = cfg.certificado_id || ''; f.contratante.value = cfg.contratante || '';
    if (cfg.temSecret) f.consumerSecret.placeholder = '•••••••• (salvo)';
    f.onsubmit = async e => { e.preventDefault(); try { await put('/api/config/integra-contador', Object.fromEntries(new FormData(f))); f.consumerSecret.value = ''; toast('Integra Contador configurado.', 'ok'); } catch (er) { toast(er.message, 'error'); } };
  }).catch(() => {});
  $('#fSenha').onsubmit = async e => {
    e.preventDefault();
    try { await post('/api/auth/senha', Object.fromEntries(new FormData(e.target))); toast('Senha atualizada.', 'ok'); e.target.reset(); } catch (er) { toast(er.message, 'error'); }
  };
  $$('[data-d]').forEach(b => b.onclick = async () => { if (await confirmar('Excluir', 'Remover este serviço favorito?', 'Excluir', 'danger')) { await del(`/api/servicos/${b.dataset.d}`); paginaConfig(view); } });
}
