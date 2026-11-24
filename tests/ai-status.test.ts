import { describe, expect, it } from "vitest";
import { GrokIntentAgent } from "../src/ai/grok";
import { checkAllAi, checkAiStatus } from "../src/ai/status";
import { handlePanel } from "../src/mentoria/panel";
import { MemoryRepo } from "../src/db/memory-repo";
import { dashboardPage } from "../src/mentoria/panel-page";

const cfg = { aiApiKey: "gsk_SEGREDO123", aiModel: "openai/gpt-oss-120b", aiBaseUrl: "https://api.groq.com/openai/v1" };
const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

describe("estado da chave de IA (Groq)", () => {
  it("200: funcionando, com os limites que o provedor informou", async () => {
    const s = await checkAiStatus(cfg, reply(200, {}, { "x-ratelimit-remaining-requests": "950", "x-ratelimit-limit-requests": "1000", "x-ratelimit-remaining-tokens": "7000" }));
    expect(s.state).toBe("ok");
    expect(s.limits).toMatchObject({ requestsRemaining: 950, requestsLimit: 1000, tokensRemaining: 7000 });
    expect(s.message).toMatch(/NÃO estourou/);
  });

  it("429: limite estourado, diz qual (tokens por dia) e quando volta, sem vazar o id da organização", async () => {
    const msg = "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01abcSECRETO` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199990, Requested 50. Please try again in 6m12s.";
    const s = await checkAiStatus(cfg, reply(429, { error: { message: msg } }));
    expect(s.state).toBe("limit");
    expect(s.limitKind).toBe("tokens por dia");
    expect(s.retryAfter).toBe("6m12s");
    expect(JSON.stringify(s)).not.toMatch(/org_|SECRETO/);
  });

  it("401/403 chave inválida; 404 modelo; 500 fora do ar; rede/timeout fora do ar; sem chave", async () => {
    expect((await checkAiStatus(cfg, reply(401))).state).toBe("invalid_key");
    expect((await checkAiStatus(cfg, reply(403))).state).toBe("invalid_key");
    expect((await checkAiStatus(cfg, reply(404))).state).toBe("bad_model");
    expect((await checkAiStatus(cfg, reply(503))).state).toBe("down");
    expect((await checkAiStatus(cfg, (async () => { throw new Error("rede"); }) as unknown as typeof fetch)).state).toBe("down");
    expect((await checkAiStatus({ ...cfg, aiApiKey: undefined })).state).toBe("no_key");
  });

  it("nunca devolve a chave", async () => {
    for (const st of [200, 401, 429, 500]) expect(JSON.stringify(await checkAiStatus(cfg, reply(st, { error: { message: "gsk_SEGREDO123" } })))).not.toMatch(/gsk_/);
  });
});

describe("Gemini", () => {
  const g = { aiApiKey: "AIzaSEGREDO", aiModel: "gemini-flash-latest", aiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" };
  it("identifica o provedor e traduz 429 sem os cabeçalhos do Groq", async () => {
    const s = await checkAiStatus(g, reply(429, { error: { message: "Quota exceeded for metric" } }, { "retry-after": "30" }));
    expect(s).toMatchObject({ state: "limit", provider: "Google Gemini", retryAfter: "30" });
    expect(JSON.stringify(s)).not.toMatch(/AIza/);
  });
  it("404 (modelo aposentado): lista os modelos que a chave enxerga, com os Flash primeiro", async () => {
    const f = (async (u: string) => u.endsWith("/models")
      ? new Response(JSON.stringify({ data: [{ id: "models/gemini-embedding-001" }, { id: "models/gemini-pro-latest" }, { id: "models/gemini-3.8-flash" }, { id: "models/gemini-flash-latest" }] }), { status: 200 })
      : new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const s = await checkAiStatus(g, f);
    expect(s.state).toBe("bad_model");
    expect(s.message).toContain("gemini-3.8-flash, gemini-flash-latest, gemini-pro-latest");
    expect(s.message).not.toMatch(/embedding/);
  });
  it("falha de rede ou tempo esgotado diz qual foi; o probe usa o mesmo pedido do bot (sem raciocínio)", async () => {
    const abort = (async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }) as unknown as typeof fetch;
    expect((await checkAiStatus(g, abort)).message).toMatch(/sem resposta em 20 s/);
    const net = (async () => { throw new TypeError("fetch failed AQ.segredo123"); }) as unknown as typeof fetch;
    const m = (await checkAiStatus(g, net)).message;
    expect(m).toMatch(/erro de rede \(TypeError/);
    expect(m).not.toMatch(/segredo123/);
    const bodies: Record<string, unknown>[] = [];
    const spy = (async (_u: string, i: RequestInit) => { bodies.push(JSON.parse(i.body as string)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await checkAiStatus(g, spy);
    expect(bodies[0]).toHaveProperty("reasoning_effort", "none");
  });
  it("o agente pede sem raciocínio no Flash e repete sem o parâmetro se o provedor recusar (400)", async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return bodies.length === 1 ? new Response("{}", { status: 400 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"a","confianca":0.9}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const agent = new GrokIntentAgent({ apiKey: "AIzaX", model: g.aiModel, baseUrl: g.aiBaseUrl, fetchImpl: f });
    expect(await agent.classify({ question: "q", options: [{ intent: "a", description: "d" }], text: "oi tudo" })).toBe("a");
    expect(bodies[0]).toHaveProperty("reasoning_effort", "none");
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });
});

describe("visão geral: Groq e Gemini lado a lado", () => {
  const groq = { aiApiKey: "gsk_ATIVA", aiModel: "openai/gpt-oss-120b", aiBaseUrl: "https://api.groq.com/openai/v1" };
  const gemini = { aiApiKey: "AIzaATIVA", aiModel: "gemini-flash-latest", aiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" };
  // Responde 200 para uma chave e 429 para a outra, para provar que cada linha usa a chave certa.
  const byKey = ((_u: string, init: RequestInit) => {
    const auth = String((init.headers as Record<string, string>).Authorization);
    return Promise.resolve(new Response("{}", { status: auth.includes("OUTRA") ? 429 : 200 }));
  }) as unknown as typeof fetch;

  it("sempre mostra Groq e Gemini; marca o que o bot usa; a outra usa a chave opcional do segredo", async () => {
    const o = await checkAllAi(gemini, { GROQ_API_KEY: "gsk_OUTRA" }, byKey);
    expect(o.items.map((i) => [i.id, i.active, i.state])).toEqual([["groq", false, "limit"], ["gemini", true, "ok"]]);
  });

  it("chave nova do Google (AQ.) vale como chave do Gemini no segredo opcional", async () => {
    const o = await checkAllAi(groq, { GEMINI_API_KEY: "AQ.Ab8RN6" }, byKey);
    expect(o.items[1]).toMatchObject({ id: "gemini", state: "ok" });
  });

  it("sem chave da outra: linha 'sem chave' (não é erro) dizendo qual segredo definir; nunca vaza chave", async () => {
    const o = await checkAllAi(groq, {}, byKey);
    expect(o.items[0]).toMatchObject({ id: "groq", active: true, state: "ok" });
    expect(o.items[1]).toMatchObject({ id: "gemini", active: false, state: "no_key" });
    expect(o.items[1]!.message).toMatch(/GEMINI_API_KEY/);
    expect(JSON.stringify(o)).not.toMatch(/gsk_|AIza/);
  });

  it("chave com prefixo errado no segredo opcional é ignorada; outro provedor ativo ganha a própria linha", async () => {
    expect((await checkAllAi(groq, { GEMINI_API_KEY: "gsk_errada" }, byKey)).items[1]!.state).toBe("no_key");
    const o = await checkAllAi({ aiApiKey: "xai-1", aiModel: "grok-4", aiBaseUrl: "https://api.x.ai/v1" }, {}, byKey);
    expect(o.items.map((i) => i.id)).toEqual(["groq", "gemini", "other"]);
    expect(o.items[2]).toMatchObject({ active: true, provider: "xAI (Grok)", state: "ok" });
  });
});

describe("painel: rota /painel/api/ia", () => {
  const deps = (extra = {}) => ({ env: { PANEL_OPEN: "true" }, repo: new MemoryRepo(), bucket: undefined, ...extra });
  it("devolve o estado; 503 sem a função; 502 se ela falhar", async () => {
    const ok = await handlePanel(new Request("https://w.dev/painel/api/ia"), deps({ aiStatus: async () => ({ items: [{ id: "groq", active: true, state: "limit", message: "x", provider: "Groq", model: "m", checkedAt: "2026-11-17T12:00:00Z" }] }) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ items: [{ id: "groq", state: "limit" }] });
    expect((await handlePanel(new Request("https://w.dev/painel/api/ia"), deps())).status).toBe(503);
    expect((await handlePanel(new Request("https://w.dev/painel/api/ia"), deps({ aiStatus: async () => { throw new Error("x"); } }))).status).toBe(502);
  });
  it("a página tem o cartão da IA e o botão de teste", () => {
    const html = dashboardPage("n", true);
    expect(html).toContain('id="ai-rows"');
    expect(html).toContain("/painel/api/ia");
  });
});
