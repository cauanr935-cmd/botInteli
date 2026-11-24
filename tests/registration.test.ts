import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { MemoryRepo } from "../src/db/memory-repo";
import { handleIncomingMessage } from "../src/conversation/engine";
import { allBotTexts } from "../src/conversation/texts";
import { FIELDS } from "../src/registration/fields";
import { allRegistrationTexts } from "../src/registration/replies";
import type { Logger } from "../src/lib/logger";
import { processEvents } from "../src/webhook/handler";
import { sendGuarded } from "../src/whatsapp/client";
import type { IncomingMessage, WebhookEvent } from "../src/whatsapp/types";
import { asTransport } from "./helpers/transport";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
const logger: Logger = { log: () => undefined };
let seq = 0;
const text = (body: string): IncomingMessage => ({ type: "text", wamid: `r${++seq}`, from: WA, body });
const button = (id: string): IncomingMessage => ({ type: "button_reply", wamid: `r${++seq}`, from: WA, id, title: "x" });

function setup() {
  const repo = new MemoryRepo();
  const graph = vi.fn(async () =>
    new Response(JSON.stringify({ messages: [{ id: `o${++seq}` }] }), { status: 200 }),
  );
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, {
      repo, logger, phoneNumberId: "PN", evolutionUrl: "https://evo.test", evolutionApiKey: "k", evolutionInstance: "inst", stopAt: 950,
      timezone: "America/Sao_Paulo", transport: asTransport(graph as never), now: () => NOW,
    });
  const deps = {
    repo, logger, send, maxPerDay: 50, maxPer10Min: 50, now: () => NOW,
    registration: { privacyUrl: "https://ex.com/priv", termsVersion: "v1" },
  };
  const feed = async (ev: IncomingMessage) => {
    await processEvents([ev], {
      webhookToken: "", repo, logger, now: () => NOW,
      onEvent: async (e: WebhookEvent) => { await handleIncomingMessage(e, deps); },
    });
  };
  const sent = () => graph.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
  return { repo, graph, feed, sent };
}

describe("C4.1 primeiro contato", () => {
  it.each(["oi", "olá", "sinal", "xyz qualquer coisa"])("C4.1 '%s' recebe a MESMA primeira resposta: termo + botão Aceito", async (first) => {
    const s = setup();
    await s.feed(text(first));
    expect(s.graph).toHaveBeenCalledTimes(1);
    const m = s.sent()[0];
    expect(m.interactive.type).toBe("button");
    expect(m.interactive.body.text).toContain("https://ex.com/priv");
    expect(m.interactive.action.buttons[0].reply.id).toBe("consent_yes");
    expect((await s.repo.getConversation(WA)).state).toBe("REG_CONSENT");
  });
  it("C4.1 a resposta é idêntica para qualquer mensagem inicial", async () => {
    const a = setup(); const b = setup();
    await a.feed(text("oi")); await b.feed(text("sinal"));
    expect(a.sent()[0]).toEqual(b.sent()[0]);
  });
});

describe("C4.2 coleta em texto: nome e turma, depois áudio", () => {
  it("C4.2 aceite -> nome -> turma -> pede o áudio (1 mensagem por passo)", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(button("consent_yes"));
    expect(s.sent().at(-1).text.body).toBe(FIELDS[0]!.prompt); // primeira info individual: nome completo
    await s.feed(text("Maria da Silva"));
    expect(s.sent().at(-1).text.body).toBe(FIELDS[1]!.prompt); // turma
    await s.feed(text("Turma 12")); await s.feed(text("20"));
    expect(s.graph).toHaveBeenCalledTimes(5);
    const ask = s.sent().at(-1).text.body as string;
    for (const topic of [/nascimento/i, /esporte favorito/i, /time do seu coração/i, /hobbies/i]) expect(ask).toMatch(topic);
    expect((await s.repo.getConversation(WA)).state).toBe("REG_PROFILE_AUDIO");
    const reg = await s.repo.getRegistration(WA);
    expect(reg.values).toEqual({ full_name: "Maria da Silva", class_name: "Turma 12" });
    expect(reg.registeredAt).toBeNull();
    expect(reg.consentAt).toEqual(NOW);
    expect(reg.termsVersion).toBe("v1");
  });
  it("C4.2 aceitar digitando 'sim' também vale", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(text("sim!!"));
    expect((await s.repo.getConversation(WA)).state).toBe("REG_FIELD_full_name");
    expect((await s.repo.getRegistration(WA)).consentAt).toEqual(NOW);
  });
  it("curiosidades: só a data de nascimento pede mais informação (nunca 'não entendi') e não avança", async () => {
    const { isBirthDateOnly } = await import("../src/registration/decide");
    for (const d of ["12/05/2003", "12 de maio de 2003", "nasci em 12/05/2003", "meu aniversário é 3.4.2002"]) expect(isBirthDateOnly(d), d).toBe(true);
    for (const d of ["12/05/2003, gosto de música e cozinhar", "gosto de futebol", "nasci em 2003 e amo cozinhar"]) expect(isBirthDateOnly(d), d).toBe(false);
    for (const date of ["12/05/2003", "nasci em 12 de maio de 2003"]) {
      const s = setup();
      for (const m of [text("oi"), button("consent_yes"), text("Maria da Silva"), text("Turma 12"), text("20")]) await s.feed(m);
      await s.feed(text(date));
      expect(s.sent().at(-1).text.body).toMatch(/anotei sua data de nascimento[\s\S]*me conta um pouco mais/i);
      expect(s.sent().at(-1).text.body).not.toMatch(/não entendi/i);
      expect((await s.repo.getConversation(WA)).state).toBe("REG_PROFILE_AUDIO");
      await s.feed(text("12/05/2003, gosto de escutar música e cozinhar"));
      expect((await s.repo.getConversation(WA)).state).toBe("PROFILE_ROLE");
    }
    const s = setup();
    for (const m of [text("oi"), button("consent_yes"), text("Maria da Silva"), text("Turma 12"), text("20"), text("12/05/2003"), text("gosto de escutar música e cozinhar")]) await s.feed(m);
    const about = (await s.repo.getRegistration(WA)).profileAbout;
    expect(about).toContain("12/05/2003"); // as duas partes ficam juntas
    expect(about).toContain("escutar música e cozinhar");
  });
  it("C4.2 curiosidades: texto curto recebe a dica exata, depois aviso descontraído; texto longo é aceito", async () => {
    const s = setup();
    for (const m of [text("oi"), button("consent_yes"), text("Maria da Silva"), text("Turma 12"), text("20")]) await s.feed(m);
    const n = s.graph.mock.calls.length;
    await s.feed(text("futebol"));
    expect(s.graph.mock.calls.length).toBe(n + 1);
    expect(s.sent().at(-1).text.body).toMatch(/^Me conta um pouco mais sobre você[\s\S]*pelo menos 10 caracteres\.$/);
    await s.feed(text("time"));
    expect(s.graph.mock.calls.length).toBe(n + 2); // dica exata + aviso descontraído
    expect((await s.repo.getConversation(WA)).state).toBe("REG_PROFILE_AUDIO");
    await s.feed(text("nasci em 1990, gosto de futebol"));
    expect(s.graph.mock.calls.length).toBe(n + 3); // + a próxima pergunta (papel); o texto válido é aceito
    expect((await s.repo.getConversation(WA)).state).toBe("PROFILE_ROLE");
  });
});

describe("C4.3 dado inválido", () => {
  it("C4.3 nome inválido não é salvo; 1 dica e depois um aviso de não entendi", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(button("consent_yes"));
    const n = s.graph.mock.calls.length;
    await s.feed(text("oi"));
    await s.feed(text("x"));
    expect(s.graph.mock.calls.length).toBe(n + 2); // "oi" gera a dica; "x" gera o aviso de que não entendeu
    expect(s.sent().at(-2).text.body).toBe(FIELDS[0]!.hint);
    expect(s.sent().at(-1).text.body).toMatch(/entend|compreend|saquei|peguei/i);
    expect((await s.repo.getRegistration(WA)).values).toEqual({});
  });
  it("C4.3 validadores: nome curto/saudação/longo e turma vazia/comando são recusados", () => {
    expect(FIELDS[0]!.validate("A")).toBeNull();
    expect(FIELDS[0]!.validate("oi")).toBeNull();
    expect(FIELDS[0]!.validate("12345")).toBeNull();
    expect(FIELDS[0]!.validate("x".repeat(101))).toBeNull();
    expect(FIELDS[1]!.validate("  ")).toBeNull();
    expect(FIELDS[1]!.validate("sim")).toBeNull();
    expect(FIELDS[1]!.validate("1A")).toBe("1A");
  });
});

describe("C4.4 consentimento antes de dados", () => {
  it("C4.4 sem aceite: nada além do identificador técnico é salvo", async () => {
    const s = setup();
    await s.feed(text("oi"));
    for (const t of ["Maria da Silva", "Turma 12", "20", "não", "Recife"]) await s.feed(text(t));
    expect(await s.repo.getRegistration(WA)).toEqual({ consentAt: null, termsVersion: null, registeredAt: null, values: {} });
    expect((await s.repo.getConversation(WA)).state).toBe("REG_CONSENT");
  });
  it("C4.4 o repositório recusa dados sem consent_at", async () => {
    const r = new MemoryRepo();
    await r.touchUser(WA, NOW);
    await expect(r.saveRegistration(WA, { values: { full_name: "Maria" } })).rejects.toThrow();
    await expect(r.saveRegistration(WA, { profileRole: "mentor" })).rejects.toThrow();
  });
});

describe("C4.5 migrações e RLS", () => {
  const dir = join(__dirname, "..", "supabase", "migrations");
  let shared: PGlite;
  async function db() {
    return shared;
  }
  beforeAll(async () => {
    shared = new PGlite();
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) await shared.exec(readFileSync(join(dir, f), "utf8"));
  }, 60_000);
  it("C4.5 todas as migrações aplicam limpo e RLS está ligado em users", async () => {
    const d = await db();
    const r = await d.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname='users'");
    expect(r.rows[0]!.relrowsecurity).toBe(true);
    const cols = await d.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='users'");
    const names = cols.rows.map((c) => c.column_name);
    for (const c of ["wa_id_hash", "consent_at", "terms_version", "registered_at", "profile_role", "mentor_categories", ...FIELDS.map((f) => f.key)]) {
      expect(names).toContain(c);
    }
  });
  it("C4.5 reaplicar a migração 0004 é inofensivo", async () => {
    const d = await db();
    await d.exec(readFileSync(join(dir, "0004_registration.sql"), "utf8"));
  });
  it("C4.5/C4.4 o banco recusa dados de cadastro sem consentimento", async () => {
    const d = await db();
    await d.query("insert into users (wa_id, last_user_message_at) values ('1', now())");
    await expect(d.query("update users set full_name='Maria' where wa_id='1'")).rejects.toThrow();
    await expect(d.query("update users set full_name='Maria', consent_at=now() where wa_id='1'")).rejects.toThrow();
    await d.query("update users set full_name='Maria', consent_at=now(), terms_version='v1' where wa_id='1'");
  });
});

describe("C4.7 já cadastrado", () => {
  it("C4.7 volta a falar: pergunta 'O que você quer fazer?' (não presume dúvida) e, ao tirar dúvida, registra", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(button("consent_yes"));
    await s.feed(text("Maria da Silva"));
    await s.feed(text("Turma 12")); await s.feed(text("20"));
    await s.repo.saveRegistration(WA, { registeredAt: NOW }); // cadastro concluído (papel já escolhido)
    s.repo.conversations.clear(); // nova sessão
    const before = s.graph.mock.calls.length;
    await s.feed(text("oi"));
    expect(s.graph.mock.calls.length).toBe(before + 1);
    expect(s.sent().at(-1).interactive.body.text).toMatch(/O que você quer fazer/);
    await s.feed(text("oi")); // repetição: silêncio
    expect(s.graph.mock.calls.length).toBe(before + 1);
    await s.feed(button("ret_doubt"));
    expect(s.graph.mock.calls.length).toBe(before + 2);
    await s.feed(text("Como faço uma query SQL com join?"));
    expect(s.graph.mock.calls.length).toBe(before + 3);
    expect(s.sent().at(-1).interactive.body.text).toMatch(/Dúvida registrada! Agora, só para encerrar/);
    expect(s.repo.doubts).toHaveLength(1);
    expect(s.repo.doubts[0]!.categories).toContain("computacao");
    expect((await s.repo.getConversation(WA)).state).toBe("SCHED_DAYS_doubt");
  });
});

describe("textos e extras", () => {
  it("C4 textos do cadastro respeitam R2 e limites da Meta", () => {
    for (const t of [...allRegistrationTexts(), ...allBotTexts()]) {
      expect(t).not.toMatch(/aguard|process|recebi (o )?seu [aá]udio|um momento/i);
      expect(t.length).toBeLessThanOrEqual(1024);
    }
  });
  it("C4 opt-out no meio do cadastro e 'voltar' reapresenta a pergunta do campo", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(button("consent_yes"));
    await s.feed(text("sair"));
    await s.feed(text("Maria da Silva")); // silêncio
    const before = s.graph.mock.calls.length;
    await s.feed(text("voltar"));
    expect(s.graph.mock.calls.length).toBe(before + 1);
    expect(s.sent().at(-1).text.body).toBe(FIELDS[0]!.prompt);
  });
  it("C4 opt-out aguardando áudio e 'voltar' reapresenta a solicitação", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(button("consent_yes"));
    await s.feed(text("Maria da Silva"));
    await s.feed(text("Turma 12")); await s.feed(text("20"));
    await s.feed(text("sair"));
    const before = s.graph.mock.calls.length;
    await s.feed(text("voltar"));
    expect(s.graph.mock.calls.length).toBe(before + 1);
    expect(s.sent().at(-1).text.body).toMatch(/Pode gravar um áudio ou, se preferir, escrever/i);
  });
  it("C4 limites do botão e do menu explícito", async () => {
    const s = setup();
    await s.feed(text("oi"));
    const btn = s.sent()[0].interactive.action.buttons[0].reply.title as string;
    expect(btn.length).toBeLessThanOrEqual(20);
    await s.feed(button("consent_yes"));
    await s.feed(text("Maria da Silva"));
    s.repo.conversations.set(WA, { state: "COMPLETED", previousState: null, hintSentInState: false, optedOutAt: null, version: 99 });
    await s.feed(text("menu"));
    const list = s.sent().at(-1).interactive;
    const rows = list.action.sections[0].rows as { title: string; description: string }[];
    expect(rows.length).toBeLessThanOrEqual(10);
    for (const r of rows) {
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect(r.description.length).toBeLessThanOrEqual(72);
    }
  });
});
