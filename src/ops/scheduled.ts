// Cron diário (Etapa 7). Nunca envia mensagem (R1): só mantém o banco ativo, limpa e registra o uso.
import { monthKey } from "../budget/month";
import type { AudioStore } from "../audio/storage";
import type { Repo } from "../db/repo";
import { housekeepMentorias } from "../mentoria/housekeeping";
import type { Logger } from "../lib/logger";

export const PROCESSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Conversa em PROCESSING_AUDIO há mais que isso é considerada presa (o Worker morreu no meio). */
export const STUCK_PROCESSING_MS = 10 * 60 * 1000;

export interface ScheduledDeps {
  repo: Repo;
  logger: Logger;
  phoneNumberId: string;
  stopAt: number;
  timezone: string;
  /** R2 dos áudios (sem ele, a limpeza das mentorias não roda). */
  store?: AudioStore;
  now?: () => Date;
}

/** Cada tarefa é independente: falha em uma não impede as outras. */
export async function runScheduled(deps: ScheduledDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const { repo, logger } = deps;

  try {
    await repo.ping();
    logger.log("info", "cron_ping_ok");
  } catch (e) {
    logger.log("error", "cron_ping_failed", { error: e instanceof Error ? e.name : "unknown" });
  }

  try {
    const removed = await repo.deleteProcessedBefore(new Date(now.getTime() - PROCESSED_RETENTION_MS));
    logger.log("info", "cron_processed_cleanup", { removed });
  } catch (e) {
    logger.log("error", "cron_cleanup_failed", { error: e instanceof Error ? e.name : "unknown" });
  }

  try {
    const released = await repo.releaseStuckProcessing(new Date(now.getTime() - STUCK_PROCESSING_MS));
    logger.log(released > 0 ? "warn" : "info", "cron_stuck_released", { released });
  } catch (e) {
    logger.log("error", "cron_stuck_failed", { error: e instanceof Error ? e.name : "unknown" });
  }

  if (deps.store) {
    try {
      const r = await housekeepMentorias(repo, deps.store, logger, now);
      logger.log("info", "cron_mentoria_cleanup", r);
    } catch (e) {
      logger.log("error", "cron_mentoria_cleanup_failed", { error: e instanceof Error ? e.name : "unknown" });
    }
  }

  try {
    const month = monthKey(now, deps.timezone);
    const row = await repo.getBudget(deps.phoneNumberId, month);
    logger.log("info", "cron_budget_usage", {
      month, reserved_count: row?.reservedCount ?? 0, stop_at: row?.stopAt ?? deps.stopAt, tripped: row?.tripped ?? false,
    });
  } catch (e) {
    logger.log("error", "cron_usage_failed", { error: e instanceof Error ? e.name : "unknown" });
  }
}
