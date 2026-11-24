// Decisão (PURA) do mentorado no matching manual: escolhe um dos horários do mentor e diz o local (texto livre).
// Estados: MATCH_MENTEE_PICK (lista de horários) -> MATCH_MENTEE_PLACE (local) -> COMPLETED (confirmada para os dois).
// "Nenhum desses" = não há horário em comum: o mentor é chamado de novo para mandar outra grade (ver flow.ts).
import { fmtHour, WEEKDAYS, WEEKDAY_LABEL, type AvailabilitySlot, type Weekday } from "../ai/types";
import { finish, moveTo, type Counters, type Decision, type UserState } from "../conversation/machine";
import { intentsOf } from "../conversation/synonyms";
import type { Reply } from "../conversation/texts";
import type { MatchRow, Slot } from "../db/repo";
import { daysReply, daysState } from "../schedule/decide";
import { fallbackContent, type Content } from "../services/content";
import { buildButtons, buildList } from "../whatsapp/builders";
import { typedOption } from "../whatsapp/choices";
import { parseMentoringWindow, zonedToUtc } from "./time";
import type { IncomingMessage } from "../whatsapp/types";

export const ACCEPT_STATE = "MATCH_MENTOR_ACCEPT";
export const PICK_STATE = "MATCH_MENTEE_PICK";
/** O mentorado escolheu o horário livre do mentor; agora diz de que horas a que horas a mentoria vai durar. */
export const TIME_STATE = "MATCH_MENTEE_TIME";
export const PLACE_STATE = "MATCH_MENTEE_PLACE";
export const isMatchMentorAcceptState = (s: string): boolean => s === ACCEPT_STATE;
export const isMatchMenteeState = (s: string): boolean => s === PICK_STATE || s === TIME_STATE || s === PLACE_STATE;

export const ACCEPT_YES_ID = "mm_accept_yes";
export const ACCEPT_NO_ID = "mm_accept_no";
const ACCEPT_OPTIONS = [{ id: ACCEPT_YES_ID, title: "Sim, aceito" }, { id: ACCEPT_NO_ID, title: "Não posso" }] as const;

export const SLOT_ROW_PREFIX = "mm_s_";
export const NONE_ROW_ID = "mm_none";
const MAX_SLOT_ROWS = 9; // + "Nenhum desses" = 10 linhas, o limite da lista

export type MentorAcceptEffect = { kind: "accept" } | { kind: "decline" };
export type MentorAcceptDecision = Decision & { effect?: MentorAcceptEffect };

export type MenteeEffect =
  | { kind: "pick"; day: Weekday; start: string; end: string }
  | { kind: "time"; start: string; end: string }
  | { kind: "none" }
  | { kind: "place"; location: string };
export type MenteeDecision = Decision & { effect?: MenteeEffect };

const text = (body: string): Reply => ({ type: "text", text: { body } });
const isWeekday = (d: string): d is Weekday => (WEEKDAYS as readonly string[]).includes(d);

/** Faixas do mentor em ordem (dia, hora), no máximo 9: é a lista que o mentorado vê. O índice da linha aponta para esta lista. */
export function pickSlots(slots: readonly Slot[] | null): AvailabilitySlot[] {
  return (slots ?? [])
    .filter((s): s is AvailabilitySlot => isWeekday(s.day))
    .sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.start.localeCompare(b.start))
    .slice(0, MAX_SLOT_ROWS);
}

const rangeLabel = (s: { start: string; end: string }): string => `${fmtHour(s.start)} às ${fmtHour(s.end)}`;

/** Próxima data (dd/mm e ISO) do dia da semana, no fuso da conta. Hoje só vale se a faixa ainda não acabou. */
export function nextOccurrence(day: Weekday, endHHMM: string, now: Date, timezone: string): { iso: string; label: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>;
  const [y, m, d] = [Number(p.year), Number(p.month), Number(p.day)];
  const todayIdx = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // segunda = 0
  const nowMin = Number(p.hour) * 60 + Number(p.minute);
  const [eh, em] = endHHMM.split(":").map(Number) as [number, number];
  let delta = (WEEKDAYS.indexOf(day) - todayIdx + 7) % 7;
  if (delta === 0 && nowMin >= eh * 60 + em) delta = 7;
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return { iso: date.toISOString().slice(0, 10), label: `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}` };
}

/** Linhas da lista de horários, na ordem mostrada (o número digitado aponta para elas). */
export function pickOptions(slots: readonly Slot[] | null): { id: string; title: string }[] {
  return [
    ...pickSlots(slots).map((s, i) => ({ id: `${SLOT_ROW_PREFIX}${i}`, title: `${WEEKDAY_LABEL[s.day]} ${rangeLabel(s)}`.slice(0, 24) })),
    { id: NONE_ROW_ID, title: "Nenhum desses" },
  ];
}

/** Lista de horários do mentor + "Nenhum desses". `intro` abre a mensagem (ex.: apresentação do mentor). */
export function pickReply(slots: readonly Slot[] | null, now: Date, timezone: string, intro = ""): Reply {
  const options = pickSlots(slots);
  const body = `${intro}Esses são os horários que o mentor tem livres. Qual fica melhor pra você? Digite o número da opção.`;
  const rows = options.map((s, i) => ({
    id: `${SLOT_ROW_PREFIX}${i}`, title: `${WEEKDAY_LABEL[s.day]} ${rangeLabel(s)}`.slice(0, 24), description: `Próxima: ${nextOccurrence(s.day, s.end, now, timezone).label}`,
  }));
  rows.push({ id: NONE_ROW_ID, title: "Nenhum desses", description: "Peço novos horários ao mentor" });
  return buildList(body.slice(0, 1024), "Escolher horário", "Horários do mentor", rows);
}

export const PLACE_PROMPT = "Anotado! 🦎 Agora me diz: onde você quer fazer a mentoria? Escreve o local no Inteli onde prefere se encontrar.";
const PLACE_HINT = "Me diz o local da mentoria (um canto do Inteli onde você prefere), escrevendo em texto mesmo.";

export function placePrompt(): Reply { return text(PLACE_PROMPT); }

/**
 * Texto de confirmação (para o mentorado e para o mentor). ANÔNIMO: mentor e mentorado só sabem o nome um do outro 5 minutos antes
 * da mentoria (o aviso com os nomes sai pelo cron, ver `reminder.ts`); nunca aqui.
 */
/** Critérios para a mentoria ser aceita como Atividade Complementar (o que mentor e mentorado precisam cumprir). */
export function criteriaText(role: "mentor" | "mentorado"): string {
  const own = role === "mentor"
    ? "🎓 Mentor: conduza a conversa com um objetivo claro, dê orientações concretas e feche resumindo os próximos passos."
    : "🙋 Mentorado: chegue com a sua dúvida pronta, participe ativamente e, no fim, avalie a mentoria.";
  return "Pra mentoria valer como Atividade Complementar, os dois precisam cumprir:\n" +
    "• Os dois cadastrados, com nome e matrícula, alunos do Inteli e com o aceite dos termos feito.\n" +
    "• Gravar a conversa inteira (sem cortes) e enviar o áudio por aqui. Tem que ser uma gravação nova e com voz clara.\n" +
    "• Os dois falam durante toda a sessão: ninguém some por mais de 5 min e o mentor não pode ficar quase calado.\n" +
    "• Duração mínima de 20 min (provisório). Só conta fala real: pausas acima de 2 min são descontadas.\n" +
    "• Tem que ser orientação com objetivo e foco no tema, que complemente a formação. Palestra, papo social, estágio, TCC ou atividade que já conta em outra disciplina não valem.\n" +
    "• Sem ofensa e sem combinar nada pra \"encher\" horas.\n\n" + own;
}

export function confirmationText(
  m: { day: Weekday; start: string; end: string; location: string }, now: Date, timezone: string, role?: "mentor" | "mentorado",
): string {
  const when = nextOccurrence(m.day, m.end, now, timezone);
  return `Mentoria confirmada! 🎉\n📅 ${WEEKDAY_LABEL[m.day]}, ${when.label} · ${rangeLabel(m)}\n📍 ${m.location}\n\n` +
    "Por segurança, o nome de quem vai participar chega 5 minutos antes da mentoria. Se pintar algum imprevisto, avisa a coordenação." +
    (role ? `\n\n${criteriaText(role)}` : "");
}

/** Instante UTC do início da mentoria (próxima ocorrência do dia escolhido, n hora de início). */
export function scheduledInstant(m: { day: Weekday; start: string; end: string }, now: Date, timezone: string): Date {
  return zonedToUtc(nextOccurrence(m.day, m.end, now, timezone).iso, m.start, timezone);
}

const ACCEPT_BODY = "Você aceita dar essa mentoria?";
/** Pergunta ao mentor, ANTES dos horários: aceita ou não aquela mentoria. */
export function acceptReply(intro = ""): Reply {
  return buildButtons(`${intro}${ACCEPT_BODY}`.slice(0, 1024), [
    { id: ACCEPT_YES_ID, title: "Sim, aceito" }, { id: ACCEPT_NO_ID, title: "Não posso" },
  ]);
}

export function decideMatchMentor(
  user: UserState, input: IncomingMessage, counters: Counters, now: Date, content: Content = fallbackContent,
): MentorAcceptDecision | null {
  if (user.state !== ACCEPT_STATE) return null;
  const intents = input.type === "text" ? intentsOf(input.body) : new Set<string>();
  if (input.type === "text" && intents.has("quit")) return null; // opt-out é da máquina principal
  const silent = (): MentorAcceptDecision => ({ replies: [], nextState: user, outcome: "silent" });
  const typed = input.type === "text" ? typedOption(input.body, ACCEPT_OPTIONS) : null; // "1" = sim, "2" = não (pelo estado)
  const said = (input.type === "button_reply" || input.type === "list_reply")
    ? (input.id === ACCEPT_YES_ID ? "yes" : input.id === ACCEPT_NO_ID ? "no" : null)
    : typed ? (typed.id === ACCEPT_YES_ID ? "yes" : "no")
    : input.type === "text" ? (intents.has("yes") ? "yes" : intents.has("no") ? "no" : null) : null;
  if (said === "yes") {
    const d = finish(user, moveTo(user, daysState("match"), now), [daysReply("match", [], content, "Show! 🦎 ")], counters, "reply");
    return d.outcome === "limited" ? d : { ...d, effect: { kind: "accept" } };
  }
  if (said === "no") {
    const d = finish(user, moveTo(user, "COMPLETED", now), [text("Tranquilo, obrigado por avisar! Vou chamar outra pessoa pra essa mentoria. Quando surgir outra que combine com você, eu te chamo. 🦎")], counters, "reply");
    return d.outcome === "limited" ? d : { ...d, effect: { kind: "decline" } };
  }
  if (input.type !== "text" || user.hintSentInState) return silent();
  return finish(user, { ...user, hintSentInState: true }, [acceptReply("Responde só com *sim* ou *não*. ")], counters, "hint");
}

const TIME_HINTS = {
  unparsed: "Não peguei o horário 😅 Escreve de que horas a que horas vai ser a mentoria, por exemplo *8h às 9h*.",
  short: "A mentoria precisa ter pelo menos 20 minutos. Escreve de novo de que horas a que horas, por exemplo *8h às 9h*.",
  outside: "Esse horário ficou fora do que o mentor tem livre. Escolhe um intervalo dentro do horário dele, por exemplo *8h às 9h*.",
  order: "O fim precisa ser depois do começo. Escreve de novo, por exemplo *8h às 9h*.",
} as const;

/** Pergunta do horário real: a faixa livre do mentor não é a duração; em média a mentoria dura 1 h (mínimo 20 min). */
export function timePrompt(day: Weekday, start: string, end: string): Reply {
  return text(
    `Anotado! 🦎 O mentor está livre ${WEEKDAY_LABEL[day]} das ${fmtHour(start)} às ${fmtHour(end)}, mas isso é só a disponibilidade dele. ` +
    "Uma mentoria dura em média 1 hora (pode ser menos, mas no mínimo 20 minutos). " +
    "De que horas a que horas você quer fazer a sua? Escreve o intervalo, por exemplo *8h às 9h*.",
  );
}

export function decideMatchMentee(
  user: UserState, input: IncomingMessage, counters: Counters, now: Date,
  ctx: { match: MatchRow; timezone: string },
): MenteeDecision | null {
  if (!isMatchMenteeState(user.state)) return null;
  const silent = (): MenteeDecision => ({ replies: [], nextState: user, outcome: "silent" });
  if (input.type === "text" && intentsOf(input.body).has("quit")) return null; // opt-out é da máquina principal
  const hintOnce = (body: string): MenteeDecision => {
    if (user.hintSentInState) return silent();
    return finish(user, { ...user, hintSentInState: true }, [text(body)], counters, "hint");
  };
  const withEffect = (d: Decision, effect: MenteeEffect): MenteeDecision => (d.outcome === "limited" ? d : { ...d, effect });

  if (user.state === PICK_STATE) {
    // Número digitado ("2") vale pela lista do estado, mesmo sem opções pendentes.
    if (input.type === "text") {
      const hit = typedOption(input.body, pickOptions(ctx.match.mentorSlots));
      if (hit) input = { wamid: input.wamid, from: input.from, ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}), type: "button_reply", id: hit.id, title: hit.title };
    }
    if (input.type === "list_reply" || input.type === "button_reply") {
      if (input.id === NONE_ROW_ID) {
        return withEffect(finish(user, moveTo(user, "COMPLETED", now), [text("Beleza! Vou pedir novos horários pro mentor e te chamo de novo assim que ele responder. 🦎")], counters, "reply"), { kind: "none" });
      }
      if (input.id.startsWith(SLOT_ROW_PREFIX)) {
        const slot = pickSlots(ctx.match.mentorSlots)[Number(input.id.slice(SLOT_ROW_PREFIX.length))];
        if (!slot) return silent(); // linha antiga
        return withEffect(finish(user, moveTo(user, TIME_STATE, now), [timePrompt(slot.day, slot.start, slot.end)], counters, "reply"), { kind: "pick", day: slot.day, start: slot.start, end: slot.end });
      }
      return silent();
    }
    if (input.type !== "text") return silent();
    return hintOnce("Escolhe um dos horários da lista (digite o número) ou \"Nenhum desses\" se nenhum der pra você.");
  }

  if (user.state === TIME_STATE) {
    if (input.type !== "text") return silent();
    const m = ctx.match;
    // O horário do mentor escolhido está guardado no match (chosenStart/chosenEnd = a faixa livre dele).
    if (!m.chosenDay || !isWeekday(m.chosenDay) || !m.chosenStart || !m.chosenEnd) return silent();
    const w = parseMentoringWindow(input.body, m.chosenStart, m.chosenEnd);
    if (!w.ok) return hintOnce(TIME_HINTS[w.reason]);
    return withEffect(finish(user, moveTo(user, PLACE_STATE, now), [placePrompt()], counters, "reply"), { kind: "time", start: w.start, end: w.end });
  }

  // MATCH_MENTEE_PLACE: texto livre; só não pode ser vazio (nem um comando solto como "oi" ou "menu").
  if (input.type !== "text") return silent();
  const location = input.body.replace(/\s+/g, " ").trim().slice(0, 200);
  if (location.length < 2 || intentsOf(location).size > 0) return hintOnce(PLACE_HINT);
  const m = ctx.match;
  if (!m.chosenDay || !isWeekday(m.chosenDay) || !m.chosenStart || !m.chosenEnd) return silent(); // match sem horário escolhido: não confirma no escuro
  const body = confirmationText({ day: m.chosenDay, start: m.chosenStart, end: m.chosenEnd, location }, now, ctx.timezone, "mentorado");
  return withEffect(finish(user, moveTo(user, "COMPLETED", now), [text(body)], counters, "reply"), { kind: "place", location });
}
