import { describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { sendGuarded, type SendContext } from "../../../src/whatsapp/client";
import { handleStatusEvent } from "../../../src/budget/status";
import { route, type AppDeps } from "../../../src/index";
import { signBody } from "../../../src/whatsapp/signature";
import { monthKey } from "../../../src/budget/month";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
const logger = { log: () => undefined };
function mk(lastMs = 60_000) {
  const repo = new MemoryRepo();
  repo.users.set(WA, new Date(NOW.getTime() - lastMs));
  const graph = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 }));
  const ctx: SendContext = { repo, logger, phoneNumberId: "PN", whatsappToken: "t", graphApiVersion: "v21.0",
    stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW, fetchImpl: graph as unknown as typeof fetch };
  return { repo, graph, ctx };
}
const msg = { to: WA, type: "text", text: { body: "x" } };

describe("adversarial etapa 2", () => {
  it("janela: exatamente 23h30 envia, 23h30 + 1ms bloqueia", async () => {
    const a = mk(23.5 * 3600_000);
    expect((await sendGuarded(msg, a.ctx)).status).toBe("sent");
    const b = mk(23.5 * 3600_000 + 1);
    expect((await sendGuarded(msg, b.ctx)).status).toBe("blocked_window");
    expect(b.repo.budgets.size).toBe(0);
  });

  it("lock ligado: 100 envios simultâneos => zero chamadas à Graph e zero vagas", async () => {
    const { repo, graph, ctx } = mk();
    await repo.setManualLock("PN", "x");
    await Promise.all(Array.from({ length: 100 }, () => sendGuarded(msg, ctx)));
    expect(graph).not.toHaveBeenCalled();
    expect([...repo.budgets.values()].every((b) => b.reservedCount === 0)).toBe(true);
  });

  it("status sem category/type (pricing parcial) liga a trava", async () => {
    const { repo } = mk();
    await handleStatusEvent({ type: "status", id: "w1", status: "sent", pricing: { billable: false } } as never,
      { repo, logger, phoneNumberId: "PN" });
    expect((await repo.getManualLock("PN")).locked).toBe(true);
  });

  it("status com assinatura inválida não liga a trava e retorna 401", async () => {
    const repo = new MemoryRepo();
    const deps: AppDeps = { appSecret: "s", verifyToken: "v", repo, logger,
      onEvent: async (ev) => { if (ev.type === "status") await handleStatusEvent(ev, { repo, logger, phoneNumberId: "PN" }); } };
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "a", status: "sent", recipient_id: WA, pricing: { billable: true, type: "regular", category: "marketing" } }] } }] }] });
    const r = await route(new Request("https://x/webhook", { method: "POST", body, headers: { "X-Hub-Signature-256": await signBody(body + " ", "s") } }),
      { waitUntil: () => undefined }, deps);
    expect(r.status).toBe(401);
    expect((await repo.getManualLock("PN")).locked).toBe(false);
  });

  it("admin: unlock via GET não destrava; 'bearer' minúsculo é 401", async () => {
    const repo = new MemoryRepo();
    await repo.setManualLock("PN", "x");
    const deps: AppDeps = { appSecret: "s", verifyToken: "v", repo, logger,
      admin: { adminToken: "tok", repo, logger, phoneNumberId: "PN", stopAt: 950, timezone: "America/Sao_Paulo" } };
    const c = { waitUntil: () => undefined };
    const g = await route(new Request("https://x/admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO", { headers: { Authorization: "Bearer tok" } }), c, deps);
    expect(g.status).toBe(404);
    expect((await route(new Request("https://x/admin/budget", { headers: { Authorization: "bearer tok" } }), c, deps)).status).toBe(401);
    expect((await repo.getManualLock("PN")).locked).toBe(true);
  });

  it("SQL: stop_at menor depois reduz o corte; maior não aumenta; lock bloqueia 100 simultâneas", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(join(__dirname, "../../../supabase/migrations/0002_budget.sql"), "utf8"));
    const r = async (s: number) => (await db.query<{ ok: boolean }>("select reserve_outbound_slot('P','2026-11',$1) ok", [s])).rows[0]!.ok;
    for (let i = 0; i < 10; i++) await r(10);
    expect(await r(990)).toBe(false); // linha criada com cap 10, não sobe
    await db.query("select set_manual_lock('P','x')");
    const res = await Promise.all(Array.from({ length: 100 }, () => r(990)));
    expect(res.some(Boolean)).toBe(false);
    await expect(db.query("select reserve_outbound_slot('P','2026-12',0)")).rejects.toThrow();
  });

  it("month_key: ano novo e fuso", () => {
    expect(monthKey(new Date("2027-01-01T02:59:59Z"), "America/Sao_Paulo")).toBe("2026-12");
    expect(monthKey(new Date("2027-01-01T03:00:00Z"), "America/Sao_Paulo")).toBe("2027-01");
  });
});
