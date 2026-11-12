import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { MemoryRepo } from "../src/db/memory-repo";
import { SupabaseRepo } from "../src/db/supabase-repo";
import { handleIncomingMessage } from "../src/conversation/engine";
import { buildButtons, buildList, buildText, MessageLimitError } from "../src/whatsapp/builders";
import { fallbackContent, makeContent, type Service } from "../src/services/content";
import { ContentProvider } from "../src/services/provider";
import { menuReply } from "../src/services/menu";
import type { Logger } from "../src/lib/logger";
import { processEvents } from "../src/webhook/handler";
import { sendGuarded } from "../src/whatsapp/client";
import type { IncomingMessage, WebhookEvent } from "../src/whatsapp/types";
import { asTransport } from "./helpers/transport";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
let seq = 0;
const text = (body: string): IncomingMessage => ({ type: "text", wamid: `s${++seq}`, from: WA, body });
const list = (id: string): IncomingMessage => ({ type: "list_reply", wamid: `s${++seq}`, from: WA, id, title: "x" });
const button = (id: string): IncomingMessage => ({ type: "button_reply", wamid: `s${++seq}`, from: WA, id, title: "x" });
const audio = (): IncomingMessage => ({ type: "audio", wamid: `s${++seq}`, from: WA, mediaId: "m", voice: true });

const svc = (i: number, extra: Partial<Service> = {}): Service => ({
  id: `s${i}`, title: `Serviço ${i}`, description: `Descrição ${i}`, requiresAudio: false, sortOrder: i, ...extra,
});

function setup(opts: { services?: Service[]; now?: Date } = {}) {
  const logs: { level: string; event: string }[] = [];
  const logger: Logger = { log: (level, event) => void logs.push({ level, event }) };
  const repo = new MemoryRepo();
  repo.services = opts.services ?? [svc(1, { id: "audio", requiresAudio: true }), svc(2, { id: "horarios" }), svc(3, { id: "contato" })];
  let now = opts.now ?? NOW;
  const graph = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `o${++seq}` }] }), { status: 200 }));
  const provider = new ContentProvider(repo, logger, 60_000, () => now.getTime());
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, {
      repo, logger, phoneNumberId: "PN", evolutionUrl: "https://evo.test", evolutionApiKey: "k", evolutionInstance: "inst", stopAt: 950,
      timezone: "America/Sao_Paulo", transport: asTransport(graph as never), now: () => now,
    });
  const deps = { repo, logger, send, maxPerDay: 50, maxPer10Min: 50, now: () => now, content: provider };
  const feed = async (ev: IncomingMessage) => {
    await processEvents([ev], {
      webhookToken: "", repo, logger, now: () => now,
      onEvent: async (e: WebhookEvent) => { await handleIncomingMessage(e, deps); },
    });
  };
  const sent = () => graph.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
  const toMenu = async () => {
    await repo.touchUser(WA, now);
    repo.conversations.set(WA, { state: "MENU", previousState: null, hintSentInState: false, optedOutAt: null, version: 1 });
  };
  return { repo, graph, feed, sent, logs, toMenu, setNow: (d: Date) => { now = d; } };
}

describe("C5.1 menu com no máximo 10 serviços", () => {
  it("C5.1 com 12 ativos mostra os 10 primeiros por sort_order e registra warn", async () => {
    const many = Array.from({ length: 12 }, (_, i) => svc(i + 1, { sortOrder: 120 - i * 10 })); // ordem invertida
    const s = setup({ services: many });
    await s.toMenu();
    await s.feed(text("menu"));
    const rows = s.sent()[0].interactive.action.sections[0].rows as { id: string }[];
    expect(rows).toHaveLength(10);
    expect(rows[0]!.id).toBe("svc_s12"); // menor sort_order primeiro
    expect(rows.map((r) => r.id)).not.toContain("svc_s1");
    expect(s.logs).toContainEqual({ level: "warn", event: "menu_truncated" });
  });
  it("C5.1 com até 10 serviços não há warn", async () => {
    const s = setup();
    await s.toMenu();
    await s.feed(text("menu"));
    expect(s.logs.filter((l) => l.level === "warn")).toEqual([]);
    expect(s.sent()[0].interactive.type).toBe("list");
  });
});

describe("C5.2 construtores validam limites da Meta", () => {
  const ok = { id: "a", title: "t" };
  it("C5.2 linha de lista: título > 24 e descrição > 72 recusados; limites exatos aceitos", () => {
    expect(() => buildList("c", "Ver", "Sec", [{ ...ok, title: "x".repeat(25) }])).toThrow(MessageLimitError);
    expect(() => buildList("c", "Ver", "Sec", [{ ...ok, description: "x".repeat(73) }])).toThrow(MessageLimitError);
    expect(() => buildList("c", "Ver", "Sec", [{ ...ok, title: "x".repeat(24), description: "x".repeat(72) }])).not.toThrow();
  });
  it("C5.2 lista: mais de 10 linhas, vazia ou corpo > 1024 recusados", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, title: "t" }));
    expect(() => buildList("c", "Ver", "Sec", rows(11))).toThrow(MessageLimitError);
    expect(() => buildList("c", "Ver", "Sec", rows(10))).not.toThrow();
    expect(() => buildList("c", "Ver", "Sec", [])).toThrow(MessageLimitError);
    expect(() => buildList("x".repeat(1025), "Ver", "Sec", rows(1))).toThrow(MessageLimitError);
  });
  it("C5.2 botões: título > 20, mais de 3 botões e corpo > 1024 recusados", () => {
    expect(() => buildButtons("c", [{ id: "a", title: "x".repeat(21) }])).toThrow(MessageLimitError);
    expect(() => buildButtons("c", [{ id: "a", title: "x".repeat(20) }])).not.toThrow();
    const b = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, title: "t" }));
    expect(() => buildButtons("c", b(4))).toThrow(MessageLimitError);
    expect(() => buildButtons("c", b(3))).not.toThrow();
    expect(() => buildButtons("x".repeat(1025), b(1))).toThrow(MessageLimitError);
  });
  it("C5.2 texto: corpo > 1024 recusado", () => {
    expect(() => buildText("x".repeat(1025))).toThrow(MessageLimitError);
    expect(buildText("x".repeat(1024)).text.body).toHaveLength(1024);
  });
  it("C5.2 serviço do banco com título > 24 é ignorado (menu não quebra)", async () => {
    const s = setup({ services: [svc(1, { title: "x".repeat(30) }), svc(2)] });
    await s.toMenu();
    await s.feed(text("menu"));
    const rows = s.sent()[0].interactive.action.sections[0].rows as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["svc_s2"]);
  });
});

describe("C5.3 escolha na lista", () => {
  const services = [
    svc(1, { id: "audio", requiresAudio: true }),
    svc(2, { id: "faq" }),
  ];
  it("C5.3 serviço com áudio: 1 mensagem de instrução e vai a AWAIT_AUDIO", async () => {
    const s = setup({ services });
    await s.toMenu();
    await s.feed(list("svc_audio"));
    expect(s.graph).toHaveBeenCalledTimes(1);
    expect(s.sent()[0].text.body).toMatch(/áudio/);
    expect((await s.repo.getConversation(WA)).state).toBe("AWAIT_AUDIO");
  });
  it("C5.3 serviço sem áudio: 1 mensagem com botão Menu (texto do banco) e continua em MENU", async () => {
    const s = setup({ services });
    s.repo.canned.set("service_faq", "Atendemos 9h às 18h.");
    await s.toMenu();
    await s.feed(list("svc_faq"));
    expect(s.graph).toHaveBeenCalledTimes(1);
    const m = s.sent()[0];
    expect(m.interactive.body.text).toBe("Atendemos 9h às 18h.");
    expect(m.interactive.action.buttons[0].reply.id).toBe("menu");
    expect((await s.repo.getConversation(WA)).state).toBe("MENU");
    // botão Menu => menu de novo (1 mensagem)
    await s.feed(button("menu"));
    expect(s.graph).toHaveBeenCalledTimes(2);
    expect(s.sent()[1].interactive.type).toBe("list");
  });
  it("C5.3 escolha repetida do serviço com áudio e escolhas inválidas/inativas => silêncio", async () => {
    const s = setup({ services });
    await s.toMenu();
    await s.feed(list("svc_audio"));
    await s.feed(list("svc_audio")); // repetida (já em AWAIT_AUDIO)
    expect(s.graph).toHaveBeenCalledTimes(1);
    const t = setup({ services });
    await t.toMenu();
    for (const id of ["svc_inexistente", "xyz", "svc_", "audio"]) await t.feed(list(id));
    expect(t.graph).not.toHaveBeenCalled();
    expect((await t.repo.getConversation(WA)).state).toBe("MENU");
  });
  it("C5.3 escolha repetida de serviço SEM áudio => silêncio; outro serviço ou menu reaberto volta a responder", async () => {
    const s = setup({ services: [svc(1, { id: "faq" }), svc(2, { id: "contato" })] });
    await s.toMenu();
    for (let i = 0; i < 4; i++) await s.feed(list("svc_faq"));
    expect(s.graph).toHaveBeenCalledTimes(1); // só a primeira
    await s.feed(list("svc_contato")); // outro serviço: responde
    expect(s.graph).toHaveBeenCalledTimes(2);
    await s.feed(list("svc_contato")); // repetido: silêncio
    expect(s.graph).toHaveBeenCalledTimes(2);
    await s.feed(button("menu")); // menu reaberto: zera a marca
    expect(s.graph).toHaveBeenCalledTimes(3);
    await s.feed(list("svc_contato")); // nova rodada: responde
    expect(s.graph).toHaveBeenCalledTimes(4);
    expect((await s.repo.getConversation(WA)).lastServiceId).toBe("contato");
  });
  it("C5.3 wamid repetido da mesma escolha é ignorado (idempotência)", async () => {
    const s = setup({ services });
    await s.toMenu();
    const ev = list("svc_faq");
    await s.feed(ev);
    await s.feed(ev);
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
  it("C5.3 texto solto no menu: 1 dica e depois silêncio; figurinha = silêncio", async () => {
    const s = setup({ services });
    await s.toMenu();
    await s.feed(text("blablabla"));
    await s.feed(text("blablabla2"));
    await s.feed({ type: "unsupported", wamid: `s${++seq}`, from: WA, rawType: "sticker" });
    expect(s.graph).toHaveBeenCalledTimes(2); // dica + aviso; figurinha segue em silêncio
  });
  it("C5.3 áudio escolhido: texto 'menu' em AWAIT_AUDIO volta ao menu (lista, 1 mensagem)", async () => {
    const s = setup({ services });
    await s.toMenu();
    await s.feed(list("svc_audio"));
    await s.feed(text("menu"));
    expect(s.graph).toHaveBeenCalledTimes(2);
    expect(s.sent()[1].interactive.type).toBe("list");
    await s.feed(audio()); // em MENU, áudio é inesperado => silêncio
    expect(s.graph).toHaveBeenCalledTimes(2);
  });
});

describe("C5.4 pessoa cadastrada voltando", () => {
  it("C5.4 'oi' no dia seguinte (estado MENU) => menu em 1 mensagem", async () => {
    const s = setup();
    await s.toMenu();
    s.setNow(new Date(NOW.getTime() + 24 * 3600_000));
    await s.feed(text("oi"));
    expect(s.graph).toHaveBeenCalledTimes(1);
    expect(s.sent()[0].interactive.type).toBe("list");
    expect(s.sent()[0].interactive.body.text).toMatch(/de novo/);
    expect((await s.repo.getConversation(WA)).state).toBe("MENU");
  });
  it("C5.4 'oi' no dia seguinte (estado AWAIT_AUDIO) => menu e volta a MENU", async () => {
    const s = setup();
    await s.toMenu();
    s.repo.conversations.set(WA, { state: "AWAIT_AUDIO", previousState: null, hintSentInState: true, optedOutAt: null, version: 2 });
    s.setNow(new Date(NOW.getTime() + 24 * 3600_000));
    await s.feed(text("oiii"));
    expect(s.graph).toHaveBeenCalledTimes(1);
    expect((await s.repo.getConversation(WA)).state).toBe("MENU");
  });
  it("C5.4 repetir 'oi' logo em seguida não gera outro menu", async () => {
    const s = setup();
    await s.toMenu();
    s.setNow(new Date(NOW.getTime() + 24 * 3600_000));
    await s.feed(text("oi"));
    await s.feed(text("oi"));
    await s.feed(text("oi"));
    expect(s.sent().filter((m) => m.interactive?.type === "list")).toHaveLength(1);
    expect(s.graph.mock.calls.length).toBeLessThanOrEqual(2); // menu + no máximo 1 dica
  });
  it("C5.4 'oi' logo depois do menu (sessão ativa) não reenvia o menu", async () => {
    const s = setup();
    await s.toMenu();
    await s.feed(text("menu")); // bot enviou agora
    await s.feed(text("oi"));
    expect(s.sent().filter((m) => m.interactive?.type === "list")).toHaveLength(1);
  });
});

describe("C5.5 fallback de textos e cache", () => {
  it("C5.5 chave ausente em canned_responses usa o fallback do código", async () => {
    const s = setup();
    await s.toMenu();
    await s.feed(text("blabla")); // dica do menu
    expect(s.sent()[0].text.body).toMatch(/Escolha um serviço/);
  });
  it("C5.5 texto do banco substitui o fallback; vazio ou grande demais é ignorado", async () => {
    const c = makeContent([], { a: "do banco", b: "  ", c: "x".repeat(2000) });
    expect(c.text("a", "fb")).toBe("do banco");
    expect(c.text("b", "fb")).toBe("fb");
    expect(c.text("c", "fb")).toBe("fb");
    expect(c.text("zzz", "fb")).toBe("fb");
    expect(c.text("toString", "fb")).toBe("fb");
    expect(fallbackContent.text("nada", "fb")).toBe("fb");
  });
  it("C5.5 canned_responses sobrescreve a dica do menu", async () => {
    const s = setup();
    s.repo.canned.set("hintMenu", "Toque em uma opção!");
    await s.toMenu();
    await s.feed(text("blabla"));
    expect(s.sent()[0].text.body).toBe("Toque em uma opção!");
  });
  it("C5.5 banco de conteúdo fora: usa o código, não quebra e responde", async () => {
    const s = setup();
    s.repo.listActiveServices = async () => { throw new Error("db fora"); };
    await s.toMenu();
    await s.feed(text("menu"));
    expect(s.graph).toHaveBeenCalledTimes(1);
    expect(s.sent()[0].interactive.action.sections[0].rows).toHaveLength(3); // DEFAULT_SERVICES
    expect(s.logs).toContainEqual({ level: "warn", event: "content_load_failed" });
  });
  it("C5.5 cache com TTL: 1 consulta por janela, nova consulta depois do TTL", async () => {
    const repo = new MemoryRepo();
    repo.services = [svc(1)];
    const spy = vi.spyOn(repo, "listActiveServices");
    let t = 1_000_000;
    const p = new ContentProvider(repo, { log: () => undefined }, 60_000, () => t);
    await p.load(); await p.load(); await p.load();
    expect(spy).toHaveBeenCalledTimes(1);
    repo.services = [svc(1), svc(2)];
    t += 59_000;
    expect((await p.load()).services).toHaveLength(1);
    t += 2_000;
    expect((await p.load()).services).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("C5.5 menu vazio no banco usa os serviços do código", async () => {
    const repo = new MemoryRepo();
    const p = new ContentProvider(repo, { log: () => undefined });
    const c = await p.load();
    expect(c.services.length).toBeGreaterThanOrEqual(1);
    expect(() => menuReply(c)).not.toThrow();
  });
});

describe("C5 banco: migração 0005 e SupabaseRepo", () => {
  const dir = join(__dirname, "..", "supabase", "migrations");
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  }, 60_000);
  it("C5.5 seeds: 3 serviços ativos (mentoria, horários e contato; Análise de áudio desativada na 0011); RLS ligado", async () => {
    const r = await db.query<{ requires_audio: boolean }>("select requires_audio from services where active order by sort_order");
    expect(r.rows).toHaveLength(3);
    expect(r.rows.some((x) => x.requires_audio)).toBe(true);
    expect(r.rows.some((x) => !x.requires_audio)).toBe(true);
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname in ('services','canned_responses')");
    expect(rls.rows.every((x) => x.relrowsecurity)).toBe(true);
  });
  it("C5.2 o banco recusa título > 24, descrição > 72 e texto > 1024", async () => {
    await expect(db.query("insert into services (id, title) values ('x1', $1)", ["x".repeat(25)])).rejects.toThrow();
    await expect(db.query("insert into services (id, title, description) values ('x2', 't', $1)", ["x".repeat(73)])).rejects.toThrow();
    await expect(db.query("insert into canned_responses (key, text) values ('k', $1)", ["x".repeat(1025)])).rejects.toThrow();
  });
  it("C5 reaplicar a migração 0005 é inofensivo (seeds idempotentes)", async () => {
    await db.exec(readFileSync(join(dir, "0005_services.sql"), "utf8"));
    const r = await db.query<{ n: number }>("select count(*)::int as n from services");
    expect(r.rows[0]!.n).toBe(4);
  });
  it("C5 SupabaseRepo lê serviços ativos e respostas prontas pela REST (mock)", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      const body = url.includes("/services")
        ? [{ id: "a", title: "A", description: null, requires_audio: true, sort_order: 1 }]
        : [{ key: "k", text: "v" }];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const repo = new SupabaseRepo("https://x.supabase.co", "key", f);
    expect(await repo.listActiveServices()).toEqual([{ id: "a", title: "A", description: "", requiresAudio: true, sortOrder: 1 }]);
    expect(await repo.listCannedResponses()).toEqual({ k: "v" });
    expect(calls[0]).toContain("active=eq.true");
    const bad = new SupabaseRepo("https://x.supabase.co", "key", (async () => new Response("", { status: 500 })) as unknown as typeof fetch);
    await expect(bad.listActiveServices()).rejects.toThrow();
  });
});
