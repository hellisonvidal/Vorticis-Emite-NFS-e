// Leitura de XML (NFS-e, DPS, eventos) independente de plataforma (@xmldom/xmldom é JS puro).
import { DOMParser } from '@xmldom/xmldom';

export function parseXml(xml) {
  const erros = [];
  const doc = new DOMParser({ onError: (nivel, msg) => { if (nivel !== 'warning') erros.push(msg); } }).parseFromString(String(xml || ''), 'text/xml');
  if (!doc?.documentElement || erros.length) throw new Error(`XML inválido: ${erros[0] || 'vazio'}`);
  return doc;
}

const filhos = n => { const out = []; for (let c = n?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c); return out; };
const nome = n => n.localName || n.nodeName.replace(/^.*:/, '');

/** Navega por caminho de nomes locais ("infNFSe/DPS/infDPS/prest") a partir de um nó; "*" aceita qualquer elemento. */
export function no(raiz, caminho) {
  let atual = raiz?.documentElement || raiz;
  for (const parte of caminho.split('/').filter(Boolean)) {
    if (!atual) return null;
    if (parte === '..') { atual = atual.parentNode; continue; }
    atual = filhos(atual).find(c => parte === '*' || nome(c) === parte) || null;
  }
  return atual;
}
export const txt = (raiz, caminho) => { const n = caminho ? no(raiz, caminho) : raiz; return n ? String(n.textContent ?? '').trim() : ''; };
export const num = (raiz, caminho) => { const v = txt(raiz, caminho); return v === '' ? null : Number(v); };
export const attr = (n, a) => n?.getAttribute?.(a) || '';

/** Primeiro elemento com o nome local informado, em qualquer profundidade. */
export function busca(raiz, nomeLocal) {
  const d = raiz?.documentElement || raiz;
  const lista = d?.getElementsByTagNameNS ? d.getElementsByTagNameNS('*', nomeLocal) : [];
  return lista.length ? lista[0] : (d && nome(d) === nomeLocal ? d : null);
}

/** Extrai os dados principais de uma NFS-e (XML autorizado pela Sefin) para cadastro/importação. */
export function resumoNFSe(xml) {
  const doc = parseXml(xml);
  const inf = busca(doc, 'infNFSe');
  if (!inf) throw new Error('XML não é uma NFS-e (infNFSe ausente).');
  const dps = busca(inf, 'infDPS');
  const docPessoa = p => (p ? txt(p, 'CNPJ') || txt(p, 'CPF') || txt(p, 'NIF') : '');
  const toma = no(dps, 'toma');
  return {
    chave: attr(inf, 'Id').replace(/^NFS/, ''),
    nNFSe: txt(inf, 'nNFSe'), cStat: txt(inf, 'cStat'), dhProc: txt(inf, 'dhProc'), ambGer: txt(inf, 'ambGer'),
    emitDoc: docPessoa(no(inf, 'emit')), emitNome: txt(inf, 'emit/xNome'),
    idDps: attr(dps, 'Id'), tpAmb: txt(dps, 'tpAmb'), serie: txt(dps, 'serie'), nDPS: txt(dps, 'nDPS'), dCompet: txt(dps, 'dCompet'), dhEmi: txt(dps, 'dhEmi'),
    prestDoc: docPessoa(no(dps, 'prest')), tomaDoc: docPessoa(toma), tomaNome: txt(toma, 'xNome'), tomaTipo: toma ? (txt(toma, 'CNPJ') ? 'CNPJ' : txt(toma, 'CPF') ? 'CPF' : 'NIF') : '',
    cTribNac: txt(dps, 'serv/cServ/cTribNac'), cNBS: txt(dps, 'serv/cServ/cNBS'), xDescServ: txt(dps, 'serv/cServ/xDescServ'),
    vServ: num(dps, 'valores/vServPrest/vServ') || 0, vDescIncond: num(dps, 'valores/vDescCondIncond/vDescIncond') || 0,
    vBC: num(inf, 'valores/vBC') || 0, pAliq: num(inf, 'valores/pAliqAplic') || 0, vISSQN: num(inf, 'valores/vISSQN') || 0,
    vTotalRet: num(inf, 'valores/vTotalRet') || 0, vLiq: num(inf, 'valores/vLiq') || 0,
    tpRetISSQN: txt(dps, 'valores/trib/tribMun/tpRetISSQN'),
    vPis: num(dps, 'valores/trib/tribFed/piscofins/vPis') || 0, vCofins: num(dps, 'valores/trib/tribFed/piscofins/vCofins') || 0,
    vIRRF: num(dps, 'valores/trib/tribFed/vRetIRRF') || 0, vCSLL: num(dps, 'valores/trib/tribFed/vRetCSLL') || 0, vCP: num(dps, 'valores/trib/tribFed/vRetCP') || 0,
    vIBS: num(inf, 'IBSCBS/totCIBS/gIBS/vIBSTot') || 0, vCBS: num(inf, 'IBSCBS/totCIBS/gCBS/vCBS') || 0,
    chSubstda: txt(dps, 'subst/chSubstda'),
  };
}
