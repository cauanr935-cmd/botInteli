import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { DEFAULT_SERVICES } from "../src/services/content";
import { wantsNewMentoring } from "../src/conversation/switch";

const body = (s: Simulator, p: string, i = -1): string => {
  const b = s.sentTo(p).at(i)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};
async function person(state: string) {
  const s = new Simulator();
  const p = s.phone(40);
  await s.repo.touchUser(p, s.now());
  await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", registeredAt: s.now(), values: { full_name: "Ana Souza" }, profileRole: "mentorado" });
  await s.repo.saveConversation(p, 0, { state: state as never, previousState: null, hintSentInState: false, optedOutAt: null });
  return { s, p };
}

describe("marcar uma nova mentoria", () => {
  it("reconhece o pedido; não confunde com registrar mentoria, oferecer mentoria ou o assunto", () => {
    for (const t of ["quero marcar uma nova mentoria", "queria agendar uma mentoria", "preciso de um mentor", "quero uma mentoria de cálculo", "como faço pra pedir uma mentoria?", "gostaria de solicitar mentoria"]) expect(wantsNewMentoring(t), t).toBe(true);
    for (const t of ["quero registrar uma mentoria", "terminei a mentoria", "quero dar mentoria de computação", "mandei o áudio da mentoria", "cálculo 1", "tive mentoria ontem"]) expect(wantsNewMentoring(t), t).toBe(false);
  });

  it("o menu tem a opção 'Marcar nova mentoria' e escolhê-la abre o pedido", async () => {
    const { s, p } = await person("COMPLETED");
    s.repo.services = DEFAULT_SERVICES.map((x) => ({ ...x }));
    await s.text(p, "menu"); s.advance(30_000);
    const rows = ((s.sentTo(p).at(-1)!.body as { interactive: { action: { sections: { rows: { id: string; title: string }[] }[] } } }).interactive.action.sections[0]!.rows);
    expect(rows.map((r) => r.title)).toEqual(["Registrar mentoria", "Marcar nova mentoria", "Horários", "Contato"]);
    await s.list(p, "svc_nova_mentoria"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
    expect(body(s, p)).toMatch(/nova mentoria/i);
  });

  for (const st of ["MENU", "COMPLETED", "RETURNING_CHOICE", "DOUBT_ASK"]) {
    it(`escrevendo 'quero marcar uma nova mentoria' em ${st}: abre o pedido`, async () => {
      const { s, p } = await person(st);
      await s.text(p, "quero marcar uma nova mentoria"); s.advance(1000);
      expect(s.sentTo(p)).toHaveLength(1);
      expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
      expect(body(s, p)).toMatch(/Bora marcar uma nova mentoria/);
    });
  }

  it("no meio do registro de uma mentoria, pergunta antes (Sim continua, Não abre o pedido)", async () => {
    const { s, p } = await person("AWAIT_AUDIO");
    await s.text(p, "quero marcar uma nova mentoria"); s.advance(30_000);
    expect(body(s, p)).toMatch(/vai registrar a mentoria agora\?/i);
    await s.text(p, "não"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
  });

  it("o pedido segue o fluxo normal: o texto vira dúvida registrada e pede os horários", async () => {
    const { s, p } = await person("MENU");
    await s.text(p, "quero marcar uma nova mentoria"); s.advance(30_000);
    await s.text(p, "preciso de ajuda com integrais em cálculo 2"); s.advance(1000);
    expect(s.repo.doubts).toHaveLength(1);
    expect((await s.repo.getConversation(p)).state).not.toBe("DOUBT_TEXT");
  });
});
