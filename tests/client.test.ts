import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { sendGuarded, type OutboundMessage, type SendContext } from "../src/whatsapp/client";
import type { Logger, LogLevel } from "../src/lib/logger";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";

function setup(opts: { stopAt?: number; lastMinutesAgo?: number | null; graphOk?: boolean } = {}) {
  const repo = new MemoryRepo();
  const logs: { level: LogLevel; event: string; fields?: Record<string, unknown> }[] = [];
  const logger: Logger = { log: (level, event, fields) => { logs.push({ level, event, fields }); } };
  const graph = vi.fn(async () =>
    opts.graphOk === false
      ? new Response("{}", { status: 500 })
      : new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 }),
  );
  const ctx: SendContext = {
    repo, logger, phoneNumberId: "PNID", whatsappToken: "tok", graphApiVersion: "v21.0",
    stopAt: opts.stopAt ?? 950, timezone: "America/Sao_Paulo",
    fetchImpl: graph as unknown as typeof fetch, now: () => NOW,
  };
  if (opts.lastMinutesAgo !== null) repo.users.set(WA, new Date(NOW.getTime() - (opts.lastMinutesAgo ?? 5) * 60_000));
  return { repo, logs, graph, ctx };
}
const text = (): OutboundMessage => ({ to: WA, type: "text", text: { body: "oi" } });
const budgetOf = (repo: MemoryRepo) => [...repo.budgets.values()][0];

describe("sendGuarded", () => {
  it("envio feliz: reserva, chama a Graph e grava outbound_log", async () => {
    const { repo, graph, ctx } = setup();
    const r = await sendGuarded(text(), ctx);
    expect(r).toEqual({ status: "sent", wamid: "wamid.OUT" });
    expect(graph).toHaveBeenCalledTimes(1);
    const [url, init] = graph.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/PNID/messages");
    expect(JSON.parse(init.body as string)).toMatchObject({ messaging_product: "whatsapp", to: WA, type: "text" });
    expect(budgetOf(repo)!.reservedCount).toBe(1);
    expect(repo.outbound).toHaveLength(1);
    expect(repo.outbound[0]).toMatchObject({ sentOk: true, wamid: "wamid.OUT" });
    expect(repo.outbound[0]!.waIdHash).not.toContain(WA);
  });

  it("C2.2 stop_at=950: 950 envios passam; do 951º em diante a Graph recebe zero chamadas", async () => {
    const { repo, graph, ctx } = setup();
    repo.budgets.set("PNID|2026-11", {
      phoneNumberId: "PNID", monthKey: "2026-11", reservedCount: 949, stopAt: 950,
      tripped: false, tripReason: null, trippedAt: null, warned: true, tripLogged: false,
    });
    expect((await sendGuarded(text(), ctx)).status).toBe("sent"); // 950ª
    expect(graph).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) expect((await sendGuarded(text(), ctx)).status).toBe("blocked_budget");
    expect(graph).toHaveBeenCalledTimes(1);
  });

  it("C2.3 concorrência (memória): contador em 940, 100 envios simultâneos aprovam exatamente 10", async () => {
    const { repo, graph, ctx } = setup();
    repo.budgets.set("PNID|2026-11", {
      phoneNumberId: "PNID", monthKey: "2026-11", reservedCount: 940, stopAt: 950,
      tripped: false, tripReason: null, trippedAt: null, warned: true, tripLogged: false,
    });
    const rs = await Promise.all(Array.from({ length: 100 }, () => sendGuarded(text(), ctx)));
    expect(rs.filter((r) => r.status === "sent")).toHaveLength(10);
    expect(graph).toHaveBeenCalledTimes(10);
  });

  it("C2.4 mês novo libera envios (31/out 23:59 cheio, 01/nov 00:00 livre)", async () => {
    const { repo, graph, ctx } = setup();
    repo.budgets.set("PNID|2026-10", {
      phoneNumberId: "PNID", monthKey: "2026-10", reservedCount: 950, stopAt: 950,
      tripped: true, tripReason: "x", trippedAt: new Date(), warned: true, tripLogged: true,
    });
    const at = (iso: string): SendContext => ({ ...ctx, now: () => new Date(iso) });
    repo.users.set(WA, new Date("2026-11-01T02:50:00Z"));
    expect((await sendGuarded(text(), at("2026-11-01T02:59:00Z"))).status).toBe("blocked_budget");
    expect(graph).toHaveBeenCalledTimes(0);
    expect((await sendGuarded(text(), at("2026-11-01T03:00:00Z"))).status).toBe("sent");
  });

  it("C2.4 trava manual continua ligada na virada do mês", async () => {
    const { repo, graph, ctx } = setup();
    await repo.setManualLock("PNID", "teste");
    repo.users.set(WA, new Date("2026-11-01T02:50:00Z"));
    const r = await sendGuarded(text(), { ...ctx, now: () => new Date("2026-11-01T03:00:00Z") });
    expect(r.status).toBe("blocked_manual_lock");
    expect(graph).not.toHaveBeenCalled();
  });

  it("C2.6 template é sempre recusado, sem reservar vaga", async () => {
    const { repo, graph, ctx } = setup();
    for (const t of ["template", "TEMPLATE", " Template "]) {
      const r = await sendGuarded({ to: WA, type: t, template: { name: "x" } }, ctx);
      expect(r.status).toBe("blocked_template");
    }
    expect((await sendGuarded({ to: WA, type: "text", template: { name: "x" } }, ctx)).status).toBe("blocked_template");
    expect(repo.budgets.size).toBe(0);
    expect(graph).not.toHaveBeenCalled();
  });

  it("C2.7 última mensagem há 23h31: não envia e não reserva; há 23h29 envia", async () => {
    const a = setup({ lastMinutesAgo: 23 * 60 + 31 });
    expect((await sendGuarded(text(), a.ctx)).status).toBe("blocked_window");
    expect(a.repo.budgets.size).toBe(0);
    expect(a.graph).not.toHaveBeenCalled();
    const b = setup({ lastMinutesAgo: 23 * 60 + 29 });
    expect((await sendGuarded(text(), b.ctx)).status).toBe("sent");
  });

  it("C2.7 usuário sem registro de mensagem: não envia nem reserva", async () => {
    const a = setup({ lastMinutesAgo: null });
    expect((await sendGuarded(text(), a.ctx)).status).toBe("blocked_window");
    expect(a.repo.budgets.size).toBe(0);
  });

  it("C2.8 erro na reserva: não envia (fail closed) e não lança", async () => {
    const { repo, graph, ctx } = setup();
    repo.reserveSlot = async () => { throw new Error("db fora"); };
    const r = await sendGuarded(text(), ctx);
    expect(r.status).toBe("error");
    expect(graph).not.toHaveBeenCalled();
  });

  it("C2.8 banco indisponível em qualquer consulta: não envia", async () => {
    for (const m of ["getLastUserMessageAt", "getManualLock"] as const) {
      const { repo, graph, ctx } = setup();
      (repo as unknown as Record<string, unknown>)[m] = async () => { throw new Error("db fora"); };
      expect((await sendGuarded(text(), ctx)).status).toBe("error");
      expect(graph).not.toHaveBeenCalled();
    }
  });

  it("C2.9 envio que falha (HTTP 500) NÃO devolve a vaga", async () => {
    const { repo, ctx } = setup({ graphOk: false });
    const r = await sendGuarded(text(), ctx);
    expect(r.status).toBe("error");
    expect(budgetOf(repo)!.reservedCount).toBe(1);
    expect(repo.outbound[0]).toMatchObject({ sentOk: false, errorCode: "http_500" });
  });

  it("C2.9 falha de rede também não devolve a vaga e não lança", async () => {
    const { repo, ctx } = setup();
    ctx.fetchImpl = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect((await sendGuarded(text(), ctx)).status).toBe("error");
    expect(budgetOf(repo)!.reservedCount).toBe(1);
  });

  it("C2.12 warn em 80% uma única vez; critical ao abrir o disjuntor uma única vez", async () => {
    const { repo, logs, ctx } = setup({ stopAt: 100 });
    for (let i = 0; i < 130; i++) await sendGuarded(text(), ctx);
    expect(budgetOf(repo)!.reservedCount).toBe(100);
    expect(logs.filter((l) => l.level === "warn" && l.event === "budget_80_percent")).toHaveLength(1);
    expect(logs.filter((l) => l.level === "critical")).toHaveLength(1);
    const warnIdx = logs.findIndex((l) => l.level === "warn");
    const critIdx = logs.findIndex((l) => l.level === "critical");
    expect(warnIdx).toBeLessThan(critIdx);
    expect(JSON.stringify(logs)).not.toContain(WA);
  });
});
