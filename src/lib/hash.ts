// pessoa_id = HMAC-SHA256(telefone, PESSOA_ID_SECRET), em hex (64 caracteres).
// Telefone tem poucos dígitos: um SHA-256 puro se reverte por força bruta, e esse id aparece no caminho do R2 e na API.
// Com o segredo (só no Worker) o id não se reverte sem ele. Perder o segredo desliga todas as ligações: guarde um backup.
// O segredo é configurado uma vez por requisição/cron em src/index.ts (configurePessoaIdSecret).
// Falha fechada: sem segredo (ou curto), nada é calculado e, portanto, nada é gravado nem enviado.
export const MIN_PESSOA_ID_SECRET_LENGTH = 32;

let secret: string | null = null;
let key: Promise<CryptoKey> | null = null;

/** Define o segredo do HMAC. Valor ausente ou curto demais desliga o cálculo (hashWaId passa a lançar erro). */
export function configurePessoaIdSecret(value: unknown): void {
  const next = typeof value === "string" ? value.trim() : "";
  const valid = next.length >= MIN_PESSOA_ID_SECRET_LENGTH ? next : null;
  if (valid === secret) return;
  secret = valid;
  key = valid
    ? crypto.subtle.importKey("raw", new TextEncoder().encode(valid), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    : null;
}

export function hasPessoaIdSecret(): boolean {
  return secret !== null;
}

/** pessoa_id do telefone (ou de qualquer texto que não deva ficar em claro, como o IP do painel). Mesmo valor que `wa_id_hash`. */
export async function hashWaId(waId: string): Promise<string> {
  if (!key) throw new Error("PESSOA_ID_SECRET ausente ou curto (mínimo 32 caracteres)");
  const sig = await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(waId));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const pessoaId = hashWaId;
