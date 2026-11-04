// Criptografia isomórfica (Node 22+ e WebView Android) via WebCrypto.
// - Senhas: PBKDF2-SHA256 (210.000 iterações)
// - Dados sensíveis (certificados e senhas de certificado): AES-256-GCM com chave mestra do dispositivo
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const utf8 = s => enc.encode(s);
export const deUtf8 = b => dec.decode(b);

const ITER = 210000;
export async function hashSenha(senha) {
  const salt = randomBytes(16);
  const k = await subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, k, 256));
  return `pbkdf2$${ITER}$${hex(salt)}$${hex(bits)}`;
}
export async function conferirSenha(senha, armazenado) {
  if (!armazenado) return false;
  const [alg, it, salt, hash] = armazenado.split('$');
  if (alg !== 'pbkdf2') return false;
  const k = await subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = hex(new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: +it }, k, 256)));
  let diff = bits.length ^ hash.length;
  for (let i = 0; i < Math.min(bits.length, hash.length); i++) diff |= bits.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

// Cofre: cifra/decifra com a chave mestra (32 bytes) fornecida pela plataforma
export function criarCofre(chaveMestra) {
  const chave = subtle.importKey('raw', chaveMestra, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    async encrypt(dado) {
      const iv = randomBytes(12);
      const bytes = typeof dado === 'string' ? enc.encode(dado) : dado;
      const c = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, await chave, bytes));
      return `${b64(iv)}.${b64(c)}`;
    },
    async decrypt(payload, asBytes = false) {
      const [iv, c] = payload.split('.');
      const out = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await chave, unb64(c)));
      return asBytes ? out : dec.decode(out);
    },
  };
}

export const novoToken = () => hex(randomBytes(32));
