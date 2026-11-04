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
  return {
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
  };
}
