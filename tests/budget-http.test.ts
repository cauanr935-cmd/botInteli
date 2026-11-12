import { describe, it, expect } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { route, type AppDeps } from "../src/index";
import { sendGuarded } from "../src/whatsapp/client";
import { createLogger, type Logger, type LogLevel } from "../src/lib/logger";
import { PHONE, TOKEN as WEBHOOK_TOKEN, auth, text as upsertText, upsert } from "./helpers/evolution";

const NOW = new Date("2026-11-10T15:00:00Z");
const TOKEN = "admintok";

function setup() {
  const repo = new MemoryRepo();
  repo.users.set(PHONE, new Date(NOW.getTime() - 60_000)); // a pessoa já escreveu ao bot
  const logs: { level: LogLevel; event: string }[] = [];
  const logger: Logger = { log: (level, event) => { logs.push({ level, event }); } };
  const deps: AppDeps = {
    webhookToken: WEBHOOK_TOKEN, repo, logger, now: () => NOW,
    admin: { adminToken: TOKEN, repo, logger, phoneNumberId: "PNID", stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW },
  };
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  const pending: Promise<unknown>[] = [];
  return { repo, logs, deps, ctx, flush: () => Promise.all(pending.splice(0)) };
}

async function postWebhook(s: ReturnType<typeof setup>, payload: unknown): Promise<Response> {
  const r = await route(
    new Request("https://x/webhook", { method: "POST", body: JSON.stringify(payload), headers: auth() }),
    s.ctx, s.deps,
  );
  await s.flush();
  return r;
}
const sendCtx = (s: ReturnType<typeof setup>) => ({
  repo: s.repo, logger: s.deps.logger, phoneNumberId: "PNID", evolutionUrl: "https://evo.test", evolutionApiKey: "k", evolutionInstance: "inst",
  stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW,
  fetchImpl: (async () => new Response(JSON.stringify({ key: { id: "w" } }), { status: 201 })) as unknown as typeof fetch,
});
const msg = { to: PHONE, type: "text", text: { body: "oi" } };
const admin = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
  new Request("https://x" + path, {
    ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });

describe("trava manual", () => {
  it("C2.5 trava ligada bloqueia os envios; só o admin destrava (com confirmação)", async () => {
    const s = setup();
    expect((await sendGuarded(msg, sendCtx(s))).status).toBe("sent");
    await s.repo.setManualLock("PNID", "humano");
    expect((await sendGuarded(msg, sendCtx(s))).status).toBe("blocked_manual_lock");
    const r = await route(admin("/admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO", { method: "POST" }), s.ctx, s.deps);
    expect(r.status).toBe(200);
    expect((await sendGuarded(msg, sendCtx(s))).status).toBe("sent");
  });

  it("C2.5 status de entrega/preço da Evolution (messages.update) são ignorados: nada liga a trava", async () => {
    const s = setup();
    const r = await postWebhook(s, { event: "messages.update", instance: "i", data: { status: "DELIVERY_ACK", pricing: { billable: true, type: "regular", category: "marketing" } } });
    expect(r.status).toBe(200);
    expect((await s.repo.getManualLock("PNID")).locked).toBe(false);
  });
});

describe("webhook com disjuntor aberto", () => {
  it("C2.10 POST /webhook responde 200 com a trava manual e o teto diário abertos (só para de ENVIAR)", async () => {
    const s = setup();
    await s.repo.setManualLock("PNID", "x");
    s.repo.budgets.set("PNID|2026-11-10", {
      phoneNumberId: "PNID", monthKey: "2026-11-10", reservedCount: 950, stopAt: 950,
      tripped: true, tripReason: "x", trippedAt: NOW, warned: true, tripLogged: true,
    });
    expect((await postWebhook(s, upsertText("oi"))).status).toBe(200);
    expect((await postWebhook(s, upsert({ stickerMessage: {} }, { id: "S1" }))).status).toBe(200);
    expect((await postWebhook(s, { event: "connection.update", data: {} })).status).toBe(200);
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

  it("C2.11 GET /admin/budget mostra o dia, contador, stop_at, tripped e trava", async () => {
    const s = setup();
    await sendGuarded(msg, sendCtx(s));
    await s.repo.setManualLock("PNID", "motivo");
    const r = await route(admin("/admin/budget"), s.ctx, s.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      period: "2026-11-10", flood_limit_enabled: true, reserved_count: 1, stop_at: 950, tripped: false,
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

  it("C2.11 unlock não reabre o teto diário esgotado", async () => {
    const s = setup();
    s.repo.budgets.set("PNID|2026-11-10", {
      phoneNumberId: "PNID", monthKey: "2026-11-10", reservedCount: 950, stopAt: 950,
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
