// Integração (com I/O): webhook -> decide -> sendGuarded. A lógica de decisão fica em machine.ts.
import type { Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import type { OutboundMessage, SendResult } from "../whatsapp/client";
import type { IncomingMessage } from "../whatsapp/types";
import {
  decideRegistration, isRegistrationState, registrationPrompt, type RegDecision, type RegistrationContext,
  type RegistrationEffect,
} from "../registration/decide";
import { decide, type Counters, type State, type UserState } from "./machine";

export interface EngineDeps {
  repo: Repo;
  logger: Logger;
  /** Envio pela única porta de saída (sendGuarded já com o contexto). */
  send: (message: OutboundMessage) => Promise<SendResult>;
  maxPerDay: number;
  maxPer10Min: number;
  now?: () => Date;
  /** Cadastro (Etapa 4). Sem isto, vale o comportamento provisório da Etapa 3. */
  registration?: { flowId?: string; privacyUrl: string; termsVersion: string };
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
    let d: RegDecision = decide(user, msg, counters, now);
    let effect: RegistrationEffect | undefined;
    if (deps.registration) {
      const reg = deps.registration;
      const needsRecord = user.state === "NEW" || isRegistrationState(user.state);
      const rec = needsRecord ? await deps.repo.getRegistration(msg.from) : null;
      const ctx: RegistrationContext = {
        ...(reg.flowId ? { flowId: reg.flowId } : {}),
        privacyUrl: reg.privacyUrl,
        registered: rec?.registeredAt != null,
        hasConsent: rec?.consentAt != null,
      };
      const rd = decideRegistration(user, msg, counters, now, ctx);
      if (rd) {
        d = rd;
        effect = rd.effect;
      } else if (user.state === "OPTED_OUT" && d.outcome === "transition" && isRegistrationState(d.nextState.state)) {
        // "voltar" para um estado de cadastro: reapresenta a pergunta certa (e não a dica genérica).
        const prompt = registrationPrompt(d.nextState.state, { ...ctx, registered: false, hasConsent: false });
        if (prompt) d = { ...d, replies: [prompt] };
      }
    }
    const changed =
      d.nextState.state !== user.state ||
      d.nextState.hintSentInState !== user.hintSentInState ||
      d.nextState.previousState !== user.previousState ||
      d.nextState.optedOutAt?.getTime() !== user.optedOutAt?.getTime();
    if (effect) await applyEffect(effect, msg.from, deps, now); // idempotente: repetir não causa dano
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

/** Grava o cadastro (com consentimento primeiro). Lança em erro: a mensagem não é respondida (fail silent). */
async function applyEffect(effect: RegistrationEffect, waId: string, deps: EngineDeps, now: Date): Promise<void> {
  const reg = deps.registration;
  if (!reg) return;
  const waIdHash = await hashWaId(waId);
  switch (effect.kind) {
    case "consent":
      await deps.repo.saveRegistration(waId, { waIdHash, consentAt: now, termsVersion: reg.termsVersion });
      return;
    case "field":
      await deps.repo.saveRegistration(waId, { values: { [effect.key]: effect.value } });
      return;
    case "complete":
      await deps.repo.saveRegistration(waId, {
        waIdHash, values: effect.values, registeredAt: now,
        ...(effect.withConsent ? { consentAt: now, termsVersion: reg.termsVersion } : {}),
      });
      return;
  }
}
