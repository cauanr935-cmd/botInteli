// Dias e horários livres escolhidos em LISTAS (sem digitar), para mentores (no cadastro) e mentorados (depois da dúvida).
// Fluxo: lista de dias -> escolhe um dia -> lista de horários desse dia (um ou mais) -> Concluir -> volta aos dias -> Terminei.
// Estado: SCHED_DAYS_<fluxo> e SCHED_HOURS_<fluxo>_<dia>. Decisão PURA (sem I/O): as faixas escolhidas chegam por
// parâmetro e saem como efeito (o motor grava em users.availability_slots). Cada toque = no máximo 1 mensagem (R2).
import { isVent, ventScheduleHint } from "../axo/voice";
import { finish, moveTo, type Counters, type Decision, type State, type UserState } from "../conversation/machine";
import { intentsOf } from "../conversation/synonyms";
import type { Reply } from "../conversation/texts";
import { fallbackContent, type Content } from "../services/content";
import { DOUBT_NO_ID, DOUBT_YES_ID, PROFILE_TEXTS as T } from "../profile/texts";
import { fmtHour, summarizeSlots, WEEKDAYS, WEEKDAY_LABEL, type AvailabilitySlot, type ParsedAvailability, type Weekday } from "../ai/types";
import { coveredMinutes, mergeSlots, parseScheduleEdit, parseScheduleText, slotsForDay } from "./parse";
import type { AvailabilityEffect } from "../availability/decide";
import { buildButtons, buildList } from "../whatsapp/builders";
import type { IncomingMessage } from "../whatsapp/types";

export type ScheduleFlow = "mentor" | "ambos" | "doubt";
export type ScheduleDecision = Decision & { effect?: AvailabilityEffect };

/** Faixa de atendimento: das 8h às 20h. */
export const SCHEDULE_OPEN_HOUR = 8;
export const SCHEDULE_CLOSE_HOUR = 20;
export const DAY_ROW_PREFIX = "sch_day_";
export const HOURS_ROW_PREFIX = "sch_h_";
export const DAYS_DONE_ID = "sch_done";
export const DAY_END_ID = "sch_dayend";
export const RESET_ID = "sch_reset";

const DAYS_PREFIX = "SCHED_DAYS_";
const HOURS_PREFIX = "SCHED_HOURS_";
const FLOWS: readonly string[] = ["mentor", "ambos", "doubt"];

export const isScheduleState = (s: string): boolean => s.startsWith(DAYS_PREFIX) || s.startsWith(HOURS_PREFIX);
export const daysState = (flow: ScheduleFlow): State => `${DAYS_PREFIX}${flow}`;
const hoursState = (flow: ScheduleFlow, day: Weekday): State => `${HOURS_PREFIX}${flow}_${day}`;

function parseState(s: string): { kind: "days"; flow: ScheduleFlow } | { kind: "hours"; flow: ScheduleFlow; day: Weekday } | null {
  if (s.startsWith(DAYS_PREFIX)) {
    const flow = s.slice(DAYS_PREFIX.length);
    return FLOWS.includes(flow) ? { kind: "days", flow: flow as ScheduleFlow } : null;
  }
  if (s.startsWith(HOURS_PREFIX)) {
    const [flow, day] = s.slice(HOURS_PREFIX.length).split("_");
    if (flow && day && FLOWS.includes(flow) && (WEEKDAYS as readonly string[]).includes(day)) return { kind: "hours", flow: flow as ScheduleFlow, day: day as Weekday };
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

const flowWord = (flow: ScheduleFlow): string => (flow === "doubt" ? "para a mentoria" : "para mentorar");

// ---- mensagens ----
export function daysReply(flow: ScheduleFlow, slots: readonly AvailabilitySlot[], c: Content = fallbackContent, intro = ""): Reply {
  const done = daysWithSlots(slots);
  const body = done.size === 0
    ? `${intro}Em quais dias da semana você está disponível ${flowWord(flow)}? ${T.scheduleTypeHint} Ou escolha um dia na lista e depois os horários dele.`
    : `Anotado:\n${summarizeSlots(slots)}\n\nQuer incluir mais? Escreva ou escolha na lista. Para encerrar, toque em Terminei.`;
  const rows = WEEKDAYS.filter((d) => !done.has(d)).map((d) => ({ id: `${DAY_ROW_PREFIX}${d}`, title: WEEKDAY_LABEL[d], description: "" }));
  if (done.size > 0) {
    rows.push({ id: DAYS_DONE_ID, title: c.text("scheduleDaysDone", "Terminei", 24), description: "Já informei todos os dias" });
    rows.push({ id: RESET_ID, title: "Refazer tudo", description: "Apaga o que anotei e recomeça" });
  }
  return buildList(body.slice(0, 1024), c.text("scheduleDaysButton", "Escolher dias", 20), c.text("scheduleDaysSection", "Dias da semana", 24), rows);
}

export function hoursReply(day: Weekday, slots: readonly AvailabilitySlot[], c: Content = fallbackContent): Reply {
  const label = WEEKDAY_LABEL[day];
  const mine = slots.filter((s) => s.day === day);
  const body = mine.length === 0
    ? `Quais horários de ${label} você está disponível (das ${SCHEDULE_OPEN_HOUR}h às ${SCHEDULE_CLOSE_HOUR}h)? Escreva todos de uma vez (ex.: 8h às 12h e 14h às 16h) ou escolha na lista.`
    : `${label}: ${mine.map((s) => `${fmtHour(s.start)} às ${fmtHour(s.end)}`).join(", ")}. Quer incluir mais algum horário? Escolha na lista ou toque em Concluir.`;
  const rows = HOUR_OPTIONS
    .filter((o) => coveredMinutes(slots, day, o.from * 60, o.to * 60) < (o.to - o.from) * 60) // some quando já está toda coberta
    .map((o) => ({ id: o.id, title: o.title, description: o.description }));
  if (mine.length > 0) rows.push({ id: DAY_END_ID, title: `Concluir ${label}`.slice(0, 24), description: "Terminei os horários deste dia" });
  return buildList(body.slice(0, 1024), c.text("scheduleHoursButton", "Escolher horários", 20), c.text("scheduleHoursSection", "Horários", 24), rows);
}

/** Primeira mensagem do fluxo (usada por quem leva a pessoa até aqui). */
export function startSchedule(flow: ScheduleFlow, c: Content = fallbackContent, intro = ""): { state: State; reply: Reply } {
  return { state: daysState(flow), reply: daysReply(flow, [], c, intro) };
}

/** Mensagem ao retomar (depois do opt-out) um estado do fluxo. */
export function schedulePrompt(state: string, slots: readonly AvailabilitySlot[], c: Content = fallbackContent): Reply | undefined {
  const p = parseState(state);
  if (!p) return undefined;
  return p.kind === "days" ? daysReply(p.flow, slots, c) : hoursReply(p.day, slots, c);
}

/** Encerramento do fluxo: confirma os horários e segue para o próximo passo de cada caminho. */
function closing(flow: ScheduleFlow, slots: readonly AvailabilitySlot[], c: Content): { to: State; reply: Reply } {
  const saved = `Horários anotados:\n${summarizeSlots(slots)}\n\n`;
  if (flow === "mentor") return { to: "COMPLETED", reply: text(`${saved}${c.text("profileClosingMentor", T.closingMentor)}`.slice(0, 1024)) };
  if (flow === "doubt") return { to: "COMPLETED", reply: text(`${saved}${c.text("scheduleClosingDoubt", T.closingScheduleDoubt)}`.slice(0, 1024)) };
  return {
    to: "DOUBT_ASK",
    reply: buildButtons(`${saved}${c.text("profileAskDoubt", T.askDoubt)}`.slice(0, 1024), [
      { id: DOUBT_YES_ID, title: c.text("profileDoubtYes", T.doubtYes, 20) },
      { id: DOUBT_NO_ID, title: c.text("profileDoubtNo", T.doubtNo, 20) },
    ]),
  };
}

export function decideSchedule(
  user: UserState, input: IncomingMessage, counters: Counters, now: Date, content: Content = fallbackContent,
  ctx: { slots?: readonly AvailabilitySlot[]; /** Leitura da IA do texto desta mensagem (só consultada quando as regras do bot não acharam nada). */ ai?: ParsedAvailability | null } = {},
): ScheduleDecision | null {
  const st = parseState(user.state);
  if (!isScheduleState(user.state)) return null;
  const c = content;
  const slots = ctx.slots ?? [];
  const silent = (): ScheduleDecision => ({ replies: [], nextState: user, outcome: "silent" });
  if (input.type === "text" && intentsOf(input.body).has("quit")) return null; // opt-out é da máquina principal
  if (!st) return silent(); // estado de horário desconhecido (linha antiga): silêncio, nunca erro
  const save = (next: readonly AvailabilitySlot[]): AvailabilityEffect => ({ kind: "availability", text: summarizeSlots(next).slice(0, 500), slots: [...next] });
  const withEffect = (d: Decision, effect: AvailabilityEffect): ScheduleDecision => (d.outcome === "limited" ? d : { ...d, effect });
  const hintOnce = (body: string): ScheduleDecision => {
    if (user.hintSentInState) return silent();
    return finish(user, { ...user, hintSentInState: true }, [text(body)], counters, "hint");
  };
  const finishFlow = (flow: ScheduleFlow, next: readonly AvailabilitySlot[]): ScheduleDecision => {
    const end = closing(flow, next, c);
    return withEffect(finish(user, moveTo(user, end.to, now), [end.reply], counters, "reply"), save(next));
  };

  /** Faixas da IA (já limitadas a 8h-20h). */
  const aiSlots = (): AvailabilitySlot[] => mergeSlots([], ctx.ai?.slots ?? []);
  /**
   * Aplica o que a pessoa escreveu ao que já está anotado: soma (padrão), troca os dias citados ("na verdade sexta 14h às 16h"),
   * refaz tudo ("só segunda 8h às 10h") ou tira dias ("tirar sexta"). `null` = não entendi nada (vira dica).
   */
  const applyTyped = (body: string, loose?: Weekday): AvailabilitySlot[] | null => {
    const edit = parseScheduleEdit(body);
    if (edit.remove.length > 0) return slots.filter((x) => !edit.remove.includes(x.day));
    const p = parseScheduleText(body);
    let typed = p.slots.length > 0 ? p.slots : loose ? slotsForDay(loose, p.loose) : [];
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

  if (st.kind === "days") {
    if (input.type === "list_reply") {
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
    // Vários dias e horários de uma vez, escritos ("segunda e quarta das 8h às 12h; sexta à tarde").
    const next = applyTyped(input.body);
    if (next === null) return hintOnce(isVent(input.body) ? ventScheduleHint(input.body, "days") : c.text("scheduleHintDays", T.hintScheduleDays));
    return afterTyped(next, st.flow);
  }

  // Horários de um dia.
  if (input.type === "list_reply") {
    if (input.id === DAY_END_ID) {
      if (!slots.some((s) => s.day === st.day)) return silent();
      if (daysWithSlots(slots).size === WEEKDAYS.length) return finishFlow(st.flow, slots);
      return finish(user, moveTo(user, daysState(st.flow), now), [daysReply(st.flow, slots, c)], counters, "reply");
    }
    const opt = optionFromRowId(input.id);
    if (!opt) return silent();
    const next = mergeSlots(slots, [{ day: st.day, start: hh(opt.from), end: hh(opt.to) }]);
    const full = coveredMinutes(next, st.day, SCHEDULE_OPEN_HOUR * 60, SCHEDULE_CLOSE_HOUR * 60) >= (SCHEDULE_CLOSE_HOUR - SCHEDULE_OPEN_HOUR) * 60; // dia todo: não há mais o que marcar
    if (full) {
      if (daysWithSlots(next).size === WEEKDAYS.length) return finishFlow(st.flow, next);
      return withEffect(finish(user, moveTo(user, daysState(st.flow), now), [daysReply(st.flow, next, c)], counters, "reply"), save(next));
    }
    return withEffect(finish(user, user, [hoursReply(st.day, next, c)], counters, "reply"), save(next));
  }
  if (input.type !== "text") return silent();
  // Vários horários do dia de uma vez ("8h às 12h e 14h às 16h"); se vierem dias no texto, valem também.
  const next = applyTyped(input.body, st.day);
  if (next === null) return hintOnce(isVent(input.body) ? ventScheduleHint(input.body, "hours") : c.text("scheduleHintHours", T.hintScheduleHours));
  return afterTyped(next, st.flow);
}
