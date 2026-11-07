import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { route, type AppDeps } from "../src/index";
import { MemoryRepo } from "../src/db/memory-repo";
import { SupabaseRepo } from "../src/db/supabase-repo";
import { createLogger } from "../src/lib/logger";
import { parseWebhookPayload } from "../src/whatsapp/parser";
import { signBody } from "../src/whatsapp/signature";
import type { WebhookEvent } from "../src/whatsapp/types";

const SECRET = "segredo-de-teste";
const VERIFY = "verify-de-teste";
const fixture = (n: string): string => readFileSync(join(__dirname, "fixtures", n + ".json"), "utf8");

function setup(opts: { onEvent?: (e: WebhookEvent) => Promise<void>; repo?: MemoryRepo } = {}) {
  const logs: string[] = [];
  const repo = opts.repo ?? new MemoryRepo();
  const handled: WebhookEvent[] = [];
  const pending: Promise<unknown>[] = [];
  const deps: AppDeps = {
    appSecret: SECRET,
    verifyToken: VERIFY,
    repo,
    logger: createLogger((l) => logs.push(l)),
    onEvent: opts.onEvent ?? (async (e) => void handled.push(e)),
    now: () => new Date("2026-11-07T12:00:00Z"),
  };
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const post = async (body: string, sig?: string | null) => {
    const headers: Record<string, string> = {};
    const s = sig === undefined ? await signBody(body, SECRET) : sig;
    if (s !== null) headers["X-Hub-Signature-256"] = s;
    const r = await route(new Request("https://x/webhook", { method: "POST", body, headers }), ctx, deps);
    await Promise.all(pending);
    return r;
  };
  return { deps, ctx, logs, repo, handled, post };
}

describe("GET /webhook", () => {
  const get = (q: string) => {
    const s = setup();
    return route(new Request("https://x/webhook?" + q), s.ctx, s.deps);
  };
  it("C1.1 token certo devolve 200 e o challenge", async () => {
    const r = await get(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("12345");
  });
  it("C1.1 token errado devolve 403", async () => {
    expect((await get("hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1")).status).toBe(403);
  });
  it("C1.1 modo errado devolve 403", async () => {
    expect((await get(`hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`)).status).toBe(403);
  });
  it("C1.1 sem token devolve 403", async () => {
    expect((await get("hub.mode=subscribe&hub.challenge=1")).status).toBe(403);
  });
});

describe("assinatura", () => {
  it("C1.2 assinatura válida é aceita e processada", async () => {
    const s = setup();
    const r = await s.post(fixture("text"));
    expect(r.status).toBe(200);
    expect(s.handled).toHaveLength(1);
  });
  it("C1.2 assinatura ausente devolve 401 sem processar", async () => {
    const s = setup();
    expect((await s.post(fixture("text"), null)).status).toBe(401);
    expect(s.handled).toHaveLength(0);
    expect(s.repo.processed.size).toBe(0);
    expect(s.repo.users.size).toBe(0);
  });
  it("C1.2 assinatura errada devolve 401 sem processar", async () => {
    const s = setup();
    const bad = await signBody(fixture("text"), "outro-segredo");
    expect((await s.post(fixture("text"), bad)).status).toBe(401);
    expect((await s.post(fixture("text"), "sha256=zz")).status).toBe(401);
    expect((await s.post(fixture("text"), "abc")).status).toBe(401);
    expect(s.handled).toHaveLength(0);
    expect(s.repo.processed.size).toBe(0);
  });
  it("C1.2 corpo alterado após assinar devolve 401 sem processar", async () => {
    const s = setup();
    const sig = await signBody(fixture("text"), SECRET);
    expect((await s.post(fixture("text") + " ", sig)).status).toBe(401);
    expect(s.handled).toHaveLength(0);
    expect(s.repo.processed.size).toBe(0);
  });
});

describe("idempotência", () => {
  it("C1.3 mesmo payload entregue 2 vezes é processado 1 vez", async () => {
    const s = setup();
    await s.post(fixture("text"));
    const r = await s.post(fixture("text"));
    expect(r.status).toBe(200);
    expect(s.handled).toHaveLength(1);
  });
  it("C1.3 entregas simultâneas processam 1 vez", async () => {
    const s = setup();
    await Promise.all(Array.from({ length: 20 }, () => s.post(fixture("text"))));
    expect(s.handled).toHaveLength(1);
  });
  it("C1.3 statuses repetidos também são deduplicados", async () => {
    const s = setup();
    await s.post(fixture("status_free"));
    await s.post(fixture("status_free"));
    expect(s.handled).toHaveLength(1);
  });
});

describe("parser", () => {
  const types = (n: string) => parseWebhookPayload(JSON.parse(fixture(n))).map((e) => e.type);
  it("C1.4 reconhece text, botões, lista, nfm_reply e áudio", () => {
    expect(types("text")).toEqual(["text"]);
    expect(types("button_reply")).toEqual(["button_reply"]);
    expect(types("list_reply")).toEqual(["list_reply"]);
    expect(types("nfm_reply")).toEqual(["nfm_reply"]);
    expect(types("audio")).toEqual(["audio"]);
    const [v] = parseWebhookPayload(JSON.parse(fixture("voice")));
    expect(v).toMatchObject({ type: "audio", voice: true, mediaId: "MEDIA2" });
    const [n] = parseWebhookPayload(JSON.parse(fixture("nfm_reply")));
    expect(n).toMatchObject({ type: "nfm_reply" });
    expect(JSON.parse((n as { responseJson: string }).responseJson).nome).toBe("Fulano");
  });
  it("C1.4 statuses trazem pricing", () => {
    const [a] = parseWebhookPayload(JSON.parse(fixture("status_free")));
    expect(a).toMatchObject({ type: "status", pricing: { billable: false, pricingModel: "PMP", type: "free_customer_service", category: "service" } });
    const [b] = parseWebhookPayload(JSON.parse(fixture("status_billable")));
    expect(b).toMatchObject({ pricing: { billable: true, type: "regular", category: "marketing" } });
  });
  it("C1.4 figurinha, reação, imagem, vídeo, localização, contatos e desconhecido viram unsupported", () => {
    for (const n of ["sticker", "reaction", "image", "video", "location", "contacts", "unknown"]) {
      expect(types(n)).toEqual(["unsupported"]);
    }
    expect(parseWebhookPayload(JSON.parse(fixture("unknown")))[0]).toMatchObject({ rawType: "hologram" });
  });
  it("C1.4 lixo não lança erro", () => {
    for (const p of [null, 1, "x", [], {}, { entry: "a" }, { entry: [null, { changes: [{ value: { messages: [1, null, {}, { id: "a" }] } }] }] }]) {
      expect(parseWebhookPayload(p)).toEqual([]);
    }
  });
  it("C1.4 payload com vários eventos processa todos", async () => {
    expect(types("multi")).toEqual(["text", "audio", "unsupported", "status"]);
    const s = setup();
    await s.post(fixture("multi"));
    expect(s.handled.map((e) => e.type)).toEqual(["text", "audio", "unsupported", "status"]);
  });
});

describe("erros e logs", () => {
  it("C1.5 exceção no processamento devolve 200 e loga erro; demais eventos seguem", async () => {
    let n = 0;
    const s = setup({
      onEvent: async () => {
        if (n++ === 0) throw new Error("boom com 5511987651234");
      },
    });
    const r = await s.post(fixture("multi"));
    expect(r.status).toBe(200);
    expect(n).toBe(4);
    expect(s.logs.some((l) => JSON.parse(l).level === "error")).toBe(true);
  });
  it("C1.5 JSON inválido com assinatura válida devolve 200", async () => {
    const s = setup();
    expect((await s.post("não é json")).status).toBe(200);
  });
  it("C1.5 falha do banco devolve 200 e loga erro", async () => {
    const repo = new MemoryRepo();
    repo.claimMessage = async () => {
      throw new Error("db fora");
    };
    const s = setup({ repo });
    expect((await s.post(fixture("text"))).status).toBe(200);
    expect(s.logs.some((l) => JSON.parse(l).level === "error")).toBe(true);
  });
  it("C1.6 logs não contêm telefone em claro nem texto da mensagem", async () => {
    const s = setup({
      onEvent: async () => {
        throw new Error("falha");
      },
    });
    await s.post(fixture("text"));
    await s.post(fixture("multi"));
    await s.post(fixture("nfm_reply"));
    await s.post(fixture("status_free"));
    await s.post(fixture("text"), "sha256=00");
    const all = s.logs.join("\n");
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain("5511987651234");
    expect(all).not.toContain("Oi, tudo bem?");
    expect(all).not.toContain("Fulano");
    expect(all).toContain("5511*****1234");
  });
});

describe("last_user_message_at", () => {
  it("C1.7 atualizado a cada mensagem recebida (e não por status)", async () => {
    const s = setup();
    await s.post(fixture("text"));
    expect(await s.repo.getLastUserMessageAt("5511987651234")).toEqual(new Date(1762500000 * 1000));
    await s.post(fixture("status_free"));
    const s2 = setup();
    await s2.post(fixture("status_free"));
    expect(await s2.repo.getLastUserMessageAt("5511987651234")).toBeNull();
  });
  it("C1.7 mensagem mais nova avança o horário; mais antiga não regride", async () => {
    const repo = new MemoryRepo();
    await repo.touchUser("1", new Date("2026-01-02T00:00:00Z"));
    await repo.touchUser("1", new Date("2026-01-01T00:00:00Z"));
    expect(await repo.getLastUserMessageAt("1")).toEqual(new Date("2026-01-02T00:00:00Z"));
  });
  it("C1.7 timestamp futuro é limitado ao momento do recebimento", async () => {
    const s = setup();
    const p = JSON.parse(fixture("text"));
    p.entry[0].changes[0].value.messages[0].timestamp = String(Math.floor(Date.parse("2030-01-01") / 1000));
    await s.post(JSON.stringify(p));
    expect(await s.repo.getLastUserMessageAt("5511987651234")).toEqual(new Date("2026-11-07T12:00:00Z"));
  });
});

describe("Supabase e migração", () => {
  it("C1.3 SupabaseRepo.claimMessage usa insert ignore-duplicates (mock de fetch)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let first = true;
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = first ? [{ wamid: "w" }] : [];
      first = false;
      return new Response(JSON.stringify(body), { status: 201 });
    }) as unknown as typeof fetch;
    const repo = new SupabaseRepo("https://sb.test", "key", f);
    expect(await repo.claimMessage("w", new Date())).toBe(true);
    expect(await repo.claimMessage("w", new Date())).toBe(false);
    expect((calls[0]!.init.headers as Record<string, string>).Prefer).toContain("ignore-duplicates");
  });
  it("C1.3 SupabaseRepo falha em erro HTTP (lança)", async () => {
    const f = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await expect(new SupabaseRepo("https://sb.test", "k", f).claimMessage("w", new Date())).rejects.toThrow();
  });
  it("C1.3 C1.7 migração SQL aplica no PGlite: wamid é único e touch_user não regride", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(join(__dirname, "..", "supabase/migrations/0001_processed_messages.sql"), "utf8"));
    const ins = "insert into processed_messages (wamid) values ('a') on conflict do nothing returning wamid";
    expect((await db.query(ins)).rows).toHaveLength(1);
    expect((await db.query(ins)).rows).toHaveLength(0);
    await db.query("select touch_user('1', '2026-01-02T00:00:00Z')");
    await db.query("select touch_user('1', '2026-01-01T00:00:00Z')");
    const r = await db.query<{ t: string }>("select last_user_message_at::text as t from users where wa_id='1'");
    expect(r.rows[0]!.t).toContain("2026-01-02");
    await db.close();
  });
});

import { it as itR, expect as expectR } from "vitest";
import { MemoryRepo as MemRepoR } from "../src/db/memory-repo";
import { processEvents as processR } from "../src/webhook/handler";

itR("C2.5 status que falha no tratamento libera a chave para reprocessar no reenvio", async () => {
  const repo = new MemRepoR();
  const ev = { type: "status", id: "w9", status: "sent", recipientId: "5511" } as never;
  let fail = true;
  const deps = { appSecret: "s", verifyToken: "v", repo, logger: { log: () => undefined }, onEvent: async () => { if (fail) throw new Error("x"); } };
  await processR([ev], deps as never);
  fail = false;
  let calls = 0;
  deps.onEvent = async () => { calls++; };
  await processR([ev], deps as never);
  expectR(calls).toBe(1);
});
