// Cliente das APIs do Sistema Nacional NFS-e (Sefin Nacional e ADN).
// O transporte HTTPS com autenticação mútua (certificado ICP-Brasil) é fornecido pela plataforma:
//   http({ url, method, headers, body, pfx: Uint8Array, senha }) -> { status, headers, body: Uint8Array }
import { gzipB64, gunzipB64 } from './dps.js';
import { deUtf8 } from './seguranca.js';

export const AMBIENTES = {
  producao: { sefin: 'https://sefin.nfse.gov.br/SefinNacional', adn: 'https://adn.nfse.gov.br' },
  homologacao: { sefin: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional', adn: 'https://adn.producaorestrita.nfse.gov.br' },
};

export function criarSefin(http) {
  async function req(url, { method = 'GET', body, cert, accept = 'application/json' }) {
    const r = await http({
      url, method, pfx: cert.pfx, senha: cert.senha,
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
    const lista = j.erros || j.Erros || j.erro || (j.mensagem ? [{ Descricao: j.mensagem }] : []);
    const arr = (Array.isArray(lista) ? lista : [lista]).map(e => ({
      codigo: e.Codigo || e.codigo || '', descricao: e.Descricao || e.descricao || e.message || JSON.stringify(e), complemento: e.Complemento || e.complemento || '',
    }));
    if (!arr.length) arr.push({ codigo: String(r.status), descricao: (r.text || 'Erro desconhecido').slice(0, 500) });
    return arr;
  };

  return {
    async emitirNFSe(amb, cert, dps) {
      const r = await req(`${AMBIENTES[amb].sefin}/nfse`, { method: 'POST', cert, body: { dpsXmlGZipB64: gzipB64(dps) } });
      if (r.status >= 200 && r.status < 300 && r.json?.chaveAcesso) {
        return { ok: true, chave: r.json.chaveAcesso, idDps: r.json.idDps, dhProc: r.json.dataHoraProcessamento,
          xmlNFSe: r.json.nfseXmlGZipB64 ? gunzipB64(r.json.nfseXmlGZipB64) : '', alertas: r.json.alertas || [], bruto: r.json };
      }
      return { ok: false, status: r.status, erros: erros(r), bruto: r.json || r.text };
    },
    async consultarNFSe(amb, cert, chave) {
      const r = await req(`${AMBIENTES[amb].sefin}/nfse/${chave}`, { cert });
      return r.status === 200 && r.json?.nfseXmlGZipB64 ? { ok: true, xml: gunzipB64(r.json.nfseXmlGZipB64) } : { ok: false, status: r.status, erros: erros(r) };
    },
    async consultarDPS(amb, cert, id) {
      const r = await req(`${AMBIENTES[amb].sefin}/dps/${id}`, { cert });
      return r.status === 200 ? { ok: true, chave: r.json?.chaveAcesso } : { ok: false, status: r.status, erros: erros(r) };
    },
    async registrarEvento(amb, cert, chave, pedido) {
      const r = await req(`${AMBIENTES[amb].sefin}/nfse/${chave}/eventos`, { method: 'POST', cert, body: { pedidoRegistroEventoXmlGZipB64: gzipB64(pedido) } });
      if (r.status >= 200 && r.status < 300) return { ok: true, xml: r.json?.eventoXmlGZipB64 ? gunzipB64(r.json.eventoXmlGZipB64) : '', bruto: r.json };
      return { ok: false, status: r.status, erros: erros(r), bruto: r.json || r.text };
    },
    async consultarEventos(amb, cert, chave) {
      const r = await req(`${AMBIENTES[amb].sefin}/nfse/${chave}/eventos`, { cert });
      return { ok: r.status === 200, status: r.status, bruto: r.json || r.text };
    },
    async baixarDANFSe(amb, cert, chave) {
      const r = await req(`${AMBIENTES[amb].adn}/danfse/${chave}`, { cert, accept: 'application/pdf' });
      return r.status === 200 && r.bytes?.length > 100 ? { ok: true, pdf: r.bytes } : { ok: false, status: r.status, erros: erros(r) };
    },
    async parametrosMunicipais(amb, cert, cMun, sufixo) {
      const r = await req(`${AMBIENTES[amb].sefin}/parametros_municipais/${cMun}/${sufixo}`, { cert });
      return { ok: r.status === 200, status: r.status, dados: r.json || r.text };
    },
  };
}
