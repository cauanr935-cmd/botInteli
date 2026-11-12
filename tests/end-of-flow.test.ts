import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { handleIncomingMessage } from "../src/conversation/engine";
import { hashWaId } from "../src/lib/hash";
import type { Logger } from "../src/lib/logger";
import { sendGuarded } from "../src/whatsapp/client";
import type { IncomingMessage } from "../src/whatsapp/types";
import { SENSITIVE_MESSAGES } from "../src/axo/sensitive";
import { isCourtesy } from "../src/profile/decide";

const NOW = new Date("2026-11-11T15:00:00Z");
const WA = "5511987651234";
const logs: string[] = [];
const logger: Logger = { log: (_l, e, f) => { logs.push(`${e} ${JSON.stringify(f ?? {})}`); } };

type Sent = { text?: { body: string }; interactive?: { body?: { text: string }; action?: { buttons: unknown[] } } };
let seq = 0;
const text = (body: string): IncomingMessage => ({ type: "text", wamid: `w${++seq}`, from: WA, body });

async function setup(state: string, extra: { optedOutAt?: Date } = {}) {
  const repo = new MemoryRepo();
  await repo.touchUser(WA, NOW);
  await repo.saveRegistration(WA, { waIdHash: await hashWaId(WA), consentAt: NOW, termsVersion: "t" });
  await repo.saveConversation(WA, 0, { state, previousState: null, hintSentInState: false, optedOutAt: extra.optedOutAt ?? null });
  const graph = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `o${++seq}` }] }), { status: 200 }));
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, {
      repo, logger, phoneNumberId: "PN", whatsappToken: "t", graphApiVersion: "v21.0", stopAt: 950,
      timezone: "America/Sao_Paulo", fetchImpl: graph as unknown as typeof fetch, now: () => NOW,
    });
  const deps = { repo, logger, send, maxPerDay: 40, maxPer10Min: 15, now: () => NOW };
  const say = (body: string) => handleIncomingMessage(text(body), deps);
  const sent = () => graph.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string) as Sent);
  const bodyOf = (m: Sent): string => m.text?.body ?? m.interactive?.body?.text ?? "";
  return { repo, say, sent, bodyOf };
}

describe("fim do fluxo: o bot volta a falar de mentoria", () => {
  it("'oi' depois de concluir: cumprimenta e oferece as opções", async () => {
    const t = await setup("COMPLETED");
    await t.say("oi");
    const out = t.sent();
    expect(out).toHaveLength(1);
    expect(t.bodyOf(out[0]!)).toMatch(/^Olá! Que bom te ver de novo\./);
    expect(out[0]!.interactive?.action?.buttons).toHaveLength(3);
    expect((await t.repo.getConversation(WA)).state).toBe("RETURNING_CHOICE");
  });

  it("'me ajuda em cálculo' direciona para registrar a mentoria (dúvida + horários)", async () => {
    const t = await setup("COMPLETED");
    await t.say("me ajuda em cálculo");
    expect(t.sent()).toHaveLength(1);
    expect(t.bodyOf(t.sent()[0]!)).toMatch(/Dúvida registrada/);
    expect((await t.repo.getConversation(WA)).state).toMatch(/^SCHED_/);
    expect(t.repo.doubts).toHaveLength(1);
    expect(t.repo.doubts[0]!.text).toMatch(/cálculo/);
    expect(t.repo.doubts[0]!.categories).toEqual(["matematica"]);
  });

  it("o mesmo pedido funciona em RETURNING_CHOICE", async () => {
    const t = await setup("RETURNING_CHOICE");
    await t.say("preciso de ajuda com programação em python");
    expect(t.bodyOf(t.sent()[0]!)).toMatch(/Dúvida registrada/);
  });

  it("texto que o bot não entende: volta ao assunto uma vez, depois silêncio", async () => {
    const t = await setup("COMPLETED");
    await t.say("gosto de pizza de calabresa");
    expect(t.sent()).toHaveLength(1);
    expect(t.bodyOf(t.sent()[0]!)).toMatch(/cuido das mentorias/);
    await t.say("pizza é bom demais");
    await t.say("sei lá mano");
    expect(t.sent()).toHaveLength(3); // nudge + dica de RETURNING_CHOICE + aviso descontraído
  });

  it("agradecimento e despedida: silêncio (não gasta mensagem)", async () => {
    const t = await setup("COMPLETED");
    for (const m of ["obrigado!", "valeu", "tchau", "beleza", "muito obrigada"]) await t.say(m);
    expect(t.sent()).toHaveLength(0);
    expect(isCourtesy("me ajuda em cálculo")).toBe(false);
  });

  it("quem pediu para sair continua sem receber nada", async () => {
    const t = await setup("OPTED_OUT");
    await t.say("me ajuda em cálculo");
    expect(t.sent()).toHaveLength(0);
  });
});

describe("temas sensíveis no engine", () => {
  it("manda a mensagem fixa do CVV, antes de qualquer fluxo, sem mudar o estado", async () => {
    const t = await setup("DOUBT_TEXT");
    await t.say("não quero mais viver");
    expect(t.sent()).toHaveLength(1);
    expect(t.bodyOf(t.sent()[0]!)).toBe(SENSITIVE_MESSAGES.A);
    expect((await t.repo.getConversation(WA)).state).toBe("DOUBT_TEXT");
    expect(t.repo.doubts).toHaveLength(0);
  });

  it("grava só o evento, nunca o texto, nem no log", async () => {
    logs.length = 0;
    const t = await setup("COMPLETED");
    await t.say("tô com depressão");
    const h = await hashWaId(WA);
    expect(t.repo.sensitiveEvents).toEqual([{ waIdHash: h, level: "B", channel: "whatsapp", at: NOW }]);
    expect(JSON.stringify(t.repo.sensitiveEvents)).not.toMatch(/depress/);
    expect(logs.join("\n")).not.toMatch(/depress/i);
    expect(logs.join("\n")).toMatch(/sensitive_topic/);
  });

  it("modo cuidado: nas 24 h seguintes cada resposta fecha com o CVV", async () => {
    const t = await setup("COMPLETED");
    await t.say("quero morrer");
    await t.say("oi");
    const out = t.sent();
    expect(out).toHaveLength(2);
    expect(t.bodyOf(out[1]!)).toMatch(/CVV: 188, 24h$/);
  });

  it("quem pediu opt-out não recebe nem a mensagem sensível", async () => {
    const t = await setup("OPTED_OUT", { optedOutAt: NOW });
    await t.say("quero morrer");
    expect(t.sent()).toHaveLength(0);
  });

  it("'não aguento esse bug' NÃO dispara o protocolo", async () => {
    const t = await setup("COMPLETED");
    await t.say("não aguento mais esse bug");
    expect(t.sent().every((m) => !/188/.test(t.bodyOf(m)))).toBe(true);
  });
});

describe("voz do Axo: desabafo", () => {
  it("'nossa agora ta bem puxado' pedindo horário: acolhe e pede só o horário (sem tom de erro)", async () => {
    const t = await setup("SCHED_DAYS_doubt");
    await t.say("nossa agora ta bem puxado");
    const b = t.bodyOf(t.sent()[0]!);
    expect(b).toMatch(/puxado mesmo/);
    expect(b).not.toMatch(/Não consegui/);
  });
  it("no fim do fluxo, desabafo é acolhido antes das opções", async () => {
    const t = await setup("COMPLETED");
    await t.say("tô exausto, muita coisa pra entregar");
    expect(t.sent()).toHaveLength(1);
    expect(t.bodyOf(t.sent()[0]!)).toMatch(/veterano/);
  });
});

describe("pergunta sobre o bot no meio da dúvida não vira dúvida", () => {
  it("'posso anexar?' é respondida e a pergunta da etapa volta; nada é gravado como dúvida", async () => {
    const t = await setup("DOUBT_TEXT");
    await t.say("o que devo falar pra voce entender minha duvida, tenho um documento, posso anexar?");
    expect(t.sent()).toHaveLength(1);
    expect(t.bodyOf(t.sent()[0]!)).toMatch(/Anexa o documento/);
    expect(t.repo.doubts).toHaveLength(0);
    expect((await t.repo.getConversation(WA)).state).toBe("DOUBT_TEXT");
  });
  it("dúvida de conteúdo continua sendo registrada", async () => {
    const t = await setup("DOUBT_TEXT");
    await t.say("como funciona um rotacional em cálculo 3? não entendi o teorema de Stokes");
    expect(t.repo.doubts).toHaveLength(1);
  });
});
