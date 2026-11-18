import { describe, it, expect } from "vitest";
import { handleChat, toUi } from "../src/sim/chat";
import { buildButtons, buildList, buildText } from "../src/whatsapp/builders";

const ENV = {
  EVOLUTION_URL: "https://evo.example.com", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "inst", EVOLUTION_WEBHOOK_TOKEN: "token-webhook-123456",
  SUPABASE_URL: "https://x.invalid", SUPABASE_SERVICE_KEY: "k", ADMIN_TOKEN: "adm",
  PRIVACY_POLICY_URL: "https://e.com/p", TERMS_VERSION: "1",
};
const bucket = {} as unknown as R2Bucket;
const call = (env: Record<string, unknown>, url: string, headers: Record<string, string> = {}) =>
  handleChat(new Request(url, { headers }), { env: { ...env, AUDIOS: bucket }, pageHtml: "<html>ok</html>" });

describe("chat simulador (canal alternativo)", () => {
  it("desligado por padrão: 404", async () => {
    expect((await call(ENV, "https://w.dev/chat?key=adm")).status).toBe(404);
  });
  it("ligado sem chave ou com chave errada: 401", async () => {
    const env = { ...ENV, CHAT_SIM_ENABLED: "true" };
    expect((await call(env, "https://w.dev/chat")).status).toBe(401);
    expect((await call(env, "https://w.dev/chat?key=errada")).status).toBe(401);
  });
  it("ligado com a chave certa serve a página", async () => {
    const res = await call({ ...ENV, CHAT_SIM_ENABLED: "true" }, "https://w.dev/chat?key=adm");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ok");
  });
  it("toUi converte texto, botões e lista do bot em elementos de tela", () => {
    expect(toUi(buildText("oi") as never)).toEqual({ body: "oi" });
    expect(toUi(buildButtons("pick", [{ id: "a", title: "A" }]) as never)).toEqual({ body: "pick", buttons: [{ id: "a", title: "A" }] });
    expect(toUi(buildList("menu", "Ver", "Sec", [{ id: "r1", title: "R1", description: "d" }]) as never))
      .toEqual({ body: "menu", list: { button: "Ver", rows: [{ id: "r1", title: "R1", description: "d" }] } });
  });
});

describe("reinício do usuário de teste", () => {
  const mk = (registered: boolean) => {
    const calls: string[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${u.split("/rest/v1/")[1]}`);
      const body = u.includes("select=registered_at") ? JSON.stringify([{ registered_at: registered ? "2026-01-01" : null, version: 3 }]) : "[]";
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const deleted: string[][] = [];
    const bucket = { list: async () => ({ objects: [{ key: "audios/h/a.ogg" }] }), delete: async (k: string[]) => void deleted.push(k) } as unknown as R2Bucket;
    return { calls, f, bucket, deleted };
  };

  it("primeiro contato apaga áudios, envios, usuário e arquivos do R2 só do telefone de teste", async () => {
    const m = mk(false);
    const { resetTestUser, CHAT_PHONE } = await import("../src/sim/chat");
    expect(await resetTestUser("first_contact", "https://x.invalid", "k", m.bucket, m.f)).toEqual({ ok: true });
    expect(m.calls.map((c) => c.split("?")[0])).toEqual(["DELETE audios", "DELETE doubts", "DELETE doubt_materials", "DELETE outbound_log", "DELETE users"]);
    expect(m.calls[4]).toContain(CHAT_PHONE);
    expect(m.deleted).toEqual([["audios/h/a.ogg"], ["audios/h/a.ogg"], ["audios/h/a.ogg"]]); // áudios de informações, de mentorias e materiais (o mock lista o mesmo arquivo em todos os prefixos)
  });

  it("já cadastrado: limpa envios e volta ao menu, mantendo o cadastro", async () => {
    const m = mk(true);
    const { resetTestUser } = await import("../src/sim/chat");
    expect(await resetTestUser("returning", "https://x.invalid", "k", m.bucket, m.f)).toEqual({ ok: true });
    expect(m.calls.map((c) => c.split("?")[0])).toEqual(["GET users", "DELETE outbound_log", "PATCH users"]);
    expect(m.deleted).toEqual([]);
  });

  it("já cadastrado sem cadastro concluído: recusa sem apagar nada", async () => {
    const m = mk(false);
    const { resetTestUser } = await import("../src/sim/chat");
    const r = await resetTestUser("returning", "https://x.invalid", "k", m.bucket, m.f);
    expect(r.ok).toBe(false);
    expect(m.calls).toHaveLength(1);
  });
});

describe("modo admin (assumir o lugar do bot)", () => {
  const env = { ...ENV, CHAT_SIM_ENABLED: "true" };
  const mkBucket = (seed: Record<string, string> = {}) => {
    const store = new Map(Object.entries(seed));
    const b = {
      get: async (k: string) => (store.has(k) ? { text: async () => store.get(k) as string } : null),
      put: async (k: string, v: string) => void store.set(k, String(v)),
      delete: async (k: string) => void store.delete(k),
    } as unknown as R2Bucket;
    return { b, store };
  };
  const req = (b: R2Bucket, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    handleChat(new Request(`https://w.dev${path}?key=adm`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), { env: { ...env, AUDIOS: b }, pageHtml: "x" });
  const hist = (items: unknown[]) => ({ "chat-sim/history.json": JSON.stringify(items) });
  const login = async (b: R2Bucket) => ((await (await req(b, "POST", "/chat/api/login", { user: "Be My Mentor", pass: "Be My Mentor 321" })).json()) as { token: string }).token;

  it("login: só aceita o usuário e a senha combinados", async () => {
    const { b } = mkBucket();
    expect((await req(b, "POST", "/chat/api/login", { user: "Be My Mentor", pass: "errada" })).status).toBe(401);
    expect((await req(b, "POST", "/chat/api/login", { user: "x", pass: "Be My Mentor 321" })).status).toBe(401);
    expect((await req(b, "POST", "/chat/api/login", { user: "Be My Mentor", pass: "Be My Mentor 321" })).status).toBe(200);
  });

  it("admin responde: a mensagem entra no histórico como atendimento, sem apagar nada do bot", async () => {
    const bot = { id: "o1", dir: "out", at: new Date().toISOString(), kind: "text", ui: { body: "bot" } };
    const { b, store } = mkBucket(hist([bot]));
    expect((await req(b, "POST", "/chat/api/admin/reply", { text: "x" })).status).toBe(401);
    const h = { "X-Chat-Admin": await login(b) };
    expect((await req(b, "POST", "/chat/api/admin/reply", { text: "  " }, h)).status).toBe(400);
    await req(b, "POST", "/chat/api/admin/reply", { text: "resposta do admin" }, h);
    const items = JSON.parse(store.get("chat-sim/history.json") as string) as { id: string; text?: string; by?: string }[];
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("o1");
    expect(items[1]).toMatchObject({ text: "resposta do admin", by: "admin" });
  });

  it("liga/desliga o bot: exige login, valida o campo e grava o marcador", async () => {
    const { b, store } = mkBucket();
    expect((await req(b, "POST", "/chat/api/admin/bot", { on: false })).status).toBe(401);
    const h = { "X-Chat-Admin": await login(b) };
    expect((await req(b, "POST", "/chat/api/admin/bot", { on: "sim" }, h)).status).toBe(400);
    const off = (await (await req(b, "POST", "/chat/api/admin/bot", { on: false }, h)).json()) as { botOn: boolean };
    expect(off.botOn).toBe(false);
    expect(store.has("chat-sim/bot-off.json")).toBe(true);
    const st = (await (await req(b, "GET", "/chat/api/history", undefined, h)).json()) as { botOn: boolean };
    expect(st.botOn).toBe(false);
  });

  it("bot desligado: a mensagem da pessoa só vai para o histórico (nada é processado)", async () => {
    const { b, store } = mkBucket({ "chat-sim/bot-off.json": "{}", "chat-sim/admin-presence.json": JSON.stringify({ at: Date.now() }) });
    const res = await req(b, "POST", "/chat/api/send", { kind: "text", text: "oi" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { dir: string; text?: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ dir: "in", text: "oi" });
    expect((JSON.parse(store.get("chat-sim/history.json") as string) as unknown[]).length).toBe(1);
  });

  it("devolver ao bot: cadastrado volta ao estado concluído e a dica é zerada", async () => {
    const calls: { method: string; body?: string }[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", ...(init?.body ? { body: String(init.body) } : {}) });
      return new Response(init?.method === "PATCH" ? "" : JSON.stringify([{ state: "DOUBT_TEXT", registered_at: "2026-01-01", version: 7 }]), { status: 200 });
    }) as unknown as typeof fetch;
    const { handBackToBot } = await import("../src/sim/chat");
    expect(await handBackToBot("https://x.invalid", "k", f)).toEqual({ ok: true });
    expect(JSON.parse(calls[1]?.body as string)).toMatchObject({ hint_sent_in_state: false, state: "COMPLETED", version: 8 });
  });

  it("devolver ao bot: quem ainda está no cadastro continua no mesmo passo (só zera a dica)", async () => {
    const calls: { body?: string }[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      calls.push({ ...(init?.body ? { body: String(init.body) } : {}) });
      return new Response(init?.method === "PATCH" ? "" : JSON.stringify([{ state: "REG_FIELD_full_name", registered_at: null, version: 2 }]), { status: 200 });
    }) as unknown as typeof fetch;
    const { handBackToBot } = await import("../src/sim/chat");
    await handBackToBot("https://x.invalid", "k", f);
    const patch = JSON.parse(calls[1]?.body as string) as Record<string, unknown>;
    expect(patch).toMatchObject({ hint_sent_in_state: false });
    expect(patch).not.toHaveProperty("state");
  });

});

describe("contexto recente para a IA", () => {
  it("pega só as últimas 6 mensagens de texto, curtas, ignora áudio", async () => {
    const { recentLines } = await import("../src/sim/chat");
    const mk = (n: number, dir: "in" | "out", extra: Record<string, unknown> = {}) => ({ id: String(n), dir, at: "t", kind: "text" as const, text: `m${n}`, ...extra });
    const items = [mk(1, "in"), mk(2, "out"), mk(3, "in"), mk(4, "out", { text: undefined, ui: { body: "bot ".repeat(100) } }), mk(5, "in"), mk(6, "out", { by: "admin" }), mk(7, "in"), { id: "a", dir: "in" as const, at: "t", kind: "audio" as const }];
    const lines = recentLines(items as never);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("atendimento: m2");
    expect(lines.at(-1)).toBe("pessoa: m7");
    expect(lines.every((l) => l.length <= 215)).toBe(true);
  });
});

describe("certificado da mentoria (JSON rastreável)", () => {
  const row = {
    id: "11111111-1111-1111-1111-111111111111", waIdHash: "h1", role: "mentorado" as const, subject: "cálculo", partner: "Maria Mentora",
    mime: "audio/ogg", bytes: 1234, r2Key: "k", createdAt: new Date("2026-11-10T15:30:00Z"), analysisResult: null, analysisAt: null,
  };
  const f = (async (u: string) => {
    const body = u.includes("/users?") ? [{ full_name: "João Aluno", email: "j@x.com", class_name: "T12" }] : [{ text: "não entendo limites e derivadas" }];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const agent = { classify: async () => null, summarizeSubject: async () => "Limites e derivadas em Cálculo" };

  it("tem mentor, mentorado, data, assunto interpretado pela IA, áudio e hash de integridade", async () => {
    const { buildCertificate, certificateHash } = await import("../src/sim/certificate");
    const c = await buildCertificate(row, { supabaseUrl: "https://x.invalid", serviceKey: "k", agent, fetchImpl: f, now: () => new Date("2026-11-10T16:00:00Z") });
    expect(c.mentorado).toMatchObject({ name: "João Aluno", email: "j@x.com", class_name: "T12", source: "cadastro" });
    expect(c.mentor).toMatchObject({ name: "Maria Mentora", source: "informado_na_conversa" });
    expect(c.mentoria).toMatchObject({ occurred_at: "2026-11-10T15:30:00.000Z", doubt: "não entendo limites e derivadas", subject: { title: "Limites e derivadas em Cálculo", source: "ia" } });
    expect(c.audio).toEqual({ id: row.id, mime: "audio/ogg", bytes: 1234 });
    const { integrity, ...body } = c;
    expect(integrity.hash).toBe(await certificateHash(body));
    expect(JSON.stringify(c)).not.toMatch(/phone|telefone|wa_id/i); // nenhum telefone nem hash dele
  });

  it("sem IA ou se ela falhar: usa o assunto informado e marca a origem", async () => {
    const { buildCertificate } = await import("../src/sim/certificate");
    const c = await buildCertificate(row, { supabaseUrl: "https://x.invalid", serviceKey: "k", fetchImpl: f });
    expect(c.mentoria.subject).toEqual({ title: "cálculo", source: "informado_pela_pessoa" });
  });

  it("papel desconhecido: os dois ficam em participants", async () => {
    const { buildCertificate } = await import("../src/sim/certificate");
    const c = await buildCertificate({ ...row, role: null }, { supabaseUrl: "https://x.invalid", serviceKey: "k", fetchImpl: f });
    expect(c.mentor).toBeNull();
    expect(c.participants).toHaveLength(2);
  });

  it("endpoint de mentorias exige login de admin", async () => {
    const e = { ...ENV, CHAT_SIM_ENABLED: "true", AUDIOS: {} as R2Bucket };
    const r = await handleChat(new Request("https://w.dev/chat/api/admin/mentorias?key=adm"), { env: e, pageHtml: "x" });
    expect(r.status).toBe(401);
  });
});

describe("a mensagem de quem envia aparece na hora", () => {
  it("a página desenha a mensagem local antes da resposta do servidor (texto, botão/lista, áudio, documento e admin)", async () => {
    const { PAGE_HTML } = await import("../src/sim/page");
    // o desenho local acontece dentro de run(), antes de esperar a promessa do servidor
    expect(PAGE_HTML).toMatch(/function run\(promise, local\)[\s\S]*?if\(local\)\{ bubble\(local\)[\s\S]*?promise\(\)\.then/);
    expect(PAGE_HTML).toMatch(/var shown = input\.kind === "text" \? mine\("text", input\.text\) : mine\("reply"/);
    expect(PAGE_HTML).toMatch(/mine\("audio", "", \{localUrl: URL\.createObjectURL\(blob\)\}\)/);
    expect(PAGE_HTML).toMatch(/aparece na hora/);
  });
});
