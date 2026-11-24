import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { matchChoices } from "../src/whatsapp/choices";
import { looksStrangeName, readNameAnswer } from "../src/registration/strange-name";

const txt = (s: Simulator, p: string) => s.sentTo(p).map((m) => ((m.body as { text?: { body: string } }).text?.body ?? (m.body as { interactive?: { body: { text: string } } }).interactive?.body.text ?? ""));
async function person(state: string) {
  const s = new Simulator();
  const p = s.phone(70);
  await s.repo.touchUser(p, s.now());
  await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "x", registeredAt: s.now(), values: { full_name: "Ana Souza" }, profileRole: "mentorado" });
  await s.repo.saveConversation(p, 0, { state: state as never, previousState: null, hintSentInState: false, optedOutAt: null });
  return { s, p };
}

describe("nomes estranhos", () => {
  it("mapeia palavras fora do comum e deixa nomes reais passarem", () => {
    for (const n of ["Sofá", "Beleza Silva", "teste teste", "aaaaa bbb", "João123", "Pikachu Souza"]) expect(looksStrangeName(n), n).toBe(true);
    for (const n of ["Ana Souza", "João Pedro Lima", "Mariana Luz", "Cauan Rodrigues"]) expect(looksStrangeName(n), n).toBe(false);
  });
  it("entende a resposta de confirmação", () => {
    for (const t of ["sim", "sim, é meu nome", "isso mesmo", "1"]) expect(readNameAnswer(t), t).toBe("yes");
    for (const t of ["não", "nao é", "errei", "2"]) expect(readNameAnswer(t), t).toBe("no");
    expect(readNameAnswer("talvez")).toBeNull();
  });
  it("sim: segue; não: pergunta o certo; estranho de novo: segue sem perguntar", async () => {
    const { s, p } = await person("REG_FIELD_full_name");
    await s.text(p, "Beleza Silva"); s.advance(30_000);
    expect(txt(s, p).at(-1)).toMatch(/é mesmo o seu nome/);
    await s.text(p, "sim, é meu nome"); s.advance(30_000);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_class_name");

    const b = await person("REG_FIELD_full_name");
    await b.s.text(b.p, "Sofá"); b.s.advance(30_000);
    await b.s.text(b.p, "não"); b.s.advance(30_000);
    expect(txt(b.s, b.p).at(-1)).toMatch(/Qual é o seu nome completo/);
    await b.s.text(b.p, "Sofá Cama"); b.s.advance(30_000);
    expect((await b.s.repo.getConversation(b.p)).state).toBe("REG_FIELD_class_name");
  });
});

describe("vários números de uma vez", () => {
  const opts = Array.from({ length: 5 }, (_, i) => ({ id: `sch_day_${i}`, title: `Dia ${i}` }));
  it("aceita vírgulas, 'e' e faixas", () => {
    expect(matchChoices("1,2,3,4,5", opts)?.length).toBe(5);
    expect(matchChoices("1, 3 e 5", opts)?.map((o) => o.id)).toEqual(["sch_day_0", "sch_day_2", "sch_day_4"]);
    expect(matchChoices("1-3", opts)?.length).toBe(3);
    expect(matchChoices("2 a 4", opts)?.length).toBe(3);
  });
  it("dias: '1,3,5' vai para os horários dos três; horários: '1,2' vale para todos", async () => {
    const { s, p } = await person("SCHED_DAYS_doubt");
    await s.text(p, "segunda, quarta e sexta"); s.advance(30_000);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_HOURS_doubt_segunda+quarta+sexta");
    expect(txt(s, p).at(-1)).toMatch(/Segunda, Quarta e Sexta/);
    await s.text(p, "8h às 10h, 14h às 16h"); s.advance(30_000);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_doubt");
    expect(txt(s, p).at(-1)).toMatch(/Segunda[\s\S]*Quarta[\s\S]*Sexta/);
  });
});

describe("dia e horário de uma vez: grava e encerra, sem perguntar de novo", () => {
  it("'posso na segunda após as 17' -> anota e encerra na hora", async () => {
    const { s, p } = await person("SCHED_DAYS_doubt");
    await s.text(p, "posso na segunda após as 17"); s.advance(30_000);
    expect(txt(s, p).at(-1)).toMatch(/Segunda: 17h/);
    expect(txt(s, p).at(-1)).not.toMatch(/Está correto|incluir mais/);
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
  });
  it("'até as 12' funciona; só o dia segue perguntando o horário", async () => {
    const { s, p } = await person("SCHED_DAYS_doubt");
    await s.text(p, "terça até as 12"); s.advance(30_000);
    expect(txt(s, p).at(-1)).toMatch(/Terça/);
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
    const o = await person("SCHED_DAYS_doubt");
    await o.s.text(o.p, "quarta"); o.s.advance(30_000);
    expect((await o.s.repo.getConversation(o.p)).state).toBe("SCHED_HOURS_doubt_quarta");
    expect(txt(o.s, o.p).at(-1)).toMatch(/Quais horários/);
  });
});

import { looksHeavyName } from "../src/registration/strange-name";
import { ageVerdict, parseAge } from "../src/registration/age";

describe("nome pesado e idade", () => {
  it("nomes pesados são barrados, nomes normais não", () => {
    for (const n of ["Hitler", "Benito Mussoline", "ladrão da silva", "Mussolinii"]) expect(looksHeavyName(n), n).toBe(true);
    for (const n of ["Ana Souza", "Pedro Franco", "Cauan Rodrigues"]) expect(looksHeavyName(n), n).toBe(false);
  });
  it("lê a idade e classifica", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(parseAge("tenho 20 anos", now)).toBe(20);
    expect(parseAge("2004", now)).toBe(22);
    expect(parseAge("17/11/2000", now)).toBe(26);
    expect(parseAge("vinte", now)).toBeNull();
    expect([16, 17, 25, 26, 30].map(ageVerdict)).toEqual(["young", "ok", "ok", "liar26", "old"]);
  });
  it("fluxo: nome pesado não passa; idade fora da faixa fica na pergunta; idade certa segue", async () => {
    const { s, p } = await person("REG_FIELD_full_name");
    await s.text(p, "Hitler"); s.advance(30_000);
    expect(txt(s, p).at(-1)).toMatch(/não registro/);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_full_name");
    await s.text(p, "Ana Souza"); s.advance(30_000);
    await s.text(p, "T27"); s.advance(30_000);
    expect((await s.repo.getConversation(p)).state).toBe("REG_AGE");
    await s.text(p, "26"); s.advance(30_000);
    expect(txt(s, p).at(-1)).toMatch(/mentindo pra mim/);
    await s.text(p, "16"); s.advance(30_000);
    expect(txt(s, p).at(-1)).toMatch(/menos de 17/);
    expect((await s.repo.getConversation(p)).state).toBe("REG_AGE");
    await s.text(p, "35"); s.advance(30_000);
    expect(txt(s, p).at(-1)).toMatch(/17 a 25/);
    await s.text(p, "20"); s.advance(30_000);
    expect((await s.repo.getConversation(p)).state).toBe("REG_PROFILE_AUDIO");
  });
});
