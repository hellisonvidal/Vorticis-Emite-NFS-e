// Estado global simples da aplicação
const KEY = 'vorticis.contrib';
export const estado = {
  usuario: null,
  contribs: [],
  get contribId() { try { return localStorage.getItem(KEY); } catch { return this._c; } },
  setContrib(id) { this._c = id; try { localStorage.setItem(KEY, id); } catch { /* ignore */ } },
  contrib() { return this.contribs.find(c => String(c.id) === String(this.contribId)) || this.contribs.find(c => c.ativo) || null; },
};
