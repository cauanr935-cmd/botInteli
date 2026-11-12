import { describe, it, expect } from "vitest";
import { loadConfig } from "../../../src/config";
import { maskPhone } from "../../../src/lib/logger";
import worker from "../../../src/index";

const base = {
  EVOLUTION_URL: "https://evo.example.com", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "inst",
  EVOLUTION_WEBHOOK_TOKEN: "token-webhook-123456", SUPABASE_URL: "https://x", SUPABASE_SERVICE_KEY: "k",
  ANALYZER_API_URL: "https://a", ANALYZER_API_KEY: "k", ADMIN_TOKEN: "a",
  PRIVACY_POLICY_URL: "https://p", TERMS_VERSION: "1",
};
describe("adv etapa 0", () => {
  it("teto anti-flood absurdo (> 990) é recusado; 0 desliga", () => {
    for (const m of ["991", "1000", "5000"]) expect(() => loadConfig({ ...base, ANTI_FLOOD_MAX_PER_DAY: m })).toThrow(/ANTI_FLOOD_MAX_PER_DAY/);
    expect(loadConfig({ ...base, ANTI_FLOOD_MAX_PER_DAY: "0" }).stopAt).toBe(0);
  });
  it("variáveis só com espaços são tratadas como ausentes; limites 0 recusados", () => {
    expect(() => loadConfig({ ...base, EVOLUTION_API_KEY: "   " })).toThrow(/EVOLUTION_API_KEY/);
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
