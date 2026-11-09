// Cliente das APIs do Sistema Nacional NFS-e (Sefin Nacional e ADN).
// O transporte HTTPS com autenticação mútua (certificado ICP-Brasil) é fornecido pela plataforma:
//   http({ url, method, headers, body, pfx: Uint8Array, senha }) -> { status, headers, body: Uint8Array }
//
// Rotas (Manual dos Contribuintes – APIs do Emissor Público Nacional / ADN):
//   Sefin  POST /nfse · GET /nfse/{chave} · GET|HEAD /dps/{id}
//          POST /nfse/{chave}/eventos · GET /nfse/{chave}/eventos/{tipoEvento}/{nSeq}
//          GET /parametros_municipais/{cMun}/convenio | /{cMun}/{cServ} | /{cMun}/{CPF/CNPJ}
//   ADN    GET /contribuintes/DFe/{NSU}?cnpjConsulta=&lote=true (distribuição por NSU)
//          GET /parametrizacao/{cMun}/convenio
// Observação: a API de geração do DANFSe (adn.../danfse) foi suspensa em 03/08/2026 (NT 008/2026);
// o DANFSe é gerado localmente (core/danfse.js).
import { gzipSync, gunzipSync } from 'fflate';
import { b64, unb64, utf8, deUtf8 } from './seguranca.js';

export const AMBIENTES = {
  producao: { sefin: 'https://sefin.nfse.gov.br/SefinNacional', adn: 'https://adn.nfse.gov.br' },
  homologacao: { sefin: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional', adn: 'https://adn.producaorestrita.nfse.gov.br' },
};
export const URL_CONSULTA_PUBLICA = 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=';

// A Sefin exige o XML em UTF-8 com a declaração explícita; sem ela rejeita com E1229
// ("Xml não está utilizando codificação UTF-8"). Remove BOM e declarações em outra codificação.
export const DECLARACAO_XML = '<?xml version="1.0" encoding="UTF-8"?>';
export const comDeclaracao = xml => DECLARACAO_XML + String(xml).replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^>]*\?>\s*/, '');
export const gzipB64 = xml => b64(gzipSync(utf8(comDeclaracao(xml))));

/**
 * Decodifica o conteúdo XML recebido das APIs, tolerando as variações observadas:
 * GZip+Base64, Base64 duplo (ex.: eventos[].arquivoXml), Base64 simples ou XML puro.
 */
export function decodificarXml(valor) {
  let s = String(valor || '').trim();
  for (let i = 0; i < 3 && s; i++) {
    if (s.startsWith('<')) return s;
    let bytes;
    try { bytes = unb64(s); } catch { return s; }
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return deUtf8(gunzipSync(bytes));
    s = deUtf8(bytes).trim();
  }
  return s;
}

export function criarSefin(http) {
  async function req(url, { method = 'GET', body, cert, accept = 'application/json' }) {
    const r = await http({
      url, method, pfx: cert?.pfx, senha: cert?.senha, certSistema: cert?.sistema,
      headers: { Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = String(r.headers?.['content-type'] || r.headers?.['Content-Type'] || '');
    let json = null, text = '';
    if (!ct.includes('pdf')) {
      text = deUtf8(r.body || new Uint8Array());
      if (ct.includes('json') || /^\s*[{[]/.test(text)) { try { json = JSON.parse(text); } catch { /* corpo não-JSON */ } }
    }
    return { status: r.status, json, text, bytes: r.body };
  }

  const erros = r => {
    const j = r.json || {};
    const lista = j.erros || j.Erros || j.erro || j.Erro || (j.mensagem ? [{ Descricao: j.mensagem }] : []);
    const arr = (Array.isArray(lista) ? lista : [lista]).filter(Boolean).map(e => ({
      codigo: e.Codigo || e.codigo || '', descricao: e.Descricao || e.descricao || e.message || JSON.stringify(e), complemento: e.Complemento || e.complemento || '',
    }));
    if (!arr.length) arr.push({ codigo: String(r.status), descricao: r.status === 403 ? 'Acesso negado: verifique o certificado digital e a procuração.' : (r.text || 'Erro desconhecido').replace(/<[^>]+>/g, ' ').slice(0, 400) });
    return arr;
  };
  const campo = (j, ...nomes) => { for (const n of nomes) if (j?.[n] !== undefined) return j[n]; return undefined; };

  const api = {
    erros,
    async emitirNFSe(amb, cert, dps) {
      const r = await req(`${AMBIENTES[amb].sefin}/nfse`, { method: 'POST', cert, body: { dpsXmlGZipB64: gzipB64(dps) } });
      const chave = campo(r.json, 'chaveAcesso', 'ChaveAcesso');
      if (r.status >= 200 && r.status < 300 && chave) {
        const x = campo(r.json, 'nfseXmlGZipB64', 'NfseXmlGZipB64');
        return { ok: true, chave, idDps: r.json.idDps, dhProc: r.json.dataHoraProcessamento, xmlNFSe: x ? decodificarXml(x) : '', alertas: r.json.alertas || [], bruto: r.json };
      }
      const e = erros(r);
      return { ok: false, status: r.status, erros: e, duplicada: e.some(x => String(x.codigo).toUpperCase() === 'E0014'), bruto: r.json || r.text };
    },
    async consultarNFSe(amb, cert, chave) {
      const r = await req(`${AMBIENTES[amb].sefin}/nfse/${chave}`, { cert });
      const x = campo(r.json, 'nfseXmlGZipB64', 'NfseXmlGZipB64');
      return r.status === 200 && x ? { ok: true, xml: decodificarXml(x) } : { ok: false, status: r.status, erros: erros(r) };
    },
    // Recupera a chave de acesso pelo identificador da DPS (somente atores da NFS-e)
    async consultarDPS(amb, cert, id) {
      const r = await req(`${AMBIENTES[amb].sefin}/dps/${id}`, { cert });
      return r.status === 200 ? { ok: true, chave: campo(r.json, 'chaveAcesso', 'ChaveAcesso') } : { ok: false, status: r.status, erros: erros(r) };
    },
    // Informa se já existe NFS-e gerada a partir da DPS (qualquer certificado válido)
    async existeDPS(amb, cert, id) {
      const r = await req(`${AMBIENTES[amb].sefin}/dps/${id}`, { method: 'HEAD', cert });
      if (r.status === 200) return true;
      if (r.status === 404) return false;
      throw new Error(`Consulta da DPS ${id}: HTTP ${r.status} ${erros(r)[0]?.descricao || ''}`);
    },
    async registrarEvento(amb, cert, chave, pedido) {
      const r = await req(`${AMBIENTES[amb].sefin}/nfse/${chave}/eventos`, { method: 'POST', cert, body: { pedidoRegistroEventoXmlGZipB64: gzipB64(pedido) } });
      if (r.status >= 200 && r.status < 300) {
        const x = campo(r.json, 'eventoXmlGZipB64', 'EventoXmlGZipB64', 'arquivoXml', 'ArquivoXml');
        return { ok: true, xml: x ? decodificarXml(x) : '', bruto: r.json };
      }
      return { ok: false, status: r.status, erros: erros(r), bruto: r.json || r.text };
    },
    // Eventos são consultados por tipo e sequência (a rota sem tipo responde 405)
    async consultarEvento(amb, cert, chave, tipo, seq = 1) {
      const r = await req(`${AMBIENTES[amb].sefin}/nfse/${chave}/eventos/${tipo}/${seq}`, { cert });
      if (r.status !== 200) return { ok: false, status: r.status };
      const lista = campo(r.json, 'eventos', 'Eventos') || [];
      const ev = Array.isArray(lista) ? lista[0] : lista;
      return { ok: !!ev, evento: ev, xml: ev ? decodificarXml(campo(ev, 'arquivoXml', 'ArquivoXml', 'eventoXmlGZipB64')) : '' };
    },
    async situacaoEventos(amb, cert, chave) {
      const canc = await api.consultarEvento(amb, cert, chave, '101101', 1);
      if (canc.ok) return { status: 'cancelada', evento: '101101' };
      const subst = await api.consultarEvento(amb, cert, chave, '105102', 1);
      if (subst.ok) return { status: 'substituida', evento: '105102' };
      return { status: 'autorizada' };
    },
    // Distribuição de documentos do ADN a partir do último NSU (até 50 por lote)
    async distribuicaoDFe(amb, cert, nsu, cnpjConsulta) {
      const qs = new URLSearchParams({ lote: 'true', ...(cnpjConsulta ? { cnpjConsulta } : {}) });
      const r = await req(`${AMBIENTES[amb].adn}/contribuintes/DFe/${nsu}?${qs}`, { cert });
      const j = r.json || {};
      const status = campo(j, 'StatusProcessamento', 'statusProcessamento') || (r.status === 404 ? 'NENHUM_DOCUMENTO_LOCALIZADO' : '');
      const docs = (campo(j, 'LoteDFe', 'loteDFe') || []).map(d => ({
        nsu: Number(campo(d, 'NSU', 'nsu')), chave: campo(d, 'ChaveAcesso', 'chaveAcesso'), tipo: String(campo(d, 'TipoDocumento', 'tipoDocumento') || ''),
        tipoEvento: campo(d, 'TipoEvento', 'tipoEvento'), dataHora: campo(d, 'DataHoraGeracao', 'dataHoraGeracao'),
        xml: decodificarXml(campo(d, 'ArquivoXml', 'arquivoXml')),
      }));
      if (r.status >= 400 && status !== 'NENHUM_DOCUMENTO_LOCALIZADO') return { ok: false, status: r.status, situacao: status, erros: erros(r) };
      return { ok: true, situacao: status, docs };
    },
    async convenio(amb, cert, cMun) {
      let r = await req(`${AMBIENTES[amb].sefin}/parametros_municipais/${cMun}/convenio`, { cert });
      if (r.status === 404 || r.status === 405) r = await req(`${AMBIENTES[amb].adn}/parametrizacao/${cMun}/convenio`, { cert });
      return { ok: r.status === 200, status: r.status, dados: r.json || r.text, erros: r.status === 200 ? [] : erros(r) };
    },
    /** Tenta as rotas em ordem (Sefin e, se ela não tiver a rota, ADN) e devolve a primeira resposta 200. */
    async parametrosMunicipais(amb, cert, cMun, sufixos) {
      const tentativas = [];
      let ultima = null;
      for (const suf of [].concat(sufixos).filter(Boolean)) {
        for (const base of [`${AMBIENTES[amb].sefin}/parametros_municipais`, `${AMBIENTES[amb].adn}/parametrizacao`]) {
          const url = `${base}/${cMun}/${suf}`;
          const r = await req(url, { cert });
          tentativas.push({ url, status: r.status });
          ultima = { ok: r.status === 200, status: r.status, dados: r.json || r.text, rota: url };
          if (r.status === 200) return { ...ultima, tentativas };
          if (r.status !== 404 && r.status !== 405) return { ...ultima, tentativas, erros: erros(r) };
        }
      }
      return { ...(ultima || { ok: false, status: 0, dados: null }), tentativas };
    },
  };
  return api;
}
