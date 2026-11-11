// Máquina de estados declarativa + decide() PURA.
// Sem I/O: nada de rede, banco, relógio global ou aleatoriedade (o horário chega por parâmetro).
import type { IncomingMessage } from "../whatsapp/types";
import { intentsOf, type Intent } from "./synonyms";
import { fallbackContent, type Content } from "../services/content";
import { findService, MENU_BUTTON_ID, menuReply, serviceAnswerReply } from "../services/menu";
import { REPLIES, type Reply, type ReplyFn } from "./texts";

/** Sem mensagem do bot há mais que isto, um "oi" em MENU/AWAIT_AUDIO reabre o menu (sessão antiga). */
export const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;

export type State =
  | "NEW"
  | "AWAIT_REGISTRATION"
  | "REG_CONSENT"
  | "REG_NAME_CONFIRM"
  | "REG_PROFILE_AUDIO"
  | `REG_FIELD_${string}`
  | "MENU"
  | "AVAILABILITY_TEXT"
  | `SCHED_DAYS_${string}`
  | `SCHED_HOURS_${string}`
  | "AWAIT_AUDIO"
  | "PROCESSING_AUDIO"
  | "PROFILE_ROLE"
  | "MENTOR_CATEGORIES"
  | "MENTOR_CATEGORIES_BOTH"
  | "RETURNING_CHOICE"
  | "DOUBT_ASK"
  | "DOUBT_TEXT"
  | "COMPLETED"
  | "OPTED_OUT";

export interface UserState {
  state: State;
  /** Estado de onde a pessoa saiu ao pedir opt-out (para o "voltar"). */
  previousState: State | null;
  /** Já mandamos a dica única neste estado? Zera ao mudar de estado. */
  hintSentInState: boolean;
  optedOutAt: Date | null;
  /** Último serviço sem áudio respondido; repetir a mesma linha = silêncio (R2). Zera ao reabrir o menu/mudar de estado. */
  lastServiceId?: string | null;
}

export interface Counters {
  /** Mensagens do bot para a pessoa nos últimos 10 minutos. */
  sentLast10Min: number;
  /** Mensagens do bot para a pessoa nas últimas 24h. */
  sentLastDay: number;
  maxPer10Min: number;
  maxPerDay: number;
  /**
   * Instante da última mensagem do bot para a pessoa (null = nenhuma nas últimas 24h).
   * Ausente (undefined) = não informado: nunca considera a sessão antiga.
   */
  lastBotMsgAt?: Date | null;
}

export type Decision = {
  replies: Reply[];
  nextState: UserState;
  /** Motivo (para log/teste): resposta, dica, silêncio por regra ou por limite. */
  outcome: "reply" | "transition" | "hint" | "silent" | "limited";
};

type Matcher =
  | { kind: "text"; intent: Intent }
  | { kind: "nfm_reply" }
  | { kind: "audio" }
  | { kind: "button_reply" | "list_reply"; id: string };

interface Transition {
  on: Matcher;
  to: State;
  reply?: ReplyFn;
}

interface StateDef {
  transitions: Transition[];
  /** Intenções reconhecidas mas ignoradas em silêncio (não gastam a dica). */
  ignore?: Intent[];
  /** Dica única (reapresenta as opções do estado). Sem ela, o estado nunca manda dica. */
  hint?: ReplyFn;
}

/** Tabela de estados. Etapas 4 a 6 acrescentam transições aqui. */
export const STATES: Record<string, StateDef> = {
  NEW: {
    transitions: [{ on: { kind: "text", intent: "greeting" }, to: "AWAIT_REGISTRATION", reply: REPLIES.welcome }],
    hint: REPLIES.hintNew,
  },
  AWAIT_REGISTRATION: {
    // A validação do formulário é da Etapa 4; aqui só a forma da transição.
    transitions: [{ on: { kind: "nfm_reply" }, to: "MENU", reply: REPLIES.registrationDone }],
    ignore: ["greeting"], // boas-vindas já enviadas: repetição = silêncio
    hint: REPLIES.hintRegistration,
  },
  MENU: {
    // A escolha na lista (list_reply) é tratada em decide(), pois os serviços vêm do banco.
    transitions: [
      { on: { kind: "text", intent: "menu" }, to: "MENU", reply: REPLIES.menu },
      { on: { kind: "button_reply", id: MENU_BUTTON_ID }, to: "MENU", reply: REPLIES.menu },
    ],
    hint: REPLIES.hintMenu,
  },
  AWAIT_AUDIO: {
    transitions: [
      { on: { kind: "text", intent: "menu" }, to: "MENU", reply: REPLIES.menu },
      { on: { kind: "button_reply", id: MENU_BUTTON_ID }, to: "MENU", reply: REPLIES.menu },
      { on: { kind: "audio" }, to: "PROCESSING_AUDIO" }, // resposta vem do pipeline (Etapa 6)
    ],
    hint: REPLIES.hintAudio,
  },
  PROCESSING_AUDIO: { transitions: [] },
  COMPLETED: {
    transitions: [{ on: { kind: "text", intent: "menu" }, to: "MENU", reply: REPLIES.menu }],
  },
  OPTED_OUT: { transitions: [] }, // tratado à parte: só "voltar"
};

/** Mensagem ao retomar um estado (reapresenta as opções dele). */
function promptFor(state: State): ReplyFn | undefined {
  switch (state) {
    case "NEW": return REPLIES.resumeNew;
    case "AWAIT_REGISTRATION": return REPLIES.welcome;
    case "MENU": return REPLIES.menu;
    case "AWAIT_AUDIO": return REPLIES.audioInstruction;
    case "AVAILABILITY_TEXT": return REPLIES.askAvailability;
    default: return STATES[state]?.hint;
  }
}

function matches(m: Matcher, msg: IncomingMessage, intents: Set<Intent>): boolean {
  switch (m.kind) {
    case "text": return msg.type === "text" && intents.has(m.intent);
    case "nfm_reply": return msg.type === "nfm_reply";
    case "audio": return msg.type === "audio";
    case "button_reply": return msg.type === "button_reply" && msg.id === m.id;
    case "list_reply": return msg.type === "list_reply" && msg.id === m.id;
  }
}

/** Remove a marca do último serviço respondido (menu reaberto = nova rodada). */
function clearService(u: UserState): UserState {
  const rest: UserState = { ...u };
  delete rest.lastServiceId;
  return rest;
}

export function moveTo(cur: UserState, to: State, now: Date, previous: State | null = null): UserState {
  if (to === cur.state) return cur;
  return {
    state: to,
    previousState: to === "OPTED_OUT" ? previous : null,
    hintSentInState: false,
    optedOutAt: to === "OPTED_OUT" ? now : null,
  };
}

export function limited(c: Counters): boolean {
  return c.sentLast10Min >= c.maxPer10Min || c.sentLastDay >= c.maxPerDay;
}

/** Aplica o limite de mensagens: sem vaga, silêncio. Opt-out é sempre honrado (só a confirmação é muda). */
export function finish(cur: UserState, next: UserState, replies: Reply[], c: Counters, outcome: Decision["outcome"]): Decision {
  if (replies.length > 0 && limited(c)) {
    const honor = next.state === "OPTED_OUT" && cur.state !== "OPTED_OUT";
    return { replies: [], nextState: honor ? next : cur, outcome: "limited" };
  }
  return { replies: replies.slice(0, 1), nextState: next, outcome };
}

/** Decide a resposta (no máximo 1) e o próximo estado. Sem I/O. */
export function decide(
  user: UserState, input: IncomingMessage, counters: Counters, now: Date, content: Content = fallbackContent,
): Decision {
  const silent = (): Decision => ({ replies: [], nextState: user, outcome: "silent" });
  const intents = input.type === "text" ? intentsOf(input.body) : new Set<Intent>();

  // Opt-out: só "voltar" é aceito.
  if (user.state === "OPTED_OUT") {
    if (input.type === "text" && intents.has("resume")) {
      const back: State = user.previousState ?? "NEW";
      const next = { ...moveTo(user, back, now), previousState: null };
      return finish(user, next, [promptFor(back)].flatMap((r) => (r ? [r(content)] : [])), counters, "transition");
    }
    return silent();
  }

  // "sair" vale em qualquer estado.
  if (input.type === "text" && intents.has("quit")) {
    return finish(user, moveTo(user, "OPTED_OUT", now, user.state), [REPLIES.optOutConfirm(content)], counters, "transition");
  }

  const def = STATES[user.state];
  if (!def) return silent();

  // Quem já está cadastrado e manda "oi" (sessão antiga OU a pessoa quer registrar outra mentoria) recebe o menu
  // em 1 mensagem. Depois disso, novos "oi" no mesmo estado ficam em silêncio (R2): hintSentInState marca "já respondi".
  if (
    (user.state === "MENU" || user.state === "AWAIT_AUDIO") &&
    input.type === "text" && intents.has("greeting")
  ) {
    const idle =
      counters.lastBotMsgAt !== undefined &&
      (counters.lastBotMsgAt === null || now.getTime() - counters.lastBotMsgAt.getTime() > SESSION_IDLE_MS);
    // Em MENU o menu já está na tela: só reenvia se a sessão for antiga. Em AWAIT_AUDIO (onde a pessoa fica depois de
    // registrar uma mentoria) o "oi" reabre o menu uma vez, para ela poder registrar outra.
    if (idle || (user.state === "AWAIT_AUDIO" && !user.hintSentInState)) {
      const intro = content.text("welcomeBack", "Que bom ver você de novo! Escolha um serviço na lista.");
      const next = { ...clearService(moveTo(user, "MENU", now)), hintSentInState: true };
      return finish(user, next, [menuReply(content, intro)], counters, "reply");
    }
    return silent();
  }

  // Escolha na lista do menu: serviço com áudio -> instrução (AWAIT_AUDIO); sem áudio -> resposta pronta.
  if (user.state === "MENU" && input.type === "list_reply") {
    const svc = findService(content, input.id);
    if (!svc) return silent(); // linha desconhecida/inativa: silêncio
    if (svc.requiresAudio) {
      return finish(user, moveTo(user, "AWAIT_AUDIO", now), [REPLIES.audioInstruction(content)], counters, "reply");
    }
    if (user.lastServiceId === svc.id) return silent(); // mesma escolha de novo: sem resposta (R2)
    return finish(user, { ...user, lastServiceId: svc.id }, [serviceAnswerReply(content, svc)], counters, "reply");
  }

  const t = def.transitions.find((tr) => matches(tr.on, input, intents));
  if (t) {
    // Áudio com a pessoa no limite: o resultado não poderia ser entregue, então nem processa (estado não avança).
    if (t.on.kind === "audio" && limited(counters)) return { replies: [], nextState: user, outcome: "limited" };
    return finish(user, clearService(moveTo(user, t.to, now)), t.reply ? [t.reply(content)] : [], counters, t.reply ? "reply" : "transition");
  }

  // Só texto não reconhecido merece dica; qualquer outro tipo = silêncio total.
  if (input.type !== "text") return silent();
  if (def.ignore?.some((i) => intents.has(i))) return silent();
  if (!def.hint || user.hintSentInState) return silent();
  return finish(user, { ...user, hintSentInState: true }, [def.hint(content)], counters, "hint");
}
