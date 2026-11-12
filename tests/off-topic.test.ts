import { describe, it, expect } from "vitest";
import { Simulator } from "../scripts/simulate";
import { offTopicNotice } from "../src/axo/voice";

type Body = { text?: { body: string }; interactive?: { body: { text: string } } };
const bodyOf = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as Body;
  return b.text?.body ?? b.interactive?.body.text ?? "";
};

describe("assunto fora do escopo: nunca mudo de cara", () => {
  it("o aviso usa as vagas que sobram e a última vaga é a despedida", () => {
    expect(offTopicNotice("vamos falar de futebol", 0)).toBeNull();
    expect(offTopicNotice("vamos falar de futebol", 3, 0)).not.toBe(offTopicNotice("vamos falar de futebol", 3, 1));
    expect(offTopicNotice("vamos falar de futebol", 1)).toMatch(/quiet|na minha|silêncio/i);
    expect(offTopicNotice("😂😂", 3)).toBeNull(); // sem texto útil: não vale um aviso
  });

  it("quem acabou de passar pelo cadastro e manda papo fora do assunto recebe aviso (não silêncio)", async () => {
    const s = new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "6", MAX_BOT_MSGS_PER_USER_PER_DAY: "30" } });
    const p = s.phone(1);
    await s.text(p, "oi"); await s.button(p, "consent_yes"); s.advance(1000);
    await s.text(p, "Maria da Silva"); s.advance(1000);
    await s.text(p, "vi o jogo ontem, que partida!"); s.advance(1000);
    const n = s.sentTo(p).length;
    await s.text(p, "o meu time perdeu de novo kkk"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1);
    expect(bodyOf(s, p)).toMatch(/mentoria/i);
  });

  it("insistência: avisa, se despede e só então fica em silêncio (nunca passa do teto)", async () => {
    const s = new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "4", MAX_BOT_MSGS_PER_USER_PER_DAY: "30" } });
    const p = s.phone(2);
    await s.text(p, "oi"); s.advance(1000);
    for (let i = 0; i < 50; i++) { await s.text(p, `papo aleatório numero ${i} sobre pizza`); s.advance(1000); }
    expect(s.sentTo(p).length).toBe(4);
    expect(bodyOf(s, p)).toMatch(/quieto|na minha|silêncio/i); // a última fala é a despedida
  });
});
