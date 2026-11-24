import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { intentsOf } from "../src/conversation/synonyms";

const body = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};

async function person(state: string, extra: { optedOut?: boolean } = {}) {
  const s = new Simulator();
  const p = s.phone(5);
  await s.repo.touchUser(p, s.now());
  await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", values: { full_name: "Ana Souza" } });
  await s.repo.saveConversation(p, 0, { state: state as never, previousState: state === "OPTED_OUT" ? ("PROFILE_ROLE" as never) : null, hintSentInState: true, optedOutAt: extra.optedOut ? s.now() : null });
  return { s, p };
}

describe("saudação nunca fica sem retorno", () => {
  it("reconhece saudações de 'puxar assunto': tá por aí, alô, tem alguém aí, oi tudo bem", () => {
    for (const t of ["tá por aí?", "ta por ai", "alô", "tem alguém aí?", "oi tudo bem", "Olá!!", "hello", "e aí"]) expect(intentsOf(t).has("greeting"), t).toBe(true);
    for (const t of ["me ajuda com cálculo", "quero 3", "terminei"]) expect(intentsOf(t).has("greeting"), t).toBe(false);
  });

  it("no meio de uma pergunta: confirma que está vivo e repete o que falta responder", async () => {
    const { s, p } = await person("PROFILE_ROLE");
    await s.text(p, "tá por aí?"); s.advance(1000);
    expect(s.sentTo(p)).toHaveLength(1);
    expect(body(s, p)).toMatch(/tô por aqui sim.*me responde isso/is);
    expect(body(s, p)).toMatch(/mentor/i); // a pergunta pendente (papel) vem junto
    expect((await s.repo.getConversation(p)).state).toBe("PROFILE_ROLE"); // não sai da etapa
  });

  it("cada saudação (com um tempo entre elas) recebe retorno, com fala diferente; rajada colada recebe só um", async () => {
    const { s, p } = await person("PROFILE_ROLE");
    await s.text(p, "oi"); await s.text(p, "oi"); await s.text(p, "alô"); s.advance(1000);
    expect(s.sentTo(p)).toHaveLength(1); // rajada: uma só
    const first = body(s, p);
    s.advance(30_000);
    await s.text(p, "olá"); s.advance(1000);
    expect(s.sentTo(p)).toHaveLength(2);
    expect(body(s, p)).not.toBe(first);
  });

  it("na pergunta 'Você tem uma dúvida agora?' também repete a pergunta (botões/lista vão junto)", async () => {
    const { s, p } = await person("DOUBT_ASK");
    await s.text(p, "oi"); s.advance(1000);
    expect(s.sentTo(p)).toHaveLength(1);
    expect(body(s, p)).toMatch(/dúvida/i);
    expect(body(s, p)).toMatch(/me responde isso|responda|falta|Pendente|Vamos concluir/i);
  });

  it("pausou as mensagens (sair): a saudação recebe como voltar, sem retomar sozinho", async () => {
    const { s, p } = await person("OPTED_OUT", { optedOut: true });
    await s.text(p, "oi"); s.advance(1000);
    expect(body(s, p)).toMatch(/voltar/);
    expect((await s.repo.getConversation(p)).state).toBe("OPTED_OUT");
  });
});
