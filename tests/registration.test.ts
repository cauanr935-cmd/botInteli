import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { MemoryRepo } from "../src/db/memory-repo";
import { handleIncomingMessage } from "../src/conversation/engine";
import { allBotTexts } from "../src/conversation/texts";
import { FIELDS, validateEmail } from "../src/registration/fields";
import { allRegistrationTexts } from "../src/registration/replies";
import { parseFlowResponse } from "../src/registration/decide";
import type { Logger } from "../src/lib/logger";
import { processEvents } from "../src/webhook/handler";
import { sendGuarded } from "../src/whatsapp/client";
import type { IncomingMessage, WebhookEvent } from "../src/whatsapp/types";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
const logger: Logger = { log: () => undefined };
let seq = 0;
const text = (body: string): IncomingMessage => ({ type: "text", wamid: `r${++seq}`, from: WA, body });
const button = (id: string): IncomingMessage => ({ type: "button_reply", wamid: `r${++seq}`, from: WA, id, title: "x" });
const nfm = (o: Record<string, unknown>): IncomingMessage => ({
  type: "nfm_reply", wamid: `r${++seq}`, from: WA, responseJson: JSON.stringify({ flow_token: "t", ...o }),
});
const goodForm = { full_name: "Maria da Silva", email: "Maria@Exemplo.com", city: "Recife", consent: true };

function setup(flowId?: string) {
  const repo = new MemoryRepo();
  const graph = vi.fn(async () =>
    new Response(JSON.stringify({ messages: [{ id: `o${++seq}` }] }), { status: 200 }),
  );
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, {
      repo, logger, phoneNumberId: "PN", whatsappToken: "t", graphApiVersion: "v21.0", stopAt: 950,
      timezone: "America/Sao_Paulo", fetchImpl: graph as unknown as typeof fetch, now: () => NOW,
    });
  const deps = {
    repo, logger, send, maxPerDay: 50, maxPer10Min: 50, now: () => NOW,
    registration: { ...(flowId ? { flowId } : {}), privacyUrl: "https://ex.com/priv", termsVersion: "v1" },
  };
  const feed = async (ev: IncomingMessage) => {
    await processEvents([ev], {
      appSecret: "", verifyToken: "", repo, logger, now: () => NOW,
      onEvent: async (e: WebhookEvent) => { if (e.type !== "status") await handleIncomingMessage(e, deps); },
    });
  };
  const sent = () => graph.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
  return { repo, graph, feed, sent };
}

describe("C4.1 com Flow", () => {
  it("C4.1 de 'oi' até o menu: 2 mensagens (Flow, depois confirmação + lista)", async () => {
    const s = setup("FLOW1");
    await s.feed(text("oi"));
    await s.feed(nfm(goodForm));
    expect(s.graph).toHaveBeenCalledTimes(2);
    const [a, b] = s.sent();
    expect(a.interactive.type).toBe("flow");
    expect(a.interactive.action.parameters.flow_id).toBe("FLOW1");
    expect(b.interactive.type).toBe("list");
    expect(b.interactive.body.text).toMatch(/Cadastro conclu/);
    const reg = await s.repo.getRegistration(WA);
    expect(reg.values).toEqual({ full_name: "Maria da Silva", email: "maria@exemplo.com", city: "Recife" });
    expect((await s.repo.getConversation(WA)).state).toBe("MENU");
  });
});

describe("C4.2 fallback", () => {
  it("C4.2 de 'oi' até o menu: 1 + nº de campos mensagens", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(button("consent_yes"));
    await s.feed(text("Maria da Silva"));
    await s.feed(text("maria@exemplo.com"));
    await s.feed(text("Recife"));
    expect(s.graph).toHaveBeenCalledTimes(1 + FIELDS.length);
    const last = s.sent().at(-1);
    expect(last.interactive.type).toBe("list");
    expect(s.sent()[0].interactive.type).toBe("button");
    expect(s.sent()[0].interactive.body.text).toContain("https://ex.com/priv");
    const reg = await s.repo.getRegistration(WA);
    expect(reg.registeredAt).toEqual(NOW);
    expect(reg.consentAt).toEqual(NOW);
    expect(reg.termsVersion).toBe("v1");
    expect(reg.values.email).toBe("maria@exemplo.com");
  });
  it("C4.2 aceitar digitando 'sim' também vale", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(text("sim!!"));
    expect((await s.repo.getConversation(WA)).state).toBe("REG_FIELD_full_name");
    expect((await s.repo.getRegistration(WA)).consentAt).toEqual(NOW);
  });
});

describe("C4.3 dado inválido", () => {
  it("C4.3 fallback: e-mail inválido não é salvo; 1 dica e depois silêncio", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(button("consent_yes"));
    await s.feed(text("Maria da Silva"));
    const before = s.graph.mock.calls.length;
    for (const bad of ["maria", "a@b", "maria@", "x y@z.com", "@z.com"]) await s.feed(text(bad));
    expect(s.graph.mock.calls.length).toBe(before + 1);
    const reg = await s.repo.getRegistration(WA);
    expect(reg.values.email).toBeUndefined();
    expect(reg.registeredAt).toBeNull();
    await s.feed(text("maria@exemplo.com"));
    expect((await s.repo.getConversation(WA)).state).toBe("REG_FIELD_city");
  });
  it("C4.3 fallback: nome curto/saudação e cidade longa são recusados", async () => {
    expect(FIELDS[0]!.validate("A")).toBeNull();
    expect(FIELDS[0]!.validate("oi")).toBeNull();
    expect(FIELDS[0]!.validate("12345")).toBeNull();
    expect(FIELDS[0]!.validate("x".repeat(101))).toBeNull();
    expect(FIELDS[2]!.validate("a".repeat(81))).toBeNull();
    expect(FIELDS[2]!.validate("  São   Paulo ")).toBe("São Paulo");
    expect(validateEmail("a@b.co")).toBe("a@b.co");
  });
  it.each([
    ["e-mail inválido", { ...goodForm, email: "nao-e-email" }],
    ["nome curto", { ...goodForm, full_name: "A" }],
    ["cidade ausente", { full_name: "Maria", email: "m@e.com", consent: true }],
    ["sem aceite", { ...goodForm, consent: false }],
    ["aceite ausente", { full_name: "Maria", email: "m@e.com", city: "Recife" }],
  ])("C4.3 Flow: %s => nada salvo, 1 dica, depois silêncio", async (_n, form) => {
    const s = setup("F");
    await s.feed(text("oi"));
    await s.feed(nfm(form));
    await s.feed(nfm(form));
    expect(s.graph).toHaveBeenCalledTimes(2); // Flow + 1 dica
    expect(await s.repo.getRegistration(WA)).toEqual({ consentAt: null, termsVersion: null, registeredAt: null, values: {} });
    expect((await s.repo.getConversation(WA)).state).toBe("AWAIT_REGISTRATION");
  });
  it("C4.3 Flow: JSON quebrado ou não objeto é recusado", () => {
    expect(parseFlowResponse("{").ok).toBe(false);
    expect(parseFlowResponse("[]").ok).toBe(false);
    expect(parseFlowResponse("null").ok).toBe(false);
  });
});

describe("C4.4 consentimento antes de dados", () => {
  it("C4.4 sem aceite: nada além do identificador técnico é salvo", async () => {
    const s = setup();
    await s.feed(text("oi"));
    for (const t of ["Maria da Silva", "maria@exemplo.com", "não", "Recife"]) await s.feed(text(t));
    expect(await s.repo.getRegistration(WA)).toEqual({ consentAt: null, termsVersion: null, registeredAt: null, values: {} });
    expect((await s.repo.getConversation(WA)).state).toBe("REG_CONSENT");
  });
  it("C4.4 o repositório recusa dados sem consent_at", async () => {
    const r = new MemoryRepo();
    await r.touchUser(WA, NOW);
    await expect(r.saveRegistration(WA, { values: { full_name: "Maria" } })).rejects.toThrow();
  });
  it("C4.4 com aceite: consent_at e terms_version gravados (Flow)", async () => {
    const s = setup("F");
    await s.feed(text("oi"));
    await s.feed(nfm(goodForm));
    const reg = await s.repo.getRegistration(WA);
    expect(reg.consentAt).toEqual(NOW);
    expect(reg.termsVersion).toBe("v1");
    expect(reg.registeredAt).toEqual(NOW);
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
    for (const c of ["wa_id_hash", "consent_at", "terms_version", "registered_at", ...FIELDS.map((f) => f.key)]) {
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

describe("C4.6 flows/cadastro.json", () => {
  const flow = JSON.parse(readFileSync(join(__dirname, "..", "flows", "cadastro.json"), "utf8"));
  const walk = (n: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (Array.isArray(n)) n.forEach((x) => walk(x, out));
    else if (n && typeof n === "object") {
      out.push(n as Record<string, unknown>);
      Object.values(n).forEach((x) => walk(x, out));
    }
    return out;
  };
  const nodes = walk(flow);
  it("C4.6 é JSON válido com versão e tela terminal", () => {
    expect(typeof flow.version).toBe("string");
    expect(flow.screens.length).toBeGreaterThan(0);
    expect(flow.screens.some((s: { terminal?: boolean }) => s.terminal)).toBe(true);
  });
  it("C4.6 tem todos os campos de fields.ts como TextInput obrigatório", () => {
    for (const f of FIELDS) {
      const n = nodes.find((x) => x.type === "TextInput" && x.name === f.key);
      expect(n, f.key).toBeDefined();
      expect(n!.required).toBe(true);
    }
  });
  it("C4.6 tem aceite obrigatório (OptIn) com link e o envia no payload", () => {
    const opt = nodes.find((x) => x.type === "OptIn");
    expect(opt).toBeDefined();
    expect(opt!.required).toBe(true);
    expect(JSON.stringify(opt)).toMatch(/https:\/\//);
    const complete = nodes.find((x) => (x["on-click-action"] as { name?: string } | undefined)?.name === "complete");
    const payload = (complete!["on-click-action"] as { payload: Record<string, string> }).payload;
    for (const k of [...FIELDS.map((f) => f.key), "consent"]) expect(payload[k], k).toBeDefined();
  });
  it("C4.6 não declara endpoint (Flow só de navegação)", () => {
    expect(JSON.stringify(flow)).not.toMatch(/endpoint|data_channel_uri|data_exchange/);
  });
});

describe("C4.7 já cadastrado", () => {
  it("C4.7 'oi' leva direto ao menu (1 mensagem) sem refazer o cadastro", async () => {
    const s = setup("F");
    await s.feed(text("oi"));
    await s.feed(nfm(goodForm));
    // volta como nova sessão: estado zerado, mas o cadastro existe
    s.repo.conversations.clear();
    const before = s.graph.mock.calls.length;
    await s.feed(text("oi"));
    expect(s.graph.mock.calls.length).toBe(before + 1);
    expect(s.sent().at(-1).interactive.type).toBe("list");
    expect((await s.repo.getConversation(WA)).state).toBe("MENU");
  });
  it("C4.7 também no fallback", async () => {
    const s = setup();
    await s.feed(text("oi"));
    await s.feed(button("consent_yes"));
    for (const t of ["Maria da Silva", "m@e.com", "Recife"]) await s.feed(text(t));
    s.repo.conversations.clear();
    const before = s.graph.mock.calls.length;
    await s.feed(text("oi"));
    expect(s.graph.mock.calls.length).toBe(before + 1);
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
  it("C4 limites da lista e do botão da Meta", async () => {
    const s = setup();
    await s.feed(text("oi"));
    const btn = s.sent()[0].interactive.action.buttons[0].reply.title as string;
    expect(btn.length).toBeLessThanOrEqual(20);
    await s.feed(button("consent_yes"));
    for (const t of ["Maria da Silva", "m@e.com", "Recife"]) await s.feed(text(t));
    const list = s.sent().at(-1).interactive;
    const rows = list.action.sections[0].rows as { title: string; description: string }[];
    expect(rows.length).toBeLessThanOrEqual(10);
    for (const r of rows) {
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect(r.description.length).toBeLessThanOrEqual(72);
    }
  });
});
