const HEX = /^[0-9a-f]{64}$/i;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Valida X-Hub-Signature-256 ("sha256=<hex>") sobre o corpo bruto; comparação em tempo constante. */
export async function verifySignature(
  rawBody: ArrayBuffer | Uint8Array,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret) return false;
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const hex = header.slice(prefix.length);
  if (!HEX.test(hex)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // crypto.subtle.verify compara em tempo constante.
  return crypto.subtle.verify("HMAC", key, hexToBytes(hex), rawBody);
}

/** Usado em testes para assinar payloads. */
export async function signBody(body: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha256=" + [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
