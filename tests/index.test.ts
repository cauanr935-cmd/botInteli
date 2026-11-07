import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("rotas", () => {
  it("C0.7 /health devolve 200", async () => {
    const r = await worker.fetch(new Request("https://x/health"));
    expect(r.status).toBe(200);
  });
  it("C0.7 rota desconhecida devolve 404", async () => {
    const r = await worker.fetch(new Request("https://x/nada"));
    expect(r.status).toBe(404);
  });
});
