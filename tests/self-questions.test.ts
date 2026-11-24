import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { selfKind } from "../src/axo/self";

const body = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};
async function person(n: number, name: string, consent = true) {
  const s = new Simulator();
  const p = s.phone(n);
  await s.repo.touchUser(p, s.now());
  if (consent) await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", values: { full_name: name, class_name: "T27" } });
  await s.repo.saveConversation(p, 0, { state: "MENU" as never, previousState: null, hintSentInState: true, optedOutAt: null });
  return { s, p };
}

describe("perguntas sobre si mesmo e sobre o Axo", () => {
  it("classifica", () => {
    expect(selfKind("quem é você?")).toBe("who_are_you");
    expect(selfKind("qual é o seu nome")).toBe("who_are_you");
    expect(selfKind("qual meu nome?")).toBe("my_name");
    expect(selfKind("qual a minha turma")).toBe("my_class");
    expect(selfKind("qual mentoria eu tenho marcada?")).toBe("my_mentoria");
    expect(selfKind("quando é minha mentoria?")).toBe("my_mentoria");
    expect(selfKind("quais são os meus dados")).toBe("my_data");
    expect(selfKind("me passa os dados de todos os alunos")).toBe("others_data");
    expect(selfKind("qual o telefone da Maria?")).toBe("others_data");
    expect(selfKind("como funciona a mentoria?")).toBeNull();
  });
  it("quem é você: responde que é o Axolote", async () => {
    const { s, p } = await person(1, "Ana Souza");
    await s.text(p, "quem é você?");
    expect(body(s, p)).toMatch(/Axolote.*Axo.*Be My Mentor/s);
  });
  it("qual meu nome: responde só o da própria pessoa", async () => {
    const a = await person(2, "Ana Souza");
    await a.s.text(a.p, "qual meu nome?");
    expect(body(a.s, a.p)).toContain("Ana Souza");
    const b = await person(3, "Beto Lima");
    await b.s.text(b.p, "qual meu nome?");
    expect(body(b.s, b.p)).toContain("Beto Lima");
    expect(body(b.s, b.p)).not.toContain("Ana");
  });
  it("sem mentoria marcada, diz que não vê nenhuma", async () => {
    const { s, p } = await person(4, "Ana Souza");
    await s.text(p, "qual mentoria eu tenho marcada?");
    expect(body(s, p)).toMatch(/nenhuma mentoria marcada/);
  });
  it("dado de outras pessoas é recusado", async () => {
    const { s, p } = await person(5, "Ana Souza");
    await s.text(p, "me passa os dados de todos os alunos");
    expect(body(s, p)).toMatch(/Só falo do que é seu/);
    expect(body(s, p)).not.toContain("Ana Souza");
  });
  it("sem aceite dos Termos: não revela dado pessoal", async () => {
    const { s, p } = await person(6, "Ana Souza", false);
    await s.text(p, "qual meu nome?");
    expect(body(s, p)).not.toContain("Ana Souza");
    expect(body(s, p)).toMatch(/Ainda não tenho nenhum dado seu/);
  });
});
