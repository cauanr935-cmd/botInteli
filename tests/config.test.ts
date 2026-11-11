import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError, META_FREE_TIER_PER_MONTH } from "../src/config";

const base = {
  WHATSAPP_TOKEN: "t", PHONE_NUMBER_ID: "1", APP_SECRET: "s", VERIFY_TOKEN: "v",
  GRAPH_API_VERSION: "v21.0", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k",
  ANALYZER_API_URL: "https://a", ANALYZER_API_KEY: "k", ADMIN_TOKEN: "a",
  PRIVACY_POLICY_URL: "https://p", TERMS_VERSION: "1",
};

describe("config", () => {
  it("C0.3 config válida usa padrões (margem 50, STOP_AT 950)", () => {
    const c = loadConfig(base);
    expect(c.budgetSafetyMargin).toBe(50);
    expect(c.stopAt).toBe(950);
    expect(c.metaAccountTimezone).toBe("America/Sao_Paulo");
  });

  for (const key of Object.keys(base).filter((key) => key !== "ANALYZER_API_URL" && key !== "ANALYZER_API_KEY")) {
    it(`C0.3 variável obrigatória ausente: ${key}`, () => {
      const env: Record<string, string> = { ...base };
      delete env[key];
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(key);
    });
  }

  it("aceita o analisador ausente, mas exige URL e chave juntas", () => {
    const withoutAnalyzer: Record<string, string> = { ...base };
    delete withoutAnalyzer.ANALYZER_API_URL;
    delete withoutAnalyzer.ANALYZER_API_KEY;
    expect(loadConfig(withoutAnalyzer).analyzerApiUrl).toBeUndefined();
    expect(() => loadConfig({ ...base, ANALYZER_API_URL: "" })).toThrow(/ANALYZER_API_URL/);
  });

  it("C0.3 BUDGET_SAFETY_MARGIN < 10 é recusada", () => {
    expect(() => loadConfig({ ...base, BUDGET_SAFETY_MARGIN: "9" })).toThrow(/BUDGET_SAFETY_MARGIN/);
    expect(() => loadConfig({ ...base, BUDGET_SAFETY_MARGIN: "0" })).toThrow(/BUDGET_SAFETY_MARGIN/);
    expect(() => loadConfig({ ...base, BUDGET_SAFETY_MARGIN: "-5" })).toThrow(/BUDGET_SAFETY_MARGIN/);
  });

  it("C0.3 BUDGET_SAFETY_MARGIN = 10 é aceita (STOP_AT 990)", () => {
    expect(loadConfig({ ...base, BUDGET_SAFETY_MARGIN: "10" }).stopAt).toBe(990);
  });

  it("C0.3 BUDGET_SAFETY_MARGIN absurda (STOP_AT <= 0) é recusada", () => {
    for (const v of ["501", "1000", "5000"]) {
      expect(() => loadConfig({ ...base, BUDGET_SAFETY_MARGIN: v })).toThrow(/BUDGET_SAFETY_MARGIN/);
    }
    expect(loadConfig({ ...base, BUDGET_SAFETY_MARGIN: "500" }).stopAt).toBe(500);
  });

  it("C0.3 BUDGET_SAFETY_MARGIN não numérica é recusada", () => {
    for (const v of ["abc", "5x", "12.5", "NaN"]) {
      expect(() => loadConfig({ ...base, BUDGET_SAFETY_MARGIN: v })).toThrow(/BUDGET_SAFETY_MARGIN/);
    }
  });

  it("C0.4 META_FREE_TIER_PER_MONTH é constante e ignora o ambiente", () => {
    expect(META_FREE_TIER_PER_MONTH).toBe(1000);
    const c = loadConfig({ ...base, META_FREE_TIER_PER_MONTH: "5000" });
    expect(META_FREE_TIER_PER_MONTH).toBe(1000);
    expect(c.stopAt).toBe(950);
  });
});
