// Integração (com I/O): webhook -> decide -> sendGuarded. A lógica de decisão fica em machine.ts.
import type { Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import type { OutboundMessage, SendResult } from "../whatsapp/client";
import type { IncomingMessage } from "../whatsapp/types";
import { decide, type Counters, type State, type UserState } from "./machine";

export interface EngineDeps {
  repo: Repo;
  logger: Logger;
  /** Envio pela única porta de saída (sendGuarded já com o contexto). */
  send: (message: OutboundMessage) => Promise<SendResult>;
  maxPerDay: number;
  maxPer10Min: number;
  now?: () => Date;
}

const MAX_CAS_ATTEMPTS = 4;
const TEN_MIN_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function handleIncomingMessage(msg: IncomingMessage, deps: EngineDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const waIdHash = await hashWaId(msg.from);
  const sent = await deps.repo.listOutboundSince(waIdHash, new Date(now.getTime() - DAY_MS));
  const counters: Counters = {
    sentLastDay: sent.length,
    sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length,
    maxPerDay: deps.maxPerDay,
    maxPer10Min: deps.maxPer10Min,
  };

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const stored = await deps.repo.getConversation(msg.from);
    const user: UserState = {
      state: stored.state as State,
      previousState: stored.previousState as State | null,
      hintSentInState: stored.hintSentInState,
      optedOutAt: stored.optedOutAt,
    };
    const d = decide(user, msg, counters, now);
    const changed =
      d.nextState.state !== user.state ||
      d.nextState.hintSentInState !== user.hintSentInState ||
      d.nextState.previousState !== user.previousState ||
      d.nextState.optedOutAt?.getTime() !== user.optedOutAt?.getTime();
    if (changed) {
      const won = await deps.repo.saveConversation(msg.from, stored.version, d.nextState);
      if (!won) continue; // outra mensagem mudou o estado: reavalia com o estado novo
    }
    deps.logger.log("info", "conversation_decision", {
      from: maskPhone(msg.from), outcome: d.outcome, state: d.nextState.state,
    });
    for (const reply of d.replies) {
      const result = await deps.send({ to: msg.from, ...reply });
      if (result.status !== "sent") {
        deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: result.status });
      }
    }
    return;
  }
  // Disputa persistente: melhor ficar em silêncio do que responder em duplicidade.
  deps.logger.log("warn", "conversation_contention", { from: maskPhone(msg.from) });
}
