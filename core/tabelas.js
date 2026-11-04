// Tabelas oficiais do Sistema Nacional NFS-e (geradas por scripts/importar_tabelas.py a partir de gov.br/nfse).
import ctribnac from './data/ctribnac.json' with { type: 'json' };
import nbs from './data/nbs.json' with { type: 'json' };
import correlacao from './data/correlacao.json' with { type: 'json' };
import indop from './data/indop.json' with { type: 'json' };
import cclasstrib from './data/cclasstrib.json' with { type: 'json' };
import municipios from './data/municipios.json' with { type: 'json' };
import paises from './data/paises.json' with { type: 'json' };

export const T = { ctribnac, nbs, correlacao, indop, cclasstrib, municipios, paises };
export const MUN = new Map(T.municipios.map(m => [m.codigo, m]));
export const CTRIB = new Map(T.ctribnac.map(c => [c.codigo, c]));
export const NBS = new Map(T.nbs.filter(n => n.cNBS).map(n => [n.cNBS, n]));

export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function buscar(lista, q, campos, limite = 50, offset = 0) {
  const termos = norm(q).split(/\s+/).filter(Boolean);
  const res = termos.length ? lista.filter(it => {
    const alvo = norm(campos.map(c => it[c]).join(' ')) + ' ' + campos.map(c => String(it[c] ?? '').replace(/\D/g, '')).join(' ');
    return termos.every(t => alvo.includes(t) || alvo.includes(t.replace(/\D/g, '') || '\u0000'));
  }) : lista;
  return { total: res.length, itens: res.slice(offset, offset + limite) };
}

// Sugestão de NBS / indOp / cClassTrib a partir do código de tributação nacional (Anexo VIII - correlação)
export function sugestoes(ctribnac) {
  const c = String(ctribnac || '').replace(/\D/g, '');
  if (c.length < 4) return [];
  const sub = `${c.slice(0, 2)}.${c.slice(2, 4)}`;
  return T.correlacao.filter(r => r.item === sub).map(r => ({
    ...r, cNBS: r.nbs.replace(/\D/g, ''),
    cClassTribDet: r.cClassTrib.map(ct => T.cclasstrib.find(x => x.codigo === ct) || { codigo: ct }),
  }));
}

export function nomeMunicipio(cod) {
  const m = MUN.get(String(cod));
  return m ? `${m.nome}/${m.uf}` : String(cod || '');
}
