import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { handleIncomingMessage } from "../../../src/conversation/engine";
import { decide, type Counters, type UserState } from "../../../src/conversation/machine";
import { intentsOf } from "../../../src/conversation/synonyms";
import { sendGuarded } from "../../../src/whatsapp/client";
import { processEvents } from "../../../src/webhook/handler";
import type { IncomingMessage, WebhookEvent } from "../../../src/whatsapp/types";
import { asTransport } from "../../helpers/transport";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
let n = 0;
const t = (body: string): IncomingMessage => ({ type: "text", wamid: `a${++n}`, from: WA, body });
const logger = { log: () => undefined };
function setup(max10 = 4, maxDay = 12) {
  const repo = new MemoryRepo();
  const graph = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `o${++n}` }] }), { status: 200 }));
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, { repo, logger, phoneNumberId: "PN", evolutionUrl: "https://evo.test", evolutionApiKey: "k", evolutionInstance: "inst", stopAt: 950,
      timezone: "America/Sao_Paulo", transport: asTransport(graph as never), now: () => NOW });
  const deps = { repo, logger, send, maxPerDay: maxDay, maxPer10Min: max10, now: () => NOW };
  const feed = (ev: IncomingMessage) => processEvents([ev], { webhookToken: "", repo, logger, now: () => NOW,
    onEvent: async (e: WebhookEvent) => { await handleIncomingMessage(e, deps); } });
  return { graph, feed, repo };
}
const fresh = (state: UserState["state"]): UserState => ({ state, previousState: null, hintSentInState: false, optedOutAt: null });
const open: Counters = { sentLast10Min: 0, sentLastDay: 0, maxPer10Min: 4, maxPerDay: 12 };

describe("adv etapa 3", () => {
  it("variações de saudação em rajada paralela: 1 envio", async () => {
    const s = setup();
    await Promise.all(["Oi", "OIII", "Olá!!", "bom dia", "👍", "e aí", "OPA"].map((x) => s.feed(t(x))));
    expect(s.graph.mock.calls.length).toBeLessThanOrEqual(2);
    expect(s.graph.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
  it("rajada paralela de 30 'oi' com wamids distintos: exatamente 1 envio", async () => {
    const s = setup();
    await Promise.all(Array.from({ length: 30 }, () => s.feed(t("oi"))));
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
  it("lixo paralelo de 30 mensagens: exatamente 1 dica", async () => {
    const s = setup();
    await Promise.all(Array.from({ length: 30 }, (_, i) => s.feed(t(`xyz${i}`))));
    expect(s.graph).toHaveBeenCalledTimes(2); // dica + um único aviso (a rajada não multiplica os avisos)
  });
  it("sair/voltar em loop nunca passa de 4 envios em 10 min", async () => {
    const s = setup();
    for (let i = 0; i < 15; i++) { await s.feed(t("sair")); await s.feed(t("voltar")); }
    expect(s.graph.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it("sair com limite estourado: fica OPTED_OUT e não volta com 'oi'", async () => {
    const s = setup(1, 12);
    await s.feed(t("oi")); // 1 envio, limite 10min atingido
    await s.feed(t("sair"));
    expect((await s.repo.getConversation(WA)).state).toBe("OPTED_OUT");
    await s.feed(t("oi"));
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
  it("botões/listas/figurinha em NEW e MENU => silêncio", () => {
    for (const st of ["NEW", "MENU", "AWAIT_REGISTRATION"] as const) {
      for (const m of [
        { type: "button_reply", wamid: "x", from: WA, id: "foo", title: "x" },
        { type: "list_reply", wamid: "x", from: WA, id: "foo", title: "x" },
        { type: "unsupported", wamid: "x", from: WA, rawType: "sticker" },
      ] as unknown as IncomingMessage[]) {
        expect(decide(fresh(st), m, open, NOW).replies).toHaveLength(0);
      }
    }
  });
  it("entradas esquisitas não explodem e não são saudação", () => {
    for (const x of ["", "   ", "\u0000", "oi".repeat(5000), "o i", "oi?? tudo bem", "ola mundo cruel", "🎉"]) {
      expect(() => intentsOf(x)).not.toThrow();
    }
    expect(intentsOf("oi tudo bem").has("greeting")).toBe(false);
    expect(intentsOf("sair").has("greeting")).toBe(false);
  });
  it("body vazio/undefined em texto: sem exceção no decide", () => {
    const m = { type: "text", wamid: "x", from: WA, body: undefined } as unknown as IncomingMessage;
    expect(() => decide(fresh("NEW"), m, open, NOW)).not.toThrow();
  });
  it("limite diário exato: 11 enviados responde, 12 silencia", () => {
    expect(decide(fresh("NEW"), t("oi"), { ...open, sentLastDay: 11 }, NOW).replies).toHaveLength(1);
    expect(decide(fresh("NEW"), t("oi"), { ...open, sentLastDay: 12 }, NOW).replies).toHaveLength(0);
  });
});
