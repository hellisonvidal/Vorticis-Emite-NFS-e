import { post, get, sessao } from '../api.js';
import { $, $$, esc, icon, toast, arquivoBase64, fmtDoc, dataBR } from '../ui.js';

export async function telaLogin(onOk) {
  let primeiro = false;
  try { primeiro = (await get('/api/status')).usuarios === 0; } catch { /* offline */ }
  document.body.innerHTML = `<div class="login">
    <section class="hero">
      <div class="brand"><img class="logo" src="/img/icone.svg" alt=""><div><b>Vorticis Emite NFS</b><span>Emissor de NFS-e · Padrão Nacional</span></div></div>
      <div>
        <h1>Emita NFS-e do Padrão Nacional sem complicação.</h1>
        <p style="opacity:.85;max-width:520px">Integração direta com a API da Sefin Nacional (leiaute DPS v1.01), pronta para a Reforma Tributária (IBS/CBS) e para todos os regimes.</p>
        <ul>
          <li>Simples Nacional, MEI, Lucro Presumido, Real e Arbitrado</li>
          <li>Certificado instalado no computador, arquivo A1 ou de procurador</li>
          <li>Copie a última nota e altere apenas tomador e valores</li>
          <li>Consulta completa de cTribNac, NBS, cIndOp e cClassTrib</li>
          <li>Relatórios, DANFSe v2.0 e painel de indicadores</li>
        </ul>
      </div>
      <div class="small" style="opacity:.6">Tabelas oficiais do Sistema Nacional NFS-e · gov.br/nfse</div>
    </section>
    <section class="panel"><div class="box">
      <h1 style="margin-bottom:6px" id="lgTitulo">${primeiro ? 'Criar conta de acesso' : 'Entrar'}</h1>
      <p class="muted" style="margin-top:0" id="lgSub">${primeiro ? 'Primeiro acesso: cadastre o usuário administrador.' : 'Acesse com usuário e senha ou com certificado digital.'}</p>
      <div class="tabs"><button class="active" data-t="senha">Usuário e senha</button><button data-t="cert">Certificado digital</button></div>
      <div id="pSenha">
        <form id="fSenha" class="grid ${primeiro ? 'hidden' : ''}">
          <label class="f"><span>E-mail</span><input name="email" type="email" autocomplete="username" required></label>
          <label class="f"><span>Senha</span><input name="senha" type="password" autocomplete="current-password" required></label>
          <button class="btn primary lg">Entrar</button>
          <p class="small muted" style="margin:4px 0 0;text-align:center">Ainda não tem conta? <a href="#" id="lnkNovo"><b>Criar conta</b></a></p>
        </form>
        <form id="fNovo" class="grid ${primeiro ? '' : 'hidden'}">
          <label class="f"><span>Nome</span><input name="nome" autocomplete="name" required></label>
          <label class="f"><span>E-mail</span><input name="email" type="email" autocomplete="username" required></label>
          <label class="f"><span>Senha (mín. 8 caracteres)</span><input name="senha" type="password" autocomplete="new-password" minlength="8" required></label>
          <label class="f"><span>Confirme a senha</span><input name="senha2" type="password" autocomplete="new-password" minlength="8" required></label>
          <button class="btn primary lg">Criar conta e entrar</button>
          ${primeiro ? '' : '<p class="small muted" style="margin:4px 0 0;text-align:center">Já tem conta? <a href="#" id="lnkEntrar"><b>Entrar</b></a></p>'}
        </form>
      </div>
      <div id="pCert" class="hidden">
        <div id="certSis" class="grid"><div class="small muted"><span class="spinner"></span> Procurando certificados instalados…</div></div>
        <details class="collapse" id="dArq" style="margin-top:12px"><summary>Usar arquivo do certificado (.pfx/.p12)</summary>
          <form id="fCert" class="grid" style="margin-top:10px">
            <label class="f"><span>Arquivo do certificado</span><input name="arquivo" type="file" accept=".pfx,.p12" required></label>
            <label class="f"><span>Senha do certificado</span><input name="senha" type="password" required></label>
            <button class="btn primary lg">${icon('key')}Entrar com o arquivo</button>
          </form>
        </details>
      </div>
    </div></section></div>`;

  const titulo = (t, s) => { $('#lgTitulo').textContent = t; $('#lgSub').textContent = s; };
  const modoNovo = novo => {
    $('#fSenha').classList.toggle('hidden', novo); $('#fNovo').classList.toggle('hidden', !novo);
    titulo(novo ? 'Criar conta' : 'Entrar', novo ? 'Cadastre seu usuário para acessar o sistema.' : 'Acesse com usuário e senha ou com certificado digital.');
  };
  $('#lnkNovo').onclick = e => { e.preventDefault(); modoNovo(true); $('#fNovo [name=nome]').focus(); };
  if ($('#lnkEntrar')) $('#lnkEntrar').onclick = e => { e.preventDefault(); modoNovo(false); };

  let certsCarregados = false;
  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    $('#pSenha').classList.toggle('hidden', b.dataset.t !== 'senha');
    $('#pCert').classList.toggle('hidden', b.dataset.t !== 'cert');
    if (b.dataset.t === 'cert' && !certsCarregados) { certsCarregados = true; listarSistema(); }
  });
  const ok = r => { sessao.token = r.token; location.hash = ''; onOk(); };
  const envio = (form, fn) => form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button', form); btn.disabled = true;
    try { ok(await fn(Object.fromEntries(new FormData(form)))); } catch (er) { toast(er.message, 'error'); } finally { btn.disabled = false; }
  };
  envio($('#fSenha'), d => post('/api/auth/login', d));
  envio($('#fNovo'), d => {
    if (d.senha !== d.senha2) throw new Error('As senhas não conferem.');
    return post('/api/auth/registrar', { nome: d.nome, email: d.email, senha: d.senha });
  });
  envio($('#fCert'), async () => {
    const f = $('#fCert [name=arquivo]').files[0];
    return post('/api/auth/certificado', { pfx: await arquivoBase64(f), senha: $('#fCert [name=senha]').value });
  });

  // Certificados instalados no computador (repositório do Windows) ou no aparelho (Android)
  async function listarSistema() {
    const box = $('#certSis');
    let r;
    try { r = await get('/api/certificados/sistema'); } catch (e) { r = { suportado: false, erro: e.message }; }
    if (!r.suportado) {
      box.innerHTML = `<div class="alert info">${icon('info')}<div class="small">${esc(r.erro || 'Nesta versão (navegador), use o arquivo do certificado. Os certificados instalados podem ser usados no aplicativo Windows ou Android.')}</div></div>`;
      $('#dArq').open = true;
      return;
    }
    if (r.escolhaNativa) {
      box.innerHTML = `<div class="alert info">${icon('shield')}<div class="small">Use um certificado instalado no aparelho (Configurações → Segurança → Credenciais). O Android pedirá para você escolher qual certificado liberar.</div></div>
        <button class="btn primary lg" id="btnEscolher">${icon('key')}Escolher certificado instalado</button>`;
      $('#btnEscolher').onclick = () => entrarSistema(null, $('#btnEscolher'));
      return;
    }
    const lista = r.certificados || [];
    box.innerHTML = lista.length ? `<div class="small muted">Certificados instalados neste computador:</div>
      <div class="cert-lista">${lista.map(c => `<button type="button" class="cert-item" data-id="${esc(c.id)}" ${c.vencido || !c.documento ? 'disabled' : ''}>
        <span class="ci-ic">${icon('key')}</span><span class="ci-tx"><b>${esc(c.titular)}</b><span class="small muted">${c.documento ? `${c.tipo_doc} ${fmtDoc(c.documento)}` : 'sem CPF/CNPJ ICP-Brasil'} · ${esc(c.emissor)}</span>
        <span class="small ${c.vencido ? 'neg' : 'muted'}">${c.vencido ? 'Vencido em' : 'Válido até'} ${dataBR(c.valido_ate.slice(0, 10))}${c.a3 ? ' · token/cartão (A3)' : ''}</span></span></button>`).join('')}</div>`
      : `<div class="alert warn">${icon('alert')}<div class="small">Nenhum certificado com chave privada foi encontrado no repositório do Windows (Pessoal). Instale o certificado (duplo clique no .pfx) ou use o arquivo abaixo.</div></div>`;
    $$('.cert-item', box).forEach(b => b.onclick = () => entrarSistema(b.dataset.id, b));
    if (!lista.length) $('#dArq').open = true;
  }
  async function entrarSistema(id, btn) {
    btn.disabled = true;
    try { ok(await post('/api/auth/certificado-sistema', { id })); }
    catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }
}
