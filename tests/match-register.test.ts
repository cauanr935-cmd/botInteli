import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";

const last = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};

/** Match confirmado (sexta 14h-15h), pronto para receber o áudio. */
async function confirmed() {
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
  await s.list(mentee, "mm_s_0"); s.advance(1000);
  await s.text(mentee, "14h às 15h"); s.advance(1000);
  await s.text(mentee, "Biblioteca"); s.advance(1000);
  const match = (await s.repo.getMatchBySeq(1))!;
  return { s, mentee, mentor, match };
}

describe("registro da mentoria a partir do match", () => {
  it("áudio depois do horário: registra direto, sem perguntar contato, assunto nem com quem; pede confirmação à outra pessoa", async () => {
    const { s, mentee, mentor, match } = await confirmed();
    s.advance(match.scheduledAt!.getTime() + 70 * 60_000 - s.now().getTime());
    await s.audio(mentor); s.advance(1000);
    const reply = last(s, mentor);
    expect(reply).toMatch(/Mentoria registrada!.*não precisa me passar nada/s);
    expect(reply).not.toMatch(/contato|com quem|assunto da mentoria/i);
    expect((await s.repo.getConversation(mentor)).state).toBe("AWAIT_AUDIO");
    const rows = await s.repo.listMentorias({ limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "mentor", subject: "como funciona um rotacional?" });
    expect((await s.repo.getMatchBySeq(1))?.status).toBe("realizada");
    expect(last(s, mentee)).toMatch(/participou de uma mentoria/);
  });

  it("áudio ANTES do horário: não rejeita, pergunta; 'não' ignora e apaga o áudio", async () => {
    const { s, mentor } = await confirmed();
    await s.audio(mentor); s.advance(1000);
    expect(last(s, mentor)).toMatch(/antes do horário marcado/);
    expect((await s.repo.getConversation(mentor)).state).toBe("MENT_EARLY_CONFIRM");
    await s.text(mentor, "não"); s.advance(1000);
    expect(last(s, mentor)).toMatch(/ignorei esse áudio/);
    expect((await s.repo.getConversation(mentor)).state).toBe("AWAIT_AUDIO");
    expect(await s.repo.listMentorias({ limit: 10 })).toHaveLength(0);
    expect((await s.repo.getMatchBySeq(1))?.status).toBe("confirmado"); // a mentoria ainda vai acontecer
  });

  it("áudio ANTES do horário: 'sim' aceita e registra com os dados do match", async () => {
    const { s, mentee, mentor } = await confirmed();
    await s.audio(mentor); s.advance(1000);
    await s.text(mentor, "sim"); s.advance(1000);
    expect(last(s, mentor)).toMatch(/Mentoria registrada!.*não precisa me passar nada/s);
    expect((await s.repo.listMentorias({ limit: 10 }))[0]).toMatchObject({ role: "mentor", subject: "como funciona um rotacional?" });
    expect((await s.repo.getMatchBySeq(1))?.status).toBe("realizada");
    expect(last(s, mentee)).toMatch(/participou de uma mentoria/);
  });

  it("sem match confirmado, o fluxo antigo (papel, assunto, data, parceiro) continua igual", async () => {
    const s = new Simulator();
    const p = s.phone(1);
    await s.repo.touchUser(p, s.now());
    await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", registeredAt: s.now(), values: { full_name: "Ana" }, profileRole: "mentorado" });
    await s.repo.saveConversation(p, 0, { state: "AWAIT_AUDIO", previousState: null, hintSentInState: false, optedOutAt: null });
    await s.audio(p); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("MENT_ROLE");
  });
});
