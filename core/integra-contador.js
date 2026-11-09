// Integra Contador (SERPRO) – consulta de procurações eletrônicas da Receita Federal.
// Serviço: PROCURACOES / OBTERPROCURACAO41 – retorna as procurações entre outorgante e outorgado com a
// data de expiração (dtexpiracao, aaaaMMdd) e os sistemas abrangidos.
// Requisitos (contratação na Loja SERPRO): Consumer Key/Secret e certificado e-CNPJ do contratante (mTLS).
// Quando o contratante (ex.: software-house) for diferente do autor do pedido (contador), a SERPRO exige
// também o Termo de Autorização assinado – neste app o contratante é o próprio autor (escritório/contador).
import { b64, utf8, deUtf8 } from './seguranca.js';

export const SERPRO = {
  auth: 'https://autenticacao.sapi.serpro.gov.br/authenticate',
  producao: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1',
  trial: 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1',
  tokenTrial: '06aef429-a981-3ec5-a1f8-71d38d86481e',
};

const tipoDoc = d => (String(d).replace(/\D/g, '').length === 11 ? 1 : 2);
const corpo = r => { try { return JSON.parse(deUtf8(r.body || new Uint8Array())); } catch { return null; } };

export function criarIntegraContador(http) {
  const cache = new Map();

  async function autenticar({ consumerKey, consumerSecret, cert }) {
    const k = `${consumerKey}:${cert?.row?.id}`;
    const c = cache.get(k);
    if (c && c.expira > Date.now() + 60e3) return c;
    const r = await http({
      url: SERPRO.auth, method: 'POST', pfx: cert.pfx, senha: cert.senha, certSistema: cert.sistema,
      headers: { Authorization: `Basic ${b64(utf8(`${consumerKey}:${consumerSecret}`))}`, 'Role-Type': 'TERCEIROS', 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    const j = corpo(r);
    if (r.status !== 200 || !j?.access_token) throw Object.assign(new Error(`Autenticação SERPRO recusada (HTTP ${r.status}): ${j?.error_description || j?.message || 'verifique Consumer Key/Secret e o certificado do contratante'}`), { status: 502 });
    const tok = { access: j.access_token, jwt: j.jwt_token, expira: Date.now() + (j.expires_in || 3000) * 1000 };
    cache.set(k, tok);
    return tok;
  }

  /**
   * @param {object} p { ambiente: 'producao'|'trial', consumerKey, consumerSecret, cert, contratante, outorgante, outorgado }
   * @returns {Promise<{procuracoes: {dtexpiracao, validaAte, sistemas}[], mensagens}>}
   */
  async function obterProcuracoes(p) {
    const trial = p.ambiente === 'trial';
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (trial) headers.Authorization = `Bearer ${SERPRO.tokenTrial}`;
    else {
      const t = await autenticar(p);
      headers.Authorization = `Bearer ${t.access}`;
      if (t.jwt) headers.jwt_token = t.jwt;
    }
    // O modo trial só aceita o cenário de demonstração da documentação SERPRO (dados fictícios)
    const so = v => String(v).replace(/\D/g, '');
    const contratante = trial ? '99999999999999' : so(p.contratante);
    const outorgante = trial ? '99999999999999' : so(p.outorgante);
    const outorgado = trial ? '99999999999' : so(p.outorgado);
    const pedido = {
      contratante: { numero: contratante, tipo: tipoDoc(contratante) },
      autorPedidoDados: { numero: contratante, tipo: tipoDoc(contratante) },
      // Como no cenário oficial, o contribuinte da consulta é o outorgado (quem recebeu a procuração)
      contribuinte: { numero: outorgado, tipo: tipoDoc(outorgado) },
      pedidoDados: {
        idSistema: 'PROCURACOES', idServico: 'OBTERPROCURACAO41', versaoSistema: '1',
        dados: JSON.stringify({ outorgante, tipoOutorgante: String(tipoDoc(outorgante)), outorgado, tipoOutorgado: String(tipoDoc(outorgado)) }),
      },
    };
    const r = await http({
      url: `${trial ? SERPRO.trial : SERPRO.producao}/Consultar`, method: 'POST', headers, body: JSON.stringify(pedido),
      ...(trial ? {} : { pfx: p.cert.pfx, senha: p.cert.senha, certSistema: p.cert.sistema }),
    });
    const j = corpo(r);
    const mensagens = (j?.mensagens || []).map(m => `${m.codigo || ''} ${m.texto || ''}`.trim());
    const st = Number(j?.status || r.status);
    if (r.status !== 200 || st >= 300) throw Object.assign(new Error(`Integra Contador recusou a consulta (status ${st}): ${mensagens.join('; ') || 'erro desconhecido'}`), { status: 502 });
    let lista = [];
    try { lista = typeof j.dados === 'string' ? JSON.parse(j.dados || '[]') : (j.dados || []); } catch { lista = []; }
    if (!Array.isArray(lista)) lista = [lista];
    const procuracoes = lista.map(x => {
      const d = String(x.dtexpiracao || x.dtExpiracao || '');
      return { dtexpiracao: d, validaAte: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null, sistemas: x.sistemas || [] };
    });
    return { procuracoes, mensagens };
  }

  return { autenticar, obterProcuracoes };
}

/** Escolhe a procuração que abrange a NFS-e (ou a de maior validade, se nenhuma citar NFS-e explicitamente). */
export function procuracaoNFSe(lista) {
  const ehNFSe = s => /nfs-?e|nota fiscal de servi/i.test(s);
  const cand = lista.filter(p => p.sistemas.some(ehNFSe));
  const base = cand.length ? cand : lista;
  return base.filter(p => p.validaAte).sort((a, b) => b.validaAte.localeCompare(a.validaAte))[0] || null;
}
