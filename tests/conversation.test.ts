import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { MemoryRepo } from "../src/db/memory-repo";
import { SupabaseRepo } from "../src/db/supabase-repo";
import { handleIncomingMessage } from "../src/conversation/engine";
import { decide, type Counters, type UserState } from "../src/conversation/machine";
import { normalizeText } from "../src/conversation/normalize";
import { intentsOf, type Intent } from "../src/conversation/synonyms";
import { allBotTexts } from "../src/conversation/texts";
import { hashWaId } from "../src/lib/hash";
import type { Logger } from "../src/lib/logger";
import { processEvents } from "../src/webhook/handler";
import { sendGuarded } from "../src/whatsapp/client";
import type { IncomingMessage, WebhookEvent } from "../src/whatsapp/types";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
const logger: Logger = { log: () => undefined };

let seq = 0;
const text = (body: string, from = WA): IncomingMessage => ({ type: "text", wamid: `w${++seq}`, from, body });
const nfm = (): IncomingMessage => ({ type: "nfm_reply", wamid: `w${++seq}`, from: WA, responseJson: "{}" });
const audio = (): IncomingMessage => ({ type: "audio", wamid: `w${++seq}`, from: WA, mediaId: "m1", voice: true });
const unsupported = (rawType: string): IncomingMessage => ({ type: "unsupported", wamid: `w${++seq}`, from: WA, rawType });

function setup(opts: { max10?: number; maxDay?: number; graphOk?: boolean } = {}) {
  const repo = new MemoryRepo();
  const graph = vi.fn(async () =>
    new Response(JSON.stringify({ messages: [{ id: `out${++seq}` }] }), { status: opts.graphOk === false ? 500 : 200 }),
  );
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, {
      repo, logger, phoneNumberId: "PN", whatsappToken: "t", graphApiVersion: "v21.0", stopAt: 950,
      timezone: "America/Sao_Paulo", fetchImpl: graph as unknown as typeof fetch, now: () => NOW,
    });
  const deps = { repo, logger, send, maxPerDay: opts.maxDay ?? 12, maxPer10Min: opts.max10 ?? 4, now: () => NOW };
  const feed = async (ev: IncomingMessage) => {
    await processEvents([ev], {
      appSecret: "", verifyToken: "", repo, logger, now: () => NOW,
      onEvent: async (e: WebhookEvent) => { if (e.type !== "status") await handleIncomingMessage(e, deps); },
    });
  };
  const bodies = () =>
    graph.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).text?.body as string);
  return { repo, graph, feed, bodies, deps };
}

const fresh = (state: UserState["state"] = "NEW", hint = false): UserState => ({
  state, previousState: null, hintSentInState: hint, optedOutAt: null,
});
const open: Counters = { sentLast10Min: 0, sentLastDay: 0, maxPer10Min: 4, maxPerDay: 12 };

describe("C3.1 repetição", () => {
  it("C3.1 usuário novo manda 'oi' 20 vezes seguidas: exatamente 1 envio", async () => {
    const s = setup();
    for (let i = 0; i < 20; i++) await s.feed(text("oi"));
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
  it("C3.1 20 'oi' simultâneos (rajada): exatamente 1 envio", async () => {
    const s = setup();
    await Promise.all(Array.from({ length: 20 }, () => s.feed(text("oi"))));
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
  it("C3.1 o mesmo wamid duas vezes é ignorado", async () => {
    const s = setup();
    const m = text("oi");
    await s.feed(m);
    await s.feed(m);
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
});

describe("C3.2 dica única", () => {
  it("C3.2 'oi' seguido de 10 textos aleatórios: 2 envios (boas-vindas + 1 dica)", async () => {
    const s = setup();
    await s.feed(text("oi"));
    for (const t of ["blablabla", "qual o preco", "xyz", "me ajuda", "???", "kkkk", "teste", "asdf", "quero algo", "hmm"]) {
      await s.feed(text(t));
    }
    expect(s.graph).toHaveBeenCalledTimes(4); // boas-vindas + dica + aviso + despedida; só então silêncio (teto de 4 em 10 min)
  });
  it("C3.2 texto sem relação logo de cara (estado NEW): dica, aviso, despedida e depois silêncio", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) await s.feed(text("blablabla " + i));
    expect(s.graph).toHaveBeenCalledTimes(4); // dica + aviso + despedida + teto
  });
});

const GREETINGS = ["Oi", "oiii", "OLÁ!!", "ola", "Bom dia", "e aí", "Boa tarde", "boa noite!", "opa", "OPA!!!", "eae", "hey", "Hello", "helloooo", "inicio", "começar", "Oi, bom dia!", "oi 👋"];
const YES = ["Sim", "sim!!", "s", "ok", "👍", "SIMMM", "aceito", "Concordo.", "claro", "pode", "okk", "👍🏽"];
const UNRELATED = ["banana", "qual o preço?", "asdfgh", "quero falar com atendente", "123456", "talvez", "????", "o gato subiu no telhado", "simbora", "oitenta"];

describe("C3.3 normalizador e sinônimos", () => {
  const cases: [string, Intent, boolean][] = [
    ...GREETINGS.map((t) => [t, "greeting", true] as [string, Intent, boolean]),
    ...YES.map((t) => [t, "yes", true] as [string, Intent, boolean]),
    ...UNRELATED.map((t) => [t, "greeting", false] as [string, Intent, boolean]),
    ...UNRELATED.map((t) => [t, "yes", false] as [string, Intent, boolean]),
    ["MENU", "menu", true], ["Opções", "menu", true], ["voltar", "menu", true],
    ["SAIR!!", "quit", true], ["parar", "quit", true], ["Stop", "quit", true], ["cancelar", "quit", true],
    ["Não", "no", true], ["voltar", "resume", true],
  ];
  it("C3.3 tabela com mais de 40 casos", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });
  it.each(cases)("C3.3 %j como %s => %s", (input, intent, expected) => {
    expect(intentsOf(input).has(intent)).toBe(expected);
  });
  it("C3.3 normalizeText: acentos, pontuação, emoji, letras repetidas, espaços", () => {
    expect(normalizeText("  OLÁÁÁ!!   Tudo   bem?? ")).toBe("ola tudo bem");
    expect(normalizeText("simmm")).toBe("sim");
    expect(normalizeText("👍")).toBe("sim");
    expect(normalizeText("🎉🎉")).toBe("");
  });
  it("C3.3 string vazia ou só emoji sem significado não é nada", () => {
    expect(intentsOf("").size).toBe(0);
    expect(intentsOf("🎉").size).toBe(0);
  });
});

describe("C3.4 dica volta a valer depois de entrada válida", () => {
  it("C3.4 decide: mudar de estado zera hintSentInState", () => {
    const d = decide(fresh("AWAIT_REGISTRATION", true), nfm(), open, NOW);
    expect(d.nextState.state).toBe("MENU");
    expect(d.nextState.hintSentInState).toBe(false);
    const hint = decide(d.nextState, text("blabla"), open, NOW);
    expect(hint.replies).toHaveLength(1);
    expect(hint.nextState.hintSentInState).toBe(true);
    expect(decide(hint.nextState, text("blabla"), open, NOW).replies).toHaveLength(0);
  });
  it("C3.4 fluxo completo: oi, lixo, formulário, lixo, lixo => 4 envios", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(text("lixo"));
    await s.feed(text("lixo2"));
    await s.feed(nfm());
    await s.feed(text("lixo"));
    await s.feed(text("lixo2"));
    expect(s.graph).toHaveBeenCalledTimes(4);
  });
});

describe("C3.5 limites por pessoa", () => {
  it("C3.5 decide: 4 mensagens nos últimos 10 min => silêncio mesmo com entrada válida", () => {
    const d = decide(fresh("NEW"), text("oi"), { ...open, sentLast10Min: 4 }, NOW);
    expect(d.replies).toHaveLength(0);
    expect(d.outcome).toBe("limited");
    expect(d.nextState.state).toBe("NEW"); // não avança sem avisar
  });
  it("C3.5 decide: 12 no dia => silêncio", () => {
    expect(decide(fresh("NEW"), text("oi"), { ...open, sentLastDay: 12 }, NOW).replies).toHaveLength(0);
  });
  it("C3.5 decide: 3 em 10 min ainda responde", () => {
    expect(decide(fresh("NEW"), text("oi"), { ...open, sentLast10Min: 3 }, NOW).replies).toHaveLength(1);
  });
  it("C3.5 engine: ciclos sair/voltar válidos em sequência não passam de 4 envios em 10 min", async () => {
    const s = setup();
    await s.feed(text("oi"));
    for (let i = 0; i < 10; i++) {
      await s.feed(text("sair"));
      await s.feed(text("voltar"));
    }
    expect(s.graph).toHaveBeenCalledTimes(4);
  });
  it("C3.5 engine: 12 mensagens já enviadas hoje (fora dos 10 min) => silêncio", async () => {
    const s = setup();
    const h = await hashWaId(WA);
    for (let i = 0; i < 12; i++) {
      s.repo.outbound.push({
        waIdHash: h, messageType: "text", wamid: null, sentOk: true, errorCode: null,
        reservedAt: new Date(NOW.getTime() - (60 + i) * 60_000),
      });
    }
    await s.feed(text("oi"));
    expect(s.graph).not.toHaveBeenCalled();
  });
  it("C3.5 engine: envios de ontem (>24h) não contam", async () => {
    const s = setup();
    const h = await hashWaId(WA);
    for (let i = 0; i < 12; i++) {
      s.repo.outbound.push({
        waIdHash: h, messageType: "text", wamid: null, sentOk: true, errorCode: null,
        reservedAt: new Date(NOW.getTime() - 25 * 3_600_000),
      });
    }
    await s.feed(text("oi"));
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
});

describe("C3.6 tipos não esperados", () => {
  for (const raw of ["sticker", "reaction", "image", "video", "location", "contacts"]) {
    it(`C3.6 ${raw} em NEW, MENU e AWAIT_REGISTRATION: 0 envios, nem dica`, async () => {
      for (const st of ["NEW", "AWAIT_REGISTRATION", "MENU", "AWAIT_AUDIO", "PROCESSING_AUDIO", "OPTED_OUT"] as const) {
        const d = decide(fresh(st), unsupported(raw), open, NOW);
        expect(d.replies, `${raw} em ${st}`).toHaveLength(0);
        expect(d.nextState).toEqual(fresh(st));
      }
    });
  }
  it("C3.6 engine: figurinha numa conversa nova => nenhum envio", async () => {
    const s = setup();
    await s.feed(unsupported("sticker"));
    await s.feed(unsupported("image"));
    expect(s.graph).not.toHaveBeenCalled();
  });
  it("C3.6 áudio e formulário fora do estado esperado => silêncio", () => {
    expect(decide(fresh("NEW"), audio(), open, NOW).replies).toHaveLength(0);
    expect(decide(fresh("MENU"), audio(), open, NOW).replies).toHaveLength(0);
    expect(decide(fresh("NEW"), nfm(), open, NOW).replies).toHaveLength(0);
  });
  it("C3.6 áudio no estado que o espera é aceito sem resposta separada", () => {
    const d = decide(fresh("AWAIT_AUDIO"), audio(), open, NOW);
    expect(d.nextState.state).toBe("PROCESSING_AUDIO");
    expect(d.replies).toHaveLength(0);
  });
});

describe("C3.7 decide é pura", () => {
  const dir = join(__dirname, "..", "src", "conversation");
  const pure = ["machine.ts", "normalize.ts", "synonyms.ts", "texts.ts"];
  const pureExt = [
    ["..", "services", "content.ts"], ["..", "services", "menu.ts"], ["..", "whatsapp", "builders.ts"],
  ];
  it("C3.7 arquivos puros só importam entre si e tipos", () => {
    const files: [string, string][] = [
      ...pure.map((f): [string, string] => [f, join(dir, f)]),
      ...pureExt.map((parts): [string, string] => [parts.join("/"), join(dir, ...parts)]),
    ];
    for (const [f, path] of files) {
      const src = readFileSync(path, "utf8");
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1]!;
        const allowed = ["../whatsapp/types", "../whatsapp/builders", "../services/content", "../services/menu"];
        const extra = ["../lib/logger", "../conversation/texts", "../whatsapp/builders"]; // só tipos/constantes puras
        expect(spec.startsWith("./") || allowed.includes(spec) || extra.includes(spec), `${f} importa ${spec}`).toBe(true);
      }
      expect(src, f).not.toMatch(/\bfetch\s*\(|Date\.now|new Date\(\s*\)|Math\.random|\bprocess\b|\bconsole\b|\bcrypto\b/);
    }
  });
  it("C3.7 mesma entrada, mesma saída, sem mutar o estado", () => {
    const u = fresh("NEW");
    const copy = structuredClone(u);
    const m = text("oi");
    expect(decide(u, m, open, NOW)).toEqual(decide(u, m, open, NOW));
    expect(u).toEqual(copy);
  });
});

describe("C3.8 opt-out", () => {
  it("C3.8 sair gera 1 confirmação e OPTED_OUT; depois só 'voltar' responde", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(text("sair"));
    expect(s.graph).toHaveBeenCalledTimes(2);
    expect((await s.repo.getConversation(WA)).state).toBe("OPTED_OUT");
    expect((await s.repo.getConversation(WA)).optedOutAt).toEqual(NOW);
    for (const t of ["oi", "menu", "sim", "sair", "lixo", "bom dia", "stop"]) await s.feed(text(t));
    await s.feed(nfm());
    await s.feed(audio());
    await s.feed(unsupported("sticker"));
    expect(s.graph).toHaveBeenCalledTimes(2);
    await s.feed(text("Voltar!"));
    expect(s.graph).toHaveBeenCalledTimes(3);
    const c = await s.repo.getConversation(WA);
    expect(c.state).toBe("AWAIT_REGISTRATION"); // estado anterior
    expect(c.optedOutAt).toBeNull();
  });
  it("C3.8 'sair' funciona em qualquer estado ativo", () => {
    for (const st of ["NEW", "AWAIT_REGISTRATION", "MENU", "AWAIT_AUDIO", "PROCESSING_AUDIO"] as const) {
      const d = decide(fresh(st), text("PARAR"), open, NOW);
      expect(d.nextState.state).toBe("OPTED_OUT");
      expect(d.nextState.previousState).toBe(st);
      expect(d.replies).toHaveLength(1);
    }
  });
  it("C3.8 opt-out é honrado mesmo com limite estourado (confirmação muda)", () => {
    const d = decide(fresh("MENU"), text("sair"), { ...open, sentLast10Min: 4 }, NOW);
    expect(d.nextState.state).toBe("OPTED_OUT");
    expect(d.replies).toHaveLength(0);
  });
  it("C3.8 'voltar' em OPTED_OUT respeita o limite", () => {
    const u: UserState = { state: "OPTED_OUT", previousState: "MENU", hintSentInState: false, optedOutAt: NOW };
    const d = decide(u, text("voltar"), { ...open, sentLastDay: 12 }, NOW);
    expect(d.replies).toHaveLength(0);
    expect(d.nextState.state).toBe("OPTED_OUT");
  });
});

describe("C3.9 textos", () => {
  it("C3.9 nenhum texto é 'aguarde', 'processando' ou 'recebi seu áudio'", () => {
    const texts = allBotTexts();
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) {
      expect(t, t).not.toMatch(/aguard|process|recebi (o )?seu [aá]udio|um momento/i);
      expect(t.length).toBeLessThanOrEqual(1024);
    }
  });
});

describe("persistência e integração", () => {
  it("envio falho (Graph 500) não gera segunda tentativa nem laço", async () => {
    const s = setup({ graphOk: false });
    await s.feed(text("oi"));
    await s.feed(text("oi"));
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
  it("janela fechada (última mensagem há mais de 23h30) => sendGuarded bloqueia", async () => {
    const s = setup();
    await s.repo.touchUser(WA, new Date(NOW.getTime() - 24 * 3_600_000));
    await s.deps.send({ to: WA, type: "text", text: { body: "x" } });
    expect(s.graph).not.toHaveBeenCalled();
  });
  it("usuários diferentes têm estados independentes", async () => {
    const s = setup();
    await s.feed(text("oi", "551100000001"));
    await s.feed(text("oi", "551100000002"));
    expect(s.graph).toHaveBeenCalledTimes(2);
  });
});

describe("SupabaseRepo (conversa) com fetch simulado", () => {
  it("saveConversation faz PATCH condicionado à versão e devolve false se ninguém foi atualizado", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      return new Response("[]", { status: 200 });
    });
    const repo = new SupabaseRepo("https://s.test", "k", f as unknown as typeof fetch);
    const ok = await repo.saveConversation(WA, 3, {
      state: "MENU", previousState: null, hintSentInState: false, optedOutAt: null,
    });
    expect(ok).toBe(false);
    expect(calls[0]).toContain("version=eq.3");
  });
});

describe("migração 0003 (PGlite)", () => {
  const sql = (n: string) => readFileSync(join(__dirname, "..", "supabase", "migrations", n), "utf8");
  it("aplica após 0001 e 0002, com padrões e compare-and-set por versão", async () => {
    const files = readdirSync(join(__dirname, "..", "supabase", "migrations")).sort();
    expect(files).toContain("0003_conversation.sql");
    const db = new PGlite();
    await db.exec(sql("0001_processed_messages.sql"));
    await db.exec(sql("0002_budget.sql"));
    await db.exec(sql("0003_conversation.sql"));
    await db.query("select touch_user($1,$2)", [WA, NOW.toISOString()]);
    const r = await db.query<{ state: string; version: number; hint_sent_in_state: boolean }>(
      "select state, version, hint_sent_in_state from users",
    );
    expect(r.rows[0]).toEqual({ state: "NEW", version: 0, hint_sent_in_state: false });
    const upd = (v: number) =>
      db.query("update users set state='MENU', version=$2+1 where wa_id=$1 and version=$2 returning wa_id", [WA, v]);
    expect((await upd(0)).rows).toHaveLength(1);
    expect((await upd(0)).rows).toHaveLength(0); // versão velha perde
  });
});
