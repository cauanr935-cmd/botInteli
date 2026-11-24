// Dias e horários livres escolhidos em LISTAS (sem digitar), para mentores (no cadastro) e mentorados (depois da dúvida).
// Fluxo: lista de dias -> escolhe um dia -> lista de horários desse dia (um ou mais) -> Concluir -> volta aos dias -> Terminei.
// Estado: SCHED_DAYS_<fluxo> e SCHED_HOURS_<fluxo>_<dia>. Decisão PURA (sem I/O): as faixas escolhidas chegam por
// parâmetro e saem como efeito (o motor grava em users.availability_slots). Cada toque = no máximo 1 mensagem (R2).
import { isVent, ventScheduleHint } from "../axo/voice";
import { finish, moveTo, type Counters, type Decision, type State, type UserState } from "../conversation/machine";
import { readNameAnswer } from "../registration/strange-name";
import { intentsOf } from "../conversation/synonyms";
import type { Reply } from "../conversation/texts";
import { fallbackContent, type Content } from "../services/content";
import { DOUBT_NO_ID, DOUBT_YES_ID, PROFILE_TEXTS as T } from "../profile/texts";
import { fmtHour, summarizeSlots, WEEKDAYS, WEEKDAY_LABEL, type AvailabilitySlot, type ParsedAvailability, type Weekday } from "../ai/types";
import { coveredMinutes, mergeSlots, parseScheduleEdit, parseScheduleText, slotsForDay } from "./parse";
import type { AvailabilityEffect } from "../availability/decide";
import { buildButtons, buildList } from "../whatsapp/builders";
import { CONTROL_OPTION_IDS, isSelectAll, matchChoice, matchChoices, matchPastedList, typedOption } from "../whatsapp/choices";
import type { IncomingMessage } from "../whatsapp/types";

/** "match" = o mentor indicado pelo admin informa os horários para UMA mentoria (guardados no match, não no perfil). */
export type ScheduleFlow = "mentor" | "ambos" | "doubt" | "match";
export type ScheduleDecision = Decision & { effect?: AvailabilityEffect };

/** Faixa de atendimento: das 8h às 20h. */
export const SCHEDULE_OPEN_HOUR = 8;
export const SCHEDULE_CLOSE_HOUR = 20;
export const DAY_ROW_PREFIX = "sch_day_";
export const HOURS_ROW_PREFIX = "sch_h_";
export const DAYS_DONE_ID = "sch_done";
export const DAY_END_ID = "sch_dayend";
export const RESET_ID = "sch_reset";
export const CONFIRM_YES_ID = "sch_ok";
export const CONFIRM_NO_ID = "sch_no";

const DAYS_PREFIX = "SCHED_DAYS_";
const HOURS_PREFIX = "SCHED_HOURS_";
const CONFIRM_PREFIX = "SCHED_CONFIRM_";
const FLOWS: readonly string[] = ["mentor", "ambos", "doubt", "match"];

export const isScheduleState = (s: string): boolean => s.startsWith(DAYS_PREFIX) || s.startsWith(HOURS_PREFIX) || s.startsWith(CONFIRM_PREFIX);
/** Estado do fluxo de horários de um match (matching manual). */
export const isMatchScheduleState = (s: string): boolean => s === `${DAYS_PREFIX}match` || s.startsWith(`${HOURS_PREFIX}match_`);
export const daysState = (flow: ScheduleFlow): State => `${DAYS_PREFIX}${flow}`;
const hoursState = (flow: ScheduleFlow, days: Weekday | readonly Weekday[]): State => `${HOURS_PREFIX}${flow}_${Array.isArray(days) ? days.join("+") : days}`;

function parseState(s: string): { kind: "confirm"; flow: ScheduleFlow } | { kind: "days"; flow: ScheduleFlow } | { kind: "hours"; flow: ScheduleFlow; days: Weekday[] } | null {
  if (s.startsWith(DAYS_PREFIX)) {
    const flow = s.slice(DAYS_PREFIX.length);
    return FLOWS.includes(flow) ? { kind: "days", flow: flow as ScheduleFlow } : null;
  }
  if (s.startsWith(CONFIRM_PREFIX)) {
    const flow = s.slice(CONFIRM_PREFIX.length);
    return FLOWS.includes(flow) ? { kind: "confirm", flow: flow as ScheduleFlow } : null;
  }
  if (s.startsWith(HOURS_PREFIX)) {
    const [flow, day] = s.slice(HOURS_PREFIX.length).split("_");
    // Um dia ("segunda") ou vários de uma vez ("segunda+quarta+sexta"): os horários valem para todos eles.
    const days = (day ?? "").split("+");
    if (flow && FLOWS.includes(flow) && days.length > 0 && days.every((d) => (WEEKDAYS as readonly string[]).includes(d))) return { kind: "hours", flow: flow as ScheduleFlow, days: days as Weekday[] };
  }
  return null;
}

// ---- faixas por dia (em passos de 30 min; ver parse.ts) ----
const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;
const daysWithSlots = (slots: readonly AvailabilitySlot[]): Set<Weekday> => new Set(slots.map((s) => s.day));

// ---- opções de horário (no máximo 9 + "Concluir" = 10 linhas, o limite da Meta) ----
interface HourOption { id: string; title: string; description: string; from: number; to: number }
const mkOption = (from: number, to: number, title?: string, description = ""): HourOption => ({
  id: `${HOURS_ROW_PREFIX}${from}_${to}`, title: title ?? `${from}h às ${to}h`, description, from, to,
});
const HOUR_OPTIONS: readonly HourOption[] = [
  mkOption(8, 10), mkOption(10, 12), mkOption(12, 14), mkOption(14, 16), mkOption(16, 18), mkOption(18, 20),
  mkOption(8, 12, "Manhã (8h às 12h)", "Escolhe de uma vez todas as horas da manhã"),
  mkOption(12, 18, "Tarde (12h às 18h)", "Escolhe de uma vez todas as horas da tarde"),
  mkOption(8, 20, "Dia todo (8h às 20h)", "Escolhe de uma vez o dia inteiro"),
];
const optionFromRowId = (id: string): HourOption | null => HOUR_OPTIONS.find((o) => o.id === id) ?? null;
const text = (body: string): Reply => ({ type: "text", text: { body } });

const flowWord = (flow: ScheduleFlow): string => (flow === "doubt" ? "para a mentoria" : flow === "match" ? "para essa mentoria" : "para mentorar");

// ---- mensagens ----
export function daysReply(flow: ScheduleFlow, slots: readonly AvailabilitySlot[], c: Content = fallbackContent, intro = ""): Reply {
  const done = daysWithSlots(slots);
  const body = done.size === 0
    ? `${intro}Em quais dias da semana você está disponível ${flowWord(flow)}? ${T.scheduleTypeHint} Ou digite o número de um ou mais dias da lista (ex.: 1,2,3) e depois os horários deles.`
    : `Anotado:\n${summarizeSlots(slots)}\n\nQuer incluir mais? Escolha na lista ou escreva direto (ex.: sábado das 9h às 12h). Para encerrar, digite o número de Terminei.`;
  const rows = WEEKDAYS.filter((d) => !done.has(d)).map((d) => ({ id: `${DAY_ROW_PREFIX}${d}`, title: WEEKDAY_LABEL[d], description: "" }));
  if (done.size > 0) {
    rows.push({ id: DAYS_DONE_ID, title: c.text("scheduleDaysDone", "Terminei", 24), description: "Já informei todos os dias" });
    rows.push({ id: RESET_ID, title: "Refazer tudo", description: "Apaga o que anotei e recomeça" });
  }
  return buildList(body.slice(0, 1024), c.text("scheduleDaysButton", "Escolher dias", 20), c.text("scheduleDaysSection", "Dias da semana", 24), rows);
}

const joinLabels = (days: readonly Weekday[]): string => {
  const l = days.map((d) => WEEKDAY_LABEL[d]);
  return l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`;
};

export function hoursReply(daysIn: Weekday | readonly Weekday[], slots: readonly AvailabilitySlot[], c: Content = fallbackContent): Reply {
  const days: readonly Weekday[] = Array.isArray(daysIn) ? daysIn : [daysIn as Weekday];
  const day = days[0] as Weekday;
  const label = joinLabels(days);
  const mine = slots.filter((s) => s.day === day);
  const body = mine.length === 0
    ? `Quais horários de ${label} você está disponível (das ${SCHEDULE_OPEN_HOUR}h às ${SCHEDULE_CLOSE_HOUR}h)? Escreva todos de uma vez (ex.: 8h às 12h e 14h às 16h) ou digite o número de uma ou mais opções da lista (ex.: 1,2,3).${days.length > 1 ? " Vale para todos esses dias." : ""}`
    : `${label}: ${mine.map((s) => `${fmtHour(s.start)} às ${fmtHour(s.end)}`).join(", ")}. Quer incluir mais algum horário? Digite o número de uma opção ou o de Concluir.`;
  const rows = HOUR_OPTIONS
    .filter((o) => days.some((d) => coveredMinutes(slots, d, o.from * 60, o.to * 60) < (o.to - o.from) * 60)) // some quando já está toda coberta
    .map((o) => ({ id: o.id, title: o.title, description: o.description }));
  if (mine.length > 0) rows.push({ id: DAY_END_ID, title: `Concluir ${days.length > 1 ? "esses dias" : label}`.slice(0, 24), description: "Terminei os horários deste dia" });
  return buildList(body.slice(0, 1024), c.text("scheduleHoursButton", "Escolher horários", 20), c.text("scheduleHoursSection", "Horários", 24), rows);
}

/** "Anotei isso, está correto?": a pessoa já escreveu dia e horário, então só confirma (Sim encerra). */
export function confirmReply(slots: readonly AvailabilitySlot[]): Reply {
  return buildButtons(`Anotei assim:\n${summarizeSlots(slots)}\n\nEstá correto?`.slice(0, 1024), [
    { id: CONFIRM_YES_ID, title: "Sim, está certo" }, { id: CONFIRM_NO_ID, title: "Não, refazer" },
  ]);
}

/** Primeira mensagem do fluxo (usada por quem leva a pessoa até aqui). */
export function startSchedule(flow: ScheduleFlow, c: Content = fallbackContent, intro = ""): { state: State; reply: Reply } {
  return { state: daysState(flow), reply: daysReply(flow, [], c, intro) };
}

/** Mensagem ao retomar (depois do opt-out) um estado do fluxo. */
export function schedulePrompt(state: string, slots: readonly AvailabilitySlot[], c: Content = fallbackContent): Reply | undefined {
  const p = parseState(state);
  if (!p) return undefined;
  if (p.kind === "confirm") return slots.length > 0 ? confirmReply(slots) : daysReply(p.flow, [], c);
  return p.kind === "days" ? daysReply(p.flow, slots, c) : hoursReply(p.days, slots, c);
}

/** Encerramento do fluxo: confirma os horários e segue para o próximo passo de cada caminho. */
function closing(flow: ScheduleFlow, slots: readonly AvailabilitySlot[], c: Content, typed = false): { to: State; reply: Reply } {
  const saved = `Horários anotados:\n${summarizeSlots(slots)}\n${typed ? "Algo errado? É só refazer pelo menu, em Horários.\n" : ""}\n`;
  if (flow === "mentor") return { to: "COMPLETED", reply: text(`${saved}${c.text("profileClosingMentor", T.closingMentor)}`.slice(0, 1024)) };
  if (flow === "match") {
    return { to: "COMPLETED", reply: text(`${saved}Valeu! Vou passar esses horários pro mentorado escolher e te aviso quando fechar. 🦎`.slice(0, 1024)) };
  }
  if (flow === "doubt") return { to: "COMPLETED", reply: text(`${saved}${c.text("scheduleClosingDoubt", T.closingScheduleDoubt)}`.slice(0, 1024)) };
  return {
    to: "DOUBT_ASK",
    reply: buildButtons(`${saved}${c.text("profileAskDoubt", T.askDoubt)}`.slice(0, 1024), [
      { id: DOUBT_YES_ID, title: c.text("profileDoubtYes", T.doubtYes, 20) },
      { id: DOUBT_NO_ID, title: c.text("profileDoubtNo", T.doubtNo, 20) },
    ]),
  };
}

/** Linhas na MESMA ordem em que as listas de dias e de horários são mostradas (o número digitado aponta para elas). */
function shownRows(st: { kind: "days" } | { kind: "hours"; days: Weekday[] }, slots: readonly AvailabilitySlot[]): { id: string; title: string }[] {
  if (st.kind === "days") {
    const done = daysWithSlots(slots);
    const rows = WEEKDAYS.filter((d) => !done.has(d)).map((d) => ({ id: `${DAY_ROW_PREFIX}${d}`, title: WEEKDAY_LABEL[d] }));
    if (done.size > 0) rows.push({ id: DAYS_DONE_ID, title: "Terminei" }, { id: RESET_ID, title: "Refazer tudo" });
    return rows;
  }
  const rows = HOUR_OPTIONS
    .filter((o) => st.days.some((d) => coveredMinutes(slots, d, o.from * 60, o.to * 60) < (o.to - o.from) * 60))
    .map((o) => ({ id: o.id, title: o.title }));
  if (st.days.some((d) => slots.some((s) => s.day === d))) rows.push({ id: DAY_END_ID, title: "Concluir" });
  return rows;
}

/**
 * Número, vários números, lista colada ou "todas" digitados nas listas de dias/horários. O webhook já resolve isto com as opções
 * pendentes (que expiram em 12 h); aqui vale a mesma regra direto pelo estado, para o "1" nunca virar "não entendi".
 */
function resolveTypedChoice(input: IncomingMessage, st: { kind: "days" } | { kind: "hours"; days: Weekday[] }, slots: readonly AvailabilitySlot[]): IncomingMessage {
  if (input.type !== "text") return input;
  const rows = shownRows(st, slots);
  const base = { wamid: input.wamid, from: input.from, ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}) };
  const asButton = (r: { id: string; title: string }): IncomingMessage => ({ ...base, type: "button_reply", id: r.id, title: r.title });
  const manyRaw = matchChoices(input.body, rows) ?? matchPastedList(input.body, rows) ?? (isSelectAll(input.body) ? rows : null);
  const many = manyRaw ? manyRaw.filter((o) => !CONTROL_OPTION_IDS.test(o.id)) : null;
  if (many && many.length > 1) {
    const body = many.map((o) => { const h = /^sch_h_(\d+)_(\d+)$/.exec(o.id); return h ? `${h[1]}h às ${h[2]}h` : o.title; }).join(", ");
    return { ...base, type: "text", body };
  }
  if (many && many.length === 1) return asButton(many[0] as { id: string; title: string });
  const one = matchChoice(input.body, rows);
  return one ? asButton(one) : input;
}

/**
 * "dia 2 e 3 a partir das 4", "dias 1, 3 e 5", "dia 2 e dia 3": na lista de dias, os números apontam para os dias da lista
 * (1 = primeiro dia mostrado). Troca esses números pelo nome do dia antes de ler o texto, para a pessoa nunca precisar repetir.
 * Números fora da lista (ex.: "dia 15") ficam como estão.
 */
export function daysByListNumber(body: string, slots: readonly AvailabilitySlot[]): string {
  const dayRows = shownRows({ kind: "days" }, slots).filter((r) => r.id.startsWith(DAY_ROW_PREFIX));
  const label = (n: string): string | null => { const r = dayRows[Number(n) - 1]; return r && Number(n) >= 1 ? r.title : null; };
  return body.replace(/\bdias?\s+(\d{1,2}(?:\s*(?:,|e|ou|\/|&)\s*(?:dias?\s+)?\d{1,2})*)(?!\d)/gi, (all, list: string) => {
    const names = (list.match(/\d{1,2}/g) ?? []).map(label);
    return names.length > 0 && names.every((n) => n !== null) ? (names as string[]).join(" e ") : all;
  });
}

export function decideSchedule(
  user: UserState, rawInput: IncomingMessage, counters: Counters, now: Date, content: Content = fallbackContent,
  ctx: { slots?: readonly AvailabilitySlot[]; /** Leitura da IA do texto desta mensagem (só consultada quando as regras do bot não acharam nada). */ ai?: ParsedAvailability | null } = {},
): ScheduleDecision | null {
  const st = parseState(user.state);
  if (!isScheduleState(user.state)) return null;
  const c = content;
  const slots = ctx.slots ?? [];
  const input = st && (st.kind === "days" || st.kind === "hours") ? resolveTypedChoice(rawInput, st, slots) : rawInput;
  const silent = (): ScheduleDecision => ({ replies: [], nextState: user, outcome: "silent" });
  if (input.type === "text" && intentsOf(input.body).has("quit")) return null; // opt-out é da máquina principal
  if (!st) return silent(); // estado de horário desconhecido (linha antiga): silêncio, nunca erro
  const save = (next: readonly AvailabilitySlot[]): AvailabilityEffect => ({ kind: "availability", text: summarizeSlots(next).slice(0, 500), slots: [...next] });
  const withEffect = (d: Decision, effect: AvailabilityEffect): ScheduleDecision => (d.outcome === "limited" ? d : { ...d, effect });
  const hintOnce = (body: string): ScheduleDecision => {
    if (user.hintSentInState) return silent();
    return finish(user, { ...user, hintSentInState: true }, [text(body)], counters, "hint");
  };
  const finishFlow = (flow: ScheduleFlow, next: readonly AvailabilitySlot[], typed = false): ScheduleDecision => {
    const end = closing(flow, next, c, typed);
    return withEffect(finish(user, moveTo(user, end.to, now), [end.reply], counters, "reply"), save(next));
  };

  /** Faixas da IA (já limitadas a 8h-20h). */
  const aiSlots = (): AvailabilitySlot[] => mergeSlots([], ctx.ai?.slots ?? []);
  /**
   * Aplica o que a pessoa escreveu ao que já está anotado: soma (padrão), troca os dias citados ("na verdade sexta 14h às 16h"),
   * refaz tudo ("só segunda 8h às 10h") ou tira dias ("tirar sexta"). `null` = não entendi nada (vira dica).
   */
  const applyTyped = (body: string, loose?: readonly Weekday[]): AvailabilitySlot[] | null => {
    const edit = parseScheduleEdit(body);
    if (edit.remove.length > 0) return slots.filter((x) => !edit.remove.includes(x.day));
    const p = parseScheduleText(body);
    let typed = p.slots.length > 0 ? p.slots : loose ? loose.flatMap((d) => slotsForDay(d, p.loose)) : [];
    if (typed.length === 0) typed = aiSlots();
    if (typed.length === 0) return null;
    if (edit.replaceAll) return mergeSlots([], typed);
    if (edit.replaceDays) { const days = new Set(typed.map((x) => x.day)); return mergeSlots(slots.filter((x) => !days.has(x.day)), typed); }
    return mergeSlots(slots, typed);
  };
  /** Depois de escrever vários de uma vez: grava e mostra o que foi anotado (ou encerra, se todos os dias já estão). */
  const afterTyped = (next: readonly AvailabilitySlot[], flow: ScheduleFlow): ScheduleDecision => {
    if (daysWithSlots(next).size === WEEKDAYS.length) return finishFlow(flow, next);
    return withEffect(finish(user, moveTo(user, daysState(flow), now), [daysReply(flow, next, c)], counters, "reply"), save(next));
  };

  /** Escreveu dia E horário de uma vez: grava e encerra, sem perguntar de novo (só "tirar um dia" volta à lista). */
  const typedConfirm = (body: string, next: readonly AvailabilitySlot[], flow: ScheduleFlow): ScheduleDecision => {
    if (parseScheduleEdit(body).remove.length > 0) return afterTyped(next, flow);
    return finishFlow(flow, next, true);
  };

  if (st.kind === "confirm") {
    const typedConf = input.type === "text" ? typedOption(input.body, [{ id: CONFIRM_YES_ID, title: "Sim, está certo" }, { id: CONFIRM_NO_ID, title: "Não, refazer" }]) : null;
    const said = typedConf ? (typedConf.id === CONFIRM_YES_ID ? "yes" : "no") : (input.type === "button_reply" || input.type === "list_reply") ? (input.id === CONFIRM_YES_ID ? "yes" : input.id === CONFIRM_NO_ID ? "no" : null)
      : input.type === "text" ? (intentsOf(input.body).has("yes") ? "yes" : intentsOf(input.body).has("no") ? "no" : readNameAnswer(input.body)) : null;
    if (said === "yes") return slots.length > 0 ? finishFlow(st.flow, slots) : silent();
    if (said === "no") return withEffect(finish(user, moveTo(user, daysState(st.flow), now), [daysReply(st.flow, [], c, "Sem problema, vamos de novo. ")], counters, "reply"), save([]));
    if (input.type !== "text") return silent();
    // Corrigiu escrevendo ("na verdade terça às 14h"): aplica e confirma de novo.
    const fix = applyTyped(input.body);
    if (fix !== null) return typedConfirm(input.body, fix, st.flow);
    return hintOnce("Responda *sim* se os horários acima estão certos ou *não* para refazer. Se preferir, escreva a correção (ex.: terça das 14h às 16h).");
  }

  if (st.kind === "days") {
    if ((input.type === "list_reply" || input.type === "button_reply")) {
      if (input.id === DAYS_DONE_ID) return slots.length > 0 ? finishFlow(st.flow, slots) : silent();
      if (input.id === RESET_ID) {
        if (slots.length === 0) return silent();
        return withEffect(finish(user, user, [daysReply(st.flow, [], c)], counters, "reply"), save([]));
      }
      if (input.id.startsWith(DAY_ROW_PREFIX)) {
        const day = input.id.slice(DAY_ROW_PREFIX.length);
        if (!(WEEKDAYS as readonly string[]).includes(day) || daysWithSlots(slots).has(day as Weekday)) return silent(); // linha antiga: silêncio
        return finish(user, moveTo(user, hoursState(st.flow, day as Weekday), now), [hoursReply(day as Weekday, slots, c)], counters, "reply");
      }
      return silent();
    }
    if (input.type !== "text") return silent();
    // Vários dias e horários de uma vez, escritos ("segunda e quarta das 8h às 12h; sexta à tarde"; "dia 2 e 3 depois das 16h").
    const body = daysByListNumber(input.body, slots);
    const next = applyTyped(body);
    // Só dias, sem horários ("segunda, quarta e sexta"): pergunta os horários de uma vez para todos eles.
    if (next === null) {
      const only = parseScheduleText(body).daysOnly.filter((d) => !daysWithSlots(slots).has(d));
      if (only.length > 0 && !isVent(input.body)) return finish(user, moveTo(user, hoursState(st.flow, only), now), [hoursReply(only, slots, c)], counters, "reply");
    }
    if (next === null) return hintOnce(isVent(input.body) ? ventScheduleHint(input.body, "days") : c.text("scheduleHintDays", T.hintScheduleDays));
    return typedConfirm(body, next, st.flow);
  }

  // Horários de um dia.
  if ((input.type === "list_reply" || input.type === "button_reply")) {
    if (input.id === DAY_END_ID) {
      if (!st.days.some((d) => slots.some((s) => s.day === d))) return silent();
      if (daysWithSlots(slots).size === WEEKDAYS.length) return finishFlow(st.flow, slots);
      return finish(user, moveTo(user, daysState(st.flow), now), [daysReply(st.flow, slots, c)], counters, "reply");
    }
    const opt = optionFromRowId(input.id);
    if (!opt) return silent();
    const next = mergeSlots(slots, st.days.map((d) => ({ day: d, start: hh(opt.from), end: hh(opt.to) })));
    const full = st.days.every((d) => coveredMinutes(next, d, SCHEDULE_OPEN_HOUR * 60, SCHEDULE_CLOSE_HOUR * 60) >= (SCHEDULE_CLOSE_HOUR - SCHEDULE_OPEN_HOUR) * 60); // dia todo: não há mais o que marcar
    if (full) {
      if (daysWithSlots(next).size === WEEKDAYS.length) return finishFlow(st.flow, next);
      return withEffect(finish(user, moveTo(user, daysState(st.flow), now), [daysReply(st.flow, next, c)], counters, "reply"), save(next));
    }
    return withEffect(finish(user, user, [hoursReply(st.days, next, c)], counters, "reply"), save(next));
  }
  if (input.type !== "text") return silent();
  // Vários horários do dia de uma vez ("8h às 12h e 14h às 16h"); se vierem dias no texto, valem também.
  const next = applyTyped(input.body, st.days);
  if (next === null) return hintOnce(isVent(input.body) ? ventScheduleHint(input.body, "hours") : c.text("scheduleHintHours", T.hintScheduleHours));
  return afterTyped(next, st.flow);
}
