// Recuperação de mensagens perdidas: quando o Worker, a internet ou a VM da Evolution caem, o webhook não chega (ou chega e
// falha no meio). A cada minuto o cron pergunta à Evolution o que chegou nas últimas horas e responde SÓ o que o bot nunca viu.
// Passa pelo mesmo caminho do webhook (idempotência, motor, limites por pessoa e anti-flood): nada novo envia por fora.
import { parseWebhookPayload } from "../whatsapp/parser";
import { idempotencyKey, processEvents, type WebhookDeps } from "./handler";
import type { WebhookEvent } from "../whatsapp/types";

/** Só mensagens dos últimos 6 h: responder algo mais velho que isso surpreenderia a pessoa. */
export const RECOVERY_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Teto por execução (o plano gratuito limita as chamadas por invocação do cron). */
export const RECOVERY_MAX_PER_RUN = 8;
/** Mensagens muito recentes ainda podem estar a caminho pelo webhook: espera um pouco antes de agir. */
export const RECOVERY_GRACE_MS = 90 * 1000;

export interface RecoveryDeps extends Omit<WebhookDeps, "webhookToken"> {
  /** Busca as mensagens recebidas desde `sinceSec` (segundos), no formato do webhook (evolutionClient.fetchRecentInbound). */
  fetchRecent: (sinceSec: number) => Promise<unknown>;
}

/** Responde o que ficou sem resposta. Devolve quantas mensagens foram reprocessadas. */
export async function recoverMissed(deps: RecoveryDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const since = Math.floor((now.getTime() - RECOVERY_WINDOW_MS) / 1000);
  const payload = await deps.fetchRecent(since);
  const cutoff = Math.floor((now.getTime() - RECOVERY_GRACE_MS) / 1000);
  const events = parseWebhookPayload(payload)
    .filter((e) => (e.timestamp ?? 0) === 0 || (e.timestamp as number) <= cutoff)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  if (events.length === 0) return 0;
  const unseen = new Set(await deps.repo.unseenMessageKeys(events.map(idempotencyKey)));
  const todo: WebhookEvent[] = events.filter((e) => unseen.has(idempotencyKey(e))).slice(0, RECOVERY_MAX_PER_RUN);
  if (todo.length === 0) return 0;
  deps.logger.log("warn", "recovery_replaying", { count: todo.length });
  await processEvents(todo, { ...deps, webhookToken: "" });
  return todo.length;
}
