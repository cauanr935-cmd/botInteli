import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { isSelectAll, matchPastedList } from "../src/whatsapp/choices";

const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"].map((t, i) => ({ id: `sch_day_${i}`, title: t }));
const pasted = "1) Segunda\n2) Terça\n3) Quarta\n4) Quinta\n5) Sexta\n6) Sábado\n7) Domingo\n\nResponda com o número da opção.";

describe("lista colada e 'todas'", () => {
  it("a lista inteira copiada vira todas as opções, ignorando o rodapé", () => {
    expect(matchPastedList(pasted, dias)?.map((o) => o.title)).toEqual(dias.map((d) => d.title));
  });
  it("uma linha só não é lista colada; número fora da lista = null", () => {
    expect(matchPastedList("1) Segunda", dias)).toBeNull();
    expect(matchPastedList("1) Segunda\n9) Nada", dias)).toBeNull();
  });
  it("reconhece 'todas', 'todos os dias', 'quero todos'", () => {
    for (const t of ["todas", "Todos!", "todos os dias", "quero todos", "tudo"]) expect(isSelectAll(t)).toBe(true);
    expect(isSelectAll("todas as segundas")).toBe(false);
  });
});

const mk = () => new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "40", MAX_BOT_MSGS_PER_USER_PER_DAY: "100" } });
async function toMentorDays(s: Simulator, p: string) {
  await s.text(p, "oi"); s.advance(1000);
  await s.button(p, "consent_yes"); s.advance(1000);
  await s.text(p, "Maria da Silva"); s.advance(1000);
  await s.text(p, "T12"); s.advance(1000); await s.text(p, "20"); s.advance(1000);
  await s.audio(p); s.advance(1000);
  await s.button(p, "prof_mentor"); s.advance(1000);
  await s.list(p, "cat_computacao"); s.advance(1000);
  await s.list(p, "cat_done"); s.advance(1000);
}

describe("seleção de dias pelo número", () => {
  it("'1' é segunda e abre os horários de segunda", async () => {
    const s = mk(); const p = s.phone(1);
    await toMentorDays(s, p);
    await s.text(p, "1"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_HOURS_mentor_segunda");
  });
  it("'1' funciona mesmo com as opções pendentes expiradas (resposta no dia seguinte)", async () => {
    const s = mk(); const p = s.phone(2);
    await toMentorDays(s, p);
    s.advance(20 * 60 * 60 * 1000);
    await s.text(p, "1"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_HOURS_mentor_segunda");
  });
  it("colar a lista inteira escolhe todos os dias (e vai para os horários deles)", async () => {
    const s = mk(); const p = s.phone(3);
    await toMentorDays(s, p);
    await s.text(p, pasted); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_HOURS_mentor_segunda+terca+quarta+quinta+sexta+sabado+domingo");
  });
  it("'todas' escolhe todos os dias", async () => {
    const s = mk(); const p = s.phone(4);
    await toMentorDays(s, p);
    await s.text(p, "todas"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toContain("SCHED_HOURS_mentor_segunda+terca");
  });
});

describe("lista colada: variações de copiar e colar", () => {
  const opts = ["Segunda-feira", "Terça-feira", "Quarta-feira"].map((title, i) => ({ id: `sch_day_${i}`, title }));
  it("prefixo de data do WhatsApp na primeira linha", () => {
    const text = "[14:05, 18/11/2026] Axo: 1) Segunda-feira\n2) Terça-feira\n3) Quarta-feira\n\nResponda com o número da opção.";
    expect(matchPastedList(text, opts)?.map((o) => o.title)).toEqual(["Segunda-feira", "Terça-feira", "Quarta-feira"]);
  });
  it("emoji numerado e marcadores", () => {
    expect(matchPastedList("1️⃣ Segunda-feira\n2️⃣ Terça-feira", opts)?.length).toBe(2);
    expect(matchPastedList("• 1. Segunda-feira\n• 2. Terça-feira", opts)?.length).toBe(2);
  });
  it("uma frase com número solto não vira lista", () => {
    expect(matchPastedList("14 pessoas vão\n15 também", opts)).toBeNull();
  });
});
