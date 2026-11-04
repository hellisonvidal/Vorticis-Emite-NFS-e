// Gera um certificado A1 de TESTE (autoassinado) no formato ICP-Brasil (otherName CNPJ/CPF) para desenvolvimento.
import forge from 'node-forge';
import fs from 'node:fs';

export function gerarPfx({ nome = 'EMPRESA TESTE LTDA', cpf, cnpj = cpf ? null : '11222333000181', senha = '1234', dias = 365 } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + dias * 86400e3);
  const doc = cnpj || cpf;
  const attrs = [{ name: 'commonName', value: `${nome}:${doc}` }, { name: 'countryName', value: 'BR' }, { name: 'organizationName', value: 'ICP-Brasil' }];
  cert.setSubject(attrs);
  cert.setIssuer([{ name: 'commonName', value: 'AC TESTE NFSE FACIL' }]);
  const A = forge.asn1;
  const other = (oid, val) => A.create(A.Class.CONTEXT_SPECIFIC, 0, true, [
    A.create(A.Class.UNIVERSAL, A.Type.OID, false, A.oidToDer(oid).getBytes()),
    A.create(A.Class.CONTEXT_SPECIFIC, 0, true, [A.create(A.Class.UNIVERSAL, A.Type.OCTETSTRING, false, val)]),
  ]);
  const san = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, cnpj
    ? [other('2.16.76.1.3.3', cnpj), other('2.16.76.1.3.4', '01011980' + '52998224725' + '0'.repeat(30))]
    : [other('2.16.76.1.3.1', '01011980' + cpf + '0'.repeat(30))]);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { id: '2.5.29.17', critical: false, value: A.toDer(san).getBytes() },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  return Buffer.from(A.toDer(p12).getBytes(), 'binary');
}

if (process.argv[1]?.endsWith('gerar-cert-teste.js')) {
  const out = process.argv[2] || 'certificado-teste.pfx';
  fs.writeFileSync(out, gerarPfx({ nome: process.argv[3], cnpj: process.argv[4] }));
  console.log(`Certificado de teste gerado: ${out} (senha 1234)`);
}
