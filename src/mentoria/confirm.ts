// Confirmação do parceiro (com I/O). A pergunta sai pelo `send` (sendGuarded): janela de 23h30, orçamento e limites
// por pessoa valem como em qualquer outra mensagem. Fora da janela a pergunta fica pendente e aparece na próxima
// mensagem do parceiro. Só quem já consentiu (R6) pode responder.
import type { AudioStore } from "../audio/storage";
import { limited, type Counters } from "../conversation/machine";
import type { PendingConfirmation, Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import { buildButtons } from "../whatsapp/builders";
import type { OutboundMessage, SendResult } from "../whatsapp/client";
import type { ButtonReplyEvent } from "../whatsapp/types";
import { formatDateBr, phoneCandidates } from "./parse";
import { CONFIRM_NO_PREFIX, CONFIRM_YES_PREFIX, MENTORIA_TEXTS as T } from "./texts";

export interface ConfirmDeps {
  repo: Repo;
  logger: Logger;
  send: (message: OutboundMessage) => Promise<SendResult>;
  maxPerDay: number;
  maxPer10Min: number;
  now: () => Date;
  /** Sem o R2, a recusa não consegue apagar o áudio e por isso não é registrada. */
  store?: AudioStore;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-fA-F-]{36}$/;
const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** Hashes que o wa_id de uma pessoa pode ter em quem a indicou (com e sem o 9º dígito). */
export async function waIdHashes(waId: string): Promise<string[]> {
  const ids = [...new Set([waId, ...phoneCandidates(waId)])];
  return Promise.all(ids.map(hashWaId));
}

export function confirmationReply(p: PendingConfirmation) {
  return buildButtons(T.confirmAsk(clip(p.registrantName ?? "outra pessoa", 100), formatDateBr(p.occurredOn), p.subject), [
    { id: `${CONFIRM_YES_PREFIX}${p.id}`, title: T.confirmYes }, { id: `${CONFIRM_NO_PREFIX}${p.id}`, title: T.confirmNo },
  ]);
}

async function countersFor(waId: string, deps: ConfirmDeps): Promise<Counters> {
  const now = deps.now();
  const sent = await deps.repo.listOutboundSince(await hashWaId(waId), new Date(now.getTime() - DAY_MS));
  return {
    lastBotMsgAt: null, sentLastDay: sent.length,
    sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length,
    maxPerDay: deps.maxPerDay, maxPer10Min: deps.maxPer10Min,
  };
}

/** Envia a pergunta ao parceiro (se couber nos limites e na janela) e marca como entregue. Nunca lança. */
export async function deliverConfirmation(p: PendingConfirmation, toWaId: string, deps: ConfirmDeps): Promise<boolean> {
  try {
    if (limited(await countersFor(toWaId, deps))) return false; // R2: limite por pessoa
    const r = await deps.send({ to: toWaId, ...confirmationReply(p) });
    if (r.status !== "sent") {
      deps.logger.log("info", "mentoria_confirm_not_sent", { to: maskPhone(toWaId), status: r.status });
      return false;
    }
    await deps.repo.markPartnerPrompted(p.id, deps.now());
    return true;
  } catch {
    deps.logger.log("warn", "mentoria_confirm_failed", { to: maskPhone(toWaId) });
    return false;
  }
}

/** Logo depois de registrar a mentoria: tenta avisar o parceiro (só se já é cadastrado e não pediu para sair). */
export async function notifyPartner(audioId: string, partnerHash: string, deps: ConfirmDeps): Promise<void> {
  try {
    const person = await deps.repo.findPersonByWaIdHash(partnerHash);
    if (!person?.consentAt || !person.termsVersion) return; // sem cadastro: a pergunta espera a próxima mensagem dele
    if ((await deps.repo.getConversation(person.waId)).state === "OPTED_OUT") return;
    const pending = (await deps.repo.listPendingConfirmations([partnerHash])).find((x) => x.id === audioId);
    if (pending && !pending.prompted) await deliverConfirmation(pending, person.waId, deps);
  } catch {
    deps.logger.log("warn", "mentoria_notify_failed");
  }
}

/** Estados em que a pergunta pendente pode aparecer no lugar da resposta normal (nunca no meio de um fluxo). */
const IDLE_STATES: readonly string[] = ["MENU", "COMPLETED", "RETURNING_CHOICE", "AWAIT_AUDIO"];

/**
 * Próxima mensagem do parceiro: se há uma confirmação ainda não entregue, ela vira a resposta (1 mensagem).
 * Devolve true se respondeu. Pergunta já entregue antes não se repete (R2).
 */
export async function offerPendingConfirmation(waId: string, state: string, counters: Counters, deps: ConfirmDeps): Promise<boolean> {
  if (!IDLE_STATES.includes(state) || limited(counters)) return false;
  const reg = await deps.repo.getRegistration(waId);
  if (!reg.consentAt || !reg.termsVersion) return false; // R6: sem cadastro, o cadastro vem antes
  const pending = (await deps.repo.listPendingConfirmations(await waIdHashes(waId))).find((x) => !x.prompted);
  if (!pending) return false;
  return deliverConfirmation(pending, waId, deps);
}

/** Toque em Sim/Não. Devolve true se tratou (mesmo sem responder). */
export async function handlePartnerAnswer(msg: ButtonReplyEvent, counters: Counters, deps: ConfirmDeps): Promise<boolean> {
  const yes = msg.id.startsWith(CONFIRM_YES_PREFIX);
  const no = msg.id.startsWith(CONFIRM_NO_PREFIX);
  if (!yes && !no) return false;
  const id = msg.id.slice((yes ? CONFIRM_YES_PREFIX : CONFIRM_NO_PREFIX).length);
  if (!UUID.test(id)) return true;

  const reg = await deps.repo.getRegistration(msg.from);
  if (!reg.consentAt || !reg.termsVersion) return true; // R6
  const hashes = await waIdHashes(msg.from);
  const row = await deps.repo.getMentoria(id);
  if (!row?.partnerHash || !hashes.includes(row.partnerHash)) return true; // não é o parceiro desta mentoria
  if (row.partnerConfirmedAt || row.partnerRejectedAt || row.contestedReason || row.audioDeletedAt) return true; // já respondida

  const asHash = await hashWaId(msg.from);
  if (no) {
    // Primeiro o áudio sai do R2; só depois a recusa é registrada (se o R2 falhar, o parceiro pode tocar de novo).
    if (!deps.store) return true;
    try { await deps.store.delete(row.r2Key); } catch { deps.logger.log("error", "mentoria_reject_delete_failed"); return true; }
  }
  const outcome = await deps.repo.answerPartner(id, hashes, yes ? "yes" : "no", deps.now(), asHash);
  if (outcome !== "confirmed" && outcome !== "rejected") return true;
  deps.logger.log("info", "mentoria_partner_answered", { from: maskPhone(msg.from), outcome });

  const optedOut = (await deps.repo.getConversation(msg.from)).state === "OPTED_OUT";
  if (optedOut || limited(counters)) return true; // a resposta foi gravada; sem mensagem (R2/opt-out)
  const body = outcome === "confirmed" ? T.confirmedThanks : T.rejectedThanks;
  const r = await deps.send({ to: msg.from, type: "text", text: { body } });
  if (r.status !== "sent") deps.logger.log("info", "mentoria_answer_reply_not_sent", { from: maskPhone(msg.from), status: r.status });
  return true;
}
