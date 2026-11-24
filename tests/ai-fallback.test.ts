// IA com mais de uma chave: o Gemini (principal) falha (503/429/timeout) e a Groq responde; o provedor que falhou fica de castigo.
import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { GrokIntentAgent, PROVIDER_COOLDOWN_MS, resetProviderCooldowns } from "../src/ai/grok";

const ENV = { EVOLUTION_URL: "https://e.example", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "i", EVOLUTION_WEBHOOK_TOKEN: "t".repeat(20), SUPABASE_URL: "https://s.example", SUPABASE_SERVICE_KEY: "k", ADMIN_TOKEN: "a", PRIVACY_POLICY_URL: "https://p.example", TERMS_VERSION: "1" };
const GEM = "AQ.fake-gemini-key", GROQ = "gsk_fake-groq-key", XAI = "xai-fake-key";

describe("config: todas as chaves viram provedores", () => {
  it("Gemini principal; Groq reserva (antes da xAI); sem repetir provedor", () => {
    const cfg = loadConfig({ ...ENV, AI_API_KEY: GEM, XAI_API_KEY: GROQ, GROQ_API_KEY: GROQ, GEMINI_API_KEY: XAI } as never);
    expect(cfg.aiApiKey).toBe(GEM);
    expect(cfg.aiBaseUrl).toMatch(/googleapis\.com/);
    expect(cfg.aiFallbacks?.map((f) => f.baseUrl)).toEqual(["https://api.groq.com/openai/v1", "https://api.x.ai/v1"]);
    expect(cfg.aiFallbacks?.[0]).toMatchObject({ apiKey: GROQ, model: "openai/gpt-oss-120b" });
  });
  it("uma chave só: sem reserva", () => {
    expect(loadConfig({ ...ENV, AI_API_KEY: GEM } as never).aiFallbacks).toBeUndefined();
  });
});

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const mkAgent = (handler: (url: string) => Response | Promise<Response>) => {
  const calls: string[] = [];
  const agent = new GrokIntentAgent({
    apiKey: GEM, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-latest", timeoutMs: 3000,
    fallbacks: [{ apiKey: GROQ, baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" }],
    logger: { log: () => undefined },
    fetchImpl: (async (url: string) => { calls.push(new URL(url).hostname); return handler(url); }) as never,
  });
  return { agent, calls };
};
const Q = { question: "q", options: [{ intent: "1", description: "um" }], text: "oi" };
const GOOD = ok('{"intent":"1","confianca":0.9}');

describe("fallback entre provedores", () => {
  beforeEach(() => resetProviderCooldowns());

  it("Gemini 503 -> a Groq responde e o bot entende a pessoa", async () => {
    const { agent, calls } = mkAgent((url) => (url.includes("googleapis") ? new Response("busy", { status: 503 }) : GOOD.clone()));
    expect(await agent.classify(Q)).toBe("1");
    expect(calls).toEqual(["generativelanguage.googleapis.com", "api.groq.com"]);
  });

  it("Gemini ok: a Groq nem é chamada", async () => {
    const { agent, calls } = mkAgent(() => GOOD.clone());
    expect(await agent.classify(Q)).toBe("1");
    expect(calls).toEqual(["generativelanguage.googleapis.com"]);
  });

  it("erro de rede no principal também cai para o reserva", async () => {
    const { agent } = mkAgent((url) => { if (url.includes("googleapis")) throw new TypeError("network"); return GOOD.clone(); });
    expect(await agent.classify(Q)).toBe("1");
  });

  it("depois de uma falha, o provedor fica de castigo: a próxima pergunta vai direto ao reserva", async () => {
    let gemini = 0;
    const { agent, calls } = mkAgent((url) => { if (url.includes("googleapis")) { gemini++; return new Response("x", { status: 503 }); } return GOOD.clone(); });
    await agent.classify(Q);
    await agent.classify(Q);
    expect(gemini).toBe(1); // a segunda pergunta nem tentou o Gemini
    expect(calls.at(-1)).toBe("api.groq.com");
    expect(PROVIDER_COOLDOWN_MS).toBe(60_000);
  });

  it("todos falham: null (o bot segue sozinho)", async () => {
    const { agent } = mkAgent(() => new Response("x", { status: 503 }));
    expect(await agent.classify(Q)).toBeNull();
  });

  it("resposta vazia mas HTTP ok do principal NÃO dispara o reserva (não é falha do provedor)", async () => {
    const { agent, calls } = mkAgent(() => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    expect(await agent.classify(Q)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
