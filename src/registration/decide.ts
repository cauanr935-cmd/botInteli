// Decisão do cadastro (PURA, sem I/O). Cuida dos estados NEW (saudação), AWAIT_REGISTRATION,
// REG_CONSENT e REG_FIELD_*. Qualquer outra coisa devolve null e o motor usa `decide` normal.
import {
  finish, limited, moveTo, type Counters, type Decision, type State, type UserState,
} from "../conversation/machine";
import { intentsOf, type Intent } from "../conversation/synonyms";
import type { Reply } from "../conversation/texts";
import type { IncomingMessage } from "../whatsapp/types";
import { FIELDS } from "./fields";
import { returningChoiceReply, roleReply } from "../profile/decide";
import { consentWelcomeReply, fieldPromptReply, nameConfirmReply, profileAudioPrompt } from "./replies";
import { fallbackContent, type Content } from "../services/content";
import { ageVerdict, MAX_AGE, MIN_AGE, parseAge } from "./age";
import { looksHeavyName, looksStrangeName, readNameAnswer } from "./strange-name";
import { CONSENT_BUTTON_ID, NAME_NO_ID, NAME_YES_ID, REG_TEXTS } from "./texts";

export interface RegistrationContext {
  flowId?: string;
  privacyUrl: string;
  /** Já tem cadastro completo (registered_at preenchido). */
  registered: boolean;
  /** Já existe consent_at gravado (não regrava). */
  hasConsent: boolean;
  /**
   * Parecer da IA sobre o nome digitado nesta mensagem: "suspicious" = alta chance de ser falso (apelido, objeto,
   * personagem...). Ausente = IA não consultada/sem certeza (vale só a regra do bot: nome de uma palavra só é confirmado).
   */
  nameCheck?: "real" | "suspicious";
  /** Textos e serviços do banco (com fallback). Ausente = só os textos do código. */
  content?: Content;
}

/** Efeito a executar (com I/O) pelo motor quando a transição for confirmada. */
export type RegistrationEffect =
  | { kind: "consent" }
  | { kind: "field"; key: string; value: string }
  | { kind: "profile"; values: Record<string, string>; withConsent: boolean }
  /** Curiosidades escritas no lugar do áudio de perfil. */
  | { kind: "about"; text: string }
  /** Cadastro completo: `values` contém os campos que ainda faltam gravar. */
  | { kind: "complete"; values: Record<string, string>; withConsent: boolean };

export type RegDecision = Decision & { effect?: RegistrationEffect };

/** Curiosidades escritas: de 10 a 1000 caracteres, com letras, e que não seja só um comando ("oi", "menu"...). */
export function validAbout(raw: string): string | null {
  const v = raw.replace(/\s+/g, " ").trim();
  if (v.length < 10 || v.length > 1000 || !/\p{L}/u.test(v) || intentsOf(v).size > 0) return null;
  return v;
}

/** Só a data de nascimento ("12/05/2003", "nasci em 12 de maio de 2003"): é uma resposta esperada, mas falta contar mais. */
const DATE_WORDS = new Set(["nasci", "em", "dia", "de", "do", "no", "meu", "minha", "aniversario", "data", "nascimento", "e", "eh", "a", "o", "dos", "da",
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]);
/** Prefixo da data de nascimento guardada sozinha; o motor junta o resto das curiosidades a ela. */
export const BIRTH_PREFIX = "Data de nascimento: ";
export function isBirthDateOnly(raw: string): boolean {
  const v = raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9/.\-\s]/g, " ");
  const left = v.split(/\s+/).filter((w) => w !== "" && !DATE_WORDS.has(w));
  return /\d{2,4}/.test(v) && (v.match(/\d/g) ?? []).length >= 4 && left.every((w) => /^[\d/.-]+$/.test(w));
}

/** Marca em lastServiceId: a pessoa disse que o nome estava errado e já corrigiu uma vez. */
const NAME_RETRY = "name_retry";
export const fieldState = (key: string): State => `REG_FIELD_${key}`;
const fieldIndex = (state: string): number =>
  state.startsWith("REG_FIELD_") ? FIELDS.findIndex((f) => f.key === state.slice("REG_FIELD_".length)) : -1;

export function isRegistrationState(state: string): boolean {
  return state === "AWAIT_REGISTRATION" || state === "REG_CONSENT" || state === "REG_NAME_CONFIRM" || state === "REG_AGE" || state === "REG_PROFILE_AUDIO" || state.startsWith("REG_FIELD_");
}

/** Resultado da leitura do formulário (nfm_reply). */
export type FlowParse = { ok: true; values: Record<string, string> } | { ok: false };

/** Valida o response_json do Flow: aceite obrigatório + todos os campos válidos. Nada parcial. */
export function parseFlowResponse(responseJson: string): FlowParse {
  let data: unknown;
  try {
    data = JSON.parse(responseJson);
  } catch {
    return { ok: false };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false };
  const o = data as Record<string, unknown>;
  if (!(o.consent === true || o.consent === "true")) return { ok: false };
  const values: Record<string, string> = {};
  for (const f of FIELDS) {
    const raw = o[f.key];
    if (typeof raw !== "string") return { ok: false };
    const v = f.validate(raw);
    if (v === null) return { ok: false };
    values[f.key] = v;
  }
  return { ok: true, values };
}

/** Mensagem ao retomar (depois do opt-out) um estado de cadastro. */
export function registrationPrompt(state: State, ctx: RegistrationContext): Reply | undefined {
  const c = ctx.content ?? fallbackContent;
  if (state === "AWAIT_REGISTRATION" || state === "REG_CONSENT") return consentWelcomeReply(ctx.privacyUrl, c);
  if (state === "REG_NAME_CONFIRM") return nameConfirmReply(null, c);
  if (state === "REG_AGE") return { type: "text", text: { body: REG_TEXTS.askAge } };
  if (state === "REG_PROFILE_AUDIO") return profileAudioPrompt();
  const i = fieldIndex(state);
  return i >= 0 ? fieldPromptReply(i) : undefined;
}

/** Dica única: 1 por estado, depois silêncio. */
function hintOnce(user: UserState, text: string, counters: Counters): RegDecision {
  if (user.hintSentInState) return { replies: [], nextState: user, outcome: "silent" };
  const reply: Reply = { type: "text", text: { body: text } };
  return finish(user, { ...user, hintSentInState: true }, [reply], counters, "hint");
}

export function decideRegistration(
  user: UserState, input: IncomingMessage, counters: Counters, now: Date, ctx: RegistrationContext,
): RegDecision | null {
  const c = ctx.content ?? fallbackContent;
  const hintText = (key: keyof typeof REG_TEXTS): string => c.text(key, REG_TEXTS[key]);
  const silent = (): RegDecision => ({ replies: [], nextState: user, outcome: "silent" });
  const intents: Set<Intent> = input.type === "text" ? intentsOf(input.body) : new Set<Intent>();
  if (input.type === "text" && intents.has("quit")) return null; // opt-out é da máquina principal

  const withEffect = (d: Decision, effect: RegistrationEffect): RegDecision =>
    d.outcome === "limited" ? d : { ...d, effect };

  // ---- NEW: QUALQUER mensagem de texto inicia o cadastro, com a mesma primeira resposta (termo + Aceito) ----
  // Quem já é cadastrado recebe "O que você quer fazer agora?" (tirar dúvida, mudar áreas ou menu).
  if (user.state === "NEW") {
    if (input.type !== "text") return null;
    if (ctx.registered) return finish(user, moveTo(user, "RETURNING_CHOICE", now), [returningChoiceReply(c)], counters, "reply");
    return finish(user, moveTo(user, "REG_CONSENT", now), [consentWelcomeReply(ctx.privacyUrl, c)], counters, "reply");
  }

  if (!isRegistrationState(user.state)) return null;

  // Estado legado (formulário Flow): vale como o consentimento por botão.
  if (user.state === "AWAIT_REGISTRATION") {
    return decideRegistration({ ...user, state: "REG_CONSENT" }, input, counters, now, ctx);
  }

  // ---- consentimento (política de privacidade) ----
  if (user.state === "REG_CONSENT") {
    const accepted =
      (input.type === "button_reply" && input.id === CONSENT_BUTTON_ID) ||
      (input.type === "text" && intents.has("yes"));
    if (accepted) {
      const first = FIELDS[0];
      if (!first) return null;
      return withEffect(
        finish(user, moveTo(user, fieldState(first.key), now), [fieldPromptReply(0)], counters, "reply"),
        { kind: "consent" },
      );
    }
    if (input.type !== "text") return silent();
    if (intents.has("greeting") || intents.has("no")) return silent();
    return hintOnce(user, hintText("hintConsent"), counters);
  }

  // ---- confirmação do nome (suspeito de ser falso): Sim segue; Não pede o nome de novo ----
  if (user.state === "REG_NAME_CONFIRM") {
    const said = input.type === "text" ? readNameAnswer(input.body) : null;
    const yes = (input.type === "button_reply" && input.id === NAME_YES_ID) || (input.type === "text" && (intents.has("yes") || said === "yes"));
    const no = (input.type === "button_reply" && input.id === NAME_NO_ID) || (input.type === "text" && (intents.has("no") || said === "no"));
    const nameIdx = FIELDS.findIndex((f) => f.key === "full_name");
    if (yes) {
      const next = FIELDS[nameIdx + 1];
      if (!next) return null;
      return finish(user, moveTo(user, fieldState(next.key), now), [fieldPromptReply(nameIdx + 1)], counters, "reply");
    }
    if (no) {
      // Marca a segunda tentativa: se o nome vier estranho de novo, o fluxo segue sem perguntar outra vez.
      const d = finish(
        user, moveTo(user, fieldState("full_name"), now),
        [{ type: "text", text: { body: c.text("askNameAgain", REG_TEXTS.askNameAgain) } }], counters, "reply",
      );
      return d.outcome === "limited" ? d : { ...d, nextState: { ...d.nextState, lastServiceId: NAME_RETRY } };
    }
    if (input.type !== "text") return silent();
    if (intents.has("greeting")) return silent();
    return hintOnce(user, hintText("hintNameConfirm"), counters);
  }

  // ---- idade (17 a 25): não é gravada; só decide se o cadastro segue ----
  if (user.state === "REG_AGE") {
    if (input.type !== "text") return silent();
    if (intents.has("greeting")) return silent();
    const age = parseAge(input.body, now);
    if (age === null) return hintOnce(user, hintText("hintAge"), counters);
    const verdict = ageVerdict(age);
    if (verdict === "ok") {
      return finish(user, moveTo(user, "REG_PROFILE_AUDIO", now), [profileAudioPrompt()], counters, "reply");
    }
    const body = verdict === "liar26" ? hintText("ageLiar26")
      : (verdict === "young" ? hintText("ageYoung") : hintText("ageOld")).replace("{min}", String(MIN_AGE)).replace("{max}", String(MAX_AGE));
    return finish(user, { ...user }, [{ type: "text", text: { body } }], counters, "reply");
  }

  // ---- curiosidades: áudio OU texto (quem prefere escrever). Texto curto ou inválido recebe 1 dica (R2) ----
  if (user.state === "REG_PROFILE_AUDIO") {
    if (input.type === "text") {
      // Só a data de nascimento: agradece e pede o resto (resposta esperada, então não é "não entendi" nem fica sem retorno).
      // A data fica guardada e a próxima mensagem se junta a ela (ver "about" no motor).
      if (isBirthDateOnly(input.body)) {
        return withEffect(finish(user, { ...user }, [{ type: "text", text: { body: hintText("aboutNeedMore") } }], counters, "reply"),
          { kind: "about", text: `${BIRTH_PREFIX}${input.body.replace(/\s+/g, " ").trim().slice(0, 100)}` });
      }
      const about = validAbout(input.body);
      if (about === null) return hintOnce(user, hintText("hintProfileAudio"), counters);
      return withEffect(
        finish(user, moveTo(user, "PROFILE_ROLE", now), [roleReply(c)], counters, "reply"),
        { kind: "about", text: about },
      );
    }
    if (input.type !== "audio") return silent();
    // Sem vaga de mensagem para responder, nem processa (como em AWAIT_AUDIO).
    if (limited(counters)) return { replies: [], nextState: user, outcome: "limited" };
    // O pipeline guarda o áudio e responde com a pergunta de papel.
    return finish(user, moveTo(user, "PROCESSING_AUDIO", now), [], counters, "transition");
  }

  // ---- fallback: um campo por vez ----
  const i = fieldIndex(user.state);
  const field = FIELDS[i];
  if (!field) return null;
  if (input.type !== "text") return silent();
  const value = field.validate(input.body);
  if (value === null) return hintOnce(user, field.hint, counters);
  // Nome malicioso ou de peso (crime, ódio, ditadores): não grava e pede o nome de verdade.
  if (field.key === "full_name" && looksHeavyName(value)) {
    return finish(user, { ...user }, [{ type: "text", text: { body: hintText("nameBlocked") } }], counters, "reply");
  }
  // Nome com alta chance de ser falso (a IA achou, ou é uma palavra só): pergunta se é mesmo o nome. O valor já fica
  // gravado; "Não" pede o nome de novo (e regrava), "Sim" segue.
  const retry = user.lastServiceId === NAME_RETRY;
  if (field.key === "full_name" && !retry && (ctx.nameCheck === "suspicious" || value.split(" ").length < 2 || looksStrangeName(value))) {
    return withEffect(
      finish(user, moveTo(user, "REG_NAME_CONFIRM", now), [nameConfirmReply(value, c)], counters, "reply"),
      { kind: "field", key: field.key, value },
    );
  }
  const next = FIELDS[i + 1];
  if (next) {
    return withEffect(
      finish(user, moveTo(user, fieldState(next.key), now), [fieldPromptReply(i + 1)], counters, "reply"),
      { kind: "field", key: field.key, value },
    );
  }
  return withEffect(
    finish(user, moveTo(user, "REG_AGE", now), [{ type: "text", text: { body: hintText("askAge") } }], counters, "reply"),
    { kind: "field", key: field.key, value },
  );
}
