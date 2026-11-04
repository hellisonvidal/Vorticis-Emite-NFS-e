// Utilitários de interface: escape, formatação, máscaras, modais, toasts, autocomplete.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const so = s => String(s ?? '').replace(/\D/g, '');

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = v => BRL.format(+v || 0);
export const num = (v, d = 2) => (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = v => `${num(v, 2)}%`;
export const dataBR = d => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '—';
export const dataHoraBR = d => d ? new Date(d.replace(' ', 'T') + (d.includes('T') || d.includes('Z') ? '' : 'Z')).toLocaleString('pt-BR') : '—';
export const mesBR = m => { if (!m) return ''; const [a, mm] = m.split('-'); return new Date(+a, +mm - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''); };
export const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function fmtDoc(v, tipo) {
  const d = so(v);
  if ((tipo === 'CPF' || (!tipo && d.length === 11)) && d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '';
}
export const fmtCep = v => so(v).replace(/(\d{5})(\d{3})/, '$1-$2');
export const fmtCTrib = v => { const d = so(v); return d.length === 6 ? `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}` : v || ''; };
export const fmtNBS = v => { const d = so(v); return d.length === 9 ? `${d[0]}.${d.slice(1, 5)}.${d.slice(5, 7)}.${d.slice(7)}` : v || ''; };
export const fmtChave = v => String(v || '').replace(/(.{5})/g, '$1 ').trim();

export const STATUS = { autorizada: 'Autorizada', rejeitada: 'Rejeitada', rascunho: 'Rascunho', cancelada: 'Cancelada', substituida: 'Substituída' };
export const AMB = { simulacao: 'Simulação', homologacao: 'Produção restrita', producao: 'Produção' };
export const badge = (k, map = STATUS) => `<span class="badge b-${esc(k)}">${esc(map[k] || k)}</span>`;

// Ícones (SVG inline, traço)
const P = {
  dash: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  building: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="m10.3 3.9-8.5 14.7A2 2 0 0 0 3.5 21.6h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 1V2l-1 1-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};
export const icon = (n, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${P[n] || ''}</svg>`;

// ---------- Toast ----------
export function toast(msg, tipo = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), tipo === 'error' ? 7000 : 4000);
}

// ---------- Modal ----------
export function modal({ titulo, corpo, botoes = [], wide = false, onOpen }) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog"><div class="modal-head"><h2>${titulo}</h2><button class="btn ghost sm" data-x>${icon('x')}</button></div>
      <div class="modal-body">${corpo}</div>${botoes.length ? `<div class="modal-foot">${botoes.map((b, i) => `<button class="btn ${b.cls || ''}" data-b="${i}">${b.texto}</button>`).join('')}</div>` : ''}</div>`;
    const fechar = v => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') fechar(null); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', e => { if (e.target === bg) fechar(null); });
    $('[data-x]', bg).onclick = () => fechar(null);
    $$('[data-b]', bg).forEach(b => b.onclick = async () => {
      const def = botoes[+b.dataset.b];
      if (def.acao) {
        b.disabled = true;
        try { const r = await def.acao(bg); if (r !== false) fechar(r ?? def.valor ?? true); } catch (e) { toast(e.message, 'error'); } finally { b.disabled = false; }
      } else fechar(def.valor ?? true);
    });
    document.body.append(bg);
    onOpen?.(bg, fechar);
    $('input,select,textarea', bg)?.focus();
  });
}
export const confirmar = (titulo, texto, ok = 'Confirmar', cls = 'primary') => modal({ titulo, corpo: `<p>${texto}</p>`, botoes: [{ texto: 'Voltar', valor: false }, { texto: ok, cls, valor: true }] });

// ---------- Formulários ----------
export function lerForm(el) {
  const o = {};
  $$('[name]', el).forEach(i => {
    if (i.type === 'checkbox') o[i.name] = i.checked;
    else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
    else if (i.type === 'number') o[i.name] = i.value === '' ? '' : +i.value;
    else o[i.name] = i.value;
  });
  return o;
}
export function preencherForm(el, o) {
  $$('[name]', el).forEach(i => {
    if (!(i.name in o)) return;
    const v = o[i.name];
    if (i.type === 'checkbox') i.checked = !!v && v !== '0';
    else if (i.type === 'radio') i.checked = String(v) === i.value;
    else i.value = v ?? '';
  });
}
export const campo = (label, input, { req, hint, cls = '' } = {}) =>
  `<label class="f ${cls}"><span>${label}${req ? ' <i class="req">*</i>' : ''}</span>${input}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
export const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${String(sel) === String(k) ? 'selected' : ''}>${esc(v)}</option>`).join('');

// Máscara de documento/CEP enquanto digita
export function mascaras(root) {
  root.addEventListener('input', e => {
    const i = e.target;
    if (i.dataset.mask === 'doc') {
      const d = so(i.value).slice(0, 14);
      i.value = d.length <= 11 ? d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
        : d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
    } else if (i.dataset.mask === 'cep') i.value = so(i.value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
  });
}

// ---------- Autocomplete genérico ----------
export function autocomplete(input, { buscar, render, escolher, min = 2 }) {
  const wrap = input.parentElement;
  wrap.classList.add('ac');
  let list, timer, itens = [], sel = -1;
  const fechar = () => { list?.remove(); list = null; sel = -1; };
  const abrir = async () => {
    const q = input.value.trim();
    if (q.length < min) return fechar();
    itens = await buscar(q);
    fechar();
    if (!itens.length) return;
    list = document.createElement('div');
    list.className = 'ac-list';
    list.innerHTML = itens.map((it, i) => `<div data-i="${i}">${render(it)}</div>`).join('');
    list.onmousedown = e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); escolher(itens[+d.dataset.i]); fechar(); } };
    wrap.append(list);
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(abrir, 220); });
  input.addEventListener('focus', () => { if (input.value.trim().length >= min) abrir(); });
  input.addEventListener('blur', () => setTimeout(fechar, 150));
  input.addEventListener('keydown', e => {
    if (!list) return;
    const els = $$('[data-i]', list);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, Math.min(els.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      els.forEach((el, i) => el.classList.toggle('sel', i === sel));
      els[sel]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); escolher(itens[sel]); fechar(); }
    else if (e.key === 'Escape') fechar();
  });
}

export function arquivoBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function baixar(nome, conteudo, tipo = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const vazio = (msg, ic = 'file') => `<div class="empty">${icon(ic)}${msg}</div>`;
export const formatarXml = xml => {
  let pad = 0;
  return xml.replace(/>\s*</g, '><').replace(/(>)(<)(\/*)/g, '$1\n$2$3').split('\n').map(l => {
    if (/^<\//.test(l)) pad = Math.max(pad - 1, 0);
    const out = '  '.repeat(pad) + l;
    if (/^<[^!?/][^>]*[^/]>.*$/.test(l) && !/<\/[^>]+>$/.test(l)) pad++;
    return out;
  }).join('\n');
};
