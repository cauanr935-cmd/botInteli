import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { route, type AppDeps } from "../src/index";
import { MemoryRepo } from "../src/db/memory-repo";
import { SupabaseRepo } from "../src/db/supabase-repo";
import { createLogger } from "../src/lib/logger";
import { parseWebhookPayload } from "../src/whatsapp/parser";
import { matchChoice } from "../src/whatsapp/choices";
import { hashWaId } from "../src/lib/hash";
import { PHONE, TOKEN, auth, json, text, upsert } from "./helpers/evolution";
import type { WebhookEvent } from "../src/whatsapp/types";


function setup(opts: { onEvent?: (e: WebhookEvent) => Promise<void>; repo?: MemoryRepo } = {}) {
  const logs: string[] = [];
  const repo = opts.repo ?? new MemoryRepo();
  const handled: WebhookEvent[] = [];
  const pending: Promise<unknown>[] = [];
  const deps: AppDeps = {
    webhookToken: TOKEN,
    repo,
    logger: createLogger((l) => logs.push(l)),
    onEvent: opts.onEvent ?? (async (e) => void handled.push(e)),
    now: () => new Date("2026-11-07T12:00:00Z"),
  };
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const post = async (body: unknown, token: string | null = TOKEN) => {
    const headers = auth(token);
    const r = await route(new Request("https://x/webhook", { method: "POST", body: typeof body === "string" ? body : json(body), headers }), ctx, deps);
    await Promise.all(pending);
    return r;
  };
  return { deps, ctx, logs, repo, handled, post };
}

const T1 = text("Oi, tudo bem?", { id: "3EB0TEXT1" });
const MULTI = [text("a", { id: "m1" }), upsert({ audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } }, { id: "m2" }), upsert({ stickerMessage: {} }, { id: "m3" })];

describe("rotas", () => {
  it("GET /webhook não existe mais (a Evolution não faz handshake)", async () => {
    const s = setup();
    const r = await route(new Request("https://x/webhook?hub.mode=subscribe&hub.challenge=1"), s.ctx, s.deps);
    expect(r.status).toBe(405);
  });
});

describe("token do webhook", () => {
  it("C1.2 token válido (x-webhook-token ou Bearer) é aceito e processado", async () => {
    const s = setup();
    expect((await s.post(T1)).status).toBe(200);
    expect(s.handled).toHaveLength(1);
    const s2 = setup();
    const r = await route(new Request("https://x/webhook", { method: "POST", body: json(T1), headers: { Authorization: `Bearer ${TOKEN}` } }), s2.ctx, s2.deps);
    expect(r.status).toBe(200);
  });
  it("C1.2 token ausente, errado, vazio ou parcial devolve 401 sem processar nada", async () => {
    const s = setup();
    for (const t of [null, "", "errado", TOKEN.slice(0, -1), TOKEN + "x", TOKEN.toUpperCase()]) {
      expect((await s.post(T1, t)).status).toBe(401);
    }
    expect(s.handled).toHaveLength(0);
    expect(s.repo.processed.size).toBe(0);
    expect(s.repo.users.size).toBe(0);
  });
  it("C1.2 servidor sem token configurado recusa tudo (nunca aceita token vazio)", async () => {
    const s = setup();
    s.deps.webhookToken = "";
    expect((await s.post(T1, "")).status).toBe(401);
    expect((await s.post(T1, null)).status).toBe(401);
  });
});

describe("idempotência", () => {
  it("C1.3 mesmo key.id entregue 2 vezes é processado 1 vez", async () => {
    const s = setup();
    await s.post(T1);
    expect((await s.post(T1)).status).toBe(200);
    expect(s.handled).toHaveLength(1);
  });
  it("C1.3 entregas simultâneas processam 1 vez", async () => {
    const s = setup();
    await Promise.all(Array.from({ length: 20 }, () => s.post(T1)));
    expect(s.handled).toHaveLength(1);
  });
});

describe("parser (messages.upsert)", () => {
  const parse = (p: unknown) => parseWebhookPayload(p);
  const one = (message: Record<string, unknown>, o = {}) => parse(upsert(message, o))[0];
  it("C1.4 texto: conversation e extendedTextMessage; key.id vira wamid e o telefone vem do JID", () => {
    expect(one({ conversation: "oi" }, { id: "K1" })).toMatchObject({ type: "text", body: "oi", wamid: "K1", from: PHONE, timestamp: 1762500000 });
    expect(one({ extendedTextMessage: { text: "link" } })).toMatchObject({ type: "text", body: "link" });
    expect(one({ ephemeralMessage: { message: { conversation: "temporária" } } })).toMatchObject({ type: "text", body: "temporária" });
  });
  it("C1.4 timestamp como string ou Long {low}", () => {
    expect(one({ conversation: "a" }, { ts: "1762500001" })).toMatchObject({ timestamp: 1762500001 });
    expect(one({ conversation: "a" }, { ts: { low: 1762500002, high: 0 } as never })).toMatchObject({ timestamp: 1762500002 });
  });
  it("C1.4 respostas nativas de botão, lista e native flow", () => {
    expect(one({ buttonsResponseMessage: { selectedButtonId: "yes", selectedDisplayText: "Sim" } })).toMatchObject({ type: "button_reply", id: "yes", title: "Sim" });
    expect(one({ listResponseMessage: { title: "Mentoria", singleSelectReply: { selectedRowId: "s1" } } })).toMatchObject({ type: "list_reply", id: "s1", title: "Mentoria" });
    expect(one({ interactiveResponseMessage: { nativeFlowResponseMessage: { name: "quick_reply", paramsJson: '{"id":"no","display_text":"Não"}' } } })).toMatchObject({ type: "button_reply", id: "no" });
    expect(one({ interactiveResponseMessage: { nativeFlowResponseMessage: { name: "single_select", paramsJson: '{"id":"s2","title":"X"}' } } })).toMatchObject({ type: "list_reply", id: "s2" });
    expect(one({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: "{lixo" } } })).toMatchObject({ type: "unsupported" });
  });
  it("C1.4 áudio e nota de voz: mediaId é o key.id; mimetype e ptt preservados", () => {
    expect(one({ audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } }, { id: "A1" })).toMatchObject({ type: "audio", mediaId: "A1", voice: true, mimeType: "audio/ogg; codecs=opus" });
    expect(one({ audioMessage: { mimetype: "audio/mpeg" } }, { id: "A2" })).toMatchObject({ type: "audio", voice: false });
  });
  it("C1.4 documento comum fica documento (áudio como documento é coberto em audio.test)", () => {
    expect(one({ documentMessage: { mimetype: "application/pdf", fileName: "a.pdf" } }, { id: "D1" })).toMatchObject({ type: "document", mediaId: "D1", filename: "a.pdf" });
  });
  it("C1.4 figurinha, reação, imagem, vídeo, localização e desconhecido viram unsupported", () => {
    for (const m of [{ stickerMessage: {} }, { reactionMessage: { text: "👍" } }, { imageMessage: {} }, { videoMessage: {} }, { locationMessage: {} }, { holograma: {} }]) {
      expect(one(m)).toMatchObject({ type: "unsupported" });
    }
    expect(one({ holograma: {} })).toMatchObject({ rawType: "holograma" });
    expect(one({ stickerMessage: {} }, { messageType: "stickerMessage" })).toMatchObject({ rawType: "stickerMessage" });
  });
  it("C1.4 ignora o que não é conversa individual recebida: fromMe, grupo, status, outro evento", () => {
    expect(parse(upsert({ conversation: "x" }, { fromMe: true }))).toEqual([]);
    expect(parse(upsert({ conversation: "x" }, { jid: "120363@g.us" }))).toEqual([]);
    expect(parse(upsert({ conversation: "x" }, { jid: "status@broadcast" }))).toEqual([]);
    expect(parse({ ...upsert({ conversation: "x" }), event: "messages.update" })).toEqual([]);
    expect(parse({ ...upsert({ conversation: "x" }), event: "connection.update" })).toEqual([]);
  });
  it("C1.4 nome do evento tolerante: MESSAGES_UPSERT e messages-upsert", () => {
    expect(parse({ ...upsert({ conversation: "x" }), event: "MESSAGES_UPSERT" })).toHaveLength(1);
    expect(parse({ ...upsert({ conversation: "x" }), event: "messages-upsert" })).toHaveLength(1);
  });
  it("C1.4 @lid: usa o JID alternativo com número quando vem; senão o JID completo", () => {
    expect(one({ conversation: "x" }, { jid: "123456@lid", extraKey: { remoteJidAlt: `${PHONE}@s.whatsapp.net` } })).toMatchObject({ from: PHONE });
    expect(one({ conversation: "x" }, { jid: "123456@lid" })).toMatchObject({ from: "123456@lid" });
  });
  it("C1.4 data em lista (várias mensagens num webhook)", () => {
    const a = upsert({ conversation: "1" }, { id: "L1" });
    const b = upsert({ conversation: "2" }, { id: "L2" });
    expect(parse({ ...a, data: [a.data, b.data] }).map((e) => e.wamid)).toEqual(["L1", "L2"]);
  });
  it("C1.4 lixo não lança erro", () => {
    for (const p of [null, 1, "x", [], {}, { event: "messages.upsert" }, { event: "messages.upsert", data: [null, 1, {}, { key: {} }, { key: { id: "a" } }, { key: { id: "a", remoteJid: "1@s.whatsapp.net" }, message: "x" }] }]) {
      expect(parse(p)).toEqual([]);
    }
  });
  it("C1.4 webhook com vários eventos processa todos", async () => {
    const s = setup();
    for (const m of MULTI) await s.post(m);
    expect(s.handled.map((e) => e.type)).toEqual(["text", "audio", "unsupported"]);
  });
});

describe("texto numerado -> opção", () => {
  const OPTS = [{ id: "yes", title: "Sim" }, { id: "no", title: "Não" }];
  it("matchChoice: número, variações e título; fora da faixa ou texto livre = null", () => {
    for (const t of ["1", " 1 ", "1)", "1.", "opção 1", "Opcao 1", "sim", "SIM!", "Sim "]) expect(matchChoice(t, OPTS)?.id).toBe("yes");
    for (const t of ["2", "não", "Nao"]) expect(matchChoice(t, OPTS)?.id).toBe("no");
    for (const t of ["0", "3", "12", "1 2", "quero o 1 sim", "", "talvez"]) expect(matchChoice(t, OPTS)).toBeNull();
  });
  it("resposta '2' vira button_reply com o id; vale uma vez só", async () => {
    const s = setup();
    await s.repo.setPendingChoices(await hashWaId(PHONE), OPTS, new Date("2026-11-07T11:00:00Z"));
    await s.post(text("2", { id: "N1" }));
    expect(s.handled[0]).toMatchObject({ type: "button_reply", id: "no", title: "Não", wamid: "N1", from: PHONE });
    await s.post(text("2", { id: "N2" }));
    expect(s.handled[1]).toMatchObject({ type: "text", body: "2" });
  });
  it("sem opções pendentes, ou vencidas (12h), o número segue como texto", async () => {
    const s = setup();
    await s.post(text("1", { id: "N1" }));
    await s.repo.setPendingChoices(await hashWaId(PHONE), OPTS, new Date("2026-11-06T23:00:00Z")); // 13h antes
    await s.post(text("1", { id: "N2" }));
    expect(s.handled.map((e) => e.type)).toEqual(["text", "text"]);
  });
  it("falha ao ler as opções não derruba a mensagem: segue como texto", async () => {
    const s = setup();
    s.repo.getPendingChoices = async () => { throw new Error("db fora"); };
    await s.post(text("1"));
    expect(s.handled[0]).toMatchObject({ type: "text" });
  });
});

describe("erros e logs", () => {
  it("C1.5 exceção no processamento devolve 200 e loga erro; demais eventos seguem", async () => {
    let n = 0;
    const s = setup({ onEvent: async () => { if (n++ === 0) throw new Error("boom com 5511987651234"); } });
    const events = MULTI.flatMap((m) => parseWebhookPayload(m));
    const { processEvents } = await import("../src/webhook/handler");
    await processEvents(events, s.deps);
    expect(n).toBe(3);
    expect(s.logs.some((l) => JSON.parse(l).level === "error")).toBe(true);
    expect((await s.post(MULTI[0])).status).toBe(200);
  });
  it("C1.5 JSON inválido com token válido devolve 200", async () => {
    const s = setup();
    expect((await s.post("não é json")).status).toBe(200);
  });
  it("C1.5 falha do banco devolve 200 e loga erro", async () => {
    const repo = new MemoryRepo();
    repo.claimMessage = async () => { throw new Error("db fora"); };
    const s = setup({ repo });
    expect((await s.post(T1)).status).toBe(200);
    expect(s.logs.some((l) => JSON.parse(l).level === "error")).toBe(true);
  });
  it("C1.6 logs não contêm telefone em claro, texto da mensagem, nem a apikey do payload", async () => {
    const s = setup({ onEvent: async () => { throw new Error("falha"); } });
    await s.post(T1);
    for (const m of MULTI) await s.post(m);
    await s.post(T1, "token-errado");
    const all = s.logs.join("\n");
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain(PHONE);
    expect(all).not.toContain("Oi, tudo bem?");
    expect(all).not.toContain("Fulano");
    expect(all).not.toContain("NAO-DEVE-VAZAR");
    expect(all).toContain("5511*****1234");
  });
});

describe("last_user_message_at", () => {
  it("C1.7 atualizado a cada mensagem recebida", async () => {
    const s = setup();
    await s.post(T1);
    expect(await s.repo.getLastUserMessageAt(PHONE)).toEqual(new Date(1762500000 * 1000));
  });
  it("C1.7 mensagem mais nova avança o horário; mais antiga não regride", async () => {
    const repo = new MemoryRepo();
    await repo.touchUser("1", new Date("2026-01-02T00:00:00Z"));
    await repo.touchUser("1", new Date("2026-01-01T00:00:00Z"));
    expect(await repo.getLastUserMessageAt("1")).toEqual(new Date("2026-01-02T00:00:00Z"));
  });
  it("C1.7 timestamp futuro é limitado ao momento do recebimento", async () => {
    const s = setup();
    await s.post(text("x", { ts: Math.floor(Date.parse("2030-01-01") / 1000) }));
    expect(await s.repo.getLastUserMessageAt(PHONE)).toEqual(new Date("2026-11-07T12:00:00Z"));
  });
});

describe("pending_choices (Supabase e migração)", () => {
  it("SupabaseRepo grava (upsert) e apaga as opções; lê de volta (mock de fetch)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(init.method === "GET" || !init.method ? JSON.stringify([{ options: [{ id: "a", title: "A" }], created_at: "2026-11-12T10:00:00Z" }]) : "[]", { status: 200 });
    }) as unknown as typeof fetch;
    const repo = new SupabaseRepo("https://sb.test", "key", f);
    const at = new Date("2026-11-12T10:00:00Z");
    await repo.setPendingChoices("h", [{ id: "a", title: "A" }], at);
    expect(calls[0]!.url).toContain("/rest/v1/pending_choices?on_conflict=wa_id_hash");
    expect((calls[0]!.init.headers as Record<string, string>).Prefer).toContain("merge-duplicates");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ wa_id_hash: "h", options: [{ id: "a", title: "A" }] });
    expect(await repo.getPendingChoices("h")).toEqual({ options: [{ id: "a", title: "A" }], createdAt: at });
    await repo.setPendingChoices("h", null, at);
    expect(calls[2]!.init.method).toBe("DELETE");
  });
  it("SupabaseRepo lança em erro HTTP (o handler trata como texto comum)", async () => {
    const f = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await expect(new SupabaseRepo("https://sb.test", "k", f).getPendingChoices("h")).rejects.toThrow();
  });
  it("migração 0017 aplica no PGlite: uma linha por pessoa (upsert)", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(join(__dirname, "..", "supabase/migrations/0017_pending_choices.sql"), "utf8"));
    const up = "insert into pending_choices (wa_id_hash, options) values ('h', $1) on conflict (wa_id_hash) do update set options = excluded.options";
    await db.query(up, [JSON.stringify([{ id: "a", title: "A" }])]);
    await db.query(up, [JSON.stringify([{ id: "b", title: "B" }])]);
    const r = await db.query<{ n: number }>("select count(*)::int as n from pending_choices");
    expect(r.rows[0]!.n).toBe(1);
    await db.close();
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

