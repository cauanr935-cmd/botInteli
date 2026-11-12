// Adaptador de teste: os testes do MOTOR (conversa, cadastro, áudio...) olham a mensagem no formato interno
// (`type`, `text.body`, `interactive`). Este transporte entrega a mensagem a um mock de fetch nesse formato, sem tocar
// a Evolution. O que a Evolution recebe de verdade (endpoint, corpo, texto numerado) é coberto em client.test.ts.
import type { OutboundMessage, SendContext } from "../../src/whatsapp/client";

export function asTransport(mock: (url: string, init: RequestInit) => Promise<Response>): NonNullable<SendContext["transport"]> {
  return async (message: OutboundMessage) => {
    const { to, ...rest } = message;
    const res = await mock("https://engine-test.local/send", {
      method: "POST",
      body: JSON.stringify({ to, ...rest }),
    });
    if (!res.ok) return { ok: false, code: `http_${res.status}`, httpStatus: res.status };
    const j = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
    return { ok: true, messageId: j?.messages?.[0]?.id ?? null, pending: null };
  };
}
