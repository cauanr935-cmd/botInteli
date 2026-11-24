// Aviso da decisão da equipe (curadoria): reenvio do /result, uma mensagem por mudança, botão de revisão, painel.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Simulator, HOUR } from "../scripts/simulate";
import { MemoryRepo } from "../src/db/memory-repo";
import { hashWaId } from "../src/lib/hash";
import { handleApi } from "../src/mentoria/api";
import { approvedText, notifyCuradoria, parseCuradoria, summarizeCuradoria, type CuradoriaDeps } from "../src/mentoria/curadoria";
import { handlePanel } from "../src/mentoria/panel";
import type { OutboundMessage, SendResult } from "../src/whatsapp/client";

const NOW = new Date("2026-11-18T12:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "k".repeat(40);

type Msg = OutboundMessage & { interactive?: { body: { text: string }; action: { buttons?: { reply: { id: string; title: string } }[] } } };
const textOf = (m: Msg): string => m.text?.body ?? m.interactive?.body.text ?? "";
const buttonsOf = (m: Msg): string[] => (m.interactive?.action.buttons ?? []).map((b) => b.reply.id);

const conta = (o: Record<string, unknown> = {}) => ({ minutos_disponiveis: 70, horas_certificadas: 0, pode_pedir_certificado: true, minimo_horas: 1, ...o });
const part = (pessoa_id: string, situacao: string, o: Record<string, unknown> = {}) =>
  ({ pessoa_id, papel: "mentor", situacao, minutos_contabilizados: 35, conta: conta(), ...o });
const result = (status: string, participantes: unknown[]) => ({ status: "analisada", curadoria: { status, participantes } });

async function world(extra: { optedOut?: boolean } = {}) {
  const repo = new MemoryRepo();
  const a = "5511900000001", b = "5511900000002";
  const [ha, hb] = [await hashWaId(a), await hashWaId(b)];
  for (const [wa, h, name] of [[a, ha, "Ana"], [b, hb, "Bruno"]] as const) {
    repo.registrations.set(wa, { consentAt: NOW, termsVersion: "1", registeredAt: NOW, values: { full_name: name }, waIdHash: h } as never);
  }
  repo.audios.set(ID, {
    id: ID, waIdHash: ha, r2Key: "k", mime: "audio/ogg", bytes: 10, serviceId: "mentoria",
    mentoria: { role: "mentor", subject: "Carreira", partner: "Bruno" }, ocorreuEm: "2026-11-12", partnerWaIdHash: hb,
    partnerConfirmedAt: NOW, status: "done", result: null, createdAt: NOW, finishedAt: NOW,
  });
  if (extra.optedOut) {
    const c = await repo.getConversation(b);
    await repo.saveConversation(b, c.version, { state: "OPTED_OUT", previousState: null, optedOutAt: NOW, hintSentInState: false });
  }
  const sent: Msg[] = [];
  let fail = false;
  const deps: CuradoriaDeps = {
    repo, logger: { log: () => undefined }, maxPerDay: 100, maxPer10Min: 50, timezone: "America/Sao_Paulo", now: () => NOW,
    send: async (m: OutboundMessage): Promise<SendResult> => {
      if (fail) return { status: "error", code: "x" };
      sent.push(m as Msg); return { status: "sent", wamid: "w" };
    },
  };
  return { repo, deps, sent, a, b, ha, hb, failNext: (v: boolean) => { fail = v; } };
}
const to = (sent: Msg[], wa: string) => sent.filter((m) => m.to === wa);

describe("parseCuradoria", () => {
  it("lê o bloco, ignora participante inválido e aceita sem_analise", () => {
    const c = parseCuradoria({ status: "sem_analise", curadoria: { status: "parcial", participantes: [part("h1", "aprovada"), { x: 1 }, part("h2", "xyz"), part("h3", "recusada", { conta: null })] } });
    expect(c?.status).toBe("parcial");
    expect(c?.participantes.map((p) => [p.pessoaId, p.situacao])).toEqual([["h1", "aprovada"], ["h3", "recusada"]]);
    expect(c?.participantes[0]?.conta).toMatchObject({ minutosDisponiveis: 70, podePedirCertificado: true, minimoHoras: 1 });
  });
  it("sem bloco ou com bloco inválido: null (nunca lança)", () => {
    for (const r of [null, "x", 3, {}, { curadoria: null }, { curadoria: { status: "?", participantes: [] } }, { curadoria: { status: "aprovada" } }]) expect(parseCuradoria(r)).toBeNull();
  });
});

describe("mensagens", () => {
  it("aprovada: data, minutos, horas na conta e o mínimo para o certificado", () => {
    const p = parseCuradoria(result("aprovada", [part("h", "aprovada", { conta: conta({ minutos_disponiveis: 130 }) })]))!.participantes[0]!;
    expect(approvedText("12/11/2026", p)).toBe(
      "Sua mentoria de 12/11/2026 foi aprovada pela equipe ✅ 35 min contabilizados. Você tem 2 h 10 min na conta. O certificado de horas complementares pode ser pedido a partir de 1 h.");
  });
  it("aprovada sem a conta: só o que existe (nada de 'undefined')", () => {
    const p = parseCuradoria(result("aprovada", [part("h", "aprovada", { conta: null, minutos_contabilizados: null })]))!.participantes[0]!;
    expect(approvedText("12/11/2026", p)).toBe("Sua mentoria de 12/11/2026 foi aprovada pela equipe ✅");
  });
});

describe("notifyCuradoria", () => {
  it("uma mensagem por mudança: aprovada avisa uma vez e o reenvio igual não manda de novo", async () => {
    const w = await world();
    const r1 = result("aprovada", [part(w.ha, "aprovada"), part(w.hb, "aguardando_equipe", { papel: "mentorado" })]);
    expect(await notifyCuradoria(ID, r1, w.deps)).toBe(1);
    expect(textOf(to(w.sent, w.a)[0]!)).toMatch(/^Sua mentoria de 12\/11\/2026 foi aprovada pela equipe ✅ 35 min contabilizados\. Você tem 1 h 10 min na conta\./);
    expect(to(w.sent, w.b)).toHaveLength(0); // aguardando_equipe: silêncio
    expect(await notifyCuradoria(ID, r1, w.deps)).toBe(0); // reenvio igual
    expect(await notifyCuradoria(ID, structuredClone(r1), w.deps)).toBe(0);
    // o outro participante muda depois: só ele é avisado
    const r2 = result("aprovada", [part(w.ha, "aprovada"), part(w.hb, "aprovada", { papel: "mentorado" })]);
    expect(await notifyCuradoria(ID, r2, w.deps)).toBe(1);
    expect(w.sent).toHaveLength(2);
    expect(to(w.sent, w.b)).toHaveLength(1);
  });
  it("aprovada com e sem pode_pedir_certificado: texto igual, sem botão (o pedido de certificado vem depois)", async () => {
    const w = await world();
    await notifyCuradoria(ID, result("aprovada", [part(w.ha, "aprovada", { conta: conta({ pode_pedir_certificado: true }) }), part(w.hb, "aprovada", { conta: conta({ pode_pedir_certificado: false, minutos_disponiveis: 35 }) })]), w.deps);
    expect(w.sent).toHaveLength(2);
    for (const m of w.sent) expect(m.type).toBe("text");
    expect(textOf(to(w.sent, w.b)[0]!)).toContain("Você tem 0 h 35 min na conta");
  });
  it("recusada: texto de validação e botão [Pedir revisão] com o id da mentoria", async () => {
    const w = await world();
    await notifyCuradoria(ID, result("recusada", [part(w.ha, "recusada"), part(w.hb, "recusada", { papel: "mentorado" })]), w.deps);
    const m = to(w.sent, w.a)[0]!;
    expect(textOf(m)).toBe("Sua mentoria de 12/11/2026 não foi contabilizada: ela não atendeu aos critérios de validação. Se quiser, peça revisão humana.");
    expect(buttonsOf(m)).toEqual([`ment_rev:${ID}`]);
    expect(m.interactive && JSON.stringify(m.interactive)).toContain("Pedir revisão");
  });
  it("mudança de aguardando_equipe para aprovada/recusada avisa; recusada depois de aprovada (revisão) avisa de novo", async () => {
    const w = await world();
    await notifyCuradoria(ID, result("aguardando_equipe", [part(w.ha, "aguardando_equipe")]), w.deps);
    expect(w.sent).toHaveLength(0);
    await notifyCuradoria(ID, result("aprovada", [part(w.ha, "aprovada")]), w.deps);
    await notifyCuradoria(ID, result("recusada", [part(w.ha, "recusada")]), w.deps);
    expect(w.sent).toHaveLength(2);
  });
  it("sem data informada usa o dia de created_at; pessoa_id desconhecido ou de fora da mentoria não quebra nem envia", async () => {
    const w = await world();
    const r = result("aprovada", [part("f".repeat(64), "aprovada"), part("lixo", "recusada")]);
    expect(await notifyCuradoria(ID, r, w.deps)).toBe(0);
    expect(await notifyCuradoria("22222222-2222-4222-8222-222222222222", result("aprovada", [part(w.ha, "aprovada")]), w.deps)).toBe(0); // mentoria inexistente
    expect(w.sent).toHaveLength(0);
    // participante da mentoria mas sem cadastro/consentimento: nada (R6)
    w.repo.registrations.get(w.b)!.consentAt = null;
    expect(await notifyCuradoria(ID, result("aprovada", [part(w.hb, "aprovada")]), w.deps)).toBe(0);
    // sem ocorreu_em: o dia de created_at (fuso do bot)
    w.repo.audios.set(ID, { ...w.repo.audios.get(ID)!, ocorreuEm: undefined as never });
    expect(await notifyCuradoria(ID, result("aprovada", [part(w.ha, "aprovada")]), w.deps)).toBe(1);
    expect(textOf(w.sent[0]!)).toContain("de 18/11/2026");
  });
  it("opt-out e limite por pessoa: não envia e não gasta a mudança (o próximo reenvio tenta de novo)", async () => {
    const w = await world({ optedOut: true });
    const r = result("aprovada", [part(w.hb, "aprovada", { papel: "mentorado" })]);
    expect(await notifyCuradoria(ID, r, w.deps)).toBe(0);
    const lim = await world();
    const strict = { ...lim.deps, maxPer10Min: 0 };
    expect(await notifyCuradoria(ID, result("aprovada", [part(lim.ha, "aprovada")]), strict)).toBe(0);
    expect(await notifyCuradoria(ID, result("aprovada", [part(lim.ha, "aprovada")]), lim.deps)).toBe(1);
  });
  it("envio que falha desfaz a reserva: o próximo reenvio do mesmo resumo tenta de novo e só então marca como avisado", async () => {
    const w = await world();
    const r = result("recusada", [part(w.ha, "recusada")]);
    w.failNext(true);
    expect(await notifyCuradoria(ID, r, w.deps)).toBe(0);
    expect(w.repo.audios.get(ID)!.notifiedCuradoria?.[w.ha]).toBeUndefined();
    w.failNext(false);
    expect(await notifyCuradoria(ID, r, w.deps)).toBe(1);
    expect(w.repo.audios.get(ID)!.notifiedCuradoria?.[w.ha]).toBe("recusada");
    expect(await notifyCuradoria(ID, r, w.deps)).toBe(0);
  });
  it("dois reenvios simultâneos do mesmo resumo mandam uma mensagem só", async () => {
    const w = await world();
    const r = result("aprovada", [part(w.ha, "aprovada")]);
    await Promise.all([notifyCuradoria(ID, r, w.deps), notifyCuradoria(ID, r, w.deps), notifyCuradoria(ID, r, w.deps)]);
    expect(w.sent).toHaveLength(1);
  });
  it("nenhuma mensagem contém telefone (nem o wa_id nem número com DDD)", async () => {
    const w = await world();
    await notifyCuradoria(ID, result("aprovada", [part(w.ha, "aprovada"), part(w.hb, "recusada", { papel: "mentorado" })]), w.deps);
    expect(w.sent).toHaveLength(2);
    for (const m of w.sent) {
      const t = JSON.stringify({ ...m, to: undefined }).replaceAll(ID, "<id>"); // o id da mentoria (UUID) não é telefone
      expect(t).not.toContain(w.a.slice(2));
      expect(t).not.toContain(w.b.slice(2));
      expect(t).not.toMatch(/\d{8,}/);
    }
  });
});

describe("POST /result reenvia e avisa", () => {
  it("o notebook reenvia o mesmo resumo: grava sempre, avisa uma vez; falha no aviso não derruba o POST", async () => {
    const w = await world();
    const post = (body: unknown, extra: Partial<Parameters<typeof handleApi>[1]> = {}) =>
      handleApi(new Request(`https://w.dev/api/v1/mentorias/${ID}/result`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) }),
        { apiKey: KEY, repo: w.repo, bucket: undefined, now: () => NOW, notify: (id, r) => notifyCuradoria(id, r, w.deps), ...extra });
    const body = { result: result("recusada", [part(w.ha, "recusada")]) };
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(w.sent).toHaveLength(1);
    expect((await w.repo.getMentoria(ID))!.analysisResult).toEqual(body.result);
    // aviso que lança: o resultado continua gravado e a resposta continua 200
    const r = await post({ result: { novo: true } }, { notify: async () => { throw new Error("boom"); } });
    expect(r.status).toBe(200);
    expect((await w.repo.getMentoria(ID))!.analysisResult).toEqual({ novo: true });
    // waitUntil: a resposta não espera o aviso
    const jobs: Promise<unknown>[] = [];
    expect((await post({ result: result("aprovada", [part(w.ha, "aprovada")]) }, { waitUntil: (p) => void jobs.push(p) })).status).toBe(200);
    await Promise.all(jobs);
    expect(w.sent).toHaveLength(2);
  });
});

describe("botão [Pedir revisão] (fluxo completo no simulador)", () => {
  async function sim() {
    const s = new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "40", MAX_BOT_MSGS_PER_USER_PER_DAY: "100" } });
    const a = s.phone(1), b = s.phone(2), c = s.phone(3);
    for (const p of [a, b, c]) { await s.register(p, 1000); s.advance(11 * 60_000); }
    const [ha, hb] = [await hashWaId(a), await hashWaId(b)];
    s.repo.audios.set(ID, {
      id: ID, waIdHash: ha, r2Key: "k", mime: "audio/ogg", bytes: 10, serviceId: "mentoria", mentoria: { role: "mentor", subject: "Carreira" },
      ocorreuEm: "2026-11-12", partnerWaIdHash: hb, partnerConfirmedAt: s.now(), status: "done", result: null, createdAt: s.now(), finishedAt: s.now(),
    });
    const send = async (m: OutboundMessage): Promise<SendResult> => { s.sent.push({ to: m.to, body: m as never, at: s.now() }); return { status: "sent", wamid: "w" }; };
    const deps: CuradoriaDeps = { repo: s.repo, logger: { log: () => undefined }, send, maxPerDay: 100, maxPer10Min: 50, timezone: s.cfg.timezone, now: () => s.now() };
    return { s, a, b, c, ha, hb, deps };
  }
  it("recusada -> toque no botão registra o pedido uma vez e confirma; repetir fica em silêncio", async () => {
    const { s, a, ha, deps } = await sim();
    await notifyCuradoria(ID, result("recusada", [part(ha, "recusada")]), deps);
    const before = s.sentTo(a).length;
    s.advance(HOUR);
    await s.button(a, `ment_rev:${ID}`);
    expect(s.repo.reviews).toHaveLength(1);
    expect(s.repo.reviews[0]).toMatchObject({ audioId: ID, waIdHash: ha, status: "aberta" });
    expect(s.sentTo(a).length).toBe(before + 1);
    s.advance(1000);
    await s.button(a, `ment_rev:${ID}`);
    expect(s.repo.reviews).toHaveLength(1);
    expect(s.sentTo(a).length).toBe(before + 1);
  });
  it("só pede revisão quem participou e teve a recusa avisada (aprovada, estranho e id inválido não registram)", async () => {
    const { s, a, b, c, ha, hb, deps } = await sim();
    await notifyCuradoria(ID, result("aprovada", [part(ha, "aprovada"), part(hb, "recusada", { papel: "mentorado" })]), deps);
    await s.button(a, `ment_rev:${ID}`);          // aprovada: não é recusa
    await s.button(c, `ment_rev:${ID}`);          // não participou
    await s.button(b, "ment_rev:nao-e-uuid");
    await s.button(b, "ment_rev:22222222-2222-4222-8222-222222222222");
    expect(s.repo.reviews).toHaveLength(0);
    await s.button(b, `ment_rev:${ID}`);          // o parceiro, recusado
    expect(s.repo.reviews).toHaveLength(1);
    expect(s.repo.reviews[0]!.waIdHash).toBe(hb);
  });
});

describe("painel", () => {
  const env = { PANEL_OPEN: "true" };
  const get = (repo: MemoryRepo, path: string) => handlePanel(new Request(`https://w.dev${path}`), { env, repo, bucket: undefined, now: () => NOW });
  it("mostra curadoria.status e se cada participante já foi avisado (sem pessoa_id)", async () => {
    const w = await world();
    const r = result("parcial", [part(w.ha, "aprovada"), part(w.hb, "recusada", { papel: "mentorado" })]);
    await w.repo.setAnalysisResult(ID, r, NOW);
    await notifyCuradoria(ID, { ...r, curadoria: { ...r.curadoria, participantes: [part(w.ha, "aprovada"), part(w.hb, "aguardando_equipe", { papel: "mentorado" })] } }, w.deps);
    const res = await get(w.repo, "/painel/api/mentorias");
    const txt = await res.text();
    const item = (JSON.parse(txt) as { items: { curadoria: unknown }[] }).items[0]!;
    expect(item.curadoria).toEqual({
      status: "parcial",
      participantes: [{ papel: "mentor", situacao: "aprovada", avisado: true }, { papel: "mentorado", situacao: "recusada", avisado: false }],
    });
    expect(JSON.stringify(item.curadoria)).not.toContain(w.ha); // o resumo não traz pessoa_id (o result bruto já era exibido)
    expect(txt).not.toContain(w.a); // nunca telefone
    expect(summarizeCuradoria({}, null)).toBeNull();
  });
  it("lista os pedidos de revisão: mentoria, data e papel de quem pediu", async () => {
    const w = await world();
    await w.repo.requestReview(ID, w.hb, NOW);
    expect(await w.repo.requestReview(ID, w.hb, NOW)).toBe(false);
    const j = (await (await get(w.repo, "/painel/api/revisoes?status=aberta")).json()) as { items: Record<string, unknown>[] };
    expect(j.items).toEqual([expect.objectContaining({ mentoriaId: ID, occurredOn: "2026-11-12", role: "mentorado", status: "aberta" })]);
    expect(JSON.stringify(j)).not.toContain(w.hb);
    expect((await get(w.repo, "/painel/api/revisoes?status=xyz")).status).toBe(400);
  });
});

describe("SQL (PGlite): migração 0021", () => {
  it("reserva atômica, desfazer e pedido de revisão único", async () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const db = new PGlite();
    for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
    await db.query("insert into users (wa_id, last_user_message_at, wa_id_hash, consent_at, terms_version, registered_at, full_name) values ('1', now(), 'h1', now(), 'v1', now(), 'Ana')");
    await db.query("insert into audios (id, wa_id_hash, r2_key, mime, bytes, service_id, subject) values ($1,'h1','k','audio/ogg',10,'mentoria','x')", [ID]);
    const claim = async (s: string) => (await db.query<{ c: boolean }>("select claim_curadoria_notice($1, 'p1', $2) as c", [ID, s])).rows[0]!.c;
    expect(await claim("recusada")).toBe(true);
    expect(await claim("recusada")).toBe(false);
    expect(await claim("aprovada")).toBe(true);
    await db.query("select release_curadoria_notice($1, 'p1', 'aprovada', 'recusada')", [ID]);
    expect((await db.query<{ n: unknown }>("select notified_curadoria as n from audios where id = $1", [ID])).rows[0]!.n).toEqual({ p1: "recusada" });
    await db.query("select release_curadoria_notice($1, 'p1', 'recusada', null)", [ID]);
    expect((await db.query<{ n: unknown }>("select notified_curadoria as n from audios where id = $1", [ID])).rows[0]!.n).toEqual({});
    await db.query("insert into revisao_pedidos (audio_id, wa_id_hash) values ($1, 'h1')", [ID]);
    await expect(db.query("insert into revisao_pedidos (audio_id, wa_id_hash) values ($1, 'h1')", [ID])).rejects.toThrow();
  });
});
