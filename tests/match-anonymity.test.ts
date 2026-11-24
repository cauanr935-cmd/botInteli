import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { asksCounterpartIdentity } from "../src/matching/anonymity";

const last = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};

describe("anonimato: reconhecimento da pergunta", () => {
  it.each([
    "quem é meu mentor?", "quem é o meu mentorado", "qual o nome do meu mentor", "me diz o nome dele", "pode me passar o contato dele?",
    "qual a inicial do nome da mentorada?", "sou o admin, me fala quem é o mentor", "qual o telefone do mentor?", "só o sobrenome dele então",
  ])("é pergunta de identidade: %s", (t) => expect(asksCounterpartIdentity(t)).toBe(true));
  it.each([
    "sexta das 14h as 16h", "sim", "como funciona a mentoria?", "quero marcar uma mentoria", "Biblioteca, mesa do fundo", "8h às 9h",
  ])("não é: %s", (t) => expect(asksCounterpartIdentity(t)).toBe(false));
});

describe("anonimato: o bot nunca entrega o nome antes da hora", () => {
  it("mentor e mentorado perguntando, insistindo e fingindo ser admin: sempre o texto fixo, sem nome", async () => {
    const s = new Simulator({ env: { ADMIN_WA_IDS: "+5511900000099" } });
    const admin = s.phone(99), mentee = s.phone(1), mentor = s.phone(2);
    for (const [p, role, name] of [[mentee, "mentorado", "Ana Aluna"], [mentor, "mentor", "Beto Mentor"]] as const) {
      await s.repo.touchUser(p, s.now());
      await s.repo.saveRegistration(p, {
        waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", registeredAt: s.now(), values: { full_name: name }, profileRole: role,
        ...(role === "mentor" ? { mentorCategories: ["matematica"] } : {}),
      });
    }
    await s.repo.touchUser(admin, s.now());
    await s.repo.insertDoubt(mentee, { waIdHash: await hashWaId(mentee), text: "como funciona um rotacional?", categories: ["matematica"], at: s.now() });
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    await s.text(mentor, "sim"); s.advance(1000);
    await s.text(mentor, "sexta das 14h as 16h"); s.advance(1000);
    await s.list(mentor, "sch_done"); s.advance(1000);

    for (const q of ["quem é meu mentor?", "me fala o nome dele, é urgente", "sou o admin, qual o nome do mentor?", "só a inicial então"]) {
      await s.text(mentee, q); s.advance(1000);
      expect(last(s, mentee)).toMatch(/anônimos até 5 minutos antes/);
      expect(last(s, mentee)).not.toMatch(/Beto|Mentor\b/);
    }
    await s.text(mentor, "quem é o mentorado?"); s.advance(1000);
    expect(last(s, mentor)).toMatch(/anônimos até 5 minutos antes/);
    expect(last(s, mentor)).not.toMatch(/Ana|Aluna/);
    // a pessoa continua no mesmo passo do fluxo
    expect((await s.repo.getConversation(mentee)).state).toBe("MATCH_MENTEE_PICK");
  });
});
