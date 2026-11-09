// Repositório de certificados do Windows via PowerShell/.NET (sem dependência do Electron, testável no CI).
// Lista os certificados com chave privada (CurrentUser\\My e LocalMachine\\My) e assina com RSA PKCS#1 v1.5,
// inclusive chaves não exportáveis e tokens/cartões A3 (o Windows pede o PIN).
import { execFile } from 'node:child_process';

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
export const THUMB = /^[0-9A-F]{40}$/i;

function powershell(script, env = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [...PS, script], { env: { ...process.env, ...env }, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((String(stderr || '').split(/\r?\n/).find(l => l.trim() && !l.startsWith('At ') && !l.startsWith('+')) || err.message).trim()));
      resolve(String(stdout).trim());
    });
  });
}

const SCRIPT_LISTAR = `
$ErrorActionPreference = 'SilentlyContinue'
$r = @()
foreach ($loc in 'CurrentUser', 'LocalMachine') {
  Get-ChildItem ("Cert:\\" + $loc + "\\My") | Where-Object { $_.HasPrivateKey } | ForEach-Object {
    $r += [pscustomobject]@{ id = $_.Thumbprint; der = [Convert]::ToBase64String($_.RawData); local = $loc; nome = $_.GetNameInfo('SimpleName', $false) }
  }
}
ConvertTo-Json -InputObject @($r) -Compress`;

const SCRIPT_ASSINAR = `
$ErrorActionPreference = 'Stop'
$c = Get-Item -Path ("Cert:\\CurrentUser\\My\\" + $env:VORTICIS_CERT) -ErrorAction SilentlyContinue
if (-not $c) { $c = Get-Item -Path ("Cert:\\LocalMachine\\My\\" + $env:VORTICIS_CERT) }
$k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c)
if (-not $k) { throw 'A chave privada deste certificado não está acessível.' }
if ($env:VORTICIS_ALG -eq 'sha256') { $h = [System.Security.Cryptography.HashAlgorithmName]::SHA256 } else { $h = [System.Security.Cryptography.HashAlgorithmName]::SHA1 }
$s = $k.SignData([Convert]::FromBase64String($env:VORTICIS_DADOS), $h, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
[Convert]::ToBase64String($s)`;

export async function listar() {
  if (process.platform !== 'win32') return [];
  const saida = await powershell(SCRIPT_LISTAR);
  const lista = saida ? JSON.parse(saida) : [];
  const vistos = new Set();
  return (Array.isArray(lista) ? lista : [lista]).filter(c => c?.id && !vistos.has(c.id) && vistos.add(c.id))
    .map(c => ({ id: c.id.toUpperCase(), der: new Uint8Array(Buffer.from(c.der, 'base64')), nome: c.nome, local: c.local }));
}

export async function assinar(id, dados, alg = 'sha1') {
  if (!THUMB.test(id)) throw new Error('Certificado inválido.');
  const r = await powershell(SCRIPT_ASSINAR, { VORTICIS_CERT: id, VORTICIS_DADOS: Buffer.from(dados).toString('base64'), VORTICIS_ALG: alg === 'sha256' ? 'sha256' : 'sha1' });
  return new Uint8Array(Buffer.from(r, 'base64'));
}

