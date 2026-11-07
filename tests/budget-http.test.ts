import { describe, it, expect } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { route, type AppDeps } from "../src/index";
import { handleStatusEvent } from "../src/budget/status";
import { sendGuarded } from "../src/whatsapp/client";
import { createLogger, type Logger, type LogLevel } from "../src/lib/logger";
import { signBody } from "../src/whatsapp/signature";
import statusBillable from "./fixtures/status_billable.json";
import statusFree from "./fixtures/status_free.json";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
const SECRET = "appsecret";
const TOKEN = "admintok";

function setup() {
  const repo = new MemoryRepo();
  const logs: { level: LogLevel; event: string }[] = [];
  const logger: Logger = { log: (level, event) => { logs.push({ level, event }); } };
  const deps: AppDeps = {
    appSecret: SECRET, verifyToken: "v", repo, logger, now: () => NOW,
    onEvent: async (ev) => {
      if (ev.type === "status") await handleStatusEvent(ev, { repo, logger, phoneNumberId: "PNID", now: () => NOW });
    },
    admin: { adminToken: TOKEN, repo, logger, phoneNumberId: "PNID", stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW },
  };
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  const pending: Promise<unknown>[] = [];
  return { repo, logs, deps, ctx, flush: () => Promise.all(pending.splice(0)) };
}

async function postWebhook(s: ReturnType<typeof setup>, payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const sig = await signBody(body, SECRET);
  const r = await route(
    new Request("https://x/webhook", { method: "POST", body, headers: { "X-Hub-Signature-256": sig } }),
    s.ctx, s.deps,
  );
  await s.flush();
  return r;
}
function clone<T>(o: T): T { return JSON.parse(JSON.stringify(o)) as T; }
function withPricing(base: unknown, id: string, pricing: unknown) {
  const p = clone(base) as { entry: { changes: { value: { statuses: Record<string, unknown>[] } }[] }[] };
  const st = p.entry[0]!.changes[0]!.value.statuses[0]!;
  st.id = id;
  st.pricing = pricing;
  return p;
}
const sendCtx = (s: ReturnType<typeof setup>) => ({
  repo: s.repo, logger: s.deps.logger, phoneNumberId: "PNID", whatsappToken: "t", graphApiVersion: "v21.0",
  stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW,
  fetchImpl: (async () => new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 })) as unknown as typeof fetch,
});
const msg = { to: WA, type: "text", text: { body: "oi" } };
const admin = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
  new Request("https://x" + path, {
    ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });

describe("status webhooks e trava manual", () => {
  it("C2.5 billable:true liga a trava; envios seguintes bloqueados; só o admin destrava", async () => {
    const s = setup();
    s.repo.users.set(WA, new Date(NOW.getTime() - 60_000));
    expect((await sendGuarded(msg, sendCtx(s))).status).toBe("sent");
    await postWebhook(s, statusBillable);
    expect((await s.repo.getManualLock("PNID")).locked).toBe(true);
    expect(s.logs.some((l) => l.level === "critical")).toBe(true);
    expect((await sendGuarded(msg, sendCtx(s))).status).toBe("blocked_manual_lock");
    // um status "bom" depois não destrava
    await postWebhook(s, statusFree);
    expect((await s.repo.getManualLock("PNID")).locked).toBe(true);
    const r = await route(admin("/admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO", { method: "POST" }), s.ctx, s.deps);
    expect(r.status).toBe(200);
    expect((await sendGuarded(msg, sendCtx(s))).status).toBe("sent");
  });

  it("C2.5 type:'regular' sozinho liga a trava", async () => {
    const s = setup();
    await postWebhook(s, withPricing(statusFree, "wamid.A", { billable: false, pricing_model: "PMP", type: "regular", category: "service" }));
    expect((await s.repo.getManualLock("PNID")).locked).toBe(true);
  });

  it("C2.5 category:'utility' sozinho liga a trava", async () => {
    const s = setup();
    await postWebhook(s, withPricing(statusFree, "wamid.B", { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "utility" }));
    expect((await s.repo.getManualLock("PNID")).locked).toBe(true);
  });

  it("C2.5 pricing gratuito normal NÃO liga a trava e é gravado no outbound_log", async () => {
    const s = setup();
    await s.repo.insertOutboundLog({ waIdHash: "h", messageType: "text", wamid: "wamid.OUT1", reservedAt: NOW, sentOk: true, errorCode: null });
    await postWebhook(s, withPricing(statusFree, "wamid.OUT1", { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "service" }));
    expect((await s.repo.getManualLock("PNID")).locked).toBe(false);
    expect(s.repo.outbound[0]).toMatchObject({ pricingBillable: false, pricingType: "free_customer_service", pricingCategory: "service" });
  });
});

describe("webhook com disjuntor aberto", () => {
  it("C2.10 POST /webhook responde 200 com disjuntor (orçamento e trava manual) aberto", async () => {
    const s = setup();
    await s.repo.setManualLock("PNID", "x");
    s.repo.budgets.set("PNID|2026-11", {
      phoneNumberId: "PNID", monthKey: "2026-11", reservedCount: 950, stopAt: 950,
      tripped: true, tripReason: "x", trippedAt: NOW, warned: true, tripLogged: true,
    });
    const text = clone(statusFree);
    expect((await postWebhook(s, text)).status).toBe(200);
    expect((await postWebhook(s, statusBillable)).status).toBe(200);
    expect((await postWebhook(s, { object: "whatsapp_business_account", entry: [] })).status).toBe(200);
  });
});

describe("endpoints admin", () => {
  it("C2.11 sem token ou token errado -> 401 em todas as rotas", async () => {
    const s = setup();
    for (const [path, method] of [["/admin/budget", "GET"], ["/admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO", "POST"]] as const) {
      expect((await route(admin(path, { method }, null), s.ctx, s.deps)).status).toBe(401);
      expect((await route(admin(path, { method }, "errado"), s.ctx, s.deps)).status).toBe(401);
      expect((await route(admin(path, { method }, ""), s.ctx, s.deps)).status).toBe(401);
    }
  });

  it("C2.11 unlock sem confirm correto -> 400 e a trava continua", async () => {
    const s = setup();
    await s.repo.setManualLock("PNID", "x");
    for (const q of ["", "?confirm=sim", "?confirm=eu_entendo_o_risco"]) {
      expect((await route(admin("/admin/budget/unlock" + q, { method: "POST" }), s.ctx, s.deps)).status).toBe(400);
    }
    expect((await s.repo.getManualLock("PNID")).locked).toBe(true);
  });

  it("C2.11 GET /admin/budget mostra mês, contador, stop_at, tripped e trava", async () => {
    const s = setup();
    s.repo.users.set(WA, new Date(NOW.getTime() - 60_000));
    await sendGuarded(msg, sendCtx(s));
    await s.repo.setManualLock("PNID", "motivo");
    const r = await route(admin("/admin/budget"), s.ctx, s.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      month: "2026-11", reserved_count: 1, stop_at: 950, tripped: false,
      manual_lock: { locked: true, reason: "motivo" },
    });
  });

  it("C2.11 unlock correto desliga só a trava manual e registra quem/quando", async () => {
    const s = setup();
    await s.repo.setManualLock("PNID", "x");
    const r = await route(
      admin("/admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO", { method: "POST", headers: { "X-Admin-User": "maria" } }),
      s.ctx, s.deps,
    );
    expect(r.status).toBe(200);
    const lock = await s.repo.getManualLock("PNID");
    expect(lock).toMatchObject({ locked: false, unlockedBy: "maria" });
    expect(lock.unlockedAt).toBeInstanceOf(Date);
  });

  it("C2.11 unlock não reabre o orçamento esgotado do mês", async () => {
    const s = setup();
    s.repo.users.set(WA, new Date(NOW.getTime() - 60_000));
    s.repo.budgets.set("PNID|2026-11", {
      phoneNumberId: "PNID", monthKey: "2026-11", reservedCount: 950, stopAt: 950,
      tripped: true, tripReason: "x", trippedAt: NOW, warned: true, tripLogged: true,
    });
    await s.repo.setManualLock("PNID", "x");
    await route(admin("/admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO", { method: "POST" }), s.ctx, s.deps);
    expect((await sendGuarded(msg, sendCtx(s))).status).toBe("blocked_budget");
  });

  it("admin sem configuração devolve 500 (nunca aberto)", async () => {
    const r = await route(admin("/admin/budget"), { waitUntil: () => undefined }, null);
    expect(r.status).toBe(500);
    void createLogger;
  });
});
