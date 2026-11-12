import { describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { sendGuarded, type SendContext } from "../../../src/whatsapp/client";
import { route, type AppDeps } from "../../../src/index";
import { text as upsertText, json as toJson } from "../../helpers/evolution";
import { dayKey, monthKey } from "../../../src/budget/month";
import { asTransport } from "../../helpers/transport";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
const logger = { log: () => undefined };
function mk(lastMs = 60_000) {
  const repo = new MemoryRepo();
  repo.users.set(WA, new Date(NOW.getTime() - lastMs));
  const graph = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 }));
  const ctx: SendContext = { repo, logger, phoneNumberId: "PN", evolutionUrl: "https://evo.test", evolutionApiKey: "k", evolutionInstance: "inst",
    stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW, transport: asTransport(graph as never) };
  return { repo, graph, ctx };
}
const msg = { to: WA, type: "text", text: { body: "x" } };

describe("adversarial etapa 2", () => {
  it("sem janela de 24h: quem escreveu há 30 dias recebe; quem nunca escreveu não (anti-ban), sem gastar vaga", async () => {
    const a = mk(30 * 24 * 3600_000);
    expect((await sendGuarded(msg, a.ctx)).status).toBe("sent");
    const b = mk();
    b.repo.users.clear();
    expect((await sendGuarded(msg, b.ctx)).status).toBe("blocked_unknown_contact");
    expect(b.repo.budgets.size).toBe(0);
    expect(b.graph).not.toHaveBeenCalled();
  });

  it("lock ligado: 100 envios simultâneos => zero chamadas à Evolution e zero vagas", async () => {
    const { repo, graph, ctx } = mk();
    await repo.setManualLock("PN", "x");
    await Promise.all(Array.from({ length: 100 }, () => sendGuarded(msg, ctx)));
    expect(graph).not.toHaveBeenCalled();
    expect([...repo.budgets.values()].every((b) => b.reservedCount === 0)).toBe(true);
  });

  it("webhook com token inválido não processa nada, não liga a trava e retorna 401", async () => {
    const repo = new MemoryRepo();
    let seen = 0;
    const deps: AppDeps = { webhookToken: "token-correto-123456", repo, logger, onEvent: async () => { seen++; } };
    const body = toJson(upsertText("oi"));
    const r = await route(new Request("https://x/webhook", { method: "POST", body, headers: { "x-webhook-token": "token-errado" } }),
      { waitUntil: () => undefined }, deps);
    expect(r.status).toBe(401);
    expect(seen).toBe(0);
    expect(repo.processed.size).toBe(0);
    expect((await repo.getManualLock("PN")).locked).toBe(false);
  });

  it("admin: unlock via GET não destrava; 'bearer' minúsculo é 401", async () => {
    const repo = new MemoryRepo();
    await repo.setManualLock("PN", "x");
    const deps: AppDeps = { webhookToken: "s", repo, logger,
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

  it("day_key: virada à meia-noite do fuso e ano novo", () => {
    expect(dayKey(new Date("2026-11-11T02:59:59Z"), "America/Sao_Paulo")).toBe("2026-11-10");
    expect(dayKey(new Date("2026-11-11T03:00:00Z"), "America/Sao_Paulo")).toBe("2026-11-11");
    expect(dayKey(new Date("2027-01-01T02:59:59Z"), "America/Sao_Paulo")).toBe("2026-12-31");
  });

  it("month_key (legado): ano novo e fuso", () => {
    expect(monthKey(new Date("2027-01-01T02:59:59Z"), "America/Sao_Paulo")).toBe("2026-12");
    expect(monthKey(new Date("2027-01-01T03:00:00Z"), "America/Sao_Paulo")).toBe("2027-01");
  });
});
