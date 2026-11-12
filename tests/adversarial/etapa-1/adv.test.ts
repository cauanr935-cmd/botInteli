import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { route } from "../../../src/index";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { createLogger } from "../../../src/lib/logger";
import { TOKEN, PHONE, auth, text as evoText, upsert, json } from "../../helpers/evolution";

function mk() {
  const lines: string[] = [];
  const repo = new MemoryRepo();
  const seen: string[] = [];
  const deps = { webhookToken: TOKEN, repo, logger: createLogger((l) => lines.push(l)),
    onEvent: async (e: { type: string }) => { seen.push(e.type); } };
  const tasks: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { tasks.push(p); } };
  return { lines, repo, seen, deps, ctx, tasks };
}
const body = (id: string, text = "segredo-xyz") => [
  evoText(text, { id }),
  upsert({ stickerMessage: {} }, { id: id + "s" }),
];

async function post(m: ReturnType<typeof mk>, payloads: unknown[], token: string | null = TOKEN) {
  let last: Response | undefined;
  for (const p of payloads) {
    last = await route(new Request("http://x/webhook", { method: "POST", body: json(p), headers: auth(token) }), m.ctx, m.deps);
  }
  await Promise.all(m.tasks);
  return last!;
}

it("100 entregas simultâneas do mesmo payload processam 1x e sem vazar texto/telefone", async () => {
  const m = mk();
  const b = body("3EB0A");
  const rs = await Promise.all(Array.from({ length: 100 }, () => post(m, b)));
  expect(rs.every((r) => r.status === 200)).toBe(true);
  expect(m.seen).toEqual(["text", "unsupported"]);
  const all = m.lines.join("\n");
  expect(all).not.toContain("segredo-xyz");
  expect(all).not.toContain(PHONE);
});

it("token: vazio, parcial, com sufixo, de outro tamanho, assinatura da Meta no lugar -> 401", async () => {
  const m = mk();
  const b = body("3EB0B");
  for (const t of [null, "", " ", TOKEN.slice(1), TOKEN + "00", "outro-token-qualquer-123"]) {
    expect((await post(m, b, t)).status).toBe(401);
  }
  const meta = await route(new Request("http://x/webhook", { method: "POST", body: json(b[0]), headers: { "X-Hub-Signature-256": "sha256=00" } }), m.ctx, m.deps);
  expect(meta.status).toBe(401);
  expect(m.seen).toEqual([]);
  expect(m.repo.processed.size).toBe(0);
});

it("o token vale mesmo no formato Authorization: Bearer", async () => {
  const m = mk();
  const r = await route(new Request("http://x/webhook", { method: "POST", body: json(body("3EB0C")[0]), headers: { Authorization: `Bearer ${TOKEN}` } }), m.ctx, m.deps);
  await Promise.all(m.tasks);
  expect(r.status).toBe(200);
  expect(m.seen).toEqual(["text"]);
});

it("onEvent lançando e repo falhando -> 200", async () => {
  const m = mk();
  m.repo.claimMessage = async () => { throw new Error("db down"); };
  expect((await post(m, body("3EB0D"))).status).toBe(200);
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
