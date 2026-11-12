import { describe, it, expect } from "vitest";
import { Simulator } from "../scripts/simulate";
import type { FaqResult, IntentAgent } from "../src/ai/agent";
import { buildCorpus, retrieve, MIN_SCORE, whyWeAsk } from "../src/rag/corpus";
import { legalSections } from "../src/legal/page";
import { isQuestion, shouldAnswer } from "../src/conversation/faq";

const URL = "https://example.com/privacidade";
type Body = { text?: { body: string }; interactive?: { body: { text: string }; action?: { buttons?: { reply: { id: string } }[] } } };
const lastMsg = (s: Simulator, p: string): Body => s.sentTo(p).at(-1)!.body as Body;
const bodyOf = (s: Simulator, p: string): string => lastMsg(s, p).text?.body ?? lastMsg(s, p).interactive?.body.text ?? "";
const btnIds = (s: Simulator, p: string): string[] => lastMsg(s, p).interactive?.action?.buttons?.map((b) => b.reply.id) ?? [];

function fakeAgent(result: FaqResult | null) {
  const calls: { text: string; extra?: { excerpts?: readonly string[]; step?: string | undefined } | undefined }[] = [];
  const agent: IntentAgent = {
    classify: async () => null,
    answerFaq: async (text, _recent, extra) => { calls.push({ text, extra }); return result; },
  };
  return { agent, calls };
}
const mk = (agent?: IntentAgent) => new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "30", MAX_BOT_MSGS_PER_USER_PER_DAY: "100" }, ...(agent ? { agent } : {}) });

describe("RAG dos termos e da política", () => {
  it("as seções saem do mesmo texto da página pública e cobrem termos, privacidade e direitos", () => {
    const secs = legalSections();
    expect(secs.some((x) => x.part === "termos" && /O que o serviço oferece/.test(x.title))).toBe(true);
    expect(secs.some((x) => x.part === "privacidade" && /Seus direitos/.test(x.title))).toBe(true);
    expect(secs.every((x) => !/<[a-z]/.test(x.text))).toBe(true); // sem HTML
  });
  it("a busca acha o trecho certo para perguntas reais de usuários", () => {
    const c = buildCorpus();
    const top = (q: string) => retrieve(q, c, 1)[0]!;
    expect(top("ao que terei acesso ao aceitar seus termos?").score).toBeGreaterThanOrEqual(MIN_SCORE);
    // o trecho que diz que a plataforma própria é para o ano que vem precisa estar entre os que vão para a IA
    expect(retrieve("Quando terei acesso à plataforma depois de terminar esse cadastro?", c, 3).some((h) => /próximo ano/.test(h.chunk.text))).toBe(true);
    expect(retrieve("como posso utilizar você?", c, 3).some((h) => /Como usar o bot hoje/.test(h.chunk.title) && h.score >= MIN_SCORE)).toBe(true);
    expect(retrieve("vai chover amanhã em Fortaleza?", c, 3)).toEqual([]);
    expect(top("vocês vendem os meus dados?").chunk.source).not.toBe("programa");
    expect(top("como faço para apagar meus dados?").chunk.text).toMatch(/exclusão|eliminação|apagar/i);
  });
  it("perguntas e não-perguntas", () => {
    expect(isQuestion("Olá, como posso utilizar você?")).toBe(true);
    expect(isQuestion("pra que você está me perguntando isso")).toBe(true);
    expect(isQuestion("Maria da Silva")).toBe(false);
    expect(shouldAnswer("oi", "REG_CONSENT")).toBe(false);
    expect(shouldAnswer("Como me preparo para entrevistas?", "DOUBT_TEXT")).toBe(false); // a dúvida em si não é pergunta ao bot
    expect(shouldAnswer("segunda 8h às 12h?", "SCHED_DAYS_mentor")).toBe(false); // é resposta, não pergunta
    expect(whyWeAsk("REG_FIELD_full_name")).toMatch(/nome completo/);
  });
});

describe("perguntas em qualquer etapa", () => {
  it("1ª mensagem é uma pergunta: responde e já pede o aceite, com o link embutido (sem IA antes do aceite)", async () => {
    const { agent, calls } = fakeAgent({ kind: "answer", text: "NÃO DEVE SER USADO" });
    const s = mk(agent); const p = s.phone(1);
    await s.text(p, "Olá, como posso utilizar você?"); s.advance(1000);
    expect(s.sentTo(p)).toHaveLength(1);
    expect(calls).toHaveLength(0); // antes do aceite o texto da pessoa não sai para a IA
    expect(bodyOf(s, p)).toContain(URL);
    expect(bodyOf(s, p)).toMatch(/Cadastro|cadastro|Menu|Registrar mentoria|usar/);
    expect(bodyOf(s, p)).toMatch(/Toque em \*Aceito\*/);
    expect(btnIds(s, p)).toEqual(["consent_yes"]);
    expect(bodyOf(s, p).length).toBeLessThanOrEqual(1024);
    expect((await s.repo.getConversation(p)).state).toBe("REG_CONSENT");
    await s.button(p, "consent_yes"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_full_name");
  });

  it("no consentimento: 'ao que terei acesso ao aceitar os termos?' é respondida com os termos e o link", async () => {
    const s = mk(); const p = s.phone(2);
    await s.text(p, "oi"); s.advance(1000);
    const n = s.sentTo(p).length;
    await s.text(p, "Certo, mas ao que terei acesso ao aceitar seus termos?"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1); // 1 resposta
    expect(bodyOf(s, p)).toContain(URL);
    expect(btnIds(s, p)).toEqual(["consent_yes"]);
    expect((await s.repo.getConversation(p)).state).toBe("REG_CONSENT");
    expect((await s.repo.getRegistration(p)).consentAt).toBeNull(); // perguntar não é aceitar
  });

  it("'pra que você está me perguntando isso?' no nome: explica o motivo e repete a pergunta, sem virar nome", async () => {
    const s = mk(); const p = s.phone(3);
    await s.text(p, "oi"); await s.button(p, "consent_yes"); s.advance(1000);
    await s.text(p, "pra que você está me perguntando isso?"); s.advance(1000);
    expect(bodyOf(s, p)).toMatch(/^Pedimos o seu nome completo/);
    expect(bodyOf(s, p)).toMatch(/Qual é o seu nome completo\?$/);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_full_name");
    expect((await s.repo.getRegistration(p)).values.full_name).toBeUndefined();
  });

  it("depois do aceite a IA responde com os trechos dos termos como base e a pergunta da etapa volta junto", async () => {
    const { agent, calls } = fakeAgent({ kind: "answer", text: "Por enquanto o acesso é só por este bot; a plataforma está prevista para o próximo ano." });
    const s = mk(agent); const p = s.phone(4);
    await s.text(p, "oi"); await s.button(p, "consent_yes"); await s.text(p, "Maria da Silva"); s.advance(1000);
    await s.text(p, "Quando terei acesso à plataforma depois de terminar esse cadastro?"); s.advance(1000);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe("Quando terei acesso à plataforma depois de terminar esse cadastro?"); // só o texto, sem nome nem telefone
    expect(calls[0]!.extra?.excerpts?.length).toBeGreaterThan(0);
    expect(calls[0]!.extra?.step).toMatch(/turma/i);
    expect(bodyOf(s, p)).toMatch(/^Por enquanto o acesso é só por este bot/);
    expect(bodyOf(s, p)).toMatch(/Qual é a sua turma/);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_class_name");
  });

  it("pergunta sobre os termos depois do aceite leva o link junto", async () => {
    const { agent } = fakeAgent({ kind: "answer", text: "Seus dados não são vendidos nem compartilhados para outras finalidades." });
    const s = mk(agent); const p = s.phone(5);
    await s.text(p, "oi"); await s.button(p, "consent_yes"); await s.text(p, "Maria da Silva"); s.advance(1000);
    await s.text(p, "vocês vendem os meus dados pessoais?"); s.advance(1000);
    expect(bodyOf(s, p)).toContain(URL);
  });

  it("dúvida técnica ('como funciona um rotacional?') não é respondida e nunca vira nome", async () => {
    const { agent } = fakeAgent({ kind: "mentor_doubt" });
    const s = mk(agent); const p = s.phone(6);
    await s.text(p, "oi"); await s.button(p, "consent_yes"); s.advance(1000);
    await s.text(p, "como funciona um rotacional?"); s.advance(1000);
    expect(bodyOf(s, p)).not.toMatch(/rotacional/i);
    expect((await s.repo.getRegistration(p)).values.full_name).toBeUndefined();
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_full_name");
  });

  it("assunto sem relação: silêncio; IA fora do ar: a base local ainda responde sobre os termos", async () => {
    const off = mk(fakeAgent({ kind: "off_topic" }).agent); const p = off.phone(7);
    await off.text(p, "oi"); await off.button(p, "consent_yes"); off.advance(1000);
    const n = off.sentTo(p).length;
    await off.text(p, "vai chover amanhã em Fortaleza?"); off.advance(1000);
    expect(off.sentTo(p).length).toBe(n + 1);

    const down = mk(fakeAgent(null).agent); const q = down.phone(8);
    await down.text(q, "oi"); await down.button(q, "consent_yes"); down.advance(1000);
    await down.text(q, "como faço para apagar meus dados?"); down.advance(1000);
    expect(down.sentTo(q).length).toBe(3); // consentimento, nome, resposta
    expect(bodyOf(down, q)).toMatch(/eliminação|apagar|direitos/i);
  });

  it("respeita o limite de mensagens por pessoa (silêncio)", async () => {
    const s = new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "1", MAX_BOT_MSGS_PER_USER_PER_DAY: "10" } }); const p = s.phone(9);
    await s.text(p, "oi"); s.advance(1000);
    const n = s.sentTo(p).length;
    await s.text(p, "o que vou ter acesso?"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n);
  });
});

describe("LGPD e uso dos dados: respondidos mesmo sem aceitar", () => {
  const preConsent = async (q: string) => {
    const { agent, calls } = fakeAgent({ kind: "answer", text: "NÃO DEVE SER USADO" });
    const s = mk(agent); const p = s.phone(40);
    await s.text(p, "oi"); s.advance(1000);
    const n = s.sentTo(p).length;
    await s.text(p, q); s.advance(1000);
    return { s, p, n, calls };
  };

  it.each([
    ["por que querem usar meus dados?", "finalidade", /conectar quem tem uma dúvida[\s\S]*validar e emitir as horas complementares/],
    ["Pra que vocês precisam dos meus dados", "finalidade", /não são vendidos/],
    ["quais dados vocês coletam?", "quais-dados", /nome completo e turma/],
    ["vocês compartilham minhas informações com terceiros?", "compartilhamento", /Não vendemos/],
    ["por quanto tempo vocês guardam meus dados?", "retencao", /12 meses[\s\S]*5 anos[\s\S]*6 meses/],
    ["como faço para apagar meus dados depois?", "apagar", /eliminação[\s\S]*15 dias/],
    ["o que é a LGPD? quais são os meus direitos?", "direitos", /Lei 13\.709\/2018[\s\S]*ANPD/],
    ["a IA lê as minhas mensagens?", "ia", /sem nome nem telefone[\s\S]*depois do seu aceite/],
    ["meus dados vão para fora do Brasil?", "exterior", /Estados Unidos/],
    ["isso vai pra blockchain? dá pra apagar?", "blockchain", /não pode ser alterada nem apagada/],
    ["e se eu não aceitar os termos?", "sem-aceite", /voluntário[\s\S]*só temos o número do WhatsApp/],
  ])("antes do aceite: %s", async (q, id, expected) => {
    const { legalAnswer } = await import("../src/rag/legal-faq");
    expect(legalAnswer(q)?.id).toBe(id);
    const { s, p, n, calls } = await preConsent(q);
    expect(s.sentTo(p).length).toBe(n + 1); // 1 resposta
    expect(calls).toHaveLength(0); // sem IA e sem enviar o texto dela para fora antes do aceite
    expect(bodyOf(s, p)).toMatch(expected);
    expect(bodyOf(s, p)).toContain(URL); // link dos termos dentro da mensagem
    expect(btnIds(s, p)).toEqual(["consent_yes"]); // e o Aceito continua à vista
    expect(bodyOf(s, p).length).toBeLessThanOrEqual(1024);
    expect((await s.repo.getRegistration(p)).consentAt).toBeNull();
  });

  it("depois do aceite as mesmas perguntas também têm a resposta pronta, com o link, sem gastar a IA", async () => {
    const { agent, calls } = fakeAgent({ kind: "answer", text: "genérica" });
    const s = mk(agent); const p = s.phone(41);
    await s.text(p, "oi"); await s.button(p, "consent_yes"); await s.text(p, "Maria da Silva"); s.advance(1000);
    await s.text(p, "por que querem usar meus dados?"); s.advance(1000);
    expect(calls).toHaveLength(0);
    expect(bodyOf(s, p)).toMatch(/^Usamos os seus dados só para três coisas/);
    expect(bodyOf(s, p)).toContain(URL);
    expect(bodyOf(s, p)).toMatch(/Qual é a sua turma/);
  });

  it("as respostas prontas só dizem o que a página de Termos e Política diz", async () => {
    const { renderLegalPage } = await import("../src/legal/page");
    const { LEGAL_TOPICS } = await import("../src/rag/legal-faq");
    const html = renderLegalPage();
    for (const fact of [/12 meses/, /5 anos/, /6 meses/, /15 dias/, /ANPD/, /Estados Unidos/, /pseudonimizadas/, /não vendemos nem comercializamos/i, /dados pessoais sensíveis/i, /Lei nº 13\.709\/2018/]) expect(html).toMatch(fact);
    expect(LEGAL_TOPICS.every((t) => t.answer.length <= 700)).toBe(true);
    for (const t of LEGAL_TOPICS) expect(t.answer, t.id).not.toMatch(/aguard|processando|um momento/i);
  });
});
