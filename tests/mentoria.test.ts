import { describe, it, expect } from "vitest";
import { Simulator, MINUTE } from "../scripts/simulate";
import { DEFAULT_SERVICES } from "../src/services/content";
import { TEXTS } from "../src/conversation/texts";

const mkSim = () => {
  const s = new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "20", MAX_BOT_MSGS_PER_USER_PER_DAY: "60" } });
  s.repo.services = [...DEFAULT_SERVICES];
  Object.assign(s.analyzer, { deferred: true });
  return s;
};
const lastBody = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};
async function toMenu(s: Simulator, p: string) {
  await s.register(p, 1000);
  s.advance(11 * MINUTE);
  await s.text(p, "menu"); s.advance(1000);
}

describe("menu e serviços", () => {
  it("o menu não tem 'Análise de áudio' e tem Registrar mentoria, Horários e Contato", () => {
    expect(DEFAULT_SERVICES.map((x) => x.title)).toEqual(["Registrar mentoria", "Horários", "Contato"]);
  });

  it("Registrar mentoria: pede o arquivo, guarda e pergunta o papel (a mentoria só fica completa depois)", async () => {
    const s = mkSim();
    const p = s.phone(1);
    await toMenu(s, p);
    const before = s.sentTo(p).length;
    await s.list(p, "svc_mentoria"); s.advance(1000);
    expect(lastBody(s, p)).toBe(TEXTS.audioInstruction);
    expect(lastBody(s, p)).toMatch(/Anexe o arquivo de áudio da mentoria/);
    expect((await s.repo.getConversation(p)).state).toBe("AWAIT_AUDIO");
    await s.audio(p);
    expect(s.sentTo(p).length - before).toBe(2); // instrução + pergunta do papel
    expect(lastBody(s, p)).toMatch(/mentor ou mentorado/);
    expect((await s.repo.getConversation(p)).state).toBe("MENT_ROLE");
    expect(await s.repo.listMentorias({ limit: 10 })).toHaveLength(0); // incompleta: ainda não é uma mentoria
    expect(s.store.objects.size).toBe(2); // áudio de perfil + arquivo da mentoria
  });

  it("Registrar mentoria: texto no lugar do áudio recebe 1 dica e depois silêncio", async () => {
    const s = mkSim();
    const p = s.phone(2);
    await toMenu(s, p);
    await s.list(p, "svc_mentoria"); s.advance(1000);
    const n = s.sentTo(p).length;
    await s.text(p, "quero falar sobre carreira"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1);
    await s.text(p, "quero falar sobre carreira"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 2); // dica + aviso descontraído
    expect((await s.repo.getConversation(p)).state).toBe("AWAIT_AUDIO");
  });

  it("Horários: pede dias e horários livres, grava o texto e volta ao menu", async () => {
    const s = mkSim();
    const p = s.phone(3);
    await toMenu(s, p);
    await s.list(p, "svc_horarios"); s.advance(1000);
    expect(lastBody(s, p)).toBe(TEXTS.askAvailability);
    expect((await s.repo.getConversation(p)).state).toBe("AVAILABILITY_TEXT");
    await s.text(p, "oi"); s.advance(1000); // não é horário: dica única
    expect(lastBody(s, p)).toBe(TEXTS.hintAvailability);
    const n = s.sentTo(p).length;
    await s.text(p, "oi"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n); // silêncio
    await s.text(p, "Segunda e quarta, das 14h às 18h"); s.advance(1000);
    expect(lastBody(s, p)).toBe(TEXTS.availabilitySaved);
    expect((await s.repo.getConversation(p)).state).toBe("MENU");
    expect(s.repo.availabilities.get(p)?.text).toBe("Segunda e quarta, das 14h às 18h");
  });

  it("Horários: 'menu' cancela sem gravar", async () => {
    const s = mkSim();
    const p = s.phone(4);
    await toMenu(s, p);
    await s.list(p, "svc_horarios"); s.advance(1000);
    await s.text(p, "menu"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("MENU");
    expect(s.repo.availabilities.size).toBe(0);
  });

  it("Contato: indica o WhatsApp do Cauan (88 99289-5332)", async () => {
    const s = mkSim();
    const p = s.phone(5);
    await toMenu(s, p);
    await s.list(p, "svc_contato"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/Cauan.*Bruno/);
    expect(lastBody(s, p)).toMatch(/88 99289-5332/);
    expect(lastBody(s, p)).toMatch(/wa\.me\/5588992895332/);
  });
});
