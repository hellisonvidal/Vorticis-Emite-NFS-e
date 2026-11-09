// Geração do XML da DPS (leiaute v1.01 do Sistema Nacional NFS-e) e do Pedido de Registro de Evento.
import forge from 'node-forge';
import { gzipSync, gunzipSync } from 'fflate';
import { b64, unb64, utf8, deUtf8, randomBytes } from './seguranca.js';

export const NS = 'http://www.sped.fazenda.gov.br/nfse';
export const VERSAO = '1.01';
export const VER_APLIC = 'VorticisEmiteNFS-1.0';

// Escape de texto compatível com a forma canônica C14N (& < > CR)
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const so = s => String(s ?? '').replace(/\D/g, '');
const dec = (v, casas = 2) => {
  const n = +v || 0;
  return n === 0 ? '0' : n.toFixed(casas);
};
const limpa = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

// Elemento simples (omitido se vazio quando opcional)
function el(tag, v, opcional = true) {
  if (opcional && (v === undefined || v === null || v === '')) return '';
  return `<${tag}>${esc(v)}</${tag}>`;
}
const grp = (tag, inner, opcional = true) => (opcional && !inner ? '' : `<${tag}>${inner}</${tag}>`);

export function dataHoraBR(d = new Date()) {
  // Horário de Brasília (UTC-03:00), formato AAAA-MM-DDThh:mm:ss-03:00
  const t = new Date(d.getTime() - 3 * 3600e3);
  return t.toISOString().slice(0, 19) + '-03:00';
}

export function idDPS({ cLocEmi, tipoDoc, doc, serie, nDPS }) {
  const tp = tipoDoc === 'CPF' ? '1' : '2';
  return 'DPS' + so(cLocEmi).padStart(7, '0') + tp + so(doc).padStart(14, '0') + so(serie).padStart(5, '0') + String(nDPS).padStart(15, '0');
}

function documento(p) {
  const d = so(p.documento);
  switch (p.tipo_doc) {
    case 'CPF': return el('CPF', d.padStart(11, '0'), false);
    case 'NIF': return el('NIF', limpa(p.documento, 40), false);
    case 'SEM': return el('cNaoNIF', p.motivo_sem_nif || '0', false);
    default: return el('CNPJ', d.padStart(14, '0'), false);
  }
}

function endereco(p, obrig = false) {
  if (!p.logradouro && !obrig) return '';
  let local;
  if ((p.pais || 'BR') !== 'BR') {
    local = grp('endExt', el('cPais', p.pais, false) + el('cEndPost', limpa(p.cod_postal_ext || '0', 11), false) +
      el('xCidade', limpa(p.cidade_ext, 60), false) + el('xEstProvReg', limpa(p.estado_ext || '-', 60), false), false);
  } else {
    local = grp('endNac', el('cMun', so(p.cod_municipio), false) + el('CEP', so(p.cep), false), false);
  }
  return grp('end', local + el('xLgr', limpa(p.logradouro, 255), false) + el('nro', limpa(p.numero || 'S/N', 60), false) +
    el('xCpl', limpa(p.complemento, 156)) + el('xBairro', limpa(p.bairro || 'Centro', 60), false), false);
}

/**
 * Monta o XML da DPS (sem assinatura).
 * @param {object} n  dados consolidados: { contrib, tomador, form, calc, serie, nDPS, ambiente, subst }
 */
export function montarDPS(n) {
  const { contrib: c, tomador: t, form: f, calc: k } = n;
  const tpAmb = n.ambiente === 'producao' ? '1' : '2';
  const id = idDPS({ cLocEmi: c.cod_municipio, tipoDoc: c.tipo_doc, doc: c.documento, serie: n.serie, nDPS: n.nDPS });
  const dhEmi = n.dhEmi || dataHoraBR(new Date(Date.now() - 60e3));

  // ---- Prestador ----
  const regTrib = el('opSimpNac', k.opSimpNac, false) + el('regApTribSN', k.regApTribSN) + el('regEspTrib', k.regEspTrib || '0', false);
  const prest = grp('prest', documento(c) + el('IM', so(c.im)) + el('fone', so(c.fone).slice(0, 20)) + el('email', limpa(c.email, 80)) + grp('regTrib', regTrib, false), false);

  // ---- Tomador ----
  let toma = '';
  if (t && (t.documento || t.tipo_doc === 'SEM')) {
    toma = grp('toma', documento(t) + el('IM', so(t.im)) + el('xNome', limpa(t.nome, 150), false) + endereco(t) +
      el('fone', so(t.fone).slice(0, 20)) + el('email', limpa(t.email, 80)), false);
  }

  // ---- Serviço ----
  const locPrest = f.local_prestacao_pais && f.local_prestacao_pais !== 'BR'
    ? el('cPaisPrestacao', f.local_prestacao_pais, false)
    : el('cLocPrestacao', so(f.local_prestacao || c.cod_municipio), false);
  const cServ = el('cTribNac', so(f.ctribnac), false) + el('cTribMun', so(f.ctribmun)) +
    el('xDescServ', limpa(f.descricao, 2000), false) + el('cNBS', so(f.cnbs)) + el('cIntContrib', limpa(f.cod_interno, 20));
  let infoCompl = '';
  if (f.info_compl || f.num_pedido || f.doc_ref) {
    infoCompl = grp('infoCompl', el('docRef', limpa(f.doc_ref, 255)) + el('xPed', limpa(f.num_pedido, 15)) + el('xInfComp', limpa(f.info_compl, 2000)));
  }
  let obra = '';
  if (f.obra_cobra || f.obra_cep) {
    obra = grp('obra', el('inscImobFisc', limpa(f.obra_insc_imob, 30)) + (f.obra_cobra ? el('cObra', limpa(f.obra_cobra, 30), false)
      : grp('end', el('CEP', so(f.obra_cep), false) + el('xLgr', limpa(f.obra_logradouro, 255), false) + el('nro', limpa(f.obra_numero || 'S/N', 60), false) +
        el('xCpl', limpa(f.obra_complemento, 156)) + el('xBairro', limpa(f.obra_bairro || 'Centro', 60), false), false)));
  }
  let atvEvento = '';
  if (f.evento_nome) {
    atvEvento = grp('atvEvento', el('xNome', limpa(f.evento_nome, 255), false) + el('dtIni', f.evento_ini, false) + el('dtFim', f.evento_fim || f.evento_ini, false) +
      (f.evento_id ? el('idAtvEvt', limpa(f.evento_id, 30), false) : grp('end', el('CEP', so(f.evento_cep), false) + el('xLgr', limpa(f.evento_logradouro, 255), false) +
        el('nro', limpa(f.evento_numero || 'S/N', 60), false) + el('xBairro', limpa(f.evento_bairro || 'Centro', 60), false), false)));
  }
  let comExt = '';
  if (f.comext_ativo) {
    comExt = grp('comExt', el('mdPrestacao', f.comext_modo || '1', false) + el('vincPrest', f.comext_vinculo || '0', false) +
      el('tpMoeda', f.comext_moeda || '220', false) + el('vServMoeda', dec(f.comext_valor_moeda), false) +
      el('mecAFComexP', f.comext_mec_p || '01', false) + el('mecAFComexT', f.comext_mec_t || '01', false) +
      el('movTempBens', f.comext_mov_bens || '1', false) + el('mdic', f.comext_mdic || '0', false));
  }
  const serv = grp('serv', grp('locPrest', locPrest, false) + grp('cServ', cServ, false) + comExt + obra + atvEvento + infoCompl, false);

  // ---- Valores ----
  const vServPrest = grp('vServPrest', el('vReceb', f.valor_recebido ? dec(f.valor_recebido) : '') + el('vServ', dec(k.vServ), false), false);
  const vDesc = (k.vDescIncond || k.vDescCond)
    ? grp('vDescCondIncond', (k.vDescIncond ? el('vDescIncond', dec(k.vDescIncond)) : '') + (k.vDescCond ? el('vDescCond', dec(k.vDescCond)) : '')) : '';
  const vDedRed = k.vDR ? grp('vDedRed', k.deducaoTipo === 'percentual' ? el('pDR', dec(k.deducaoValor), false) : el('vDR', dec(k.vDR), false)) : '';

  let tribMun = el('tribISSQN', k.tribISSQN, false);
  if (k.tribISSQN === '3') tribMun += el('cPaisResult', f.pais_resultado || f.local_prestacao_pais || 'US');
  if (k.tribISSQN === '2') tribMun += el('tpImunidade', f.tp_imunidade || '0');
  if (f.exig_susp_tipo) tribMun += grp('exigSusp', el('tpSusp', f.exig_susp_tipo, false) + el('nProcesso', limpa(f.exig_susp_processo, 30), false));
  if (f.bm_numero) tribMun += grp('BM', el('nBM', limpa(f.bm_numero, 14), false) + (f.bm_vred ? el('vRedBCBM', dec(f.bm_vred)) : f.bm_pred ? el('pRedBCBM', dec(f.bm_pred)) : ''));
  tribMun += el('tpRetISSQN', k.tpRetISSQN, false);
  if (k.enviarAliq && k.aliq) tribMun += el('pAliq', dec(k.aliq));

  let tribFed = '';
  const fd = k.fed;
  if (c.tipo_doc !== 'CPF') {
    let pc = '';
    if (fd.vPis || fd.vCofins || fd.tpRet) {
      pc = grp('piscofins', el('CST', fd.cst, false) + el('vBCPisCofins', dec(fd.vBC)) + el('pAliqPis', dec(fd.pAliqPis)) +
        el('pAliqCofins', dec(fd.pAliqCofins)) + el('vPis', dec(fd.vPis)) + el('vCofins', dec(fd.vCofins)) + el('tpRetPisCofins', fd.tpRet));
    }
    tribFed = grp('tribFed', pc + (fd.vCP ? el('vRetCP', dec(fd.vCP)) : '') + (fd.vIRRF ? el('vRetIRRF', dec(fd.vIRRF)) : '') + (fd.vCSLL ? el('vRetCSLL', dec(fd.vCSLL)) : ''));
  }
  const totTrib = grp('totTrib', k.totTrib.pTotTribSN !== undefined ? el('pTotTribSN', dec(k.totTrib.pTotTribSN), false) : el('indTotTrib', '0', false), false);
  const valores = grp('valores', vServPrest + vDesc + vDedRed + grp('trib', grp('tribMun', tribMun, false) + tribFed + totTrib, false), false);

  // ---- IBS/CBS (Reforma Tributária) ----
  let ibscbs = '';
  if (k.ibscbs) {
    const b = k.ibscbs;
    const dest = f.ind_dest === '1' && f.dest_documento
      ? grp('dest', documento({ tipo_doc: f.dest_tipo_doc || 'CNPJ', documento: f.dest_documento }) + el('xNome', limpa(f.dest_nome, 150), false)) : '';
    let imovel = '';
    if (f.imovel_ccib || f.imovel_cep) {
      imovel = grp('imovel', el('inscImobFisc', limpa(f.imovel_insc, 30)) + (f.imovel_ccib ? el('cCIB', limpa(f.imovel_ccib, 8), false)
        : grp('end', el('CEP', so(f.imovel_cep), false) + el('xLgr', limpa(f.imovel_logradouro, 255), false) + el('nro', limpa(f.imovel_numero || 'S/N', 60), false) +
          el('xBairro', limpa(f.imovel_bairro || 'Centro', 60), false), false)));
    }
    const gIBSCBS = el('CST', b.cst, false) + el('cClassTrib', b.cClassTrib, false) + el('cCredPres', f.ccredpres);
    ibscbs = grp('IBSCBS', el('finNFSe', '0', false) + el('indFinal', f.ind_final ? '1' : '0') + el('cIndOp', b.cIndOp, false) +
      el('tpOper', f.tp_oper) + (f.ref_nfse ? grp('gRefNFSe', el('refNFSe', so(f.ref_nfse), false)) : '') +
      el('tpEnteGov', t?.orgao_publico ? t.tp_ente_gov : '') + el('indDest', f.ind_dest || '0', false) + dest + imovel +
      grp('valores', grp('trib', grp('gIBSCBS', gIBSCBS, false), false), false), false);
  }

  let subst = '';
  if (n.subst?.chave) subst = grp('subst', el('chSubstda', so(n.subst.chave), false) + el('cMotivo', n.subst.motivo || '99', false) + el('xMotivo', limpa(n.subst.xMotivo || 'Substituição de NFS-e', 255)));

  const inf = el('tpAmb', tpAmb, false) + el('dhEmi', dhEmi, false) + el('verAplic', VER_APLIC, false) + el('serie', so(n.serie).replace(/^0+(?=\d)/, ''), false) +
    el('nDPS', String(n.nDPS), false) + el('dCompet', f.competencia, false) + el('tpEmit', '1', false) + el('cLocEmi', so(c.cod_municipio), false) +
    subst + prest + toma + serv + valores + ibscbs;
  const xml = `<DPS xmlns="${NS}" versao="${VERSAO}"><infDPS Id="${id}">${inf}</infDPS></DPS>`;
  return { xml, id, dhEmi, tpAmb };
}

export function montarCancelamento({ chave, tpAmb, tipoDoc, doc, motivo, xMotivo }) {
  const tp = '101101';
  const id = `PRE${chave}${tp}`;
  const autor = tipoDoc === 'CPF' ? el('CPFAutor', so(doc).padStart(11, '0'), false) : el('CNPJAutor', so(doc).padStart(14, '0'), false);
  const xml = `<pedRegEvento xmlns="${NS}" versao="${VERSAO}"><infPedReg Id="${id}">` +
    el('tpAmb', tpAmb, false) + el('verAplic', VER_APLIC, false) + el('dhEvento', dataHoraBR(new Date(Date.now() - 60e3)), false) + autor +
    el('chNFSe', chave, false) + `<e${tp}><xDesc>Cancelamento de NFS-e</xDesc>` + el('cMotivo', motivo || '1', false) +
    el('xMotivo', limpa(xMotivo || 'Erro na emissão', 255), false) + `</e${tp}></infPedReg></pedRegEvento>`;
  return { xml, id };
}

const ALG = {
  sha1: { sig: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1', dig: 'http://www.w3.org/2000/09/xmldsig#sha1', md: () => forge.md.sha1.create() },
  sha256: { sig: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', dig: 'http://www.w3.org/2001/04/xmlenc#sha256', md: () => forge.md.sha256.create() },
};
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

/**
 * Assinatura XMLDSig enveloped (C14N inclusiva) do elemento `tag` (infDPS / infPedReg).
 * O XML é gerado por este módulo já na forma canônica (sem espaços, escape C14N, sem elementos vazios),
 * então a canonicalização do elemento referenciado é o próprio trecho com a declaração de namespace herdada.
 */
export function assinar(xml, tag, { keyPem, certPem }, alg = 'sha1') {
  const a = ALG[alg] || ALG.sha1;
  const ini = xml.indexOf(`<${tag} `);
  const fimTag = `</${tag}>`;
  const fim = xml.indexOf(fimTag) + fimTag.length;
  if (ini < 0 || fim < fimTag.length) throw new Error(`Elemento ${tag} não encontrado para assinatura.`);
  const trecho = xml.slice(ini, fim);
  const id = trecho.match(/ Id="([^"]+)"/)[1];
  const ns = xml.match(/^<\w+ xmlns="([^"]+)"/)[1];
  // C14N: declaração de namespace primeiro, depois atributos em ordem
  const canon = trecho.replace(`<${tag} Id="${id}"`, `<${tag} xmlns="${ns}" Id="${id}"`);
  const mdD = a.md(); mdD.update(canon, 'utf8');
  const digest = forge.util.encode64(mdD.digest().getBytes());
  const signedInfo = `<SignedInfo xmlns="${DSIG}"><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${a.sig}"></SignatureMethod><Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="${a.dig}"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const key = forge.pki.privateKeyFromPem(keyPem);
  const mdS = a.md(); mdS.update(signedInfo, 'utf8');
  const valor = forge.util.encode64(key.sign(mdS));
  const cert = certPem.replace(/-----[^-]+-----|\s/g, '');
  const sig = `<Signature xmlns="${DSIG}">${signedInfo.replace(` xmlns="${DSIG}"`, '')}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${cert}</X509Certificate></X509Data></KeyInfo></Signature>`;
  return xml.slice(0, fim) + sig + xml.slice(fim);
}

export const gzipB64 = xml => b64(gzipSync(utf8(xml)));
export const gunzipB64 = s => deUtf8(gunzipSync(unb64(s)));

// ----------- Simulação local (sem envio à Sefin) -----------
export function chaveSimulada({ cMun, tipoDoc, doc, nNFSe }) {
  // cMun(7) + ambGer(1) + tpInsc(1) + inscr(14) + nNFSe(13) + AAMM(4) + cod(9) + DV(1) = 50
  const d = new Date();
  const aamm = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
  const base = so(cMun).padStart(7, '0') + '2' + (tipoDoc === 'CPF' ? '1' : '2') + so(doc).padStart(14, '0') +
    String(nNFSe).padStart(13, '0') + aamm + String(new DataView(randomBytes(4).buffer).getUint32(0) % 999999999).padStart(9, '0');
  let soma = 0, peso = 2;
  for (let i = base.length - 1; i >= 0; i--) { soma += +base[i] * peso; peso = peso === 9 ? 2 : peso + 1; }
  const dv = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  return base + dv;
}

export function nfseSimulada({ chave, nNFSe, dpsAssinada, contrib, calc, municipio, xTribNac = 'SIMULAÇÃO - SEM VALOR FISCAL' }) {
  const dps = dpsAssinada.replace(/^<\?xml[^>]*>/, '');
  const ib = calc.ibscbs;
  const ibsXml = ib ? `<IBSCBS><cLocalidadeIncid>${so(contrib.cod_municipio)}</cLocalidadeIncid><xLocalidadeIncid>${esc(municipio)}</xLocalidadeIncid>` +
    `<valores><vBC>${dec(ib.vBC)}</vBC><uf><pIBSUF>${dec(ib.pIBSUF)}</pIBSUF><pAliqEfetUF>${dec(ib.pIBSUF)}</pAliqEfetUF></uf>` +
    `<mun><pIBSMun>${dec(ib.pIBSMun)}</pIBSMun><pAliqEfetMun>${dec(ib.pIBSMun)}</pAliqEfetMun></mun><fed><pCBS>${dec(ib.pCBS)}</pCBS><pAliqEfetCBS>${dec(ib.pCBS)}</pAliqEfetCBS></fed></valores>` +
    `<totCIBS><vTotNF>${dec(ib.vTotNF)}</vTotNF><gIBS><vIBSTot>${dec(ib.vIBS)}</vIBSTot><gIBSUFTot><vIBSUF>${dec(ib.vIBSUF)}</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>${dec(ib.vIBSMun)}</vIBSMun></gIBSMunTot></gIBS>` +
    `<gCBS><vCBS>${dec(ib.vCBS)}</vCBS></gCBS></totCIBS></IBSCBS>` : '';
  return `<NFSe xmlns="${NS}" versao="${VERSAO}"><infNFSe Id="NFS${chave}"><xLocEmi>${esc(municipio)}</xLocEmi><xLocPrestacao>${esc(municipio)}</xLocPrestacao>` +
    `<nNFSe>${nNFSe}</nNFSe><cLocIncid>${so(contrib.cod_municipio)}</cLocIncid><xLocIncid>${esc(municipio)}</xLocIncid><xTribNac>${esc(xTribNac)}</xTribNac><verAplic>${VER_APLIC}</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><cStat>100</cStat>` +
    `<dhProc>${dataHoraBR()}</dhProc><nDFSe>${nNFSe}</nDFSe><emit>${documento(contrib)}${contrib.im ? `<IM>${so(contrib.im)}</IM>` : ''}<xNome>${esc(contrib.razao_social)}</xNome>` +
    `<enderNac><xLgr>${esc(contrib.logradouro || '-')}</xLgr><nro>${esc(contrib.numero || 'S/N')}</nro><xBairro>${esc(contrib.bairro || '-')}</xBairro><cMun>${so(contrib.cod_municipio)}</cMun><UF>${esc(contrib.uf || '')}</UF><CEP>${so(contrib.cep) || '00000000'}</CEP></enderNac>` +
    `${contrib.fone ? `<fone>${so(contrib.fone)}</fone>` : ''}${contrib.email ? `<email>${esc(contrib.email)}</email>` : ''}</emit>` +
    `<valores><vBC>${dec(calc.bcISS)}</vBC>${calc.aliq ? `<pAliqAplic>${dec(calc.aliq)}</pAliqAplic>` : ''}<vISSQN>${dec(calc.vISS)}</vISSQN><vTotalRet>${dec(calc.vTotalRet)}</vTotalRet><vLiq>${dec(calc.vLiq)}</vLiq></valores>` +
    `${ibsXml}${dps}</infNFSe></NFSe>`;
}
