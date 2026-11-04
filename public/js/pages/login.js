import { post, get, sessao } from '../api.js';
import { $, $$, icon, toast, arquivoBase64 } from '../ui.js';

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
          <li>Certificado A1 próprio ou de procurador (várias procurações)</li>
          <li>Copie a última nota e altere apenas tomador e valores</li>
          <li>Consulta completa de cTribNac, NBS, cIndOp e cClassTrib</li>
          <li>Relatórios, exportação CSV e painel de indicadores</li>
        </ul>
      </div>
      <div class="small" style="opacity:.6">Tabelas oficiais do Sistema Nacional NFS-e · gov.br/nfse</div>
    </section>
    <section class="panel"><div class="box">
      <h1 style="margin-bottom:6px">${primeiro ? 'Criar conta de acesso' : 'Entrar'}</h1>
      <p class="muted" style="margin-top:0">${primeiro ? 'Primeiro acesso: cadastre o usuário administrador.' : 'Acesse com usuário e senha ou com certificado digital.'}</p>
      <div class="tabs"><button class="active" data-t="senha">Usuário e senha</button><button data-t="cert">Certificado digital</button>${primeiro ? '' : '<button data-t="novo">Criar conta</button>'}</div>
      <form id="fSenha" class="grid">
        ${primeiro ? '<label class="f"><span>Nome</span><input name="nome" required></label>' : ''}
        <label class="f"><span>E-mail</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="f"><span>Senha</span><input name="senha" type="password" autocomplete="current-password" minlength="${primeiro ? 8 : 1}" required></label>
        <button class="btn primary lg">${primeiro ? 'Criar conta e entrar' : 'Entrar'}</button>
      </form>
      <form id="fNovo" class="grid hidden">
        <label class="f"><span>Nome</span><input name="nome" required></label>
        <label class="f"><span>E-mail</span><input name="email" type="email" required></label>
        <label class="f"><span>Senha (mín. 8)</span><input name="senha" type="password" minlength="8" required></label>
        <button class="btn primary lg">Criar conta</button>
      </form>
      <form id="fCert" class="grid hidden">
        <div class="alert info">${icon('shield')}<div class="small">Selecione o certificado A1 (.pfx/.p12). O titular (CPF/CNPJ ICP-Brasil) é identificado automaticamente e o certificado fica disponível, criptografado, para assinar as notas.</div></div>
        <label class="f"><span>Arquivo do certificado</span><input name="arquivo" type="file" accept=".pfx,.p12" required></label>
        <label class="f"><span>Senha do certificado</span><input name="senha" type="password" required></label>
        <button class="btn primary lg">${icon('key')}Entrar com certificado</button>
      </form>
    </div></section></div>`;

  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    $('#fSenha').classList.toggle('hidden', b.dataset.t !== 'senha');
    $('#fCert').classList.toggle('hidden', b.dataset.t !== 'cert');
    $('#fNovo').classList.toggle('hidden', b.dataset.t !== 'novo');
  });
  const ok = r => { sessao.token = r.token; location.hash = ''; onOk(); };
  const envio = (form, fn) => form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button', form); btn.disabled = true;
    try { ok(await fn(Object.fromEntries(new FormData(form)))); } catch (er) { toast(er.message, 'error'); } finally { btn.disabled = false; }
  };
  envio($('#fSenha'), d => post(primeiro ? '/api/auth/registrar' : '/api/auth/login', d));
  envio($('#fNovo'), d => post('/api/auth/registrar', d));
  envio($('#fCert'), async () => {
    const f = $('#fCert [name=arquivo]').files[0];
    return post('/api/auth/certificado', { pfx: await arquivoBase64(f), senha: $('#fCert [name=senha]').value });
  });
}
