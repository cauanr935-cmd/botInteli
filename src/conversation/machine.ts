// Máquina de estados declarativa + decide() PURA.
// Sem I/O: nada de rede, banco, relógio global ou aleatoriedade (o horário chega por parâmetro).
import type { IncomingMessage } from "../whatsapp/types";
import { intentsOf, type Intent } from "./synonyms";
import { REPLIES, type Reply } from "./texts";

export type State =
  | "NEW"
  | "AWAIT_REGISTRATION"
  | "REG_CONSENT"
  | `REG_FIELD_${string}`
  | "MENU"
  | "AWAIT_AUDIO"
  | "PROCESSING_AUDIO"
  | "OPTED_OUT";

export interface UserState {
  state: State;
  /** Estado de onde a pessoa saiu ao pedir opt-out (para o "voltar"). */
  previousState: State | null;
  /** Já mandamos a dica única neste estado? Zera ao mudar de estado. */
  hintSentInState: boolean;
  optedOutAt: Date | null;
}

export interface Counters {
  /** Mensagens do bot para a pessoa nos últimos 10 minutos. */
  sentLast10Min: number;
  /** Mensagens do bot para a pessoa nas últimas 24h. */
  sentLastDay: number;
  maxPer10Min: number;
  maxPerDay: number;
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
  reply?: Reply;
}

interface StateDef {
  transitions: Transition[];
  /** Intenções reconhecidas mas ignoradas em silêncio (não gastam a dica). */
  ignore?: Intent[];
  /** Dica única (reapresenta as opções do estado). Sem ela, o estado nunca manda dica. */
  hint?: Reply;
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
    // Escolha de serviço (list_reply) é da Etapa 5.
    transitions: [],
    hint: REPLIES.hintMenu,
  },
  AWAIT_AUDIO: {
    transitions: [
      { on: { kind: "text", intent: "menu" }, to: "MENU", reply: REPLIES.menu },
      { on: { kind: "button_reply", id: "menu" }, to: "MENU", reply: REPLIES.menu },
      { on: { kind: "audio" }, to: "PROCESSING_AUDIO" }, // resposta vem do pipeline (Etapa 6)
    ],
    hint: REPLIES.hintAudio,
  },
  PROCESSING_AUDIO: { transitions: [] },
  OPTED_OUT: { transitions: [] }, // tratado à parte: só "voltar"
};

/** Mensagem ao retomar um estado (reapresenta as opções dele). */
function promptFor(state: State): Reply | undefined {
  switch (state) {
    case "NEW": return REPLIES.resumeNew;
    case "AWAIT_REGISTRATION": return REPLIES.welcome;
    case "MENU": return REPLIES.menu;
    case "AWAIT_AUDIO": return REPLIES.audioInstruction;
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

function moveTo(cur: UserState, to: State, now: Date, previous: State | null = null): UserState {
  if (to === cur.state) return cur;
  return {
    state: to,
    previousState: to === "OPTED_OUT" ? previous : null,
    hintSentInState: false,
    optedOutAt: to === "OPTED_OUT" ? now : null,
  };
}

function limited(c: Counters): boolean {
  return c.sentLast10Min >= c.maxPer10Min || c.sentLastDay >= c.maxPerDay;
}

/** Aplica o limite de mensagens: sem vaga, silêncio. Opt-out é sempre honrado (só a confirmação é muda). */
function finish(cur: UserState, next: UserState, replies: Reply[], c: Counters, outcome: Decision["outcome"]): Decision {
  if (replies.length > 0 && limited(c)) {
    const honor = next.state === "OPTED_OUT" && cur.state !== "OPTED_OUT";
    return { replies: [], nextState: honor ? next : cur, outcome: "limited" };
  }
  return { replies: replies.slice(0, 1), nextState: next, outcome };
}

/** Decide a resposta (no máximo 1) e o próximo estado. Sem I/O. */
export function decide(user: UserState, input: IncomingMessage, counters: Counters, now: Date): Decision {
  const silent = (): Decision => ({ replies: [], nextState: user, outcome: "silent" });
  const intents = input.type === "text" ? intentsOf(input.body) : new Set<Intent>();

  // Opt-out: só "voltar" é aceito.
  if (user.state === "OPTED_OUT") {
    if (input.type === "text" && intents.has("resume")) {
      const back: State = user.previousState ?? "NEW";
      const next = { ...moveTo(user, back, now), previousState: null };
      return finish(user, next, [promptFor(back)].filter((r): r is Reply => !!r), counters, "transition");
    }
    return silent();
  }

  // "sair" vale em qualquer estado.
  if (input.type === "text" && intents.has("quit")) {
    return finish(user, moveTo(user, "OPTED_OUT", now, user.state), [REPLIES.optOutConfirm], counters, "transition");
  }

  const def = STATES[user.state];
  if (!def) return silent();

  const t = def.transitions.find((tr) => matches(tr.on, input, intents));
  if (t) {
    return finish(user, moveTo(user, t.to, now), t.reply ? [t.reply] : [], counters, t.reply ? "reply" : "transition");
  }

  // Só texto não reconhecido merece dica; qualquer outro tipo = silêncio total.
  if (input.type !== "text") return silent();
  if (def.ignore?.some((i) => intents.has(i))) return silent();
  if (!def.hint || user.hintSentInState) return silent();
  return finish(user, { ...user, hintSentInState: true }, [def.hint], counters, "hint");
}
