// Confirmação de saída do aplicativo (Windows): diálogo próprio, no visual do app, no lugar da caixa nativa.
// O processo principal do Electron chama globalThis.__vorticisConfirmarSaida() ao fechar a janela e só sai se
// a promessa resolver true. Na tela de emissão com dados digitados, oferece "Salvar rascunho e sair".
import { esc, icon } from './ui.js';
import { estado } from './estado.js';

let aberto = null;

function haDigitacao() {
  if (!location.hash.startsWith('#/emitir')) return false;
  const v = document.querySelector('[name=valor_servico]')?.value || '';
  const d = document.querySelector('[name=descricao]')?.value || '';
  return /[1-9]/.test(v) || d.trim().length > 0;
}

export function confirmarSaida() {
  if (aberto) return aberto;
  aberto = new Promise(resolve => {
    const pendente = haDigitacao() && typeof globalThis.__vorticisSalvarRascunho === 'function';
    const c = estado.contrib();
    const bg = document.createElement('div');
    bg.className = 'saida-bg';
    bg.innerHTML = `<div class="saida" role="alertdialog" aria-modal="true" aria-labelledby="saidaTit" aria-describedby="saidaTxt">
      <div class="saida-ico">${icon('logout')}</div>
      <h2 id="saidaTit">Sair do Vorticis Emite NFS?</h2>
      <p id="saidaTxt">${c ? `Você está trabalhando com <b>${esc(c.nome_fantasia || c.razao_social)}</b>. ` : ''}Seus cadastros, notas e certificados ficam salvos neste computador.</p>
      ${pendente ? `<div class="saida-aviso">${icon('alert')}<span>Há uma nota em digitação que ainda não foi emitida nem salva como rascunho.</span></div>` : ''}
      <div class="saida-btns">
        <button class="btn" data-r="ficar">Continuar no app</button>
        ${pendente ? `<button class="btn" data-r="salvar">${icon('save')}Salvar rascunho e sair</button>` : ''}
        <button class="btn sair" data-r="sair">${icon('logout')}Sair</button>
      </div>
      <div class="saida-dica"><kbd>Esc</kbd> para continuar no app</div>
    </div>`;
    const fim = v => {
      document.removeEventListener('keydown', tecla, true);
      bg.classList.add('fechando');
      setTimeout(() => bg.remove(), 140);
      aberto = null;
      resolve(v);
    };
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fim(false); }
    };
    document.addEventListener('keydown', tecla, true);
    bg.addEventListener('mousedown', e => { if (e.target === bg) fim(false); });
    bg.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
      const r = b.dataset.r;
      if (r === 'ficar') return fim(false);
      if (r === 'sair') return fim(true);
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Salvando…';
      try { await globalThis.__vorticisSalvarRascunho(); fim(true); } catch { b.disabled = false; b.innerHTML = `${icon('save')}Salvar rascunho e sair`; }
    });
    document.body.append(bg);
    bg.querySelector('[data-r=ficar]').focus();
  });
  return aberto;
}
globalThis.__vorticisConfirmarSaida = confirmarSaida;
