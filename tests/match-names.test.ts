import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { createLogger } from "../src/lib/logger";
import { sendNamesDue, type ReminderDeps } from "../src/matching/reminder";
import type { OutboundMessage, SendResult } from "../src/whatsapp/client";

const bodyOf = (m: OutboundMessage): string => ((m as { text?: { body: string } }).text?.body ?? "");

async function confirmedMatch() {
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
  const sent: { to: string; body: string }[] = [];
  const deps = (over: Partial<ReminderDeps> = {}): ReminderDeps => ({
    repo: s.repo, logger: createLogger(), maxPerDay: 200, maxPer10Min: 30, now: () => s.now(),
    send: async (m): Promise<SendResult> => { sent.push({ to: m.to, body: bodyOf(m) }); return { status: "sent" } as SendResult; },
    ...over,
  });
  return { s, mentee, mentor, match, sent, deps };
}

describe("matching: nomes só 5 minutos antes", () => {
  it("antes da janela ninguém recebe o nome; dentro dela cada um recebe o do outro, uma vez só", async () => {
    const { s, mentee, mentor, match, sent, deps } = await confirmedMatch();
    expect(match.status).toBe("confirmado");
    const start = match.scheduledAt!.getTime();
    s.advance(start - 6 * 60_000 - s.now().getTime());
    expect(await sendNamesDue(deps())).toBe(0);
    expect(sent).toHaveLength(0);

    s.advance(2 * 60_000); // faltam 4 min
    expect(await sendNamesDue(deps())).toBe(1);
    expect(sent.find((x) => x.to === mentor)?.body).toMatch(/Seu mentorado é Ana.*Biblioteca/s);
    expect(sent.find((x) => x.to === mentee)?.body).toMatch(/Seu mentor é Beto.*Biblioteca/s);

    expect(await sendNamesDue(deps())).toBe(0); // próxima rodada do cron: nada repetido
    expect(sent).toHaveLength(2);
    expect((await s.repo.getMatchBySeq(1))?.namesSentAt).not.toBeNull();
  });

  it("falha de envio nos dois: libera para a próxima rodada tentar de novo", async () => {
    const { s, match, sent, deps } = await confirmedMatch();
    s.advance(match.scheduledAt!.getTime() - 3 * 60_000 - s.now().getTime());
    expect(await sendNamesDue(deps({ send: async () => ({ status: "failed" }) as unknown as SendResult }))).toBe(0);
    expect((await s.repo.getMatchBySeq(1))?.namesSentAt).toBeNull();
    expect(await sendNamesDue(deps())).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it("quem pediu para sair (opt-out) não recebe", async () => {
    const { s, mentor, match, sent, deps } = await confirmedMatch();
    s.advance(match.scheduledAt!.getTime() - 3 * 60_000 - s.now().getTime());
    await s.text(mentor, "sair"); s.advance(1000);
    await sendNamesDue(deps());
    expect(sent.some((x) => x.to === mentor)).toBe(false);
  });
});
