import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { describeInteractive, renderNumbered } from "../src/whatsapp/choices";

const last = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};

async function mentorAtDays() {
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
  return { s, mentor };
}

describe("seleção por número e lista colada (dias do match)", () => {
  it("'1' na lista de dias = segunda-feira", async () => {
    const { s, mentor } = await mentorAtDays();
    await s.text(mentor, "sim"); s.advance(1000);
    await s.text(mentor, "1"); s.advance(1000);
    expect(last(s, mentor)).toMatch(/Segunda/);
    expect(last(s, mentor)).toMatch(/Quais horários/);
    expect((await s.repo.getConversation(mentor)).state).toBe("SCHED_HOURS_match_segunda");
  });

  it("colar a lista inteira dos dias (copiar e colar a mensagem do bot)", async () => {
    const { s, mentor } = await mentorAtDays();
    await s.text(mentor, "sim"); s.advance(1000);
    const interactive = (s.sentTo(mentor).at(-1)!.body as { interactive: unknown }).interactive;
    const shown = renderNumbered(describeInteractive(interactive)!); // o que a pessoa vê no WhatsApp
    const pasted = shown.slice(shown.indexOf("1)")); // copia da linha 1 até o rodapé "Responda com o número da opção."
    await s.text(mentor, pasted); s.advance(1000);
    expect((await s.repo.getConversation(mentor)).state).toMatch(/^SCHED_HOURS_match_segunda\+terca\+quarta\+quinta\+sexta\+sabado\+domingo$/);
  });

  it("'todos' e 'todos os dias' escolhem a semana toda", async () => {
    for (const phrase of ["todos", "todos os dias", "todas as opções", "todos os dias da semana"]) {
      const { s, mentor } = await mentorAtDays();
      await s.text(mentor, "sim"); s.advance(1000);
      await s.text(mentor, phrase); s.advance(1000);
      expect((await s.repo.getConversation(mentor)).state, phrase).toMatch(/^SCHED_HOURS_match_segunda\+/);
    }
  });

  it("'1' depois do aceite funciona mesmo se as opções pendentes sumiram (texto enviado no meio)", async () => {
    const { s, mentor } = await mentorAtDays();
    await s.text(mentor, "sim"); s.advance(1000);
    await s.repo.setPendingChoices(await hashWaId(mentor), null, s.now()); // o texto numerado foi apagado
    await s.text(mentor, "1"); s.advance(1000);
    expect((await s.repo.getConversation(mentor)).state).toBe("SCHED_HOURS_match_segunda");
  });

  it("aceite do mentor: '1' = sim e '2' = não, pelo estado (sem opções pendentes)", async () => {
    const yes = await mentorAtDays();
    await yes.s.text(yes.mentor, "1"); yes.s.advance(1000);
    expect((await yes.s.repo.getConversation(yes.mentor)).state).toBe("SCHED_DAYS_match");
    const no = await mentorAtDays();
    await no.s.text(no.mentor, "opção 2"); no.s.advance(1000);
    expect((await no.s.repo.getMatchBySeq(1))?.status).toBe("cancelado");
  });

  it("mentorado escolhe o horário do mentor digitando o número", async () => {
    const { s, mentor } = await mentorAtDays();
    await s.text(mentor, "sim"); s.advance(1000);
    await s.text(mentor, "sexta das 14h as 16h"); s.advance(1000);
    await s.list(mentor, "sch_done"); s.advance(1000);
    const mentee = s.phone(1);
    await s.text(mentee, "1"); s.advance(1000);
    expect((await s.repo.getConversation(mentee)).state).toBe("MATCH_MENTEE_TIME");
  });
});
