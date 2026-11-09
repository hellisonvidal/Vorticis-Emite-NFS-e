// Executado no CI (windows-latest): repositório de certificados do Windows via PowerShell/.NET.
// Cria certificados NÃO exportáveis (CNG e CSP legado) no CurrentUser\My, lista, assina e confere.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import forge from 'node-forge';
import { listar, assinar, ambientePowershell } from '../../desktop/repositorio-windows.js';
import { lerCertificadoDer, conferirAssinatura } from '../../core/certificado.js';

const ps = cmd => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Import-Module Microsoft.PowerShell.Security, PKI -ErrorAction Stop; ' + cmd], { encoding: 'utf8', env: ambientePowershell() }).trim();
const criados = [];
const criar = (cn, provedor) => {
  const t = ps(`(New-SelfSignedCertificate -Subject 'CN=${cn}' -CertStoreLocation Cert:\\CurrentUser\\My -KeyExportPolicy NonExportable -KeyAlgorithm RSA -KeyLength 2048 -Provider '${provedor}' -NotAfter (Get-Date).AddDays(2)).Thumbprint`);
  criados.push(t);
  return t;
};
after(() => { for (const t of criados) ps(`Remove-Item -Path Cert:\\CurrentUser\\My\\${t} -DeleteKey`); });

const bin = u => String.fromCharCode(...u);
function confere(certPem, dados, sig, alg) {
  const cert = forge.pki.certificateFromPem(certPem);
  const md = alg === 'sha256' ? forge.md.sha256.create() : forge.md.sha1.create();
  md.update(bin(dados));
  return cert.publicKey.verify(md.digest().getBytes(), bin(sig));
}

for (const provedor of ['Microsoft Software Key Storage Provider', 'Microsoft Enhanced RSA and AES Cryptographic Provider']) {
  test(`listar e assinar com chave não exportável (${provedor})`, async () => {
    const t = criar(`TESTE VORTICIS ${criados.length}:11222333000181`, provedor);
    const c = (await listar()).find(x => x.id === t);
    assert.ok(c, 'certificado criado não apareceu na listagem');
    const info = lerCertificadoDer(c.der);
    assert.equal(info.documento, '11222333000181');
    const dados = new TextEncoder().encode('<SignedInfo>teste ç</SignedInfo>');
    for (const alg of ['sha1', 'sha256']) assert.ok(confere(info.certPem, dados, await assinar(t, dados, alg), alg), `assinatura ${alg} inválida`);
    assert.ok(conferirAssinatura(info.certPem, dados, await assinar(t, dados, 'sha256')));
    await assert.rejects(assinar('0'.repeat(40), dados, 'sha1'));
    await assert.rejects(assinar("x'; Remove-Item", dados, 'sha1'), /inválido/);
  });
}
