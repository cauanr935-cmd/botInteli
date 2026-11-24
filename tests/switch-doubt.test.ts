import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { readSwitchAnswer, wantsDoubt } from "../src/conversation/switch";

const body = (s: Simulator, p: string, i = -1): string => {
  const b = s.sentTo(p).at(i)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};
async function person(state: string, agent?: unknown) {
  const s = new Simulator(agent ? { agent: agent as never } : {});
  const p = s.phone(30);
  await s.repo.touchUser(p, s.now());
  await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", registeredAt: s.now(), values: { full_name: "Ana Souza" }, profileRole: "mentorado" });
  await s.repo.saveConversation(p, 0, { state: state as never, previousState: null, hintSentInState: false, optedOutAt: null });
  return { s, p };
}

describe("troca de assunto no registro de mentoria", () => {
  it("reconhece o pedido de dúvida, e só ele", () => {
    for (const t of ["quero tirar uma dúvida", "tenho uma dúvida", "queria tirar uma duvida agora", "preciso tirar uma dúvida", "posso tirar uma dúvida?", "to com uma dúvida"]) expect(wantsDoubt(t), t).toBe(true);
    for (const t of ["cálculo 1", "Banco de dados", "ontem", "sim", "mentoria de design com o Caio", "terminei"]) expect(wantsDoubt(t), t).toBe(false);
  });

  for (const st of ["AWAIT_AUDIO", "MENT_ROLE", "MENT_SUBJECT", "MENT_PARTNER"]) {
    it(`em ${st}: pergunta se vai registrar a mentoria, sem presumir`, async () => {
      const { s, p } = await person(st);
      await s.text(p, "quero tirar uma dúvida"); s.advance(1000);
      expect(s.sentTo(p)).toHaveLength(1);
      expect(body(s, p)).toMatch(/vai registrar a mentoria agora\?/i);
      const c = await s.repo.getConversation(p);
      expect(c.state).toBe("SWITCH_DOUBT");
      expect(c.previousState).toBe(st);
    });
  }

  it("'não' (botão ou escrito): larga o registro, apaga o rascunho e começa a dúvida do zero", async () => {
    for (const how of ["text", "button"] as const) {
      const { s, p } = await person("MENT_SUBJECT");
      await s.repo.saveMentoriaDraft(p, { role: "mentorado", subject: "cálculo" });
      await s.text(p, "quero tirar uma dúvida"); s.advance(30_000);
      if (how === "text") await s.text(p, "não"); else await s.button(p, "sw_doubt");
      s.advance(1000);
      expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
      expect(body(s, p)).toMatch(/deixei o registro da mentoria de lado/i);
      expect(body(s, p)).toMatch(/d[úu]vida/i); // a pergunta da dúvida vem junto
      expect(await s.repo.getMentoriaDraft(p)).toEqual({});
    }
  });

  it("'sim': volta exatamente de onde parou, repetindo a pergunta daquela etapa", async () => {
    const { s, p } = await person("MENT_ROLE");
    await s.text(p, "tenho uma dúvida"); s.advance(30_000);
    await s.text(p, "sim"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("MENT_ROLE");
    expect(body(s, p)).toMatch(/seguimos com a mentoria/i);
    expect(body(s, p)).toMatch(/mentor/i);
  });

  it("depois do 'não', a dúvida digitada é registrada normalmente", async () => {
    const { s, p } = await person("AWAIT_AUDIO");
    await s.text(p, "quero tirar uma dúvida"); s.advance(30_000);
    await s.text(p, "não"); s.advance(30_000);
    await s.text(p, "como calcular o limite de uma função em cálculo 1?"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).not.toBe("DOUBT_TEXT");
    expect(s.repo.doubts).toHaveLength(1); // a dúvida foi registrada para o matching
    expect(s.repo.doubts[0]!.text).toMatch(/limite de uma função/);
  });
});

describe("perguntas sobre a Be My Mentor e os fundadores em qualquer etapa", () => {
  const agent = { classify: async () => null, answerFaq: async () => ({ kind: "answer" as const, text: "A Be My Mentor foi criada por Cauan e Bruno, alunos do Inteli." }) };
  for (const st of ["AWAIT_AUDIO", "MENT_ROLE", "MENT_SUBJECT", "MENT_DATE", "MENT_DATE_TEXT", "MENT_PARTNER", "SWITCH_DOUBT"]) {
    it(`em ${st}: responde sobre os fundadores e não perde a etapa`, async () => {
      const { s, p } = await person(st, agent);
      await s.text(p, "quem são os fundadores da be my mentor?"); s.advance(1000);
      expect(body(s, p)).toMatch(/Cauan e Bruno/);
      expect((await s.repo.getConversation(p)).state).toBe(st);
    });
  }
  it("em texto livre (assunto), uma resposta normal NÃO vira pergunta de FAQ", async () => {
    const { s, p } = await person("MENT_SUBJECT", agent);
    await s.text(p, "como estudar cálculo"); s.advance(1000);
    expect(s.sentTo(p).every((m) => !/Cauan e Bruno/.test(JSON.stringify(m.body)))).toBe(true);
  });
});

describe("readSwitchAnswer", () => {
  it("lê botões e texto", () => {
    const b = (id: string) => ({ type: "button_reply", id, title: "", wamid: "w", from: "1" }) as never;
    expect(readSwitchAnswer(b("sw_keep"))).toBe("keep");
    expect(readSwitchAnswer(b("sw_doubt"))).toBe("doubt");
    const t = (body: string) => ({ type: "text", body, wamid: "w", from: "1" }) as never;
    expect(readSwitchAnswer(t("sim"))).toBe("keep");
    expect(readSwitchAnswer(t("não vou registrar, quero tirar dúvida"))).toBe("doubt");
    expect(readSwitchAnswer(t("hmm talvez"))).toBeNull();
  });
});
