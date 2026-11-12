import { describe, it, expect, vi } from "vitest";
import { Simulator, MINUTE } from "../scripts/simulate";
import { ANSWER_MAX_CHARS, GrokIntentAgent, MIN_CONFIDENCE, cleanAnswer, createAgent, parseAgentJson } from "../src/ai/grok";
import { BMM_KNOWLEDGE } from "../src/ai/knowledge";
import { sendGuarded } from "../src/whatsapp/client";
import { MemoryRepo } from "../src/db/memory-repo";
import { ROUTES, type FaqResult, type IntentAgent, type IntentQuery } from "../src/ai/agent";
import { loadConfig } from "../src/config";
import { sanitizeSlots, summarizeSlots, type ParsedAvailability } from "../src/ai/types";

const lastBody = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};
const mk = (agent?: IntentAgent) =>
  new Simulator({ ...(agent ? { agent } : {}), env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "30", MAX_BOT_MSGS_PER_USER_PER_DAY: "80" } });
const fakeAgent = (answer: string | null) => {
  const calls: IntentQuery[] = [];
  const agent: IntentAgent = { classify: async (q) => { calls.push(q); return answer; } };
  return { agent, calls };
};
const slotsAgent = (result: ParsedAvailability | null) => {
  const texts: string[] = [];
  const agent: IntentAgent = { classify: async () => null, extractAvailability: async (t) => { texts.push(t); return result; } };
  return { agent, texts };
};
const grokReply = (content: string, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));
const query: IntentQuery = {
  question: "q", text: "quero dar mentoria de computação",
  options: [{ intent: "mudar_areas", description: "d" }, { intent: "tirar_duvida", description: "d" }],
};

describe("cliente do Grok", () => {
  it("chama /chat/completions com a chave, o modelo e só a mensagem da pessoa (sem telefone/nome)", async () => {
    const f = grokReply('{"intent":"mudar_areas","confianca":0.93}');
    const a = new GrokIntentAgent({ apiKey: "KEY", model: "m1", fetchImpl: f as unknown as typeof fetch });
    expect(await a.classify(query)).toBe("mudar_areas");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer KEY");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("m1");
    expect(JSON.stringify(body)).toContain("quero dar mentoria de computação");
  });
  it("aceita JSON cercado de texto e recusa opção fora da lista, confiança baixa e lixo", async () => {
    const ok = (c: string) => new GrokIntentAgent({ apiKey: "k", fetchImpl: grokReply(c) as unknown as typeof fetch }).classify(query);
    expect(await ok('Claro! ```json\n{"intent":"tirar_duvida","confianca":0.8}\n```')).toBe("tirar_duvida");
    expect(await ok('{"intent":"apagar_tudo","confianca":1}')).toBeNull(); // fora da lista fechada
    expect(await ok(`{"intent":"mudar_areas","confianca":${MIN_CONFIDENCE - 0.1}}`)).toBeNull();
    expect(await ok('{"intent":"nenhuma","confianca":0.9}')).toBeNull();
    expect(await ok("não sei")).toBeNull();
  });
  it("falha fechada: HTTP de erro, rede fora e timeout devolvem null (o bot segue sozinho)", async () => {
    const mkA = (f: unknown, timeoutMs = 6000) => new GrokIntentAgent({ apiKey: "k", timeoutMs, fetchImpl: f as typeof fetch });
    expect(await mkA(grokReply("x", 500)).classify(query)).toBeNull();
    expect(await mkA(vi.fn(async () => { throw new Error("rede"); })).classify(query)).toBeNull();
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("abort")))));
    expect(await mkA(hang, 20).classify(query)).toBeNull();
  });
  it("parseAgentJson", () => {
    expect(parseAgentJson('{"intent":"a","confianca":"0.7"}')).toEqual({ intent: "a", confianca: 0.7 });
    expect(parseAgentJson("{}")).toBeNull();
  });
  it("provedor pela chave: gsk_ = Groq, xai- = xAI; AI_MODEL/AI_BASE_URL sobrescrevem; nomes antigos valem", () => {
    const base = {
      EVOLUTION_URL: "https://evo.example.com", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "inst", EVOLUTION_WEBHOOK_TOKEN: "token-webhook-123456",
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", ADMIN_TOKEN: "a", PRIVACY_POLICY_URL: "https://e.com", TERMS_VERSION: "1",
    };
    const g = loadConfig({ ...base, XAI_API_KEY: "gsk_abc" }); // o segredo antigo com chave do Groq passa a funcionar
    expect(g).toMatchObject({ aiApiKey: "gsk_abc", aiBaseUrl: "https://api.groq.com/openai/v1", aiModel: "openai/gpt-oss-120b" });
    const x = loadConfig({ ...base, AI_API_KEY: "xai-abc" });
    expect(x).toMatchObject({ aiBaseUrl: "https://api.x.ai/v1", aiModel: "grok-4" });
    expect(loadConfig({ ...base, AI_API_KEY: "gsk_abc", AI_MODEL: "outro", AI_BASE_URL: "https://z.example/v1" })).toMatchObject({ aiModel: "outro", aiBaseUrl: "https://z.example/v1" });
  });
  it("createAgent só existe com chave; AI_BASE_URL precisa ser https", () => {
    const base = {
      EVOLUTION_URL: "https://evo.example.com", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "inst", EVOLUTION_WEBHOOK_TOKEN: "token-webhook-123456",
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", ADMIN_TOKEN: "a", PRIVACY_POLICY_URL: "https://e.com", TERMS_VERSION: "1",
    };
    expect(createAgent(loadConfig(base))).toBeUndefined();
    expect(createAgent(loadConfig({ ...base, AI_API_KEY: "k" }))).toBeDefined();
    expect(() => loadConfig({ ...base, AI_BASE_URL: "http://inseguro" })).toThrow(/https/);
  });
  it("as opções de cada estado são fechadas e nenhum estado permite opt-out/consentimento pela IA", () => {
    for (const [state, r] of Object.entries(ROUTES)) {
      expect(["COMPLETED", "RETURNING_CHOICE", "DOUBT_ASK", "PROFILE_ROLE", "DOUBT_TEXT"]).toContain(state);
      expect(r.options.length).toBeGreaterThan(0);
    }
  });
});

describe("IA intervém no bot", () => {
  it("'oi' do cadastrado + 'quero dar mentoria de computação também' => abre a escolha de áreas (sem a IA, hint)", async () => {
    const { agent, calls } = fakeAgent("mudar_areas");
    const s = mk(agent); const p = s.phone(1);
    await s.register(p, 1000);
    await s.repo.saveRegistration(p, { profileRole: "mentor", mentorCategories: ["vida_academica"] });
    s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.text(p, "quero dar mentoria também sobre computação"); s.advance(1000);
    expect(calls).toHaveLength(1);
    expect(lastBody(s, p)).toMatch(/Suas áreas hoje: Vida Acadêmica/);
    expect((await s.repo.getConversation(p)).state).toBe("MENTOR_CATEGORIES");
  });

  it("sem agente configurado o mesmo texto só gera 1 dica (o bot funciona sem IA)", async () => {
    const s = mk(); const p = s.phone(2);
    await s.register(p, 1000); s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.text(p, "quero dar mentoria também sobre computação"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("RETURNING_CHOICE");
  });

  it("DOUBT_TEXT: a IA confere o texto; 'sem_duvida' evita registrar uma dúvida falsa", async () => {
    const { agent, calls } = fakeAgent("sem_duvida");
    const s = mk(agent); const p = s.phone(3);
    await s.register(p, 1000); s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "ret_doubt"); s.advance(1000);
    await s.text(p, "acho que por enquanto está tudo certo por aqui"); s.advance(1000);
    expect(calls).toHaveLength(1);
    expect(s.repo.doubts).toHaveLength(0);
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
  });

  it("DOUBT_TEXT: se a IA diz 'duvida' (ou falha), a dúvida é registrada normalmente", async () => {
    for (const answer of ["duvida", null]) {
      const { agent } = fakeAgent(answer);
      const s = mk(agent); const p = s.phone(4);
      await s.register(p, 1000); s.advance(60 * MINUTE);
      await s.text(p, "oi"); s.advance(1000);
      await s.button(p, "ret_doubt"); s.advance(1000);
      await s.text(p, "Como faço um join em SQL com duas tabelas?"); s.advance(1000);
      expect(s.repo.doubts).toHaveLength(1);
    }
  });

  it("agente que lança erro não derruba a conversa", async () => {
    const agent: IntentAgent = { classify: async () => { throw new Error("boom"); } };
    const s = mk(agent); const p = s.phone(5);
    await s.register(p, 1000); s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.text(p, "quero dar mentoria também sobre computação"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("RETURNING_CHOICE");
    expect(lastBody(s, p)).toMatch(/Toque em/);
  });

  it("comandos que o bot já entende (sair, menu, oi, sim, não) nunca consultam a IA; 'sair' sempre vale", async () => {
    const { agent, calls } = fakeAgent("tirar_duvida");
    const s = mk(agent); const p = s.phone(6);
    await s.register(p, 1000); s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.text(p, "oi"); s.advance(1000);
    await s.text(p, "menu"); s.advance(1000);
    expect(calls).toHaveLength(0);
    await s.text(p, "sair"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("OPTED_OUT");
  });

  it("a IA não consome mensagens extras: continua 1 resposta por entrada e respeita os limites por pessoa", async () => {
    const { agent } = fakeAgent("mudar_areas");
    const s = new Simulator({ agent, env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "30", MAX_BOT_MSGS_PER_USER_PER_DAY: "80" } });
    const p = s.phone(7);
    await s.register(p, 1000); s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    const n = s.sentTo(p).length;
    await s.text(p, "quero mudar as áreas em que dou mentoria"); s.advance(1000);
    expect(s.sentTo(p).length - n).toBe(1);
  });

  it("estados sem rota (cadastro, consentimento, áudio) nunca consultam a IA", async () => {
    const { agent, calls } = fakeAgent("mudar_areas");
    const s = mk(agent); const p = s.phone(8);
    await s.text(p, "oi"); s.advance(1000);
    await s.text(p, "quero participar do programa"); s.advance(1000); // REG_CONSENT: texto qualquer
    await s.button(p, "consent_yes"); s.advance(1000);
    await s.text(p, "Maria da Silva"); s.advance(1000);
    await s.text(p, "Turma 12"); s.advance(1000);
    await s.text(p, "nasci em 1999"); s.advance(1000); // REG_PROFILE_AUDIO: texto
    expect(calls).toHaveLength(0);
  });
});

describe("horários lidos pela IA", () => {
  const toHorarios = async (s: Simulator, p: string) => {
    await s.register(p, 1000);
    s.advance(11 * MINUTE);
    await s.text(p, "menu"); s.advance(1000);
    await s.list(p, "svc_horarios"); s.advance(1000);
  };
  const reply = { slots: [
    { day: "segunda" as const, start: "14:00", end: "18:00" },
    { day: "quarta" as const, start: "14:00", end: "18:00" },
  ] };

  it("a IA lê o texto livre, grava as faixas estruturadas e mostra o que anotou", async () => {
    const { agent, texts } = slotsAgent(reply);
    const s = mk(agent); const p = s.phone(10);
    await toHorarios(s, p);
    await s.text(p, "Posso segunda e quarta depois do almoço até umas 6 da tarde"); s.advance(1000);
    expect(texts).toEqual(["Posso segunda e quarta depois do almoço até umas 6 da tarde"]);
    expect(lastBody(s, p)).toMatch(/Anotei seus horários livres/);
    expect(lastBody(s, p)).toMatch(/• Segunda: 14h às 18h/);
    expect(lastBody(s, p)).toMatch(/• Quarta: 14h às 18h/);
    const saved = s.repo.availabilities.get(p)!;
    expect(saved.slots).toEqual(reply.slots);
    expect(saved.text).toContain("depois do almoço");
    expect((await s.repo.getConversation(p)).state).toBe("MENU");
  });

  it("a IA leu e não achou horários: 1 dica, nada é gravado, depois silêncio", async () => {
    const { agent } = slotsAgent({ slots: [] });
    const s = mk(agent); const p = s.phone(11);
    await toHorarios(s, p);
    await s.text(p, "não sei ainda, depende do trabalho"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/Não consegui identificar os dias e horários/);
    const n = s.sentTo(p).length;
    await s.text(p, "talvez à noite?"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1); // 2º texto sem horário: o Axo avisa em vez de calar
    expect(s.repo.availabilities.size).toBe(0);
    expect((await s.repo.getConversation(p)).state).toBe("AVAILABILITY_TEXT");
  });

  it("IA fora do ar (null) ou sem IA: plano B guarda o texto como veio (nada se perde)", async () => {
    for (const agent of [slotsAgent(null).agent, undefined]) {
      const s = mk(agent); const p = s.phone(12);
      await toHorarios(s, p);
      await s.text(p, "seg 14h"); s.advance(1000); // curto, mas é horário
      expect(s.repo.availabilities.get(p)?.text).toBe("seg 14h");
      expect(s.repo.availabilities.get(p)?.slots).toBeUndefined();
      expect((await s.repo.getConversation(p)).state).toBe("MENU");
    }
  });

  it("'menu' cancela sem consultar a IA", async () => {
    const { agent, texts } = slotsAgent(reply);
    const s = mk(agent); const p = s.phone(13);
    await toHorarios(s, p);
    await s.text(p, "menu"); s.advance(1000);
    expect(texts).toHaveLength(0);
    expect((await s.repo.getConversation(p)).state).toBe("MENU");
  });

  it("sanitizeSlots descarta o que a IA inventar: dia inválido, hora ruim, início >= fim, repetidos", () => {
    const out = sanitizeSlots([
      { dia: "Segunda", inicio: "9:00", fim: "12:00" },
      { dia: "segunda", inicio: "09:00", fim: "12:00" }, // repetido (mesma faixa)
      { dia: "feriado", inicio: "09:00", fim: "12:00" },
      { dia: "terca", inicio: "25:00", fim: "26:00" },
      { dia: "quinta", inicio: "18:00", fim: "10:00" },
      "lixo", null,
      { day: "sexta", start: "19:00", end: "21:30" },
    ]);
    expect(out).toEqual([{ day: "segunda", start: "09:00", end: "12:00" }, { day: "sexta", start: "19:00", end: "21:30" }]);
    expect(summarizeSlots(out)).toBe("• Segunda: 9h às 12h\n• Sexta: 19h às 21h30");
    expect(sanitizeSlots("x")).toEqual([]);
  });

  it("o cliente lê o JSON do modelo e valida as faixas", async () => {
    const f = grokReply('Aqui está: {"slots":[{"dia":"sexta","inicio":"19:00","fim":"21:00"},{"dia":"noite","inicio":"1","fim":"2"}]}');
    const a = new GrokIntentAgent({ apiKey: "k", fetchImpl: f as unknown as typeof fetch });
    expect(await a.extractAvailability("sexta à noite")).toEqual({ slots: [{ day: "sexta", start: "19:00", end: "21:00" }] });
    expect(await new GrokIntentAgent({ apiKey: "k", fetchImpl: grokReply("sem json") as unknown as typeof fetch }).extractAvailability("x")).toBeNull();
    expect(await new GrokIntentAgent({ apiKey: "k", fetchImpl: grokReply("x", 401) as unknown as typeof fetch }).extractAvailability("x")).toBeNull();
  });
});

describe("a IA NÃO tira dúvidas: só guarda", () => {
  const toDoubt = async (s: Simulator, p: string) => {
    await s.register(p, 1000); s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "ret_doubt"); s.advance(1000);
  };
  it("dúvida de conteúdo: guarda e manda só o encerramento (sem resposta da IA, sem consultar answerFaq)", async () => {
    const faqCalls: string[] = [];
    const agent: IntentAgent = {
      classify: async () => "duvida",
      answerFaq: async (t) => { faqCalls.push(t); return { kind: "answer", text: "O rotacional diverge porque..." }; },
    };
    const s = mk(agent); const p = s.phone(20);
    await toDoubt(s, p);
    const n = s.sentTo(p).length;
    await s.text(p, "Estou com dúvida sobre rotacional e divergente"); s.advance(1000);
    expect(s.sentTo(p).length - n).toBe(1);
    expect(lastBody(s, p)).toMatch(/^Dúvida registrada!/);
    expect(lastBody(s, p)).not.toMatch(/diverge porque/);
    expect(faqCalls).toHaveLength(0);
    expect(s.repo.doubts).toHaveLength(1);
  });
  it("assunto sem relação ('vai chover hoje em São Paulo?') no texto da dúvida: aviso descontraído e nada é guardado", async () => {
    const agent: IntentAgent = { classify: async () => "fora_do_tema" };
    const s = mk(agent); const p = s.phone(21);
    await toDoubt(s, p);
    const n = s.sentTo(p).length;
    await s.text(p, "Vai chover hoje em São Paulo?"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1); // aviso descontraído, nada é guardado
    expect(s.repo.doubts).toHaveLength(0);
    expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
  });
});

describe("IA responde só sobre o programa", () => {
  const faqAgent = (r: FaqResult | null) => {
    const texts: string[] = [];
    const agent: IntentAgent = { classify: async () => null, answerFaq: async (t) => { texts.push(t); return r; } };
    return { agent, texts };
  };
  const done = async (s: Simulator, p: string) => { await s.register(p, 1000); s.advance(60 * MINUTE); await s.text(p, "oi"); s.advance(1000); };

  it("pergunta sobre o programa: responde (1 mensagem)", async () => {
    const { agent, texts } = faqAgent({ kind: "answer", text: "Você pode ser mentor, mentorado ou os dois." });
    const s = mk(agent); const p = s.phone(30);
    await done(s, p);
    const n = s.sentTo(p).length;
    await s.text(p, "como funciona a mentoria?"); s.advance(1000);
    expect(texts).toEqual(["como funciona a mentoria?"]);
    expect(s.sentTo(p).length - n).toBe(1);
    expect(lastBody(s, p)).toMatch(/^Você pode ser mentor, mentorado ou os dois\.\n\nO que você quer fazer agora/); // a resposta e a pergunta da etapa, juntas
    expect((await s.repo.getConversation(p)).state).toBe("RETURNING_CHOICE");
  });
  it("assunto sem relação: aviso descontraído (sem a dica de botões)", async () => {
    const { agent } = faqAgent({ kind: "off_topic" });
    const s = mk(agent); const p = s.phone(31);
    await done(s, p);
    const n = s.sentTo(p).length;
    await s.text(p, "vai chover hoje em São Paulo?"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1); // aviso descontraído de "aqui é mentoria"
  });
  it("dúvida de conteúdo fora do fluxo: não é respondida (cai na dica de sempre)", async () => {
    const { agent } = faqAgent({ kind: "mentor_doubt" });
    const s = mk(agent); const p = s.phone(32);
    await done(s, p);
    await s.text(p, "como calcular o rotacional de um campo?"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/Toque em/);
  });
  it("respeita o limite de mensagens por pessoa", async () => {
    const { agent } = faqAgent({ kind: "answer", text: "resposta" });
    const s = new Simulator({ agent, env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "8", MAX_BOT_MSGS_PER_USER_PER_DAY: "80" } });
    const p = s.phone(33);
    await s.register(p, 1000); // 7 mensagens do cadastro, tudo dentro de 10 min
    await s.text(p, "oi"); s.advance(1000); // 8ª mensagem: esgota o limite dos 10 min
    const n = s.sentTo(p).length;
    await s.text(p, "como funciona a mentoria?"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n);
  });
  it("o cliente lê {tipo, resposta} e só aceita 'programa' com resposta", async () => {
    const ask = (c: string) => new GrokIntentAgent({ apiKey: "k", fetchImpl: grokReply(c) as unknown as typeof fetch }).answerFaq("x");
    expect(await ask('{"tipo":"programa","resposta":"O cadastro pede nome, turma e um áudio."}')).toEqual({ kind: "answer", text: "O cadastro pede nome, turma e um áudio." });
    expect(await ask('{"tipo":"duvida_para_mentor","resposta":"vou explicar cálculo..."}')).toEqual({ kind: "mentor_doubt" });
    expect(await ask('{"tipo":"fora_do_tema","resposta":""}')).toEqual({ kind: "off_topic" });
    expect(await ask('{"tipo":"programa"}')).toBeNull();
    expect(await ask("lixo")).toBeNull();
  });
  it("cleanAnswer limita o tamanho e descarta resposta vazia", () => {
    expect(cleanAnswer(null)).toBeNull();
    expect(cleanAnswer("  ")).toBeNull();
    expect(cleanAnswer(`${"Frase de teste com tamanho razoável. ".repeat(40)}`)!.length).toBeLessThanOrEqual(ANSWER_MAX_CHARS);
    expect(cleanAnswer("a\n\nb  c   d e")).toBe("a b c d e");
  });
});

describe("base de conhecimento (RAG) da Be My Mentor", () => {
  it("o prompt do FAQ leva a base inteira e manda usar só ela", async () => {
    const f = grokReply('{"tipo":"programa","resposta":"Os dados só servem para validar horas complementares."}');
    const a = new GrokIntentAgent({ apiKey: "k", fetchImpl: f as unknown as typeof fetch });
    await a.answerFaq("para que vocês usam meus dados?");
    const sent = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { messages: { role: string; content: string }[] };
    const system = sent.messages[0]!.content;
    expect(system).toContain(BMM_KNOWLEDGE);
    expect(system).toMatch(/SOMENTE a base de conhecimento/);
    expect(sent.messages[1]!.content).toContain("para que vocês usam meus dados?");
  });
  it("a base cobre os 5 assuntos dos fundadores", () => {
    for (const t of [/conecta estudantes universit/i, /iniciação científica/i, /fase de validação/i, /horas complementares/i, /blockchain/i, /diarização/i, /nunca responde dúvidas|nunca responde/i, /88 99289-5332/]) {
      expect(BMM_KNOWLEDGE).toMatch(t);
    }
    expect(BMM_KNOWLEDGE.length).toBeLessThan(4000); // cabe inteira no prompt
  });
});

describe("nome e turma no cadastro", () => {
  const upToName = async (s: Simulator, p: string) => {
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "consent_yes"); s.advance(1000);
  };
  const nameAgent = (real: boolean | null) => {
    const names: string[] = [];
    const agent: IntentAgent = { classify: async () => null, judgeName: async (n) => { names.push(n); return real === null ? null : { real }; } };
    return { agent, names };
  };

  it("'Zé do Frango': a IA acha falso => pergunta se é mesmo o nome; Não pede de novo; Sim segue", async () => {
    const { agent, names } = nameAgent(false);
    const s = mk(agent); const p = s.phone(40);
    await upToName(s, p);
    await s.text(p, "Zé do Frango"); s.advance(1000);
    expect(names).toEqual(["Zé do Frango"]);
    expect(lastBody(s, p)).toMatch(/\*Zé do Frango\* é mesmo o seu nome completo\?/);
    expect((await s.repo.getConversation(p)).state).toBe("REG_NAME_CONFIRM");
    await s.button(p, "name_no"); s.advance(1000);
    expect(lastBody(s, p)).toBe("Tudo bem! Qual é o seu nome completo?");
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_full_name");
    await s.text(p, "Baralho da Silva"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("REG_NAME_CONFIRM");
    await s.button(p, "name_yes"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/turma/i);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_class_name");
    expect((await s.repo.getRegistration(p)).values.full_name).toBe("Baralho da Silva");
  });
  it("nome plausível segundo a IA: segue direto, sem pergunta extra", async () => {
    const s = mk(nameAgent(true).agent); const p = s.phone(41);
    await upToName(s, p);
    await s.text(p, "Maria da Silva"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_class_name");
  });
  it("uma palavra só ('Antônio', 'Sofá') é confirmada mesmo sem IA; IA fora do ar não trava o cadastro", async () => {
    for (const agent of [undefined, nameAgent(null).agent]) {
      const s = mk(agent); const p = s.phone(42);
      await upToName(s, p);
      await s.text(p, "Antônio"); s.advance(1000);
      expect((await s.repo.getConversation(p)).state).toBe("REG_NAME_CONFIRM");
      await s.text(p, "sim"); s.advance(1000); // "sim" digitado também vale
      expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_class_name");
    }
    const s = mk(nameAgent(null).agent); const p = s.phone(43);
    await upToName(s, p);
    await s.text(p, "Maria da Silva"); s.advance(1000); // IA sem certeza: vale a regra do bot (2+ palavras)
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_class_name");
  });
  it("na confirmação, texto qualquer dá 1 dica, 1 aviso e depois nada se perde", async () => {
    const s = mk(); const p = s.phone(44);
    await upToName(s, p);
    await s.text(p, "Sofá"); s.advance(1000);
    const n = s.sentTo(p).length;
    await s.text(p, "talvez"); s.advance(1000);
    await s.text(p, "talvez"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 2); // 1 dica + 1 aviso descontraído
  });
  it("judgeName do cliente: real=false com confiança vale; sem confiança, lixo ou erro => null", async () => {
    const j = (c: string, status = 200) => new GrokIntentAgent({ apiKey: "k", fetchImpl: grokReply(c, status) as unknown as typeof fetch }).judgeName("Zé do Frango");
    expect(await j('{"real":false,"confianca":0.95}')).toEqual({ real: false });
    expect(await j('{"real":true,"confianca":0.9}')).toEqual({ real: true });
    expect(await j('{"real":false,"confianca":0.2}')).toBeNull();
    expect(await j("lixo")).toBeNull();
    expect(await j("{}", 500)).toBeNull();
  });

  it("turma: precisa de número (T27, T26, T24); só letras ou número absurdo pedem de novo", async () => {
    const s = mk(); const p = s.phone(45);
    await upToName(s, p);
    await s.text(p, "Maria da Silva"); s.advance(1000);
    await s.text(p, "Ciência da Computação"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/T27, T26 ou T24/);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_class_name");
    await s.text(p, "T123456"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("REG_FIELD_class_name");
    await s.text(p, "T27"); s.advance(1000);
    expect((await s.repo.getRegistration(p)).values.class_name).toBe("T27");
    expect((await s.repo.getConversation(p)).state).toBe("REG_PROFILE_AUDIO");
  });
  it("validClassName: aceita formatos variados com número e recusa só letras", async () => {
    const { validClassName } = await import("../src/registration/fields");
    for (const t of ["T27", "t26", "T24", "Turma 12", "CC 3B", "T9"]) expect(validClassName(t), t).not.toBeNull();
    for (const t of ["Ciência da Computação", "turma", "T", "", "T2024", "oi"]) expect(validClassName(t), t).toBeNull();
  });
});

describe("diagnóstico do envio ao WhatsApp", () => {
  const ctx = async (f: unknown, logs: { level: string; event: string; data?: unknown }[]) => {
    const repo = new MemoryRepo();
    await repo.touchUser("5511999990000", new Date());
    return {
      repo, logger: { log: (level: string, event: string, data?: unknown) => void logs.push({ level, event, data }) },
      phoneNumberId: "1", evolutionUrl: "https://evo.test", evolutionApiKey: "k", evolutionInstance: "inst", stopAt: 950, timezone: "America/Sao_Paulo",
      fetchImpl: f as typeof fetch,
    };
  };
  it("erro HTTP da Evolution: loga status e detalhe (sem telefone) e devolve error", async () => {
    const logs: { level: string; event: string; data?: unknown }[] = [];
    const f = async () => new Response(JSON.stringify({ response: { message: ["Number 5511999990000 not on WhatsApp"] } }), { status: 400 });
    const r = await sendGuarded({ to: "5511999990000", type: "text", text: { body: "oi" } } as never, await ctx(f, logs) as never);
    expect(r).toEqual({ status: "error", code: "http_400" });
    const l = logs.find((x) => x.event === "whatsapp_send_failed")!;
    expect(l.level).toBe("warn");
    expect(l.data).toMatchObject({ status: 400, code: "http_400" });
    expect(JSON.stringify(l.data)).not.toContain("5511999990000");
  });
  it("exceção de rede: loga whatsapp_send_exception e não lança", async () => {
    const logs: { level: string; event: string; data?: unknown }[] = [];
    const r = await sendGuarded({ to: "5511999990000", type: "text", text: { body: "oi" } } as never, await ctx(async () => { throw new TypeError("fetch failed"); }, logs) as never);
    expect(r).toEqual({ status: "error", code: "network_error" });
    expect(logs.some((x) => x.event === "whatsapp_send_exception")).toBe(true);
  });
});
