// Fluxo automático do matching manual: o admin cria o match (/match D12 M3) e o bot conduz mentor e mentorado.
// Etapa 4: cria o match, pergunta os horários ao MENTOR e guarda a grade no match. (O contato com o mentorado é a etapa 5.)
import { summarizeSlots, type AvailabilitySlot } from "../ai/types";
import type { MatchRow, Repo } from "../db/repo";
import { WEEKDAYS, type Weekday } from "../ai/types";
import type { Logger } from "../lib/logger";
import { maskPhone } from "../lib/logger";
import { CATEGORIES } from "../profile/categories";
import { daysReply, daysState } from "../schedule/decide";
import { ACCEPT_STATE, acceptReply, confirmationText, isMatchMenteeState, pickReply, PICK_STATE, scheduledInstant, type MenteeEffect } from "./decide";
import { fallbackContent } from "../services/content";
import type { OutboundMessage, SendResult } from "../whatsapp/client";

export interface FlowDeps {
  repo: Repo;
  send: (message: OutboundMessage) => Promise<SendResult>;
  logger: Logger;
  now: Date;
  /** Fuso da conta (datas "próxima sexta" e confirmação). */
  timezone: string;
  /** Admins do WhatsApp: recebem os avisos de matches criados pelo painel (que não tem número). */
  adminWaIds?: readonly string[];
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const labelOf = (k: string): string => CATEGORIES.find((c) => c.key === k)?.label ?? k;
const firstName = (full: string | undefined): string => (full ?? "").trim().split(/\s+/)[0] ?? "";
const sentOk = (r: SendResult): boolean => r.status === "sent";

/** "/match D12 M3" (também "d12 m3" ou "12 3"). null = formato inválido. */
export function parseMatchArgs(args: string): { doubtSeq: number; mentorSeq: number } | null {
  const m = /^d?(\d{1,9})\s+m?(\d{1,9})$/i.exec(args.trim());
  return m ? { doubtSeq: Number(m[1]), mentorSeq: Number(m[2]) } : null;
}
/** "/cancelar 5" (também "#5" ou "x5"). */
export function parseCancelArgs(args: string): number | null {
  const m = /^[#x]?(\d{1,9})$/i.exec(args.trim());
  return m ? Number(m[1]) : null;
}

/**
 * "/confirmar 5 segunda 18-20 [local]": aceita "18h às 20h", "18:30-20", "terça", "sábado". null = formato inválido.
 * Sem local, usa "A combinar com a coordenação".
 */
export function parseConfirmArgs(args: string): { seq: number; day: Weekday; start: string; end: string; location: string } | null {
  const t = args.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const m = /^[#x]?(\d{1,9})\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?\s+(?:das?\s+)?(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:-|a|as|ate)\s*(\d{1,2})(?::(\d{2}))?\s*h?(?:\s+(.+))?$/.exec(t);
  if (!m) return null;
  const sh = Number(m[3]), sm = Number(m[4] ?? 0), eh = Number(m[5]), em = Number(m[6] ?? 0);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59 || sh * 60 + sm >= eh * 60 + em) return null;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const loc = (m[7] ?? "").trim();
  const originalLoc = loc ? args.trim().slice(args.trim().length - loc.length) : "";
  return {
    seq: Number(m[1]), day: m[2] as Weekday, start: `${pad(sh)}:${pad(sm)}`, end: `${pad(eh)}:${pad(em)}`,
    location: originalLoc ? originalLoc.charAt(0).toUpperCase() + originalLoc.slice(1) : "A combinar com a coordenação",
  };
}

export const CONFIRM_USAGE = "Uso: /confirmar 5 segunda 18-20 [local] (número do match, dia, horário de início e fim; o local é opcional)";

/** Admin fecha o horário na mão: grava no match, tira os dois do fluxo de horários e manda a confirmação a mentor e mentorado (só por sendGuarded). */
export async function confirmMatchCommand(args: string, deps: FlowDeps): Promise<string> {
  const p = parseConfirmArgs(args);
  if (!p) return CONFIRM_USAGE;
  return (await confirmMatch(p, deps)).text;
}

/** Núcleo do /confirmar (também usado pelo painel). */
export async function confirmMatch(p: { seq: number; day: Weekday; start: string; end: string; location: string }, deps: FlowDeps): Promise<{ ok: boolean; text: string }> {
  const fail = (text: string) => ({ ok: false, text });
  if (!(WEEKDAYS as readonly string[]).includes(p.day)) return fail(CONFIRM_USAGE);
  const { repo, now } = deps;
  const match = await repo.getMatchBySeq(p.seq);
  if (!match) return fail(`Não achei o match #${p.seq}.`);
  if (match.status === "cancelado" || match.status === "realizada") return fail(`O match #${p.seq} está ${match.status}: não dá para confirmar.`);
  await repo.updateMatch(match.id, {
    chosenDay: p.day, chosenStart: p.start, chosenEnd: p.end, location: p.location, status: "confirmado",
    scheduledAt: scheduledInstant({ day: p.day, start: p.start, end: p.end }, now, deps.timezone),
  }, now);
  const [mConv, sConv] = await Promise.all([repo.getConversation(match.mentorWaId), repo.getConversation(match.menteeWaId)]);
  if (mConv.state === ACCEPT_STATE || (mConv.state.startsWith("SCHED_") && mConv.state.includes("match"))) await setState(repo, match.mentorWaId, "COMPLETED");
  if (isMatchMenteeState(sConv.state)) await setState(repo, match.menteeWaId, "COMPLETED");
  const m = { day: p.day, start: p.start, end: p.end, location: p.location };
  const report: string[] = [];
  for (const [who, to, conv, role] of [["mentor", match.mentorWaId, mConv, "mentor"], ["mentorado", match.menteeWaId, sConv, "mentorado"]] as const) {
    if (conv.optedOutAt) { report.push(`${who}: pediu para não receber mensagens (não avisado)`); continue; }
    const r = await deps.send({ to, type: "text", text: { body: confirmationText(m, now, deps.timezone, role) } });
    if (!sentOk(r)) deps.logger.log("info", "match_manual_confirm_not_sent", { match: match.seq, who, status: r.status });
    report.push(`${who}: ${sentOk(r) ? "avisado ✅" : `NÃO avisado (${r.status})`}`);
  }
  deps.logger.log("info", "match_manual_confirmed", { match: match.seq });
  return { ok: true, text: `Match #${match.seq} confirmado para ${p.day} ${p.start}-${p.end}.\n${report.join("\n")}` };
}

export const MATCH_USAGE = "Uso: /match D12 M3 (D = dúvida, M = mentor; veja os ids em /duvidas e /mentores)";
export const CANCEL_USAGE = "Uso: /cancelar 5 (número do match)";

export type MatchResult = { ok: true; text: string; matchSeq: number } | { ok: false; text: string };

/** Cria o match e pergunta os horários ao mentor. `createdBy` = telefone do admin, ou "painel" quando vem do painel web. */
export async function connectMatch(parsed: { doubtSeq: number; mentorSeq: number }, createdBy: string, deps: FlowDeps): Promise<MatchResult> {
  const { repo, now } = deps;
  const fail = (text: string): MatchResult => ({ ok: false, text });
  const [doubt, mentor] = await Promise.all([repo.getDoubtBySeq(parsed.doubtSeq), repo.getMentorBySeq(parsed.mentorSeq)]);
  if (!doubt) return fail(`Não achei a dúvida D${parsed.doubtSeq}.`);
  if (!mentor) return fail(`Não achei o mentor M${parsed.mentorSeq}.`);
  if (doubt.status !== "aberta") return fail(`A dúvida D${doubt.seq} não está aberta (status: ${doubt.status}).`);
  if (!doubt.waId) return fail(`A dúvida D${doubt.seq} é anterior ao matching e não tem o telefone de quem perguntou: não dá para conectar.`);
  if (mentor.waId === doubt.waId) return fail("O mentor e o mentorado são a mesma pessoa.");
  const [mentorBusy, menteeBusy] = await Promise.all([repo.getActiveMatchFor(mentor.waId), repo.getActiveMatchFor(doubt.waId)]);
  if (mentorBusy) return fail(`O mentor M${mentor.seq} já está no match #${mentorBusy.seq}. Cancele o #${mentorBusy.seq} ou espere terminar.`);
  if (menteeBusy) return fail(`O mentorado da D${doubt.seq} já está no match #${menteeBusy.seq}. Cancele o #${menteeBusy.seq} ou espere terminar.`);
  const mentorConv = await repo.getConversation(mentor.waId);
  if (mentorConv.optedOutAt) return fail(`O mentor M${mentor.seq} pediu para não receber mensagens (sair). Escolha outro.`);

  const match = await repo.createMatch({ doubtId: doubt.id, mentorWaId: mentor.waId, menteeWaId: doubt.waId, createdBy, at: now });
  if (!match) return fail(`A dúvida D${doubt.seq} acabou de ser pega por outro match.`);

  const areas = doubt.categories.length > 0 ? doubt.categories.map(labelOf).join(", ") : "mentoria";
  const hi = firstName(mentor.name ?? undefined);
  const intro =
    `Oi${hi ? `, ${hi}` : ""}! 🦎 Apareceu uma dúvida de ${areas} e a coordenação pensou em você pra ajudar:\n\n` +
    `"${clip(doubt.text.replace(/\s+/g, " "), 220)}"\n\n`;
  // Primeiro o mentor decide se aceita; só depois (se disser sim) vêm os horários.
  const sent = await deps.send({ to: mentor.waId, ...acceptReply(intro) });
  if (!sentOk(sent)) {
    await repo.cancelMatch(match.seq, now); // não deixa a dúvida presa
    deps.logger.log("warn", "match_mentor_unreachable", { mentor: maskPhone(mentor.waId), status: sent.status });
    return fail(`Não consegui falar com o mentor M${mentor.seq} agora (${sent.status}). O match foi desfeito e a D${doubt.seq} segue aberta.`);
  }
  // O mentor passa a estar no fluxo de horários do match (com tentativa de novo se outra mensagem mexeu na conversa).
  for (let i = 0; i < 3; i++) {
    const cur = await repo.getConversation(mentor.waId);
    const won = await repo.saveConversation(mentor.waId, cur.version, { state: ACCEPT_STATE, previousState: null, hintSentInState: false, optedOutAt: null });
    if (won) break;
  }
  deps.logger.log("info", "match_created", { match: match.seq, mentor: maskPhone(mentor.waId), by: createdBy === "painel" ? "painel" : "admin" });
  return { ok: true, matchSeq: match.seq, text: `Match #${match.seq} criado: D${doubt.seq} ⇄ M${mentor.seq} (${mentor.name ?? "mentor"}). Perguntei ao mentor se aceita.` };
}

/** Comando do WhatsApp: "/match D12 M3". */
export async function startMatch(args: string, createdBy: string, deps: FlowDeps): Promise<string> {
  const parsed = parseMatchArgs(args);
  if (!parsed) return MATCH_USAGE;
  const r = await connectMatch(parsed, createdBy, deps);
  return r.ok ? `${r.text} Para desfazer: /cancelar ${r.matchSeq}` : r.text;
}

/** Cancela o match, reabre a dúvida e tira os participantes do fluxo. */
export async function cancelMatchBySeq(seq: number, deps: FlowDeps): Promise<{ ok: boolean; text: string }> {
  const { repo, now } = deps;
  const match = await repo.getMatchBySeq(seq);
  if (!match) return { ok: false, text: `Não achei o match #${seq}.` };
  if (!(await repo.cancelMatch(seq, now))) return { ok: false, text: `O match #${seq} já estava cancelado.` };
  await releaseParticipants(match, deps);
  deps.logger.log("info", "match_cancelled", { match: seq });
  return { ok: true, text: `Match #${seq} cancelado. A dúvida voltou para a lista.` };
}

/** Comando do WhatsApp: "/cancelar 5". */
export async function cancelMatchCommand(args: string, deps: FlowDeps): Promise<string> {
  const seq = parseCancelArgs(args);
  if (seq === null) return CANCEL_USAGE;
  return (await cancelMatchBySeq(seq, deps)).text;
}

/** Muda o estado da conversa da pessoa (com nova tentativa se outra mensagem mexeu nela ao mesmo tempo). */
async function setState(repo: Repo, waId: string, state: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const cur = await repo.getConversation(waId);
    if (await repo.saveConversation(waId, cur.version, { state: state as never, previousState: null, hintSentInState: false, optedOutAt: cur.optedOutAt })) return;
  }
}

const nameOf = async (repo: Repo, waId: string): Promise<string> =>
  firstName((await repo.getRegistration(waId).catch(() => null))?.values.full_name) || "";

async function tellAdmin(match: MatchRow, body: string, deps: FlowDeps): Promise<void> {
  // Match criado pelo painel não tem telefone: os avisos vão para os admins do WhatsApp (se houver).
  const to = /^\d{8,15}$/.test(match.createdBy) ? [match.createdBy] : [...(deps.adminWaIds ?? [])];
  for (const t of to) {
    const r = await deps.send({ to: t, type: "text", text: { body } });
    if (!sentOk(r)) deps.logger.log("info", "match_admin_notice_not_sent", { match: match.seq, status: r.status });
  }
}

/** O mentor foi avisado no início: ao cancelar, sai do fluxo de horários; o mentorado sai do dele. Quem já tinha sido chamado recebe um aviso curto. */
async function releaseParticipants(match: MatchRow, deps: FlowDeps): Promise<void> {
  const [mConv, sConv] = await Promise.all([deps.repo.getConversation(match.mentorWaId), deps.repo.getConversation(match.menteeWaId)]);
  if (mConv.state === ACCEPT_STATE || (mConv.state.startsWith("SCHED_") && mConv.state.includes("match"))) await setState(deps.repo, match.mentorWaId, "COMPLETED");
  if (isMatchMenteeState(sConv.state)) await setState(deps.repo, match.menteeWaId, "COMPLETED");
  const cancelled = "Aquela mentoria que a gente tava combinando foi cancelada pela coordenação. Quando surgir outra, eu te chamo. 🦎";
  if (match.status !== "cancelado" && !mConv.optedOutAt) await deps.send({ to: match.mentorWaId, type: "text", text: { body: cancelled } });
  // O mentorado só sabe do match depois que recebeu os horários.
  const menteeKnows = match.status === "aguardando_mentorado" || match.status === "aguardando_local" || match.status === "confirmado";
  if (menteeKnows && !sConv.optedOutAt) await deps.send({ to: match.menteeWaId, type: "text", text: { body: cancelled } });
}

/** O mentor disse que NÃO aceita: desfaz o match, a dúvida volta para a lista e o admin escolhe outro mentor. */
export async function onMentorDeclined(match: MatchRow, deps: FlowDeps): Promise<void> {
  await deps.repo.cancelMatch(match.seq, deps.now);
  deps.logger.log("info", "match_mentor_declined", { match: match.seq });
  await tellAdmin(match, `Match #${match.seq}: o mentor NÃO aceitou essa mentoria. A dúvida voltou para a lista; conecte outro mentor com /match.`, deps);
}

/** Passo (c): manda os horários do mentor para o MENTORADO escolher. */
async function contactMentee(match: MatchRow, deps: FlowDeps): Promise<void> {
  const { repo } = deps;
  const conv = await repo.getConversation(match.menteeWaId);
  if (conv.optedOutAt) {
    await tellAdmin(match, `Match #${match.seq}: o mentorado pediu para não receber mensagens. Cancele com /cancelar ${match.seq}.`, deps);
    return;
  }
  // Anonimato: o mentorado NÃO sabe quem é o mentor (o nome só chega 5 min antes da mentoria).
  const [menteeName, doubt] = await Promise.all([nameOf(repo, match.menteeWaId), repo.getDoubtById(match.doubtId)]);
  const intro = `Oi${menteeName ? `, ${menteeName}` : ""}! 🦎 Achei um mentor que topou te ajudar pra sua dúvida${doubt ? `: "${clip(doubt.text.replace(/\s+/g, " "), 120)}"` : ""}.\n\n`;
  const r = await deps.send({ to: match.menteeWaId, ...pickReply(match.mentorSlots, deps.now, deps.timezone, intro) });
  if (!sentOk(r)) {
    await tellAdmin(match, `Match #${match.seq}: não consegui falar com o mentorado agora (${r.status}). Tente de novo mais tarde ou /cancelar ${match.seq}.`, deps);
    return;
  }
  await setState(repo, match.menteeWaId, PICK_STATE);
}

/** O mentor terminou a grade: guarda no match, avisa o admin e manda os horários para o mentorado (passos b e c). */
export async function onMentorSlotsDone(match: MatchRow, slots: readonly AvailabilitySlot[], deps: FlowDeps): Promise<void> {
  await deps.repo.updateMatch(match.id, { status: "aguardando_mentorado", mentorSlots: [...slots] }, deps.now);
  await tellAdmin(match, `Match #${match.seq}: o mentor mandou os horários.\n${summarizeSlots(slots)}\nEstou perguntando ao mentorado.`, deps);
  await contactMentee({ ...match, status: "aguardando_mentorado", mentorSlots: [...slots] }, deps);
}

/** Grava no match o que o mentorado decidiu (antes de a conversa mudar de estado). */
export async function persistMenteeEffect(effect: MenteeEffect, match: MatchRow, deps: FlowDeps): Promise<void> {
  switch (effect.kind) {
    case "pick":
      await deps.repo.updateMatch(match.id, { chosenDay: effect.day, chosenStart: effect.start, chosenEnd: effect.end, status: "aguardando_local" }, deps.now);
      return;
    case "time":
      // O horário real da mentoria (dentro da faixa livre do mentor) substitui a faixa inteira.
      await deps.repo.updateMatch(match.id, { chosenStart: effect.start, chosenEnd: effect.end }, deps.now);
      return;
    case "none":
      await deps.repo.updateMatch(match.id, { status: "sem_horario", mentorSlots: [], chosenDay: null, chosenStart: null, chosenEnd: null }, deps.now);
      return;
    case "place":
      await deps.repo.updateMatch(match.id, {
        location: effect.location, status: "confirmado",
        ...(match.chosenDay && match.chosenStart && match.chosenEnd
          ? { scheduledAt: scheduledInstant({ day: match.chosenDay as Weekday, start: match.chosenStart, end: match.chosenEnd }, deps.now, deps.timezone) } : {}),
      }, deps.now);
      return;
  }
}

/** Avisos aos outros participantes (depois de gravar e responder ao mentorado). */
export async function notifyMenteeEffect(effect: MenteeEffect, match: MatchRow, deps: FlowDeps): Promise<void> {
  const { repo } = deps;
  if (effect.kind === "place") {
    const day = match.chosenDay as Weekday;
    const text = confirmationText({ day, start: match.chosenStart ?? "", end: match.chosenEnd ?? "", location: effect.location }, deps.now, deps.timezone);
    const r = await deps.send({ to: match.mentorWaId, type: "text", text: { body: confirmationText({ day, start: match.chosenStart ?? "", end: match.chosenEnd ?? "", location: effect.location }, deps.now, deps.timezone, "mentor") } });
    if (!sentOk(r)) deps.logger.log("info", "match_mentor_confirm_not_sent", { match: match.seq, status: r.status });
    await tellAdmin(match, `Match #${match.seq} confirmado ✅\n${text.split("\n").slice(1, 3).join("\n")}`, deps);
    return;
  }
  if (effect.kind === "none") {
    // Passo (f): não bateu. O mentor volta ao passo (a) com a grade zerada.
    const conv = await repo.getConversation(match.mentorWaId);
    if (conv.optedOutAt) {
      await tellAdmin(match, `Match #${match.seq}: os horários não bateram, mas o mentor pediu para não receber mensagens. /cancelar ${match.seq}`, deps);
      return;
    }
    const mentorName = await nameOf(repo, match.mentorWaId);
    const intro = `${mentorName ? `${mentorName}, ` : ""}os horários que você passou não bateram com os do mentorado 😕 Bora tentar de novo?\n\n`;
    const r = await deps.send({ to: match.mentorWaId, ...daysReply("match", [], fallbackContent, intro) });
    if (!sentOk(r)) {
      await tellAdmin(match, `Match #${match.seq}: não bateu horário e não consegui falar com o mentor (${r.status}). /cancelar ${match.seq} ou tente depois.`, deps);
      return;
    }
    await setState(repo, match.mentorWaId, daysState("match"));
    await tellAdmin(match, `Match #${match.seq}: os horários não bateram. Pedi uma nova grade ao mentor.`, deps);
  }
}
