// Autenticação do painel: senha com PBKDF2-SHA256, sessão assinada (HMAC) em cookie e bloqueio por tentativas.
// Só usa Web Crypto (disponível no Workers). O Workers limita o PBKDF2 a 100.000 iterações.
export const PBKDF2_ITERATIONS = 100_000;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const COOKIE_NAME = "__Host-painel";
/** Bloqueio por origem: 5 erros -> 15 min. Bloqueio global (qualquer origem): 30 erros -> 15 min. */
export const LOGIN_LIMITS = { perIp: 5, global: 30, lockMs: 15 * 60 * 1000 } as const;

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Comparação em tempo constante (tamanhos diferentes = falso, mas sem atalho no conteúdo). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let d = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return d === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Formato guardado: pbkdf2$<iterações>$<salt b64url>$<hash b64url>. */
export async function hashPassword(password: string, salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const h = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(h)}`;
}

// Hash descartável: mantém o tempo de resposta igual quando o hash guardado é inválido.
const DUMMY: { iterations: number; salt: Uint8Array; hash: Uint8Array } = { iterations: PBKDF2_ITERATIONS, salt: new Uint8Array(16), hash: new Uint8Array(32) };

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  let p: { iterations: number; salt: Uint8Array; hash: Uint8Array } = DUMMY;
  let valid = false;
  if (parts.length === 4 && parts[0] === "pbkdf2") {
    const it = Number(parts[1]);
    if (Number.isInteger(it) && it >= 1 && it <= PBKDF2_ITERATIONS) {
      try {
        p = { iterations: it, salt: fromB64url(parts[2] ?? ""), hash: fromB64url(parts[3] ?? "") };
        valid = true;
      } catch { /* hash corrompido: segue com o descartável */ }
    }
  }
  const got = await pbkdf2(password, p.salt, p.iterations);
  return constantTimeEqual(got, p.hash) && valid;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signSession(secret: string, user: string, now: Date, ttlMs = SESSION_TTL_MS): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp: now.getTime() + ttlMs, n: b64url(crypto.getRandomValues(new Uint8Array(8))) })));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function verifySession(secret: string, token: string | null | undefined, user: string, now: Date): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  try {
    if (!constantTimeEqual(await hmac(secret, payload), fromB64url(sig))) return false;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u?: string; exp?: number };
    return data.u === user && typeof data.exp === "number" && data.exp > now.getTime();
  } catch {
    return false;
  }
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${COOKIE_NAME}=${token}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
