/* global Buffer, TextEncoder, console, process */
// Gera o hash da senha do painel e segredos aleatórios. Uso:  node scripts/hash-password.mjs 'sua senha'
// A senha NÃO é salva em lugar nenhum; guarde só o hash (secret PANEL_PASSWORD_HASH).
import { webcrypto as crypto } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Uso: node scripts/hash-password.mjs 'senha com 12+ caracteres'");
  process.exit(1);
}
const b64url = (u8) => Buffer.from(u8).toString("base64url");
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
console.log(`PANEL_PASSWORD_HASH=pbkdf2$100000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`);
console.log(`PANEL_SESSION_SECRET=${b64url(crypto.getRandomValues(new Uint8Array(32)))}`);
console.log(`INTEGRATION_API_KEY=${b64url(crypto.getRandomValues(new Uint8Array(32)))}`);
