import { describe, it, expect } from "vitest";
import { Simulator } from "../../../scripts/simulate";
import { route } from "../../../src/index";

describe("etapa 8 adversarial", () => {
  it("concorrência: 400 pessoas em paralelo com margem 10 nunca passam de 990", async () => {
    const s = new Simulator({ env: { BUDGET_SAFETY_MARGIN: "10" } });
    for (let r = 0; r < 3; r++) {
      await Promise.all(Array.from({ length: 400 }, (_, i) => (r === 0 ? s.text(s.phone(i), "oi") : r === 1 ? s.form(s.phone(i)) : s.chooseAudio(s.phone(i)))));
    }
    expect(s.cfg.stopAt).toBe(990);
    expect(s.sentCount).toBeLessThanOrEqual(990);
    expect(await s.reserved()).toBeLessThanOrEqual(990);
    expect(s.statuses.every((c) => c === 200)).toBe(true);
  });

  it("status com category diferente de service (billable false) abre trava e bloqueia envios", async () => {
    const s = new Simulator();
    await s.text(s.phone(1), "oi");
    const before = s.sentCount;
    await s.status("wamid.OUT1", { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "marketing" });
    await s.text(s.phone(2), "oi");
    await s.text(s.phone(1), "menu");
    expect(s.sentCount).toBe(before);
    expect(s.statuses.every((c) => c === 200)).toBe(true);
  });

  it("status legítimo (service, free) NÃO trava", async () => {
    const s = new Simulator();
    await s.text(s.phone(1), "oi");
    await s.status("wamid.OUT1", { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "service" });
    const b = s.sentCount;
    await s.text(s.phone(2), "oi");
    expect(s.sentCount).toBe(b + 1);
  });

  it("assinatura inválida/ausente: 401 e nada enviado", async () => {
    const s = new Simulator();
    const dep = (s as unknown as { deps: Parameters<typeof route>[2] }).deps;
    for (const headers of [{}, { "X-Hub-Signature-256": "sha256=00" }] as Record<string, string>[]) {
      const res = await route(new Request("https://x.invalid/webhook", { method: "POST", body: "{}", headers }), { waitUntil: () => undefined }, dep);
      expect(res.status).toBe(401);
    }
    expect(s.sentCount).toBe(0);
  });

  it("unlock sem token é rejeitado e trava segue", async () => {
    const s = new Simulator();
    await s.text(s.phone(1), "oi");
    await s.status("wamid.OUT1", { billable: true, type: "regular", category: "service" });
    const dep = (s as unknown as { deps: Parameters<typeof route>[2] }).deps;
    const res = await route(new Request("https://x.invalid/admin/budget/unlock?confirm=yes", { method: "POST", headers: { Authorization: "Bearer errado" } }), { waitUntil: () => undefined }, dep);
    expect([401, 403]).toContain(res.status);
    const b = s.sentCount;
    await s.text(s.phone(2), "oi");
    expect(s.sentCount).toBe(b);
  });

  it("variações de oi e áudio de pessoa não cadastrada não geram rajada", async () => {
    const s = new Simulator();
    const p = s.phone(5);
    for (const t of ["oi", "OIII", "Olá!", "oi", "ola", "bom dia", "oi"]) { await s.text(p, t); s.advance(1000); }
    await s.audio(p); await s.sticker(p);
    expect(s.sentTo(p).length).toBeLessThanOrEqual(2);
    expect(s.store.objects.size).toBe(0);
  });
});
