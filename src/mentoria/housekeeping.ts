// Limpeza diária das mentorias (cron). Nunca envia mensagem (R1): só apaga arquivos que não devem ficar guardados.
//  - fluxo INCOMPLETO há mais de 24 h (a pessoa guardou o arquivo e não descreveu a mentoria): apaga arquivo e registro;
//  - fluxo COMPLETO sem resposta do parceiro há mais de 7 dias: apaga o arquivo e marca como "expirada" (só no painel).
// O arquivo sai do R2 ANTES de o banco ser atualizado: se o R2 falhar, a próxima rodada tenta de novo.
import type { AudioStore } from "../audio/storage";
import type { MentoriaRepo, Repo } from "../db/repo";
import type { Logger } from "../lib/logger";

export const INCOMPLETE_TTL_MS = 24 * 60 * 60 * 1000;
export const UNANSWERED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function housekeepMentorias(
  repo: Pick<Repo, "listIncompleteMentorias" | "discardIncompleteMentoria" | "listUnansweredMentorias" | "expireMentoria"> & MentoriaRepo,
  store: AudioStore, logger: Logger, now: Date,
): Promise<{ discarded: number; expired: number }> {
  let discarded = 0;
  let expired = 0;
  for (const m of await repo.listIncompleteMentorias(new Date(now.getTime() - INCOMPLETE_TTL_MS))) {
    try {
      await store.delete(m.r2Key);
      if (await repo.discardIncompleteMentoria(m.id)) discarded++;
    } catch {
      logger.log("warn", "mentoria_discard_failed");
    }
  }
  for (const m of await repo.listUnansweredMentorias(new Date(now.getTime() - UNANSWERED_TTL_MS))) {
    try {
      await store.delete(m.r2Key);
      if (await repo.expireMentoria(m.id, now)) expired++;
    } catch {
      logger.log("warn", "mentoria_expire_failed");
    }
  }
  return { discarded, expired };
}
