// Monta payloads `messages.upsert` da Evolution (formato Baileys) para os testes. Nunca toca a rede (R4).
export const PHONE = "5511987651234";
export const TOKEN = "token-de-teste-evolution";

export interface UpsertOpts {
  id?: string;
  jid?: string;
  fromMe?: boolean;
  ts?: number | string;
  extraKey?: Record<string, unknown>;
  messageType?: string;
}

/** `message` é o conteúdo do Baileys, ex.: { conversation: "oi" }. */
export function upsert(message: Record<string, unknown>, o: UpsertOpts = {}): Record<string, unknown> {
  return {
    event: "messages.upsert",
    instance: "inst",
    data: {
      key: { remoteJid: o.jid ?? `${PHONE}@s.whatsapp.net`, fromMe: o.fromMe ?? false, id: o.id ?? "3EB0TEXT1", ...(o.extraKey ?? {}) },
      pushName: "Fulano",
      message,
      ...(o.messageType ? { messageType: o.messageType } : {}),
      messageTimestamp: o.ts ?? 1762500000,
    },
    destination: "https://worker.test/webhook",
    apikey: "NAO-DEVE-VAZAR",
  };
}

export const text = (body: string, o: UpsertOpts = {}) => upsert({ conversation: body }, o);
export const json = (p: unknown): string => JSON.stringify(p);
export const auth = (token: string | null = TOKEN): Record<string, string> => (token === null ? {} : { "x-webhook-token": token });
