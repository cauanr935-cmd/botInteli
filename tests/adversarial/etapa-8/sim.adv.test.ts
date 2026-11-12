import { describe, it, expect } from "vitest";
import { Simulator } from "../../../scripts/simulate";
import { route } from "../../../src/index";
import { TOKEN as TOKEN_SIM } from "../../helpers/evolution";

describe("etapa 8 adversarial", () => {
  it("concorrência: 400 pessoas em paralelo com teto diário de 990 nunca passam de 990", async () => {
    const s = new Simulator({ env: { ANTI_FLOOD_MAX_PER_DAY: "990" } });
    for (let r = 0; r < 3; r++) {
      await Promise.all(Array.from({ length: 400 }, (_, i) => (r === 0 ? s.text(s.phone(i), "oi") : r === 1 ? s.button(s.phone(i), "consent_yes") : s.chooseAudio(s.phone(i)))));
    }
    expect(s.cfg.stopAt).toBe(990);
    expect(s.sentCount).toBeLessThanOrEqual(990);
    expect(await s.reserved()).toBeLessThanOrEqual(990);
    expect(s.statuses.every((c) => c === 200)).toBe(true);
  });

  it("webhooks de status/entrega da Evolution (messages.update) são ignorados e não travam nada", async () => {
    const s = new Simulator();
    await s.text(s.phone(1), "oi");
    const dep = (s as unknown as { deps: Parameters<typeof route>[2] }).deps;
    const body = JSON.stringify({ event: "messages.update", data: { status: "READ", pricing: { billable: true, type: "regular", category: "marketing" } } });
    const res = await route(new Request("https://x.invalid/webhook", { method: "POST", body, headers: { "x-webhook-token": TOKEN_SIM } }), { waitUntil: () => undefined }, dep);
    expect(res.status).toBe(200);
    const b = s.sentCount;
    await s.text(s.phone(2), "oi");
    expect(s.sentCount).toBe(b + 1);
  });

  it("token do webhook inválido/ausente: 401 e nada enviado", async () => {
    const s = new Simulator();
    const dep = (s as unknown as { deps: Parameters<typeof route>[2] }).deps;
    for (const headers of [{}, { "x-webhook-token": "errado" }, { "x-hub-signature-256": "sha256=00" }] as Record<string, string>[]) {
      const res = await route(new Request("https://x.invalid/webhook", { method: "POST", body: "{}", headers }), { waitUntil: () => undefined }, dep);
      expect(res.status).toBe(401);
    }
    expect(s.sentCount).toBe(0);
  });

  it("unlock sem token é rejeitado e trava segue", async () => {
    const s = new Simulator();
    await s.text(s.phone(1), "oi");
    await s.repo.setManualLock("simpn", "humano");
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
