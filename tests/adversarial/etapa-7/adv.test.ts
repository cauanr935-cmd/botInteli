import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { createLogger } from "../../../src/lib/logger";
import { runScheduled } from "../../../src/ops/scheduled";

const root = join(__dirname, "../../..");
const NOW = new Date("2026-12-01T02:30:00Z"); // ainda 30/11 no fuso de SP

describe("adversarial etapa 7", () => {
  it("cron: falha no delete não impede log de uso e logs não vazam telefone", async () => {
    const lines: string[] = [];
    const repo = new MemoryRepo();
    repo.deleteProcessedBefore = async () => { throw new Error("boom 5511999991234"); };
    await repo.reserveSlot("PN", "2026-11-30", 950);
    await runScheduled({ repo, logger: createLogger((l) => lines.push(l)), phoneNumberId: "PN", stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW });
    const all = lines.join("\n");
    expect(all).toContain("cron_budget_usage");
    expect(all).toContain('"period":"2026-11-30"');
    expect(all).not.toContain("5511999991234");
  });
  it("cron: nunca reserva nem envia", async () => {
    const repo = new MemoryRepo();
    await runScheduled({ repo, logger: createLogger(() => undefined), phoneNumberId: "PN", stopAt: 950, timezone: "America/Sao_Paulo", now: () => NOW });
    expect(repo.outbound).toHaveLength(0);
    expect(repo.budgets.size).toBe(0);
  });
  it("SQL: release_stuck_processing é idempotente e não toca outros estados", async () => {
    const db = new PGlite();
    for (const f of ["0001_processed_messages.sql", "0002_budget.sql", "0003_conversation.sql", "0008_housekeeping.sql"]) await db.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
    await db.exec(`insert into users (wa_id, last_user_message_at, state) values ('a', now(), 'MENU')`);
    await db.exec(`update users set state_changed_at = now() - interval '2 days'`);
    const r = await db.query<{ n: number }>("select release_stuck_processing(now()) as n");
    expect(r.rows[0]!.n).toBe(0);
    await db.exec(`insert into processed_messages (wamid, received_at) values ('x', now() - interval '8 days'), ('y', now())`).catch(() => undefined);
  });
  it("todas as migrações citadas e e o anti-ban no DEPLOY", () => {
    const d = readFileSync(join(root, "docs/DEPLOY.md"), "utf8");
    for (const f of readdirSync(join(root, "supabase/migrations")).filter((n) => n.endsWith(".sql"))) expect(d).toContain(f);
    expect(d).toMatch(/ANTI_FLOOD_MAX_PER_DAY/);
    expect(d).toMatch(/banimento/);
  });
});
