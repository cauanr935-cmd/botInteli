import { describe, it, expect } from "vitest";
import { Simulator, MINUTE } from "../scripts/simulate";
import { PROFILE_TEXTS as T } from "../src/profile/texts";
import { daysReply, hoursReply } from "../src/schedule/decide";

const mk = () => new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "40", MAX_BOT_MSGS_PER_USER_PER_DAY: "100" } });
type Body = { text?: { body: string }; interactive?: { body: { text: string }; action?: { button?: string; sections?: { rows: { id: string; title: string }[] }[] } } };
const last = (s: Simulator, p: string): Body => s.sentTo(p).at(-1)!.body as Body;
const bodyOf = (s: Simulator, p: string): string => last(s, p).text?.body ?? last(s, p).interactive?.body.text ?? "";
const rowIds = (s: Simulator, p: string): string[] => last(s, p).interactive?.action?.sections?.[0]?.rows.map((r) => r.id) ?? [];
const slotsOf = async (s: Simulator, p: string) => (await s.repo.getRegistration(p)).availabilitySlots ?? [];

async function toMentorSchedule(s: Simulator, p: string, role: "prof_mentor" | "prof_both" = "prof_mentor") {
  await s.text(p, "oi"); s.advance(1000);
  await s.button(p, "consent_yes"); s.advance(1000);
  await s.text(p, "Maria da Silva"); s.advance(1000);
  await s.text(p, "T12"); s.advance(1000);
  await s.audio(p); s.advance(1000);
  await s.button(p, role); s.advance(1000);
  await s.list(p, "cat_computacao"); s.advance(1000);
  await s.list(p, "cat_done"); s.advance(1000);
}
const pick = async (s: Simulator, p: string, id: string) => { await s.list(p, id); s.advance(1000); };

describe("dias e horários em listas", () => {
  it("depois das áreas, o mentor vê a lista de dias (sem 'Terminei' ainda)", async () => {
    const s = mk(); const p = s.phone(1);
    await toMentorSchedule(s, p);
    expect(rowIds(s, p)).toEqual(["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"].map((d) => `sch_day_${d}`));
    expect(bodyOf(s, p)).toMatch(/Em quais dias da semana você está disponível para mentorar/);
    expect(last(s, p).interactive?.action?.button).toBe("Escolher dias");
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_mentor");
  });

  it("escolher o dia abre os horários (8h às 20h); um bloco por toque; 'Concluir' aparece depois do primeiro", async () => {
    const s = mk(); const p = s.phone(2);
    await toMentorSchedule(s, p);
    await pick(s, p, "sch_day_segunda");
    expect(bodyOf(s, p)).toMatch(/Quais horários de Segunda/);
    expect(rowIds(s, p)).toEqual(["sch_h_8_10", "sch_h_10_12", "sch_h_12_14", "sch_h_14_16", "sch_h_16_18", "sch_h_18_20", "sch_h_8_12", "sch_h_12_18", "sch_h_8_20"]);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_HOURS_mentor_segunda");
    await pick(s, p, "sch_h_8_10");
    expect(rowIds(s, p)).not.toContain("sch_h_8_10");
    expect(rowIds(s, p).at(-1)).toBe("sch_dayend");
    expect(rowIds(s, p).length).toBeLessThanOrEqual(10);
    expect(await slotsOf(s, p)).toEqual([{ day: "segunda", start: "08:00", end: "10:00" }]);
  });

  it("horários vizinhos viram uma faixa só; escolher a manhã inteira cobre o que já estava", async () => {
    const s = mk(); const p = s.phone(3);
    await toMentorSchedule(s, p);
    await pick(s, p, "sch_day_terca");
    await pick(s, p, "sch_h_8_10");
    await pick(s, p, "sch_h_10_12");
    await pick(s, p, "sch_h_14_16");
    expect(await slotsOf(s, p)).toEqual([{ day: "terca", start: "08:00", end: "12:00" }, { day: "terca", start: "14:00", end: "16:00" }]);
    expect(rowIds(s, p)).not.toContain("sch_h_8_12"); // manhã já coberta
    await pick(s, p, "sch_h_12_18");
    expect(await slotsOf(s, p)).toEqual([{ day: "terca", start: "08:00", end: "18:00" }]); // 8h-12h + 12h-18h viram uma faixa
  });

  it("'Concluir' volta à lista de dias, sem o dia já escolhido, agora com 'Terminei'", async () => {
    const s = mk(); const p = s.phone(4);
    await toMentorSchedule(s, p);
    await pick(s, p, "sch_day_segunda");
    await pick(s, p, "sch_h_8_12");
    await pick(s, p, "sch_dayend");
    expect(rowIds(s, p)).not.toContain("sch_day_segunda");
    expect(rowIds(s, p)).toContain("sch_done");
    expect(bodyOf(s, p)).toMatch(/Anotado:\n• Segunda: 8h às 12h/);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_mentor");
  });

  it("'Dia todo' fecha o dia e já volta à lista de dias (1 mensagem)", async () => {
    const s = mk(); const p = s.phone(5);
    await toMentorSchedule(s, p);
    await pick(s, p, "sch_day_quarta");
    const n = s.sentTo(p).length;
    await pick(s, p, "sch_h_8_20");
    expect(s.sentTo(p).length).toBe(n + 1);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_mentor");
    expect(await slotsOf(s, p)).toEqual([{ day: "quarta", start: "08:00", end: "20:00" }]);
  });

  it("mentor com vários dias: grava tudo, encerra o cadastro e fica COMPLETED", async () => {
    const s = mk(); const p = s.phone(6);
    await toMentorSchedule(s, p);
    await pick(s, p, "sch_day_segunda"); await pick(s, p, "sch_h_8_12"); await pick(s, p, "sch_dayend");
    await pick(s, p, "sch_day_sexta"); await pick(s, p, "sch_h_18_20"); await pick(s, p, "sch_dayend");
    await pick(s, p, "sch_done");
    expect(bodyOf(s, p)).toMatch(/Horários anotados:\n• Segunda: 8h às 12h\n• Sexta: 18h às 20h/);
    expect(bodyOf(s, p)).toContain(T.closingMentor);
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
    const reg = await s.repo.getRegistration(p);
    expect(reg.registeredAt).not.toBeNull();
    expect(reg.availabilitySlots).toHaveLength(2);
  });

  it("'Terminei' sem nenhum dia não avança; linha antiga e texto: 1 dica e silêncio", async () => {
    const s = mk(); const p = s.phone(7);
    await toMentorSchedule(s, p);
    const n = s.sentTo(p).length;
    await pick(s, p, "sch_done");
    await pick(s, p, "sch_h_8_10"); // linha de outra lista
    expect(s.sentTo(p).length).toBe(n);
    await s.text(p, "segunda de manhã"); s.advance(1000);
    expect(bodyOf(s, p)).toBe(T.hintScheduleDays);
    await s.text(p, "segunda de manhã"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1);
  });

  it("mentor e mentorado ('os dois'): informa horários uma vez e depois vai à dúvida, sem perguntar horário de novo", async () => {
    const s = mk(); const p = s.phone(8);
    await toMentorSchedule(s, p, "prof_both");
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_ambos");
    await pick(s, p, "sch_day_segunda"); await pick(s, p, "sch_h_8_12"); await pick(s, p, "sch_dayend"); await pick(s, p, "sch_done");
    expect(bodyOf(s, p)).toContain(T.askDoubt);
    await s.button(p, "doubt_yes"); s.advance(1000);
    await s.text(p, "Como me preparo para entrevistas técnicas?"); s.advance(1000);
    expect(bodyOf(s, p)).toBe(T.closingDoubt); // horários recentes: não pergunta de novo
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
  });

  it("mentorado: depois da dúvida vem 'só para encerrar' e a lista de dias; horários antigos não se misturam", async () => {
    const s = mk(); const p = s.phone(9);
    await s.register(p, 1000);
    await s.repo.saveAvailability(p, "antigo", new Date(s.now().getTime() - 5 * 60 * MINUTE), [{ day: "domingo", start: "08:00", end: "10:00" }]);
    s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "ret_doubt"); s.advance(1000);
    await s.text(p, "Como faço um join em SQL?"); s.advance(1000);
    expect(bodyOf(s, p)).toMatch(/^Dúvida registrada! Agora, só para encerrar: Em quais dias da semana você está disponível para a mentoria\?/);
    expect(rowIds(s, p)).toHaveLength(7); // domingo antigo foi limpo
    expect(await slotsOf(s, p)).toEqual([]);
    await pick(s, p, "sch_day_sabado"); await pick(s, p, "sch_h_8_12"); await pick(s, p, "sch_dayend"); await pick(s, p, "sch_done");
    expect(bodyOf(s, p)).toContain(T.closingScheduleDoubt);
    expect(await slotsOf(s, p)).toEqual([{ day: "sabado", start: "08:00", end: "12:00" }]);
  });

  it("'sair' no meio do fluxo é honrado e 'voltar' reapresenta a lista certa", async () => {
    const s = mk(); const p = s.phone(10);
    await toMentorSchedule(s, p);
    await pick(s, p, "sch_day_segunda");
    await s.text(p, "sair"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("OPTED_OUT");
    await s.text(p, "voltar"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_HOURS_mentor_segunda");
    expect(bodyOf(s, p)).toMatch(/Quais horários de Segunda/);
  });

  it("as mensagens respeitam os limites da Meta em qualquer combinação", () => {
    const all = (["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"] as const)
      .map((day) => ({ day, start: "08:00", end: "10:00" }));
    expect(() => daysReply("mentor", [])).not.toThrow();
    expect(() => daysReply("mentor", all.slice(0, 6))).not.toThrow();
    expect(() => hoursReply("segunda", [{ day: "segunda", start: "08:00", end: "10:00" }])).not.toThrow();
    expect(() => hoursReply("sabado", [{ day: "sabado", start: "10:00", end: "12:00" }])).not.toThrow();
  });
});
