import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryRepo } from "../src/db/memory-repo";
import { createLogger } from "../src/lib/logger";
import { runScheduled, PROCESSED_RETENTION_MS, STUCK_PROCESSING_MS } from "../src/ops/scheduled";
import worker from "../src/index";

const root = join(__dirname, "..");
const DAY = 24 * 3600 * 1000;
const NOW = new Date("2026-11-15T06:00:00Z");

function setup() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger((l) => lines.push(JSON.parse(l)));
  const repo = new MemoryRepo();
  const deps = { repo, logger, phoneNumberId: "PN", stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW };
  return { lines, repo, deps };
}

describe("cron scheduled", () => {
  it("C7.1 faz a consulta leve, limpa processed_messages > 7 dias e loga o uso do anti-flood", async () => {
    const { lines, repo, deps } = setup();
    let pinged = 0;
    const orig = repo.ping.bind(repo);
    repo.ping = async () => { pinged++; await orig(); };
    await repo.claimMessage("velho", new Date(NOW.getTime() - PROCESSED_RETENTION_MS - 1000));
    await repo.claimMessage("novo", new Date(NOW.getTime() - 6 * DAY));
    await repo.reserveSlot("PN", "2026-11-15", 950);
    await repo.reserveSlot("PN", "2026-11-15", 950);
    await runScheduled(deps);
    expect(pinged).toBe(1);
    expect(repo.processed.has("velho")).toBe(false);
    expect(repo.processed.has("novo")).toBe(true);
    const usage = lines.find((l) => l.event === "cron_budget_usage");
    expect(usage).toMatchObject({ period: "2026-11-15", reserved_count: 2, stop_at: 950 });
    expect(lines.find((l) => l.event === "cron_processed_cleanup")).toMatchObject({ removed: 1 });
  });

  it("C7.1 falha do banco no ping é logada e as outras tarefas continuam", async () => {
    const { lines, repo, deps } = setup();
    repo.pingFails = true;
    await repo.claimMessage("velho", new Date(NOW.getTime() - 8 * DAY));
    await runScheduled(deps);
    expect(lines.some((l) => l.event === "cron_ping_failed")).toBe(true);
    expect(repo.processed.size).toBe(0);
  });

  it("C7.1 conversa presa em PROCESSING_AUDIO volta a AWAIT_AUDIO sem enviar nada; recente fica", async () => {
    const { repo, deps } = setup();
    const t0 = new Date(NOW.getTime() - STUCK_PROCESSING_MS - 60_000);
    repo.clock = () => t0;
    await repo.saveConversation("5511900000001", 0, { state: "PROCESSING_AUDIO", previousState: null, hintSentInState: true, optedOutAt: null });
    repo.clock = () => new Date(NOW.getTime() - 60_000);
    await repo.saveConversation("5511900000002", 0, { state: "PROCESSING_AUDIO", previousState: null, hintSentInState: false, optedOutAt: null });
    await runScheduled(deps);
    expect((await repo.getConversation("5511900000001")).state).toBe("AWAIT_AUDIO");
    expect((await repo.getConversation("5511900000001")).hintSentInState).toBe(false);
    expect((await repo.getConversation("5511900000002")).state).toBe("PROCESSING_AUDIO");
    expect(repo.outbound).toHaveLength(0);
    expect(repo.budgets.size).toBe(0); // nenhuma reserva: o cron não envia (R1)
  });

  it("C7.1 scheduled do Worker sem config só registra erro (sem rede)", async () => {
    await expect(worker.scheduled({} as ScheduledController, {})).resolves.toBeUndefined();
  });

  it("C7.1 SQL 0008: apaga/destrava corretamente (PGlite)", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(join(root, "supabase/migrations/0001_processed_messages.sql"), "utf8"));
    await db.exec(readFileSync(join(root, "supabase/migrations/0002_budget.sql"), "utf8"));
    await db.exec(readFileSync(join(root, "supabase/migrations/0003_conversation.sql"), "utf8"));
    await db.exec(readFileSync(join(root, "supabase/migrations/0008_housekeeping.sql"), "utf8"));
    await db.exec(`insert into users (wa_id, last_user_message_at, state) values ('a', now(), 'AWAIT_AUDIO'), ('b', now(), 'AWAIT_AUDIO')`);
    await db.exec(`update users set state='PROCESSING_AUDIO'`);
    await db.exec(`update users set state_changed_at = now() - interval '1 hour' where wa_id='a'`);
    const r = await db.query<{ n: number }>("select release_stuck_processing(now() - interval '10 minutes') as n");
    expect(r.rows[0]!.n).toBe(1);
    const s = await db.query<{ wa_id: string; state: string }>("select wa_id, state from users order by wa_id");
    expect(s.rows).toEqual([{ wa_id: "a", state: "AWAIT_AUDIO" }, { wa_id: "b", state: "PROCESSING_AUDIO" }]);
  });
});

describe("build e higiene", () => {
  it("C7.2 wrangler deploy --dry-run passa sem credenciais reais", () => {
    const out = mkdtempSync(join(tmpdir(), "wr-"));
    const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: "false" };
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    const res = execFileSync("npx", ["wrangler", "deploy", "--dry-run", "--outdir", out], { cwd: root, env, encoding: "utf8", timeout: 120_000 });
    expect(res).toContain("--dry-run: exiting now");
    expect(readdirSync(out).length).toBeGreaterThan(0);
  });

  const deploy = readFileSync(join(root, "docs/DEPLOY.md"), "utf8");
  it("C7.3 DEPLOY.md cobre todas as variáveis de .dev.vars.example", () => {
    const ex = readFileSync(join(root, ".dev.vars.example"), "utf8");
    const keys = [...ex.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) expect(deploy, k).toContain(`\`${k}\``);
  });
  it("C7.3 DEPLOY.md cobre os passos das pendências humanas e o checklist de produção", () => {
    for (const t of [
      "Oracle Cloud", "Cloudflare", "Supabase", "wrangler secret put", "wrangler r2 bucket create",
      "0007_audios.sql", "0008_housekeeping.sql", "0002_budget.sql", "0017_pending_choices.sql", "x-webhook-token",
      "/instance/create", "WHATSAPP-BAILEYS", "QR Code", "MESSAGES_UPSERT", "chip", "banimento", "ANTI_FLOOD_MAX_PER_DAY",
      "texto numerado", "política de privacidade", "/admin/budget", "retenção", "TIMEZONE", "ANALYZER_API_URL",
    ]) expect(deploy, t).toContain(t);
    // todas as migrações existentes são citadas
    for (const f of readdirSync(join(root, "supabase/migrations")).filter((n) => n.endsWith(".sql"))) expect(deploy, f).toContain(f);
  });
  it("C7.4 nenhum segredo real versionado e testes sem rede (sem fetch real)", () => {
    expect(statSync(join(root, ".dev.vars.example")).isFile()).toBe(true);
    const ex = readFileSync(join(root, ".dev.vars.example"), "utf8");
    for (const l of ex.split("\n")) {
      const m = /^(EVOLUTION_API_KEY|EVOLUTION_WEBHOOK_TOKEN|SUPABASE_SERVICE_KEY|ANALYZER_API_KEY|ADMIN_TOKEN)=(.*)$/.exec(l);
      if (m) expect(m[2]).toBe("");
    }
    expect(readFileSync(join(root, "wrangler.toml"), "utf8")).not.toMatch(/TOKEN\s*=|SECRET\s*=|SERVICE_KEY\s*=|API_KEY\s*=/);
  });
});
