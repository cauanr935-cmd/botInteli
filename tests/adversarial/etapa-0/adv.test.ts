import { describe, it, expect } from "vitest";
import { loadConfig } from "../../../src/config";
import { maskPhone } from "../../../src/lib/logger";
import worker from "../../../src/index";

const base = {
  WHATSAPP_TOKEN: "t", PHONE_NUMBER_ID: "1", APP_SECRET: "s", VERIFY_TOKEN: "v",
  GRAPH_API_VERSION: "v21.0", SUPABASE_URL: "https://x", SUPABASE_SERVICE_KEY: "k",
  ANALYZER_API_URL: "https://a", ANALYZER_API_KEY: "k", ADMIN_TOKEN: "a",
  PRIVACY_POLICY_URL: "https://p", TERMS_VERSION: "1",
};
describe("adv etapa 0", () => {
  it("margem absurda (>=1000) não produz STOP_AT <= 0", () => {
    for (const m of ["1000", "5000"]) {
      let stop: number | undefined;
      try { stop = loadConfig({ ...base, BUDGET_SAFETY_MARGIN: m }).stopAt; } catch { stop = undefined; }
      expect(stop === undefined || stop > 0).toBe(true);
    }
  });
  it("variáveis só com espaços são tratadas como ausentes; limites 0 recusados", () => {
    expect(() => loadConfig({ ...base, APP_SECRET: "   " })).toThrow(/APP_SECRET/);
    expect(() => loadConfig({ ...base, MAX_BOT_MSGS_PER_USER_PER_DAY: "0" })).toThrow();
  });
  it("máscara de telefone com formatos estranhos não vaza", () => {
    expect(maskPhone("5511987651234")).toBe("5511*****1234");
    expect(maskPhone("+55 (11) 98765-1234")).not.toMatch(/9876/);
    expect(maskPhone("1234")).toBe("****");
  });
  it("rotas: POST /health, /health/x, método estranho", async () => {
    expect((await worker.fetch(new Request("https://x/health", { method: "POST" }))).status).toBe(404);
    expect((await worker.fetch(new Request("https://x/health/x"))).status).toBe(404);
    expect((await worker.fetch(new Request("https://x/"))).status).toBe(404);
  });
});
