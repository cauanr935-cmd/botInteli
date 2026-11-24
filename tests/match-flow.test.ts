import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { parseCancelArgs, parseMatchArgs } from "../src/matching/flow";

const last = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};

async function setup() {
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
  await s.repo.saveAvailability(mentor, "perfil", s.now(), [{ day: "segunda", start: "08:00", end: "10:00" }]);
  await s.repo.insertDoubt(mentee, { waIdHash: await hashWaId(mentee), text: "como funciona um rotacional?", categories: ["matematica"], at: s.now() });
  return { s, admin, mentee, mentor };
}

describe("matching: leitura dos argumentos", () => {
  it("/match aceita D12 M3, d12 m3 e 12 3; /cancelar aceita 5, #5, x5", () => {
    for (const a of ["D12 M3", "d12 m3", "12 3"]) expect(parseMatchArgs(a)).toEqual({ doubtSeq: 12, mentorSeq: 3 });
    expect(parseMatchArgs("D12")).toBeNull();
    expect(parseMatchArgs("D12 M3 M4")).toBeNull();
    for (const a of ["5", "#5", "x5"]) expect(parseCancelArgs(a)).toBe(5);
    expect(parseCancelArgs("abc")).toBeNull();
  });
});

describe("matching: /match e horários do mentor", () => {
  it("/match pergunta ao mentor se aceita; só depois vêm os horários, guardados NO MATCH (não no perfil)", async () => {
    const { s, admin, mentor } = await setup();
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    expect(last(s, admin)).toMatch(/Match #1 criado: D1 ⇄ M2 \(Beto Mentor\)/);
    expect(last(s, mentor)).toMatch(/Oi, Beto! .*dúvida de Matemática.*rotacional.*Você aceita dar essa mentoria\?/s);
    expect((await s.repo.getConversation(mentor)).state).toBe("MATCH_MENTOR_ACCEPT");
    expect(await s.repo.listOpenDoubts(10)).toHaveLength(0);
    await s.text(mentor, "sim"); s.advance(1000);
    expect(last(s, mentor)).toMatch(/Em quais dias/);
    expect((await s.repo.getConversation(mentor)).state).toBe("SCHED_DAYS_match");

    await s.text(mentor, "sexta das 14h as 16h"); s.advance(1000);
    expect((await s.repo.getMatchBySeq(1))?.mentorSlots).toEqual([{ day: "sexta", start: "14:00", end: "16:00" }]);
    expect(last(s, mentor)).toMatch(/Vou passar esses horários pro mentorado/);
    expect((await s.repo.getConversation(mentor)).state).toBe("COMPLETED");
    const m = (await s.repo.getMatchBySeq(1))!;
    expect(m.status).toBe("aguardando_mentorado");
    expect(m.mentorSlots).toHaveLength(1);
    expect(last(s, admin)).toMatch(/Match #1: o mentor mandou os horários[\s\S]*14h às 16h/);
    // o perfil do mentor continua com a disponibilidade de antes
    expect((await s.repo.getRegistration(mentor)).availabilitySlots).toEqual([{ day: "segunda", start: "08:00", end: "10:00" }]);
  });

  it("mentor que diz NÃO: match cancelado, dúvida volta para a lista e o admin é avisado", async () => {
    const { s, admin, mentor } = await setup();
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    await s.text(mentor, "não"); s.advance(1000);
    expect((await s.repo.getMatchBySeq(1))?.status).toBe("cancelado");
    expect(await s.repo.listOpenDoubts(10)).toHaveLength(1);
    expect(last(s, admin)).toMatch(/NÃO aceitou/);
    expect((await s.repo.getConversation(mentor)).state).toBe("COMPLETED");
  });

  it("recusas: dúvida/mentor inexistente, dúvida já em match, mentor ocupado, formato errado", async () => {
    const { s, admin } = await setup();
    await s.text(admin, "/match D9 M2"); s.advance(1000);
    expect(last(s, admin)).toMatch(/Não achei a dúvida D9/);
    await s.text(admin, "/match D1 M9"); s.advance(1000);
    expect(last(s, admin)).toMatch(/Não achei o mentor M9/);
    await s.text(admin, "/match D1"); s.advance(1000);
    expect(last(s, admin)).toMatch(/^Uso: \/match/);
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    expect(last(s, admin)).toMatch(/não está aberta/);
  });

  it("/cancelar reabre a dúvida, solta o mentor e avisa; o mentor não fica preso", async () => {
    const { s, admin, mentor } = await setup();
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    await s.text(admin, "/cancelar 1"); s.advance(1000);
    expect(last(s, admin)).toMatch(/Match #1 cancelado/);
    expect(await s.repo.listOpenDoubts(10)).toHaveLength(1);
    expect(last(s, mentor)).toMatch(/foi cancelada/);
    expect((await s.repo.getConversation(mentor)).state).toBe("COMPLETED");
    await s.text(admin, "/cancelar 1"); s.advance(1000);
    expect(last(s, admin)).toMatch(/já estava cancelado/);
    // dá para refazer o match com a mesma dúvida
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    expect(last(s, admin)).toMatch(/Match #2 criado/);
  });

  it("mentor que ficou em estado de match com o match cancelado por fora é solto na próxima mensagem", async () => {
    const { s, admin, mentor } = await setup();
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    await s.repo.cancelMatch(1, s.now());
    await s.text(mentor, "oi"); s.advance(1000);
    expect((await s.repo.getConversation(mentor)).state).not.toMatch(/^SCHED_/);
  });

  it("não-admin não consegue criar match", async () => {
    const { s, mentee } = await setup();
    await s.text(mentee, "/match D1 M2"); s.advance(1000);
    expect(await s.repo.listOpenDoubts(10)).toHaveLength(1);
  });
});

async function untilMenteePick() {
  const ctx = await setup();
  const { s, admin, mentor } = ctx;
  await s.text(admin, "/match D1 M2"); s.advance(1000);
  await s.text(mentor, "sim"); s.advance(1000);
  await s.text(mentor, "sexta das 14h as 16h"); s.advance(1000);
  await s.list(mentor, "sch_done"); s.advance(1000);
  return ctx;
}

describe("matching: mentorado escolhe horário e local; confirmação; sem horário em comum", () => {
  it("passos c-e: lista os horários ao mentorado, pede o local em texto livre e confirma para os dois", async () => {
    const { s, admin, mentee, mentor } = await untilMenteePick();
    expect(last(s, mentee)).toMatch(/Oi, Ana! .*Achei um mentor.*rotacional.*Qual fica melhor/s);
    expect((await s.repo.getConversation(mentee)).state).toBe("MATCH_MENTEE_PICK");
    await s.list(mentee, "mm_s_0"); s.advance(1000);
    expect(last(s, mentee)).toMatch(/De que horas a que horas/);
    expect((await s.repo.getConversation(mentee)).state).toBe("MATCH_MENTEE_TIME");
    await s.text(mentee, "14h às 14h10"); s.advance(1000); // mínimo de 20 minutos
    expect(last(s, mentee)).toMatch(/pelo menos 20 minutos/);
    await s.text(mentee, "14h às 15h"); s.advance(1000); // a faixa livre do mentor (14h-16h) não é a duração
    expect(last(s, mentee)).toMatch(/onde você quer fazer a mentoria/);
    expect((await s.repo.getConversation(mentee)).state).toBe("MATCH_MENTEE_PLACE");
    expect((await s.repo.getMatchBySeq(1))).toMatchObject({ status: "aguardando_local", chosenDay: "sexta", chosenStart: "14:00", chosenEnd: "15:00" });

    await s.text(mentee, "oi"); s.advance(1000); // comando solto não vale como local
    expect(last(s, mentee)).toMatch(/Me diz o local/);
    await s.text(mentee, "Biblioteca, mesa do fundo"); s.advance(1000);
    expect(last(s, mentee)).toMatch(/Mentoria confirmada!.*Sexta, 13\/11 · 14h às 15h.*Biblioteca, mesa do fundo/s);
    expect(last(s, mentee)).not.toMatch(/Beto/); // anônimo até 5 min antes
    // Critérios da sessão chegam na MESMA mensagem da confirmação (1 resposta), com a linha do papel de cada um.
    expect(last(s, mentee)).toMatch(/Atividade Complementar.*nome e matrícula.*sem cortes.*20 min.*Mentorado: chegue/s);
    expect(last(s, mentor)).toMatch(/Atividade Complementar.*nome e matrícula.*sem cortes.*20 min.*Mentor: conduza/s);
    expect(last(s, mentee)).not.toMatch(/blockchain|Qwen|hash|certificado/i); // sem a arquitetura do analisador
    expect(last(s, mentor)).toMatch(/Mentoria confirmada!.*Sexta, 13\/11 · 14h às 15h.*Biblioteca, mesa do fundo/s);
    expect(last(s, mentor)).not.toMatch(/Ana/);
    expect(last(s, admin)).toMatch(/Match #1 confirmado/);
    expect((await s.repo.getMatchBySeq(1))).toMatchObject({ status: "confirmado", location: "Biblioteca, mesa do fundo" });
    expect((await s.repo.getConversation(mentee)).state).toBe("COMPLETED");
    expect(await s.repo.getActiveMatchFor(mentee)).toBeNull(); // confirmado libera os dois para outros matches
  });

  it("passo f: 'Nenhum desses' avisa o mentor e pede nova grade (volta ao passo a); depois o ciclo segue", async () => {
    const { s, admin, mentee, mentor } = await untilMenteePick();
    await s.list(mentee, "mm_none"); s.advance(1000);
    expect(last(s, mentee)).toMatch(/Vou pedir novos horários pro mentor/);
    expect((await s.repo.getConversation(mentee)).state).toBe("COMPLETED");
    expect(last(s, mentor)).toMatch(/Beto, os horários que você passou não bateram.*Em quais dias/s);
    expect((await s.repo.getConversation(mentor)).state).toBe("SCHED_DAYS_match");
    expect((await s.repo.getMatchBySeq(1))).toMatchObject({ status: "sem_horario", mentorSlots: [] });
    expect(last(s, admin)).toMatch(/não bateram/);

    await s.text(mentor, "sabado das 10h as 12h"); s.advance(1000);
    await s.list(mentor, "sch_done"); s.advance(1000);
    expect(last(s, mentee)).toMatch(/Qual fica melhor/);
    expect((await s.repo.getConversation(mentee)).state).toBe("MATCH_MENTEE_PICK");
    expect((await s.repo.getMatchBySeq(1))?.mentorSlots).toEqual([{ day: "sabado", start: "10:00", end: "12:00" }]);
  });

  it("/cancelar com o mentorado na lista: ele é solto e avisado", async () => {
    const { s, admin, mentee } = await untilMenteePick();
    await s.text(admin, "/cancelar 1"); s.advance(1000);
    expect(last(s, mentee)).toMatch(/foi cancelada/);
    expect((await s.repo.getConversation(mentee)).state).toBe("COMPLETED");
    expect(await s.repo.listOpenDoubts(10)).toHaveLength(1);
  });

  it("linha antiga de uma lista cancelada não quebra nada", async () => {
    const { s, admin, mentee } = await untilMenteePick();
    await s.text(admin, "/cancelar 1"); s.advance(1000);
    const before = s.sentTo(mentee).length;
    await s.list(mentee, "mm_s_0"); s.advance(1000);
    expect((await s.repo.getMatchBySeq(1))?.status).toBe("cancelado");
    expect(s.sentTo(mentee).length).toBeGreaterThanOrEqual(before);
  });
});
