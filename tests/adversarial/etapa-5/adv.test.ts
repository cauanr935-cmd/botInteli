import { describe, it, expect } from "vitest";
import { decide, type Counters, type UserState } from "../../../src/conversation/machine";
import { buildButtons, buildList, MessageLimitError } from "../../../src/whatsapp/builders";
import { makeContent, prepareServices, type Service } from "../../../src/services/content";
import { ContentProvider } from "../../../src/services/provider";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
const open: Counters = { sentLast10Min: 0, sentLastDay: 0, maxPer10Min: 4, maxPerDay: 12, lastBotMsgAt: NOW };
const menu: UserState = { state: "MENU", previousState: null, hintSentInState: false, optedOutAt: null };
const pick = (id: string, n: number) => ({ type: "list_reply" as const, wamid: `w${n}`, from: WA, id, title: "x" });
const svcs: Service[] = [{ id: "horarios", title: "H", description: "d", requiresAudio: false, sortOrder: 1 }];

describe("adversarial etapa 5", () => {
  it("R2/C5.3: escolha repetida de serviço sem áudio NÃO deve responder de novo", () => {
    const content = makeContent(svcs, {});
    const d1 = decide(menu, pick("svc_horarios", 1), open, NOW, content);
    expect(d1.replies).toHaveLength(1);
    const d2 = decide(d1.nextState, pick("svc_horarios", 2), open, NOW, content);
    expect(d2.replies).toHaveLength(0);
  });
  it("ataque de 4 toques repetidos gasta no máximo 1 mensagem", () => {
    const content = makeContent(svcs, {});
    let u = menu; let n = 0;
    for (let i = 0; i < 4; i++) { const d = decide(u, pick("svc_horarios", i), open, NOW, content); n += d.replies.length; u = d.nextState; }
    expect(n).toBe(1);
  });
  it("construtores: limites exatos e +1", () => {
    expect(() => buildButtons("b", [1, 2, 3, 4].map((i) => ({ id: `${i}`, title: "t" })))).toThrow(MessageLimitError);
    expect(() => buildButtons("b", [{ id: "1", title: "x".repeat(21) }])).toThrow(MessageLimitError);
    expect(() => buildList("b", "ok", "s", Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, title: "t" })))).toThrow(MessageLimitError);
    expect(() => buildList("b", "ok", "s", [{ id: "1", title: "t", description: "x".repeat(73) }])).toThrow(MessageLimitError);
  });
  it("prepareServices: sort_order, empate estável e corte em 10 com warn", () => {
    const logs: string[] = [];
    const rows = Array.from({ length: 15 }, (_, i) => ({ id: `s${i}`, title: "t", description: "", requiresAudio: false, sortOrder: 15 - i }));
    const out = prepareServices(rows, { log: (_l, e) => void logs.push(e) });
    expect(out.map((s) => s.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(logs).toContain("menu_truncated");
  });
  it("cache: banco falhando não derruba e não consulta a cada mensagem", async () => {
    let calls = 0;
    const src = { listActiveServices: async () => { calls++; throw new Error("down"); }, listCannedResponses: async () => ({}) };
    const p = new ContentProvider(src, { log: () => {} }, 60_000, () => 1000);
    const c = await p.load(); await p.load(); await p.load();
    expect(c.services.length).toBeGreaterThan(0);
    expect(calls).toBe(1);
  });
  it("canned_responses com chave __proto__/toString não quebra", () => {
    const c = makeContent(svcs, {});
    expect(c.text("toString", "fb")).toBe("fb");
    expect(c.text("__proto__", "fb")).toBe("fb");
  });
});
