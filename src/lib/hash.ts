/** SHA-256 do telefone (hex): chave para outbound_log sem guardar o número em claro (R3). */
export async function hashWaId(waId: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(waId));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
