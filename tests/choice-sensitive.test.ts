import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";

const bodyOf = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};

describe("menu numerado ativo + tema sensível", () => {
  it("a pessoa recebe a recomendação do CVV (188), não 'não entendi', e o texto não vai à IA", async () => {
    const calls: string[] = [];
    const agent = { classify: async (q: { text: string }) => { calls.push(q.text); return null; } };
    const s = new Simulator({ agent: agent as never } as never);
    const p = s.phone(7);
    await s.repo.touchUser(p, s.now());
    await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1" });
    await s.repo.setPendingChoices(await hashWaId(p), [{ id: "a", title: "Opção A" }, { id: "b", title: "Opção B" }], s.now());
    await s.text(p, "não aguento mais, quero me matar"); s.advance(1000);
    expect(bodyOf(s, p)).toMatch(/188/);
    expect(bodyOf(s, p)).not.toMatch(/não entendi/i);
    expect(calls).toHaveLength(0);
  });

  it("controle: o mesmo menu com um texto comum SIM consulta a IA (prova que o teste anterior exercita o caminho)", async () => {
    const calls: string[] = [];
    const agent = { classify: async (q: { text: string }) => { calls.push(q.text); return null; } };
    const s = new Simulator({ agent: agent as never } as never);
    const p = s.phone(8);
    await s.repo.touchUser(p, s.now());
    await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1" });
    await s.repo.setPendingChoices(await hashWaId(p), [{ id: "a", title: "Opção A" }, { id: "b", title: "Opção B" }], s.now());
    await s.text(p, "a terceira"); s.advance(1000);
    expect(calls).toHaveLength(1);
    expect(bodyOf(s, p)).toMatch(/não entendi/i);
  });

  it("frase ou pergunta que não escolhe opção segue para o motor (FAQ/IA), sem o 'não entendi' do menu", async () => {
    const faq: string[] = [];
    const agent = { classify: async () => null, answerFaq: async (t: string) => { faq.push(t); return { kind: "answer" as const, text: "Os fundadores são o Cauan e o Bruno, do Inteli." }; } };
    const s = new Simulator({ agent: agent as never } as never);
    const p = s.phone(11);
    await s.repo.touchUser(p, s.now());
    await s.repo.saveConversation(p, 0, { state: "MENU" as never, previousState: null, hintSentInState: true, optedOutAt: null });
    await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1" });
    await s.repo.setPendingChoices(await hashWaId(p), [{ id: "a", title: "Opção A" }, { id: "b", title: "Opção B" }], s.now());
    await s.text(p, "quem sao os fundadores da be my mentor?"); s.advance(1000);
    expect(faq).toHaveLength(1);
    expect(bodyOf(s, p)).toMatch(/Cauan e o Bruno/);
    expect(bodyOf(s, p)).not.toMatch(/não entendi/i);
  });

  it("antes do aceite (LGPD) o texto não vai à IA", async () => {
    const calls: string[] = [];
    const agent = { classify: async (q: { text: string }) => { calls.push(q.text); return null; } };
    const s = new Simulator({ agent: agent as never } as never);
    const p = s.phone(9);
    await s.repo.touchUser(p, s.now());
    await s.repo.setPendingChoices(await hashWaId(p), [{ id: "a", title: "Opção A" }, { id: "b", title: "Opção B" }], s.now());
    await s.text(p, "quero a segunda opção por favor"); s.advance(1000);
    expect(calls).toHaveLength(0);
  });
});
