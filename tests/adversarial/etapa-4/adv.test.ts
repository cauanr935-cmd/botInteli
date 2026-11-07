import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { handleIncomingMessage } from "../../../src/conversation/engine";
import { sendGuarded } from "../../../src/whatsapp/client";
import { processEvents } from "../../../src/webhook/handler";
import type { IncomingMessage, WebhookEvent } from "../../../src/whatsapp/types";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
let n = 0;
const logs: string[] = [];
const logger = { log: (l: string, m: string, c?: unknown) => { logs.push(JSON.stringify([l, m, c])); } };
const t = (body: string, wamid?: string): IncomingMessage => ({ type: "text", wamid: wamid ?? `a${++n}`, from: WA, body });
const btn = (id: string): IncomingMessage => ({ type: "button_reply", wamid: `a${++n}`, from: WA, id, title: "x" });
const nfm = (o: Record<string, unknown>, wamid?: string): IncomingMessage => ({
  type: "nfm_reply", wamid: wamid ?? `a${++n}`, from: WA, responseJson: JSON.stringify(o),
});
const good = { full_name: "Maria da Silva", email: "m@e.com", city: "Recife", consent: true };
function setup(flowId?: string, max10 = 4, maxDay = 12) {
  const repo = new MemoryRepo();
  const graph = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `o${++n}` }] }), { status: 200 }));
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, { repo, logger, phoneNumberId: "PN", whatsappToken: "t", graphApiVersion: "v21.0", stopAt: 950,
      timezone: "America/Sao_Paulo", fetchImpl: graph as unknown as typeof fetch, now: () => NOW });
  const deps = { repo, logger, send, maxPerDay: maxDay, maxPer10Min: max10, now: () => NOW,
    registration: { ...(flowId ? { flowId } : {}), privacyUrl: "https://ex.com/p", termsVersion: "v1" } };
  const feed = (ev: IncomingMessage) => processEvents([ev], { appSecret: "", verifyToken: "", repo, logger, now: () => NOW,
    onEvent: async (e: WebhookEvent) => { if (e.type !== "status") await handleIncomingMessage(e, deps); } });
  return { graph, feed, repo };
}
const empty = { consentAt: null, termsVersion: null, registeredAt: null, values: {} };

describe("adv etapa 4", () => {
  it("nfm_reply válido sem 'oi' antes (estado NEW) não salva nada nem envia", async () => {
    const s = setup("F");
    await s.feed(nfm(good));
    expect(await s.repo.getRegistration(WA)).toEqual(empty);
    expect(s.graph).not.toHaveBeenCalled();
  });
  it("nfm_reply duplicado (mesmo wamid): 1 confirmação só", async () => {
    const s = setup("F");
    await s.feed(t("oi"));
    await Promise.all([s.feed(nfm(good, "dup")), s.feed(nfm(good, "dup")), s.feed(nfm(good, "dup"))]);
    expect(s.graph).toHaveBeenCalledTimes(2);
  });
  it("nfm_reply com wamids distintos em paralelo: no máximo 2 envios no total", async () => {
    const s = setup("F");
    await s.feed(t("oi"));
    await Promise.all(Array.from({ length: 6 }, () => s.feed(nfm(good))));
    expect(s.graph).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["consent string 'false'", { ...good, consent: "false" }],
    ["consent 1", { ...good, consent: 1 }],
    ["consent 'on'", { ...good, consent: "on" }],
    ["nome com 101 chars", { ...good, full_name: "a".repeat(101) }],
    ["nome numérico no campo", { ...good, full_name: 12345 }],
    ["email com espaço", { ...good, email: "a b@c.com" }],
    ["nome só 'oi'", { ...good, full_name: "oi" }],
    ["cidade 81", { ...good, city: "c".repeat(81) }],
  ])("Flow inválido (%s): nada salvo", async (_n, form) => {
    const s = setup("F");
    await s.feed(t("oi"));
    await s.feed(nfm(form as Record<string, unknown>));
    expect(await s.repo.getRegistration(WA)).toEqual(empty);
  });
  it("fallback: valores digitados antes do aceite nunca são salvos, mesmo depois (não retroativo)", async () => {
    const s = setup();
    await s.feed(t("oi"));
    await s.feed(t("Maria da Silva"));
    await s.feed(t("m@e.com"));
    await s.feed(btn("consent_yes"));
    const r = await s.repo.getRegistration(WA);
    expect(r.values).toEqual({});
    expect(r.consentAt).toEqual(NOW);
  });
  it("fallback com limites padrão (4/10min): fluxo feliz completa", async () => {
    const s = setup();
    for (const x of [t("oi"), btn("consent_yes"), t("Maria da Silva"), t("m@e.com"), t("Recife")]) await s.feed(x);
    expect(s.graph).toHaveBeenCalledTimes(4);
    expect((await s.repo.getRegistration(WA)).registeredAt).toEqual(NOW);
  });
  it("fallback com 1 dica no meio e limites padrão: nunca excede 4 envios e não grava registro incompleto como completo", async () => {
    const s = setup();
    for (const x of [t("oi"), btn("consent_yes"), t("Maria da Silva"), t("lixo"), t("m@e.com"), t("Recife")]) await s.feed(x);
    expect(s.graph.mock.calls.length).toBeLessThanOrEqual(4);
    const r = await s.repo.getRegistration(WA);
    if (r.registeredAt) expect(r.values.city).toBe("Recife");
  });
  it("sair no meio do cadastro: silêncio total depois e nada novo salvo", async () => {
    const s = setup();
    await s.feed(t("oi")); await s.feed(btn("consent_yes")); await s.feed(t("sair"));
    const c = s.graph.mock.calls.length;
    await s.feed(t("Maria da Silva")); await s.feed(t("m@e.com"));
    expect(s.graph.mock.calls.length).toBe(c);
    expect((await s.repo.getRegistration(WA)).values).toEqual({});
  });
  it("logs não contêm telefone completo, e-mail nem nome", async () => {
    const s = setup("F");
    await s.feed(t("oi")); await s.feed(nfm(good));
    const all = logs.join("\n");
    expect(all).not.toContain(WA);
    expect(all).not.toContain("m@e.com");
    expect(all).not.toContain("Maria da Silva");
  });
  it("falha ao gravar cadastro: não envia confirmação", async () => {
    const s = setup("F");
    await s.feed(t("oi"));
    vi.spyOn(s.repo, "saveRegistration").mockRejectedValue(new Error("db down"));
    const c = s.graph.mock.calls.length;
    await s.feed(nfm(good)).catch(() => undefined);
    expect(s.graph.mock.calls.length).toBe(c);
  });
});
