// Autenticação do webhook da Evolution. A Evolution NÃO assina o corpo (como o HMAC da Meta): usamos um segredo
// compartilhado, configurado na instância como header (`headers` do /webhook/set) e conferido em tempo constante.
export const WEBHOOK_TOKEN_HEADER = "x-webhook-token";

/** Aceita `X-Webhook-Token: <token>` ou `Authorization: Bearer <token>`. */
export function extractWebhookToken(headers: Headers): string | null {
  const direct = headers.get(WEBHOOK_TOKEN_HEADER);
  if (direct) return direct.trim();
  const m = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "");
  return m ? (m[1] ?? "").trim() : null;
}

/** Comparação em tempo constante (via hash, mesmo tamanho). Token vazio nunca vale. */
export async function verifyWebhookToken(given: string | null, expected: string): Promise<boolean> {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
