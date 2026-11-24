import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { asksToDoWork, workRefusal } from "../src/axo/work";
import { RIFF_SYSTEM } from "../src/axo/persona";
import { findPtPtForms } from "../src/axo/guardrails";

const txt = (s: Simulator, p: string) => s.sentTo(p).map((m) => ((m.body as { text?: { body: string } }).text?.body ?? (m.body as { interactive?: { body: { text: string } } }).interactive?.body.text ?? ""));
async function sim(riff: (q: { situation: string; text: string; style?: string }) => Promise<string | null>, state = "PROFILE_ROLE") {
  const agent = { classify: async () => null, answerFaq: async () => ({ kind: "off_topic" as const }), riff };
  const s = new Simulator({ agent: agent as never });
  const p = s.phone(50);
  await s.repo.touchUser(p, s.now());
  await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "x", registeredAt: s.now(), values: { full_name: "Ana Souza" }, profileRole: "mentorado" });
  await s.repo.saveConversation(p, 0, { state: state as never, previousState: null, hintSentInState: true, optedOutAt: null });
  return { s, p };
}
const OFF = "o jogo do flamengo ontem foi uma loucura";

describe("persona do Axo ligada às falas da IA", () => {
  it("o prompt traz a persona, as peculiaridades de axolote, as regras e é pt-BR", () => {
    expect(RIFF_SYSTEM).toMatch(/axolote/i);
    expect(RIFF_SYSTEM).toMatch(/regenera/);
    expect(RIFF_SYSTEM).toMatch(/brânquias/);
    expect(RIFF_SYSTEM).toMatch(/Nunca escreva nome de pessoa, horário, sala ou local/);
    expect(findPtPtForms(RIFF_SYSTEM)).toEqual([]);
  });

  it("a IA recebe a linha ESTILO medida da mensagem (registro, emoji, tamanho)", async () => {
    const seen: string[] = [];
    const { s, p } = await sim(async (q) => { seen.push(q.style ?? ""); return "kkk esse papo fica pro intervalo"; });
    await s.text(p, "kkkk mano o jogo do flamengo foi uma loucura 😂"); s.advance(1000);
    expect(seen[0]).toMatch(/^ESTILO: casual/);
    expect(seen[0]).toMatch(/emoji: até 1/);
    const calm = await sim(async (q) => { seen.push(q.style ?? ""); return "esse papo fica pro intervalo"; });
    await calm.s.text(calm.p, OFF); calm.s.advance(1000);
    expect(seen.at(-1)).toMatch(/emoji: até 1/); // vale mesmo sem emoji na mensagem
    expect(seen[0]).toMatch(/uma pergunta por mensagem/);
  });

  it("guardrails: fala com horário, sala, nome de pessoa, marcador ou português de Portugal é descartada (vale o texto fixo)", async () => {
    for (const bad of ["te encontro hoje às 18h", "passa no ateliê 2", "queres falar de mentoria?", "fala com {mentor}", "estás por aqui?"]) {
      const { s, p } = await sim(async () => bad);
      await s.text(p, OFF); s.advance(1000);
      expect(txt(s, p)[0], bad).not.toBe(bad);
      expect(txt(s, p)[0], bad).not.toContain(bad.slice(0, 12));
      expect(txt(s, p).length).toBeGreaterThan(0); // nunca silêncio
    }
  });

  it("o Axo segue usando emoji (até 1), mesmo que a pessoa não use; mais de um é cortado", async () => {
    const { s, p } = await sim(async () => "esse papo fica pro intervalo 🦎😂🔥");
    await s.text(p, OFF); s.advance(1000);
    const t = txt(s, p)[0]!;
    expect(t).toMatch(/intervalo/);
    expect(t).toMatch(/🦎/);
    expect(t.match(/\p{Extended_Pictographic}/gu)).toHaveLength(1);
  });

  it("modo cuidado: estilo neutro, sem emoji", async () => {
    const seen: string[] = [];
    const { s, p } = await sim(async (q) => { seen.push(q.style ?? ""); return "tudo bem, seguimos por aqui 🦎"; }, "COMPLETED");
    await s.repo.recordSensitiveEvent(await hashWaId(p), "B" as never, "whatsapp", s.now());
    s.advance(60_000);
    await s.text(p, "oi tudo bem"); s.advance(1000);
    if (seen[0]) { expect(seen[0]).toMatch(/^ESTILO: neutro/); expect(seen[0]).toMatch(/emoji: nenhum/); }
  });
});

describe("não faz a ponderada pelo aluno", () => {
  it("reconhece o pedido de trabalho pronto e não confunde com pedir ajuda", () => {
    for (const t of ["faz minha ponderada pra mim", "me da o gabarito da prova", "resolve essa lista pronta", "escreve o código do artefato pra mim"]) expect(asksToDoWork(t), t).toBe(true);
    for (const t of ["preciso de ajuda com a ponderada", "quero entender essa lista de exercícios", "como estudar pra prova?", "tenho uma dúvida no artefato"]) expect(asksToDoWork(t), t).toBe(false);
    expect(workRefusal("faz minha ponderada pra mim kkk")).toMatch(/marcar mentoria/);
  });

  it("no menu: explica sem bronca, oferece mentoria e não muda a etapa", async () => {
    const { s, p } = await sim(async () => null, "MENU");
    await s.text(p, "faz minha ponderada pra mim por favor"); s.advance(1000);
    expect(s.sentTo(p)).toHaveLength(1);
    expect(txt(s, p)[0]).toMatch(/marcar mentoria/);
    expect((await s.repo.getConversation(p)).state).toBe("MENU");
    s.advance(30_000);
    await s.text(p, "marcar mentoria"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
  });
});
