// Decisão (PURA) do registro de uma mentoria depois que o arquivo foi guardado:
// papel -> assunto -> data -> parceiro. Sem I/O: a busca do parceiro chega pronta em `ctx.partner`.
import { finish, moveTo, type Counters, type Decision, type UserState } from "../conversation/machine";
import { normalizeText } from "../conversation/normalize";
import { intentsOf } from "../conversation/synonyms";
import type { Reply } from "../conversation/texts";
import type { MentoriaDraft, MentoriaRole } from "../db/repo";
import { fallbackContent, type Content } from "../services/content";
import { MENU_BUTTON_ID, MENU_FALLBACKS, menuReply } from "../services/menu";
import { buildButtons } from "../whatsapp/builders";
import { typedOption } from "../whatsapp/choices";
import type { IncomingMessage } from "../whatsapp/types";
import { checkSubject, parseOccurredOn, yesterdayOf } from "./parse";
import {
  DATE_OTHER_ID, DATE_TODAY_ID, EARLY_NO_ID, EARLY_YES_ID, DATE_YESTERDAY_ID, MENTORIA_TEXTS as T, PARTNER_OTHER_ID, PARTNER_PICK_PREFIX,
  ROLE_MENTORADO_ID, ROLE_MENTOR_ID,
} from "./texts";

export const MENTORIA_STATES = ["MENT_ROLE", "MENT_SUBJECT", "MENT_DATE", "MENT_DATE_TEXT", "MENT_PARTNER", "MENT_EARLY_CONFIRM"] as const;
export const isMentoriaState = (s: string): boolean => (MENTORIA_STATES as readonly string[]).includes(s);

/** Resultado da busca do parceiro (feita pelo motor, com I/O, antes de chamar decideMentoria). */
export type PartnerResolution =
  /** `name` nulo = pessoa ainda sem cadastro (identificada só pelo número/contato). */
  | { kind: "partner"; hash: string; name: string | null }
  | { kind: "people"; people: { hash: string; name: string }[] }
  | { kind: "none" }
  | { kind: "toomany" }
  | { kind: "self" }
  | { kind: "other" };

export interface MentoriaContext {
  draft: MentoriaDraft;
  /** Data de hoje (YYYY-MM-DD) no fuso da conta. */
  today: string;
  partner?: PartnerResolution;
}

export type MentoriaEffect =
  | { kind: "role"; role: MentoriaRole }
  | { kind: "subject"; subject: string }
  | { kind: "date"; occurredOn: string }
  | { kind: "complete"; audioId: string; role: MentoriaRole; subject: string; occurredOn: string; partnerHash: string; partnerName: string | null }
  /** Áudio antes do horário e a pessoa confirmou que a mentoria já aconteceu: completa com os dados do match. */
  | { kind: "early_confirm"; audioId: string }
  | { kind: "cancel"; audioId: string | null };
export type MentoriaDecision = Decision & { effect?: MentoriaEffect };

const text = (body: string): Reply => ({ type: "text", text: { body } });
const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

export function roleQuestion(): Reply {
  return buildButtons(T.askRole, [
    { id: ROLE_MENTOR_ID, title: T.roleMentor }, { id: ROLE_MENTORADO_ID, title: T.roleMentorado },
  ]);
}
/** Resposta única ao áudio guardado: avisa que a mentoria foi registrada e já faz a primeira pergunta (R2: 1 resposta por entrada). */
export function audioSavedQuestion(): Reply {
  return buildButtons(T.askRoleAfterAudio, [
    { id: ROLE_MENTOR_ID, title: T.roleMentor }, { id: ROLE_MENTORADO_ID, title: T.roleMentorado },
  ]);
}
export function earlyQuestion(): Reply {
  return buildButtons(T.askEarly, [{ id: EARLY_YES_ID, title: T.earlyYes }, { id: EARLY_NO_ID, title: T.earlyNo }]);
}
export function savedFromMatchReply(c: Content = fallbackContent): Reply {
  return buildButtons(T.savedFromMatch, [{ id: MENU_BUTTON_ID, title: c.text("menuButtonLabel", MENU_FALLBACKS.menuButtonLabel, 20) }]);
}
export function dateQuestion(): Reply {
  return buildButtons(T.askDate, [
    { id: DATE_TODAY_ID, title: T.dateToday }, { id: DATE_YESTERDAY_ID, title: T.dateYesterday }, { id: DATE_OTHER_ID, title: T.dateOther },
  ]);
}
export function partnerPick(people: readonly { hash: string; name: string }[]): Reply {
  if (people.length === 1) {
    const p = people[0] as { hash: string; name: string };
    return buildButtons(`${T.pickOne}\n${p.name}`, [
      { id: `${PARTNER_PICK_PREFIX}${p.hash}`, title: "Sim, é essa pessoa" }, { id: PARTNER_OTHER_ID, title: T.pickOther },
    ]);
  }
  const list = people.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  const buttons = people.map((p) => ({ id: `${PARTNER_PICK_PREFIX}${p.hash}`, title: clip(p.name, 20) }));
  if (buttons.length < 3) buttons.push({ id: PARTNER_OTHER_ID, title: T.pickOther });
  return buttons.length > 0 ? buildButtons(`${T.pickMany}\n${list}`, buttons) : text(T.hintPartner);
}
export function savedReply(partnerName: string | null, c: Content = fallbackContent): Reply {
  return buildButtons(partnerName ? T.savedRegistered(partnerName) : T.savedUnregistered, [
    { id: MENU_BUTTON_ID, title: c.text("menuButtonLabel", MENU_FALLBACKS.menuButtonLabel, 20) },
  ]);
}

/** Mensagem ao retomar (depois do opt-out) um estado do registro de mentoria. */
export function mentoriaPrompt(state: string): Reply | undefined {
  switch (state) {
    case "MENT_ROLE": return roleQuestion();
    case "MENT_SUBJECT": return text(T.askSubject);
    case "MENT_DATE": return dateQuestion();
    case "MENT_DATE_TEXT": return text(T.askDateText);
    case "MENT_PARTNER": return text(T.askPartner);
    case "MENT_EARLY_CONFIRM": return earlyQuestion();
    default: return undefined;
  }
}

function roleFromText(raw: string): MentoriaRole | null {
  const t = normalizeText(raw);
  if (/^(fui |sou )?mentor$/.test(t)) return "mentor";
  if (/^(fui |sou )?mentorad[oa]$/.test(t)) return "mentorado";
  return null;
}

export function decideMentoria(
  user: UserState, input: IncomingMessage, counters: Counters, now: Date, content: Content, ctx: MentoriaContext,
): MentoriaDecision | null {
  if (!isMentoriaState(user.state)) return null;
  const intents = input.type === "text" ? intentsOf(input.body) : new Set<string>();
  if (input.type === "text" && intents.has("quit")) return null; // opt-out é da máquina principal

  const withEffect = (d: Decision, effect: MentoriaEffect): MentoriaDecision => (d.outcome === "limited" ? d : { ...d, effect });
  const silent = (): MentoriaDecision => ({ replies: [], nextState: user, outcome: "silent" });
  const hintOnce = (body: string): MentoriaDecision => {
    if (user.hintSentInState) return silent();
    return finish(user, { ...user, hintSentInState: true }, [text(body)], counters, "hint");
  };
  const go = (to: "MENT_SUBJECT" | "MENT_DATE" | "MENT_DATE_TEXT" | "MENT_PARTNER" | "AWAIT_AUDIO", reply: Reply): Decision =>
    finish(user, moveTo(user, to, now), [reply], counters, "reply");
  const d = ctx.draft;

  // "menu" cancela: o arquivo guardado e o rascunho são descartados.
  if ((input.type === "text" && intents.has("menu")) || (input.type === "button_reply" && input.id === MENU_BUTTON_ID)) {
    return withEffect(finish(user, moveTo(user, "MENU", now), [menuReply(content)], counters, "transition"), { kind: "cancel", audioId: d.audioId ?? null });
  }
  // Sem arquivo guardado (ex.: o cron descartou o fluxo abandonado): volta ao menu, sem inventar dados.
  if (!d.audioId) {
    if (input.type !== "text" && input.type !== "button_reply") return silent();
    return finish(user, moveTo(user, "MENU", now), [menuReply(content)], counters, "transition");
  }

  // Quem volta com um "oi" no meio do registro (ex.: no dia seguinte) vê a pergunta de novo, uma vez só (R2).
  if (input.type === "text" && intents.has("greeting")) {
    const prompt = mentoriaPrompt(user.state);
    if (!prompt || user.hintSentInState) return silent();
    return finish(user, { ...user, hintSentInState: true }, [prompt], counters, "hint");
  }

  // Número digitado ("1", "opção 2") vale pelos botões do ESTADO, mesmo sem opções pendentes (que expiram ou são apagadas).
  if (input.type === "text") {
    const options: { id: string; title: string }[] = user.state === "MENT_ROLE" ? [{ id: ROLE_MENTOR_ID, title: T.roleMentor }, { id: ROLE_MENTORADO_ID, title: T.roleMentorado }]
      : user.state === "MENT_DATE" ? [{ id: DATE_TODAY_ID, title: T.dateToday }, { id: DATE_YESTERDAY_ID, title: T.dateYesterday }, { id: DATE_OTHER_ID, title: T.dateOther }]
      : user.state === "MENT_EARLY_CONFIRM" ? [{ id: EARLY_YES_ID, title: T.earlyYes }, { id: EARLY_NO_ID, title: T.earlyNo }]
      : [];
    const hit = typedOption(input.body, options);
    if (hit) input = { wamid: input.wamid, from: input.from, ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}), type: "button_reply", id: hit.id, title: hit.title };
  }

  switch (user.state) {
    case "MENT_ROLE": {
      const role = input.type === "button_reply"
        ? (input.id === ROLE_MENTOR_ID ? "mentor" : input.id === ROLE_MENTORADO_ID ? "mentorado" : null)
        : input.type === "text" ? roleFromText(input.body) : null;
      if (!role) return input.type === "text" ? hintOnce(T.hintRole) : silent();
      return withEffect(go("MENT_SUBJECT", text(T.askSubject)), { kind: "role", role });
    }
    case "MENT_SUBJECT": {
      if (input.type !== "text") return silent();
      const s = checkSubject(input.body);
      if (!s.ok) return hintOnce(T.hintSubject);
      return withEffect(go("MENT_DATE", dateQuestion()), { kind: "subject", subject: s.value });
    }
    case "MENT_DATE":
    case "MENT_DATE_TEXT": {
      if (input.type === "button_reply" && input.id === DATE_OTHER_ID) {
        return user.state === "MENT_DATE" ? go("MENT_DATE_TEXT", text(T.askDateText)) : silent();
      }
      let date: string;
      if (input.type === "button_reply") {
        if (input.id === DATE_TODAY_ID) date = ctx.today;
        else if (input.id === DATE_YESTERDAY_ID) date = yesterdayOf(ctx.today);
        else return silent();
      } else if (input.type === "text") {
        const r = parseOccurredOn(input.body, ctx.today);
        if (!r.ok) return hintOnce(r.reason === "future" ? T.hintDateFuture : r.reason === "old" ? T.hintDateOld : T.hintDate);
        date = r.date;
      } else return silent();
      return withEffect(go("MENT_PARTNER", text(T.askPartner)), { kind: "date", occurredOn: date });
    }
    case "MENT_EARLY_CONFIRM": {
      const said = input.type === "button_reply"
        ? (input.id === EARLY_YES_ID ? "yes" : input.id === EARLY_NO_ID ? "no" : null)
        : input.type === "text" ? (intents.has("yes") ? "yes" : intents.has("no") ? "no" : null) : null;
      if (said === "yes") return withEffect(go("AWAIT_AUDIO", savedFromMatchReply(content)), { kind: "early_confirm", audioId: d.audioId });
      // Não: o áudio é ignorado e apagado (R6), sem perguntar mais nada.
      if (said === "no") return withEffect(go("AWAIT_AUDIO", text(T.earlyDiscarded)), { kind: "cancel", audioId: d.audioId });
      return input.type === "text" ? hintOnce(T.hintEarly) : silent();
    }
    case "MENT_PARTNER": {
      const p = ctx.partner;
      if (!p) return input.type === "text" ? hintOnce(T.hintPartner) : silent();
      switch (p.kind) {
        case "other": return finish(user, user, [text(T.askPartner)], counters, "reply");
        case "people": return finish(user, user, [partnerPick(p.people)], counters, "reply");
        case "none": return hintOnce(T.hintPartner);
        case "toomany": return hintOnce(T.hintPartnerMany);
        case "self": return hintOnce(T.hintPartnerSelf);
        case "partner": {
          if (!d.role || !d.subject || !d.occurredOn) {
            // Rascunho incompleto (não deveria acontecer): recomeça pelo papel, sem gravar nada.
            return finish(user, moveTo(user, "MENT_ROLE", now), [roleQuestion()], counters, "reply");
          }
          return withEffect(
            go("AWAIT_AUDIO", savedReply(p.name, content)),
            { kind: "complete", audioId: d.audioId, role: d.role, subject: d.subject, occurredOn: d.occurredOn, partnerHash: p.hash, partnerName: p.name },
          );
        }
      }
    }
  }
  return null;
}
