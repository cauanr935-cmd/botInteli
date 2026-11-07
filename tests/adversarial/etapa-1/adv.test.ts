import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { route } from "../../../src/index";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { createLogger } from "../../../src/lib/logger";
import { signBody } from "../../../src/whatsapp/signature";

const SECRET = "s3cret";
function mk() {
  const lines: string[] = [];
  const repo = new MemoryRepo();
  const seen: string[] = [];
  const deps = { appSecret: SECRET, verifyToken: "v", repo, logger: createLogger((l) => lines.push(l)),
    onEvent: async (e: { type: string }) => { seen.push(e.type); } };
  const tasks: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { tasks.push(p); } };
  return { lines, repo, seen, deps, ctx, tasks };
}
const body = (id: string, text = "segredo-xyz") => JSON.stringify({ entry: [{ changes: [{ value: { messages: [
  { id, from: "5511987651234", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } },
  { id: id + "s", from: "5511987651234", type: "sticker", sticker: { id: "x" } }] } }] }] });

async function post(m: ReturnType<typeof mk>, b: string, sig?: string | null) {
  const headers: Record<string, string> = {};
  const s = sig === undefined ? await signBody(b, SECRET) : sig;
  if (s !== null) headers["X-Hub-Signature-256"] = s;
  const r = await route(new Request("http://x/webhook", { method: "POST", body: b, headers }), m.ctx, m.deps);
  await Promise.all(m.tasks);
  return r;
}

it("100 entregas simultâneas do mesmo payload processam 1x e sem vazar texto/telefone", async () => {
  const m = mk();
  const b = body("wamid.A");
  const rs = await Promise.all(Array.from({ length: 100 }, () => post(m, b)));
  expect(rs.every((r) => r.status === 200)).toBe(true);
  expect(m.seen).toEqual(["text", "unsupported"]);
  const all = m.lines.join("\n");
  expect(all).not.toContain("segredo-xyz");
  expect(all).not.toContain("5511987651234");
});

it("assinatura: prefixo errado, hex curto, maiúscula com segredo errado, vazio -> 401", async () => {
  const m = mk();
  const b = body("wamid.B");
  const good = await signBody(b, SECRET);
  for (const s of [null, "", "sha256=", "sha256=abc", good.replace("sha256=", "sha1="), await signBody(b, "outro"), good + "00"]) {
    expect((await post(m, b, s)).status).toBe(401);
  }
  expect(m.seen).toEqual([]);
  expect(m.repo.processed.size).toBe(0);
});

it("corpo alterado por espaço é 401", async () => {
  const m = mk();
  const b = body("wamid.C");
  const sig = await signBody(b, SECRET);
  expect((await post(m, b + " ", sig)).status).toBe(401);
  expect(m.seen).toEqual([]);
});

it("onEvent lançando e repo falhando -> 200", async () => {
  const m = mk();
  m.repo.claimMessage = async () => { throw new Error("db down"); };
  expect((await post(m, body("wamid.D"))).status).toBe(200);
  expect(m.lines.some((l) => l.includes('"error"'))).toBe(true);
});

it("migração roda em PGlite; claim duplicado e touch_user não regride", async () => {
  const db = new PGlite();
  await db.exec(readFileSync("supabase/migrations/0001_processed_messages.sql", "utf8"));
  const ins = "insert into processed_messages(wamid) values ('a') on conflict do nothing returning wamid";
  expect((await db.query(ins)).rows.length).toBe(1);
  expect((await db.query(ins)).rows.length).toBe(0);
  await db.query("select touch_user('55', '2026-01-02T00:00:00Z')");
  await db.query("select touch_user('55', '2026-01-01T00:00:00Z')");
  const r = await db.query<{ t: string }>("select last_user_message_at::text as t from users");
  expect(r.rows[0]!.t).toContain("2026-01-02");
});
