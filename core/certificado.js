// Leitura de certificados digitais ICP-Brasil A1 (.pfx/.p12) com node-forge.
import forge from 'node-forge';

const erro = msg => Object.assign(new Error(msg), { status: 400 });

// OIDs ICP-Brasil (otherName no SubjectAltName)
const OID_CNPJ = '2.16.76.1.3.3';
const OID_CPF_PF = '2.16.76.1.3.1';      // dados do titular PF: nascimento(8) + CPF(11) + ...
const OID_CPF_RESP = '2.16.76.1.3.4';    // responsável PJ: nascimento(8) + CPF(11) + ...

function lerOtherNames(cert) {
  const out = {};
  const ext = cert.extensions.find(e => e.name === 'subjectAltName');
  if (!ext) return out;
  try {
    const asn = forge.asn1.fromDer(ext.value);
    for (const gn of asn.value) {
      if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0) continue; // otherName
      const oid = forge.asn1.derToOid(gn.value[0].value);
      let v = gn.value[1];
      while (v && Array.isArray(v.value)) v = v.value[0];
      out[oid] = v ? String(v.value) : '';
    }
  } catch { /* ignora SAN malformado */ }
  return out;
}

const binario = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return s; };

/** Lê um PFX/P12 (Uint8Array) e extrai titular, CPF/CNPJ ICP-Brasil, validade e chaves em PEM. */
export function lerPfx(pfxBytes, senha) {
  let p12;
  try {
    const asn = forge.asn1.fromDer(forge.util.createBuffer(binario(pfxBytes)));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn, false, senha);
  } catch (e) {
    throw erro('Não foi possível abrir o certificado: senha incorreta ou arquivo inválido.');
  }
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
    || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!keyBag || !certBags.length) throw erro('Certificado sem chave privada.');
  const key = keyBag.key;
  // certificado do titular = o que corresponde à chave privada
  const pubPem = forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(key.n, key.e));
  const leaf = certBags.find(b => forge.pki.publicKeyToPem(b.cert.publicKey) === pubPem)?.cert || certBags[0].cert;
  const chain = certBags.map(b => b.cert).filter(c => c !== leaf);

  const cn = leaf.subject.getField('CN')?.value || '';
  const other = lerOtherNames(leaf);
  let documento = '', tipo_doc = '';
  if (other[OID_CNPJ] && /\d{14}/.test(other[OID_CNPJ])) { documento = other[OID_CNPJ].match(/\d{14}/)[0]; tipo_doc = 'CNPJ'; }
  else if (other[OID_CPF_PF] && other[OID_CPF_PF].length >= 19) { documento = other[OID_CPF_PF].substr(8, 11); tipo_doc = 'CPF'; }
  else {
    // fallback: padrão "NOME:00000000000000" no CN
    const m = cn.match(/:(\d{14}|\d{11})$/);
    if (m) { documento = m[1]; tipo_doc = m[1].length === 14 ? 'CNPJ' : 'CPF'; }
  }
  const titular = cn.split(':')[0];
  const cad = analisarCadeia(leaf, chain);
  return {
    cadeiaCompleta: cad.completa, cadeiaICP: cad.icp, cadeiaNiveis: cad.cadeia.length, cadeiaRaiz: cad.raiz,
    titular, documento, tipo_doc,
    responsavelCpf: other[OID_CPF_RESP] ? other[OID_CPF_RESP].substr(8, 11) : '',
    emissor: leaf.issuer.getField('CN')?.value || '',
    serial: leaf.serialNumber,
    valido_de: leaf.validity.notBefore.toISOString(),
    valido_ate: leaf.validity.notAfter.toISOString(),
    keyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(leaf),
    chainPem: chain.map(c => forge.pki.certificateToPem(c)),
  };
}

export function resumoCert(row) {
  const dias = Math.floor((new Date(row.valido_ate) - Date.now()) / 86400000);
  return {
    id: row.id, apelido: row.apelido, titular: row.titular, documento: row.documento, tipo_doc: row.tipo_doc,
    emissor: row.emissor, valido_de: row.valido_de, valido_ate: row.valido_ate, dias_restantes: dias,
    situacao: dias < 0 ? 'vencido' : dias <= 30 ? 'vencendo' : 'valido',
    cadeia: (() => { try { return JSON.parse(row.cadeia || '{}'); } catch { return {}; } })(),
  };
}

// ---------------------------------------------------------------------------------------------
// Cadeia de certificação ICP-Brasil
// O ADN/Sefin exigem, na autenticação mútua, a cadeia até a raiz ICP-Brasil. Muitos arquivos .pfx trazem
// apenas o certificado do titular; nesse caso as ACs intermediárias são obtidas pelo endereço AIA
// (Authority Information Access - caIssuers) gravado no próprio certificado e o .pfx é reempacotado.
const OID_AIA = '1.3.6.1.5.5.7.1.1';
const OID_CA_ISSUERS = '1.3.6.1.5.5.7.48.2';

export function urlsAIA(cert) {
  const ext = cert.extensions.find(e => e.id === OID_AIA);
  if (!ext) return [];
  const urls = [];
  try {
    const asn = forge.asn1.fromDer(ext.value);
    for (const ad of asn.value) {
      const oid = forge.asn1.derToOid(ad.value[0].value);
      const gn = ad.value[1];
      if (oid === OID_CA_ISSUERS && gn.type === 6) urls.push(String(gn.value));
    }
  } catch { /* extensão malformada */ }
  return urls;
}

const autoAssinado = c => { try { return c.isIssuer(c) && c.verify(c); } catch { return false; } };
const emitidoPor = (filho, pai) => { try { return pai.verify(filho); } catch { return false; } };

/** Ordena a cadeia a partir do titular e informa se termina numa raiz auto-assinada. */
export function analisarCadeia(leaf, outros) {
  const cadeia = [leaf];
  let atual = leaf;
  const resto = [...outros];
  for (let i = 0; i < 6 && !autoAssinado(atual); i++) {
    const idx = resto.findIndex(c => emitidoPor(atual, c));
    if (idx < 0) break;
    atual = resto.splice(idx, 1)[0];
    cadeia.push(atual);
  }
  const raiz = cadeia[cadeia.length - 1];
  const completa = autoAssinado(raiz);
  const icp = completa && /ICP-Brasil/i.test(raiz.subject.getField('O')?.value || raiz.subject.getField('CN')?.value || '');
  return { cadeia, completa, icp, raiz: raiz.subject.getField('CN')?.value || '' };
}

function certsDeArquivo(bytes) {
  const bin = binario(bytes);
  const out = [];
  try {
    if (bin.includes('-----BEGIN')) {
      for (const pem of bin.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []) out.push(forge.pki.certificateFromPem(pem));
      if (bin.includes('BEGIN PKCS7')) out.push(...forge.pkcs7.messageFromPem(bin).certificates);
      return out;
    }
    const asn = forge.asn1.fromDer(forge.util.createBuffer(bin));
    try { out.push(forge.pki.certificateFromAsn1(asn)); } catch { out.push(...forge.pkcs7.messageFromAsn1(asn).certificates); }
  } catch { /* formato desconhecido */ }
  return out;
}

/**
 * Garante a cadeia completa no PFX. `baixar(url) -> Promise<Uint8Array>` é fornecido pela plataforma.
 * Retorna { pfx (possivelmente reempacotado), alterado, completa, icp, niveis, raiz, aviso }.
 */
export async function completarCadeia(pfxBytes, senha, baixar) {
  const asn = forge.asn1.fromDer(forge.util.createBuffer(binario(pfxBytes)));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn, false, senha);
  const key = ((p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
    || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0]).key;
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map(b => b.cert);
  const pub = forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(key.n, key.e));
  const leaf = certs.find(c => forge.pki.publicKeyToPem(c.publicKey) === pub) || certs[0];
  let extras = certs.filter(c => c !== leaf);
  let a = analisarCadeia(leaf, extras);
  let baixados = 0, aviso = '';
  for (let i = 0; i < 5 && !a.completa; i++) {
    const ultimo = a.cadeia[a.cadeia.length - 1];
    const urls = urlsAIA(ultimo);
    if (!urls.length) { aviso = 'Certificado sem endereço AIA para obter a AC emissora.'; break; }
    let novos = [];
    for (const u of urls) {
      try { novos = certsDeArquivo(await baixar(u)); if (novos.length) break; } catch (e) { aviso = `Falha ao baixar ${u}: ${e.message}`; }
    }
    if (!novos.length) break;
    baixados += novos.length;
    extras = [...extras, ...novos];
    a = analisarCadeia(leaf, extras);
  }
  const info = { completa: a.completa, icp: a.icp, niveis: a.cadeia.length, raiz: a.raiz, aviso, alterado: false, pfx: pfxBytes };
  if (baixados && a.cadeia.length > 1) {
    const novo = forge.pkcs12.toPkcs12Asn1(key, a.cadeia, senha, { algorithm: '3des', friendlyName: leaf.subject.getField('CN')?.value });
    const der = forge.asn1.toDer(novo).getBytes();
    const out = new Uint8Array(der.length);
    for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i);
    Object.assign(info, { pfx: out, alterado: true });
  }
  return info;
}
