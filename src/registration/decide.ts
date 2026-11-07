// Decisão do cadastro (PURA, sem I/O). Cuida dos estados NEW (saudação), AWAIT_REGISTRATION,
// REG_CONSENT e REG_FIELD_*. Qualquer outra coisa devolve null e o motor usa `decide` normal.
import {
  finish, moveTo, type Counters, type Decision, type State, type UserState,
} from "../conversation/machine";
import { intentsOf, type Intent } from "../conversation/synonyms";
import type { Reply } from "../conversation/texts";
import type { IncomingMessage } from "../whatsapp/types";
import { FIELDS } from "./fields";
import {
  confirmationAndMenu, consentWelcomeReply, fieldPromptReply, flowWelcomeReply, welcomeBackMenu,
} from "./replies";
import { CONSENT_BUTTON_ID, REG_TEXTS } from "./texts";

export interface RegistrationContext {
  flowId?: string;
  privacyUrl: string;
  /** Já tem cadastro completo (registered_at preenchido). */
  registered: boolean;
  /** Já existe consent_at gravado (não regrava). */
  hasConsent: boolean;
}

/** Efeito a executar (com I/O) pelo motor quando a transição for confirmada. */
export type RegistrationEffect =
  | { kind: "consent" }
  | { kind: "field"; key: string; value: string }
  /** Cadastro completo: `values` contém os campos que ainda faltam gravar. */
  | { kind: "complete"; values: Record<string, string>; withConsent: boolean };

export type RegDecision = Decision & { effect?: RegistrationEffect };

export const fieldState = (key: string): State => `REG_FIELD_${key}`;
const fieldIndex = (state: string): number =>
  state.startsWith("REG_FIELD_") ? FIELDS.findIndex((f) => f.key === state.slice("REG_FIELD_".length)) : -1;

export function isRegistrationState(state: string): boolean {
  return state === "AWAIT_REGISTRATION" || state === "REG_CONSENT" || state.startsWith("REG_FIELD_");
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
  if (state === "AWAIT_REGISTRATION" && ctx.flowId) return flowWelcomeReply(ctx.flowId);
  if (state === "AWAIT_REGISTRATION" || state === "REG_CONSENT") return consentWelcomeReply(ctx.privacyUrl);
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
  const silent = (): RegDecision => ({ replies: [], nextState: user, outcome: "silent" });
  const intents: Set<Intent> = input.type === "text" ? intentsOf(input.body) : new Set<Intent>();
  if (input.type === "text" && intents.has("quit")) return null; // opt-out é da máquina principal

  const withEffect = (d: Decision, effect: RegistrationEffect): RegDecision =>
    d.outcome === "limited" ? d : { ...d, effect };

  // ---- NEW: só a saudação inicia o cadastro (ou leva direto ao menu quem já é cadastrado) ----
  if (user.state === "NEW") {
    if (!(input.type === "text" && intents.has("greeting"))) return null;
    if (ctx.registered) return finish(user, moveTo(user, "MENU", now), [welcomeBackMenu()], counters, "reply");
    if (ctx.flowId) {
      return finish(user, moveTo(user, "AWAIT_REGISTRATION", now), [flowWelcomeReply(ctx.flowId)], counters, "reply");
    }
    return finish(user, moveTo(user, "REG_CONSENT", now), [consentWelcomeReply(ctx.privacyUrl)], counters, "reply");
  }

  if (!isRegistrationState(user.state)) return null;

  // Flow desligado depois das boas-vindas: AWAIT_REGISTRATION passa a valer como o consentimento do fallback.
  if (user.state === "AWAIT_REGISTRATION" && !ctx.flowId) {
    return decideRegistration({ ...user, state: "REG_CONSENT" }, input, counters, now, ctx);
  }

  if (user.state === "AWAIT_REGISTRATION") {
    if (input.type === "nfm_reply") {
      const parsed = parseFlowResponse(input.responseJson);
      if (!parsed.ok) return hintOnce(user, REG_TEXTS.hintFlowInvalid, counters);
      return withEffect(
        finish(user, moveTo(user, "MENU", now), [confirmationAndMenu()], counters, "reply"),
        { kind: "complete", values: parsed.values, withConsent: !ctx.hasConsent },
      );
    }
    if (input.type !== "text") return silent();
    if (intents.has("greeting")) return silent(); // boas-vindas já enviadas
    return hintOnce(user, REG_TEXTS.hintFlow, counters);
  }

  // ---- fallback: consentimento ----
  if (user.state === "REG_CONSENT") {
    const accepted =
      (input.type === "button_reply" && input.id === CONSENT_BUTTON_ID) ||
      (input.type === "text" && intents.has("yes"));
    if (accepted) {
      const first = FIELDS[0];
      if (!first) return null;
      // Sem resposta: a pergunta do primeiro campo já foi na mensagem de boas-vindas (economiza 1 mensagem).
      return withEffect(
        finish(user, moveTo(user, fieldState(first.key), now), [], counters, "transition"),
        { kind: "consent" },
      );
    }
    if (input.type !== "text") return silent();
    if (intents.has("greeting") || intents.has("no")) return silent();
    return hintOnce(user, REG_TEXTS.hintConsent, counters);
  }

  // ---- fallback: um campo por vez ----
  const i = fieldIndex(user.state);
  const field = FIELDS[i];
  if (!field) return null;
  if (input.type !== "text") return silent();
  const value = field.validate(input.body);
  if (value === null) return hintOnce(user, field.hint, counters);
  const next = FIELDS[i + 1];
  if (next) {
    return withEffect(
      finish(user, moveTo(user, fieldState(next.key), now), [fieldPromptReply(i + 1)], counters, "reply"),
      { kind: "field", key: field.key, value },
    );
  }
  return withEffect(
    finish(user, moveTo(user, "MENU", now), [confirmationAndMenu()], counters, "reply"),
    { kind: "complete", values: { [field.key]: value }, withConsent: false },
  );
}
