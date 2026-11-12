import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError, MAX_ANTI_FLOOD_PER_DAY } from "../src/config";

const base = {
  EVOLUTION_URL: "https://evo.example.com", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "inst",
  EVOLUTION_WEBHOOK_TOKEN: "token-webhook-123456", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k",
  ANALYZER_API_URL: "https://a", ANALYZER_API_KEY: "k", ADMIN_TOKEN: "a",
  PRIVACY_POLICY_URL: "https://p", TERMS_VERSION: "1",
};

describe("config", () => {
  it("C0.3 config válida usa padrões (anti-flood desligado, fuso de São Paulo, botões em texto numerado)", () => {
    const c = loadConfig(base);
    expect(c.stopAt).toBe(0);
    expect(c.timezone).toBe("America/Sao_Paulo");
    expect(c.evolutionNativeInteractive).toBe(false);
    expect(c.evolutionInstance).toBe("inst");
  });

  for (const key of Object.keys(base).filter((key) => key !== "ANALYZER_API_URL" && key !== "ANALYZER_API_KEY")) {
    it(`C0.3 variável obrigatória ausente: ${key}`, () => {
      const env: Record<string, string> = { ...base };
      delete env[key];
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(key);
    });
  }

  it("variáveis da Meta não são mais exigidas nem lidas (obsoletas)", () => {
    const c = loadConfig({ ...base, WHATSAPP_TOKEN: "x", PHONE_NUMBER_ID: "1", APP_SECRET: "s", VERIFY_TOKEN: "v", GRAPH_API_VERSION: "v21.0" });
    expect(Object.keys(c)).not.toEqual(expect.arrayContaining(["whatsappToken", "appSecret", "verifyToken", "graphApiVersion", "phoneNumberId"]));
  });

  it("aceita o analisador ausente, mas exige URL e chave juntas", () => {
    const withoutAnalyzer: Record<string, string> = { ...base };
    delete withoutAnalyzer.ANALYZER_API_URL;
    delete withoutAnalyzer.ANALYZER_API_KEY;
    expect(loadConfig(withoutAnalyzer).analyzerApiUrl).toBeUndefined();
    expect(() => loadConfig({ ...base, ANALYZER_API_URL: "" })).toThrow(/ANALYZER_API_URL/);
  });

  it("EVOLUTION_URL: https obrigatório (http só em localhost) e barra final removida", () => {
    expect(() => loadConfig({ ...base, EVOLUTION_URL: "http://evo.example.com" })).toThrow(/EVOLUTION_URL/);
    expect(() => loadConfig({ ...base, EVOLUTION_URL: "evo.example.com" })).toThrow(/EVOLUTION_URL/);
    expect(loadConfig({ ...base, EVOLUTION_URL: "http://localhost:8080" }).evolutionUrl).toBe("http://localhost:8080");
    expect(loadConfig({ ...base, EVOLUTION_URL: "https://evo.example.com//" }).evolutionUrl).toBe("https://evo.example.com");
  });

  it("EVOLUTION_INSTANCE só aceita caracteres seguros para a URL", () => {
    for (const v of ["a/b", "a b", "a?x=1", "../x", "a".repeat(65)]) expect(() => loadConfig({ ...base, EVOLUTION_INSTANCE: v })).toThrow(/EVOLUTION_INSTANCE/);
    expect(loadConfig({ ...base, EVOLUTION_INSTANCE: "bot_01.prod-1" }).evolutionInstance).toBe("bot_01.prod-1");
  });

  it("EVOLUTION_WEBHOOK_TOKEN curto (< 16) é recusado", () => {
    expect(() => loadConfig({ ...base, EVOLUTION_WEBHOOK_TOKEN: "curto" })).toThrow(/EVOLUTION_WEBHOOK_TOKEN/);
  });

  it("EVOLUTION_NATIVE_INTERACTIVE só liga com 'true'", () => {
    expect(loadConfig({ ...base, EVOLUTION_NATIVE_INTERACTIVE: "true" }).evolutionNativeInteractive).toBe(true);
    expect(loadConfig({ ...base, EVOLUTION_NATIVE_INTERACTIVE: "1" }).evolutionNativeInteractive).toBe(false);
  });

  it("ANTI_FLOOD_MAX_PER_DAY: 0 desliga; até 990 vale; acima ou não numérico é recusado", () => {
    expect(loadConfig({ ...base, ANTI_FLOOD_MAX_PER_DAY: "300" }).stopAt).toBe(300);
    expect(loadConfig({ ...base, ANTI_FLOOD_MAX_PER_DAY: String(MAX_ANTI_FLOOD_PER_DAY) }).stopAt).toBe(990);
    for (const v of ["991", "-1", "abc", "12.5"]) expect(() => loadConfig({ ...base, ANTI_FLOOD_MAX_PER_DAY: v })).toThrow(/ANTI_FLOOD_MAX_PER_DAY/);
  });

  it("TIMEZONE tem prioridade; META_ACCOUNT_TIMEZONE antigo ainda vale como alias", () => {
    expect(loadConfig({ ...base, META_ACCOUNT_TIMEZONE: "America/Manaus" }).timezone).toBe("America/Manaus");
    expect(loadConfig({ ...base, TIMEZONE: "UTC", META_ACCOUNT_TIMEZONE: "America/Manaus" }).timezone).toBe("UTC");
  });
});
