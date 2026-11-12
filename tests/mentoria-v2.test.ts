// Mentoria v2, Etapa 1: arquivo -> papel -> assunto -> data -> parceiro -> confirmação do parceiro.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Simulator, MINUTE, HOUR } from "../scripts/simulate";
import { DEFAULT_SERVICES } from "../src/services/content";
import { hashWaId } from "../src/lib/hash";
import { housekeepMentorias } from "../src/mentoria/housekeeping";
import { checkSubject, parseOccurredOn, phoneCandidates, sanitizeSubject } from "../src/mentoria/parse";
import { parseWebhookPayload } from "../src/whatsapp/parser";
import type { IncomingMessage } from "../src/whatsapp/types";

const mkSim = () => {
  const s = new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "40", MAX_BOT_MSGS_PER_USER_PER_DAY: "100" } });
  s.repo.services = [...DEFAULT_SERVICES];
  return s;
};
type Body = { text?: { body: string }; interactive?: { body: { text: string }; action: { buttons?: { reply: { id: string; title: string } }[] } } };
const bodyOf = (s: Simulator, p: string, i = -1): string => {
  const b = s.sentTo(p).at(i)!.body as Body;
  return b.text?.body ?? b.interactive?.body.text ?? "";
};
const buttonsOf = (s: Simulator, p: string, i = -1): string[] =>
  ((s.sentTo(p).at(i)!.body as Body).interactive?.action.buttons ?? []).map((b) => b.reply.id);

async function registered(s: Simulator, p: string, name: string) {
  await s.register(p, 1000);
  s.repo.registrations.get(p)!.values.full_name = name;
  s.advance(11 * MINUTE);
}
/** Do menu até a pergunta do parceiro (estado MENT_PARTNER). */
async function untilPartner(s: Simulator, p: string, subject = "Estruturas de dados no mercado", date = "button:ment_date_yesterday") {
  await s.text(p, "menu"); s.advance(1000);
  await s.list(p, "svc_mentoria"); s.advance(1000);
  await s.audio(p); s.advance(1000);
  await s.button(p, "ment_role_mentor"); s.advance(1000);
  await s.text(p, subject); s.advance(1000);
  if (date.startsWith("button:")) await s.button(p, date.slice(7)); else await s.text(p, date);
  s.advance(1000);
}
const rows = (s: Simulator) => [...s.repo.audios.values()].filter((a) => a.serviceId === "mentoria");

describe("Mentoria v2 / Etapa 1: o fluxo", () => {
  it("arquivo -> papel -> assunto -> data -> parceiro cadastrado (por contato): completa, avisa o parceiro e só lista depois do Sim", async () => {
    const s = mkSim();
    const a = s.phone(1), b = s.phone(2);
    await registered(s, a, "Ana Souza");
    await registered(s, b, "Bruno Lima");
    await untilPartner(s, a);
    expect((await s.repo.getConversation(a)).state).toBe("MENT_PARTNER");
    expect(rows(s)[0]!.mentoria).toBeUndefined(); // ainda incompleta
    expect(await s.repo.listMentorias({ limit: 10 })).toHaveLength(0);

    const before = s.sentTo(b).length;
    await s.contacts(a, [{ wa_id: b, phone: "+55 11 90000-0002" }]); s.advance(1000);
    expect(bodyOf(s, a)).toMatch(/Pedimos a confirmação de Bruno Lima/);
    const row = rows(s)[0]!;
    expect(row.mentoria).toMatchObject({ role: "mentor", subject: "Estruturas de dados no mercado", partner: "Bruno Lima" });
    expect(row.ocorreuEm).toBe("2026-11-09"); // "ontem" em relação a 2026-11-10
    expect(row.partnerWaIdHash).toBe(await hashWaId(b));
    expect((await s.repo.getConversation(a)).state).toBe("AWAIT_AUDIO");
    expect((await s.repo.getMentoriaDraft(a))).toEqual({});

    // O parceiro recebeu a pergunta (1 mensagem, janela aberta) e o resumo diz quem, quando e o assunto.
    expect(s.sentTo(b).length - before).toBe(1);
    expect(bodyOf(s, b)).toBe("Você participou de uma mentoria com Ana Souza em 09/11/2026, sobre Estruturas de dados no mercado?");
    expect(buttonsOf(s, b)).toEqual([`ment_ok:${row.id}`, `ment_no:${row.id}`]);
    expect(await s.repo.listMentorias({ limit: 10, pending: true })).toHaveLength(0); // não confirmada: o notebook não vê

    await s.button(b, `ment_ok:${row.id}`); s.advance(1000);
    expect(bodyOf(s, b)).toMatch(/confirmada/);
    expect(rows(s)[0]!.partnerConfirmedAt).toBeInstanceOf(Date);
    expect(await s.repo.listMentorias({ limit: 10, pending: true })).toHaveLength(1);
    // Responder de novo (ou tocar no botão antigo) = silêncio.
    const n = s.sentTo(b).length;
    await s.button(b, `ment_no:${row.id}`); s.advance(1000);
    expect(s.sentTo(b).length).toBe(n);
    expect(rows(s)[0]!.partnerRejectedAt).toBeUndefined();
  });

  it("parceiro por NOME (já cadastrado): botão de confirmação da pessoa; 2 pessoas = 2 botões; mais de 3 = pede contato", async () => {
    const s = mkSim();
    const a = s.phone(1);
    await registered(s, a, "Ana Souza");
    for (let i = 2; i <= 5; i++) await registered(s, s.phone(i), `Carlos Número${i} Dias`);
    await registered(s, s.phone(6), "João da Silva");
    await untilPartner(s, a);

    await s.text(a, "joao silva"); s.advance(1000); // sem acento, minúsculas
    expect(buttonsOf(s, a)).toEqual([`ment_pt:${await hashWaId(s.phone(6))}`, "ment_pt_other"]);
    expect(bodyOf(s, a)).toMatch(/João da Silva/);
    await s.text(a, "carlos dias"); s.advance(1000); // 4 pessoas: acima de 3
    expect(bodyOf(s, a)).toMatch(/mais de uma pessoa/);
    const n = s.sentTo(a).length;
    await s.text(a, "carlos dias"); s.advance(1000); // dica única por estado
    expect(s.sentTo(a).length).toBe(n + 1); // o Axo avisa em vez de calar

    await s.button(a, `ment_pt:${await hashWaId(s.phone(6))}`); s.advance(1000);
    expect(rows(s)[0]!.mentoria?.partner).toBe("João da Silva");
    expect(bodyOf(s, s.phone(6))).toMatch(/mentoria com Ana Souza/);
  });

  it("o próprio número como parceiro é recusado (1 dica) e a mentoria continua incompleta", async () => {
    const s = mkSim();
    const a = s.phone(1);
    await registered(s, a, "Ana Souza");
    await untilPartner(s, a);
    await s.text(a, "(11) 90000-0001"); s.advance(1000);
    expect(bodyOf(s, a)).toMatch(/seu próprio contato/);
    expect(rows(s)[0]!.mentoria).toBeUndefined();
    expect((await s.repo.getConversation(a)).state).toBe("MENT_PARTNER");
  });
});

describe("Mentoria v2 / Etapa 1: adversariais", () => {
  it("assunto com quebra de linha e 'mentor: X': guardado numa linha só e sem rótulo forjado", async () => {
    const s = mkSim();
    const a = s.phone(1);
    await registered(s, a, "Ana Souza");
    await untilPartner(s, a, "Carreira\nmentor: Fulano\r\nmentorado:  Beltrano  \u2028 mentor :Z");
    await s.text(a, "(11) 90000-0099"); s.advance(1000);
    const subject = rows(s)[0]!.mentoria!.subject;
    expect(subject).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(subject).not.toMatch(/\bmentor(ado)?\s*:/i);
    expect(subject.split("\n")).toHaveLength(1);
    expect(subject).toMatch(/^Carreira mentor - Fulano mentorado - Beltrano/);
  });

  it("sanitizeSubject/checkSubject: limites, controles invisíveis e comandos", () => {
    expect(sanitizeSubject("a\u200bb\u0007c\td")).toBe("a b c d");
    expect(checkSubject("x".repeat(200)).ok).toBe(true);
    expect(checkSubject("x".repeat(201))).toEqual({ ok: false, reason: "long" });
    expect(checkSubject("ab")).toEqual({ ok: false, reason: "short" });
    expect(checkSubject("1234")).toEqual({ ok: false, reason: "short" }); // sem letras
    expect(checkSubject("menu").ok).toBe(false);
    expect(checkSubject("oi").ok).toBe(false);
    expect(checkSubject("a".repeat(5000))).toEqual({ ok: false, reason: "long" });
  });

  it("parceiro sem cadastro: mentoria completa, ninguém é mensageado e ele NÃO consegue confirmar antes do cadastro (botão forjado)", async () => {
    const s = mkSim();
    const a = s.phone(1), ghost = "5511977770000";
    await registered(s, a, "Ana Souza");
    await untilPartner(s, a);
    await s.text(a, "11 97777-0000"); s.advance(1000);
    expect(bodyOf(s, a)).toMatch(/ainda não tem cadastro/);
    expect(s.sentTo(ghost)).toHaveLength(0);
    const id = rows(s)[0]!.id;
    expect(rows(s)[0]!.partnerWaIdHash).toBe(await hashWaId(ghost));

    // O fantasma, sem cadastro, toca num botão forjado: nada é gravado e nada é respondido (R6).
    await s.button(ghost, `ment_ok:${id}`); s.advance(1000);
    await s.button(ghost, `ment_no:${id}`); s.advance(1000);
    expect(rows(s)[0]!.partnerConfirmedAt).toBeUndefined();
    expect(rows(s)[0]!.partnerRejectedAt).toBeUndefined();
    expect(s.store.objects.has(rows(s)[0]!.r2Key)).toBe(true); // o áudio continua guardado
    expect(s.sentTo(ghost)).toHaveLength(0);

    // Ele se cadastra; na próxima mensagem dele a pergunta aparece (no lugar da resposta normal).
    await registered(s, ghost, "Gabriel Fantasma");
    const n = s.sentTo(ghost).length;
    await s.text(ghost, "oi"); s.advance(1000);
    expect(s.sentTo(ghost).length - n).toBe(1);
    expect(buttonsOf(s, ghost)).toEqual([`ment_ok:${id}`, `ment_no:${id}`]);
    await s.text(ghost, "oi"); s.advance(1000); // já entregue: não se repete (segue o fluxo normal)
    const asks = s.sentTo(ghost).filter((m) => JSON.stringify(m.body).includes(`ment_ok:${id}`));
    expect(asks).toHaveLength(1);
  });

  it("parceiro diz Não: áudio apagado do R2, mentoria contestada, nunca aparece como pendente nem serve o áudio", async () => {
    const s = mkSim();
    const a = s.phone(1), b = s.phone(2);
    await registered(s, a, "Ana Souza");
    await registered(s, b, "Bruno Lima");
    await untilPartner(s, a);
    await s.contacts(a, [{ wa_id: b }]); s.advance(1000);
    const row = rows(s)[0]!;
    expect(s.store.objects.has(row.r2Key)).toBe(true);
    await s.button(b, `ment_no:${row.id}`); s.advance(1000);
    const after = rows(s)[0]!;
    expect(after).toMatchObject({ contestedReason: "recusada" });
    expect(after.partnerRejectedAt).toBeInstanceOf(Date);
    expect(after.audioDeletedAt).toBeInstanceOf(Date);
    expect(s.store.objects.has(row.r2Key)).toBe(false);
    expect(bodyOf(s, b)).toMatch(/não gera certificado/);
    expect(await s.repo.listMentorias({ limit: 10, pending: true })).toHaveLength(0);
    const all = await s.repo.listMentorias({ limit: 10 });
    expect(all).toHaveLength(1); // visível no painel
    expect(all[0]!.contestedReason).toBe("recusada");
  });

  it("confirmação fora da janela de 23h30: não envia (sendGuarded) e aparece na próxima mensagem do parceiro", async () => {
    const s = mkSim();
    const a = s.phone(1), b = s.phone(2);
    await registered(s, a, "Ana Souza");
    await registered(s, b, "Bruno Lima");
    s.advance(25 * HOUR); // a janela do Bruno fechou; a Ana volta a falar
    await s.text(a, "oi"); s.advance(1000);
    await untilPartner(s, a);
    const n = s.sentTo(b).length;
    await s.contacts(a, [{ wa_id: b }]); s.advance(1000);
    expect(s.sentTo(b).length).toBe(n); // nada saiu
    expect(bodyOf(s, a)).toMatch(/Pedimos a confirmação/); // a registrante recebe a resposta normal
    const id = rows(s)[0]!.id;
    expect(rows(s)[0]!.partnerPromptedAt).toBeUndefined();
    await s.text(b, "oi"); s.advance(1000);
    expect(s.sentTo(b).length - n).toBe(1);
    expect(buttonsOf(s, b)).toEqual([`ment_ok:${id}`, `ment_no:${id}`]);
    expect(rows(s)[0]!.partnerPromptedAt).toBeInstanceOf(Date);
  });

  it("parceiro em opt-out não recebe a pergunta", async () => {
    const s = mkSim();
    const a = s.phone(1), b = s.phone(2);
    await registered(s, a, "Ana Souza");
    await registered(s, b, "Bruno Lima");
    await s.text(b, "sair"); s.advance(1000);
    const n = s.sentTo(b).length;
    await untilPartner(s, a);
    await s.contacts(a, [{ wa_id: b }]); s.advance(1000);
    expect(s.sentTo(b).length).toBe(n);
  });

  it("datas: futura, inexistente, muito antiga e texto; 'hoje' e dd/mm valem; 1 dica por estado", async () => {
    const today = "2026-11-10";
    expect(parseOccurredOn("11/11/2026", today)).toEqual({ ok: false, reason: "future" });
    expect(parseOccurredOn("31/02/2026", today)).toEqual({ ok: false, reason: "invalid" });
    expect(parseOccurredOn("12/12", today)).toEqual({ ok: false, reason: "future" });
    expect(parseOccurredOn("01/01/2020", today)).toEqual({ ok: false, reason: "old" });
    expect(parseOccurredOn("amanhã", today).ok).toBe(false);
    expect(parseOccurredOn("10/11/2026", today)).toEqual({ ok: true, date: "2026-11-10" });
    expect(parseOccurredOn("5 de novembro", today)).toEqual({ ok: true, date: "2026-11-05" });
    expect(parseOccurredOn("Ontem", today)).toEqual({ ok: true, date: "2026-11-09" });
    expect(parseOccurredOn("5/11/26", today)).toEqual({ ok: true, date: "2026-11-05" });

    const s = mkSim();
    const a = s.phone(1);
    await registered(s, a, "Ana Souza");
    await untilPartner(s, a, "Assunto qualquer", "button:ment_date_other");
    expect((await s.repo.getConversation(a)).state).toBe("MENT_DATE_TEXT");
    await s.text(a, "11/11/2026"); s.advance(1000);
    expect(bodyOf(s, a)).toMatch(/não pode ser no futuro/);
    const n = s.sentTo(a).length;
    await s.text(a, "12/11/2026"); s.advance(1000); // segunda entrada inválida no mesmo estado: silêncio
    expect(s.sentTo(a).length).toBe(n);
    await s.text(a, "05/11/2026"); s.advance(1000);
    expect((await s.repo.getConversation(a)).state).toBe("MENT_PARTNER");
    expect((await s.repo.getMentoriaDraft(a)).occurredOn).toBe("2026-11-05");
  });

  it("anti-spam: figurinha/áudio/imagem no meio do fluxo = silêncio; 'menu' cancela e apaga o arquivo", async () => {
    const s = mkSim();
    const a = s.phone(1);
    await registered(s, a, "Ana Souza");
    await untilPartner(s, a, "Assunto qualquer", "button:ment_date_today");
    const n = s.sentTo(a).length;
    await s.sticker(a); await s.audio(a); await s.document(a);
    expect(s.sentTo(a).length).toBe(n);
    expect(rows(s)).toHaveLength(1);
    await s.text(a, "menu"); s.advance(1000);
    expect((await s.repo.getConversation(a)).state).toBe("MENU");
    expect(rows(s)).toHaveLength(0);
    expect(s.store.objects.size).toBe(1); // sobrou só o áudio do cadastro (perfil), não o da mentoria
    expect(await s.repo.getMentoriaDraft(a)).toEqual({});
  });

  it("papel: texto inválido recebe 1 dica; depois silêncio", async () => {
    const s = mkSim();
    const a = s.phone(1);
    await registered(s, a, "Ana Souza");
    await s.text(a, "menu"); s.advance(1000);
    await s.list(a, "svc_mentoria"); s.advance(1000);
    await s.audio(a); s.advance(1000);
    await s.text(a, "sei lá"); s.advance(1000);
    const n = s.sentTo(a).length;
    await s.text(a, "sei lá de novo"); s.advance(1000);
    expect(s.sentTo(a).length).toBe(n + 1); // aviso descontraído
    await s.text(a, "fui mentorado"); s.advance(1000);
    expect((await s.repo.getConversation(a)).state).toBe("MENT_SUBJECT");
  });
});

describe("Mentoria v2 / Etapa 1: limpeza (cron) e dados", () => {
  it("incompleto > 24 h: apaga arquivo e registro; completo sem resposta > 7 dias: apaga o arquivo e marca 'expirada'", async () => {
    const s = mkSim();
    const a = s.phone(1), b = s.phone(2);
    await registered(s, a, "Ana Souza");
    await registered(s, b, "Bruno Lima");
    // 1) mentoria incompleta (abandonada no papel)
    await s.text(a, "menu"); s.advance(1000);
    await s.list(a, "svc_mentoria"); s.advance(1000);
    await s.audio(a); s.advance(1000);
    const logger = { log: () => undefined };
    expect((await housekeepMentorias(s.repo, s.store, logger, s.now())).discarded).toBe(0); // ainda não passou 24 h
    s.advance(25 * HOUR);
    expect(await housekeepMentorias(s.repo, s.store, logger, s.now())).toEqual({ discarded: 1, expired: 0 });
    expect(rows(s)).toHaveLength(0);
    expect((await s.repo.getMentoriaDraft(a)).audioId).toBeUndefined();
    // quem volta depois: o fluxo órfão cai no menu, sem inventar dados
    await s.text(a, "oi"); s.advance(1000);
    expect((await s.repo.getConversation(a)).state).not.toBe("MENT_ROLE");

    // 2) completa, parceiro não responde
    await s.text(a, "menu"); s.advance(1000);
    await untilPartner(s, a);
    await s.contacts(a, [{ wa_id: b }]); s.advance(1000);
    const r = rows(s)[0]!;
    s.advance(6 * 24 * HOUR);
    expect((await housekeepMentorias(s.repo, s.store, logger, s.now())).expired).toBe(0);
    s.advance(2 * 24 * HOUR);
    expect(await housekeepMentorias(s.repo, s.store, logger, s.now())).toEqual({ discarded: 0, expired: 1 });
    expect(s.store.objects.has(r.r2Key)).toBe(false);
    expect(rows(s)[0]).toMatchObject({ contestedReason: "expirada" });
    expect(rows(s)[0]!.audioDeletedAt).toBeInstanceOf(Date);
    expect(await s.repo.listMentorias({ limit: 10, pending: true })).toHaveLength(0);
  });

  it("parser: contato compartilhado vira evento 'contacts' (sem número = unsupported)", () => {
    const mk = (contacts: unknown) => parseWebhookPayload({ entry: [{ changes: [{ value: { messages: [{ id: "w", from: "5511", type: "contacts", contacts }] } }] }] });
    const ok = mk([{ phones: [{ phone: "+55 11 9", wa_id: "5511900000001" }] }])[0] as IncomingMessage;
    expect(ok).toMatchObject({ type: "contacts", contacts: [{ waId: "5511900000001", phone: "+55 11 9" }] });
    expect(mk([{ name: { formatted_name: "X" } }])[0]).toMatchObject({ type: "unsupported" });
    expect(mk("lixo")[0]).toMatchObject({ type: "unsupported" });
  });

  it("phoneCandidates: formatos do Brasil, com e sem o 9º dígito; lixo vira vazio", () => {
    expect(phoneCandidates("(11) 98765-4321")).toEqual(["5511987654321", "551187654321"]);
    expect(phoneCandidates("+55 11 8765-4321")).toEqual(["551187654321", "5511987654321"]);
    expect(phoneCandidates("5511987654321")).toEqual(["5511987654321", "551187654321"]);
    expect(phoneCandidates("12345")).toEqual([]);
    expect(phoneCandidates("(01) 98765-4321")).toEqual([]);
    expect(phoneCandidates("+1 415 555 0100")).toEqual([]);
  });

  it("SQL (PGlite): gatilho do parceiro, parceiro != registrante e busca por nome sem acento", async () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const db = new PGlite();
    for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
    await db.query("insert into users (wa_id, last_user_message_at, wa_id_hash, consent_at, terms_version, registered_at, full_name) values ('1', now(), 'h1', now(), 'v1', now(), 'Ana Souza')");
    await db.query("insert into users (wa_id, last_user_message_at, wa_id_hash) values ('2', now(), 'h2')"); // sem consentimento (o CHECK do banco nem deixa ter nome)
    await db.query("insert into users (wa_id, last_user_message_at, wa_id_hash, consent_at, terms_version, registered_at, full_name) values ('3', now(), 'h3', now(), 'v1', now(), 'João da Silva Júnior')");
    const id = "00000000-0000-4000-8000-000000000001";
    await db.query("insert into audios (id, wa_id_hash, r2_key, mime, bytes, service_id, subject, ocorreu_em, partner_wa_id_hash) values ($1,'h1','k','audio/ogg',10,'mentoria','x','2026-11-09','h2')", [id]);
    // parceiro sem consentimento não confirma nem recusa
    await expect(db.query("update audios set partner_confirmed_at = now() where id = $1", [id])).rejects.toThrow();
    await expect(db.query("update audios set partner_rejected_at = now() where id = $1", [id])).rejects.toThrow();
    // sem parceiro cadastrado nenhum, também não
    await db.query("update audios set partner_wa_id_hash = 'fantasma' where id = $1", [id]);
    await expect(db.query("update audios set partner_confirmed_at = now() where id = $1", [id])).rejects.toThrow();
    // com consentimento, sim
    await db.query("update audios set partner_wa_id_hash = 'h3' where id = $1", [id]);
    await db.query("update audios set partner_confirmed_at = now() where id = $1", [id]);
    // parceiro não pode ser o próprio registrante
    await expect(db.query("update audios set partner_wa_id_hash = 'h1' where id = $1", [id])).rejects.toThrow();
    // busca: sem acento, só quem consentiu, todas as palavras
    const r = await db.query<{ wa_id_hash: string }>("select * from find_people_by_name(array['joao','silva'], 5)");
    expect(r.rows.map((x) => x.wa_id_hash)).toEqual(["h3"]);
    expect((await db.query("select * from find_people_by_name(array[]::text[], 5)")).rows).toHaveLength(0);
  });
});
