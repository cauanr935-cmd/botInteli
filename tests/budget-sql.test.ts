import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { monthKey } from "../src/budget/month";

const SQL = readFileSync(join(__dirname, "..", "supabase", "migrations", "0002_budget.sql"), "utf8");
const PN = "PNID";

async function newDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SQL);
  return db;
}
async function reserve(db: PGlite, month: string, stop = 950): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>("select reserve_outbound_slot($1,$2,$3) as ok", [PN, month, stop]);
  return r.rows[0]!.ok;
}
async function setCount(db: PGlite, month: string, n: number, stop = 950) {
  await db.query(
    "insert into message_budget(phone_number_id, month_key, reserved_count, stop_at) values ($1,$2,$3,$4) on conflict (phone_number_id, month_key) do update set reserved_count=$3",
    [PN, month, n, stop],
  );
}

describe("reserve_outbound_slot (PGlite)", () => {
  let db: PGlite;
  beforeEach(async () => { db = await newDb(); });

  it("C2.2 stop_at=950: a 950ª reserva passa, a 951ª falha e marca tripped", async () => {
    await setCount(db, "2026-11", 949);
    expect(await reserve(db, "2026-11")).toBe(true); // 950ª
    expect(await reserve(db, "2026-11")).toBe(false); // 951ª
    expect(await reserve(db, "2026-11")).toBe(false);
    const r = await db.query<{ reserved_count: number; tripped: boolean }>("select * from message_budget");
    expect(r.rows[0]).toMatchObject({ reserved_count: 950, tripped: true });
  });

  it("C2.2 950 reservas sequenciais a partir de zero: exatamente 950 aprovam", async () => {
    let ok = 0;
    for (let i = 0; i < 960; i++) if (await reserve(db, "2026-11")) ok++;
    expect(ok).toBe(950);
  });

  it("C2.3 concorrência: contador em 940, 100 reservas simultâneas aprovam exatamente 10", async () => {
    await setCount(db, "2026-11", 940);
    const results = await Promise.all(Array.from({ length: 100 }, () => reserve(db, "2026-11")));
    expect(results.filter(Boolean)).toHaveLength(10);
    const r = await db.query<{ reserved_count: number }>("select reserved_count from message_budget");
    expect(r.rows[0]!.reserved_count).toBe(950);
  });

  it("C2.3 concorrência com cliente novo (linha do mês ainda não existe): 1200 simultâneas -> 950", async () => {
    const results = await Promise.all(Array.from({ length: 1200 }, () => reserve(db, "2026-12")));
    expect(results.filter(Boolean)).toHaveLength(950);
  });

  it("C2.4 virada de mês: 31/out 23:59 e 01/nov 00:00 (São Paulo) são meses distintos", () => {
    const tz = "America/Sao_Paulo";
    expect(monthKey(new Date("2026-11-01T02:59:00Z"), tz)).toBe("2026-10"); // 31/out 23:59
    expect(monthKey(new Date("2026-11-01T03:00:00Z"), tz)).toBe("2026-11"); // 01/nov 00:00
  });

  it("C2.4 mês novo libera envios; trava manual continua ligada", async () => {
    await setCount(db, "2026-10", 950);
    expect(await reserve(db, "2026-10")).toBe(false);
    expect(await reserve(db, "2026-11")).toBe(true);
    await db.query("select set_manual_lock($1,$2)", [PN, "teste"]);
    expect(await reserve(db, "2026-12")).toBe(false); // mês novo, mas travado
    const l = await db.query<{ locked: boolean }>("select locked from budget_lock");
    expect(l.rows[0]!.locked).toBe(true);
    // virar o mês não mexe na trava: ainda bloqueado em outro mês
    expect(await reserve(db, "2027-01")).toBe(false);
    await db.query("select clear_manual_lock($1,$2)", [PN, "alguem"]);
    expect(await reserve(db, "2027-01")).toBe(true);
    const u = await db.query<{ unlocked_by: string; unlocked_at: string }>("select * from budget_lock");
    expect(u.rows[0]!.unlocked_by).toBe("alguem");
    expect(u.rows[0]!.unlocked_at).toBeTruthy();
  });

  it("C2.5 trava manual não consome vaga", async () => {
    await db.query("select set_manual_lock($1,$2)", [PN, "x"]);
    expect(await reserve(db, "2026-11")).toBe(false);
    const r = await db.query<{ reserved_count: number }>("select reserved_count from message_budget");
    expect(r.rows[0]!.reserved_count).toBe(0);
  });

  it("C2.2 o SQL nunca passa de 990, mesmo que o chamador peça mais", async () => {
    let ok = 0;
    for (let i = 0; i < 1010; i++) if (await reserve(db, "2026-11", 5000)) ok++;
    expect(ok).toBe(990);
  });

  it("C2.12 claim_budget_alert devolve true só na primeira vez", async () => {
    await reserve(db, "2026-11");
    const c = async (k: string) =>
      (await db.query<{ v: boolean }>("select claim_budget_alert($1,$2,$3) as v", [PN, "2026-11", k])).rows[0]!.v;
    expect(await c("warn")).toBe(true);
    expect(await c("warn")).toBe(false);
    expect(await c("trip")).toBe(true);
    expect(await c("trip")).toBe(false);
  });

  it("RLS ligado nas tabelas novas", async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('message_budget','budget_lock','outbound_log')",
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((x) => x.relrowsecurity)).toBe(true);
  });
});
