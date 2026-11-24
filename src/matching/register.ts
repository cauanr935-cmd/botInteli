// Registro da mentoria a partir do MATCH: quem tem uma mentoria confirmada no bot manda só o áudio. Papel, parceiro, assunto
// (a dúvida original) e data já estão guardados, então o bot NÃO pergunta contato, assunto nem com quem foi.
// Áudio que chega ANTES do horário marcado não é rejeitado: o bot confirma ("vocês já fizeram?"), ver MENT_EARLY_CONFIRM.
import type { MatchRow, Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import type { Logger } from "../lib/logger";
import { sanitizeSubject, SUBJECT_MAX, SUBJECT_MIN, todayIn } from "../mentoria/parse";

export interface RegisterDeps {
  repo: Repo;
  logger: Logger;
  now: Date;
  timezone: string;
}

/** Mentoria confirmada da pessoa e se o áudio chegou antes do horário marcado. null = sem match (segue o fluxo com perguntas). */
export async function matchForAudio(repo: Repo, waId: string, now: Date): Promise<{ match: MatchRow; early: boolean } | null> {
  const match = await repo.getConfirmedMatchFor(waId).catch(() => null);
  if (!match) return null;
  return { match, early: match.scheduledAt !== null && now.getTime() < match.scheduledAt.getTime() };
}

/** Assunto da mentoria = a dúvida que originou o match (sanitizada, 3 a 200 caracteres). */
function subjectOf(doubtText: string | undefined): string {
  const s = sanitizeSubject(doubtText ?? "");
  const clipped = s.length > SUBJECT_MAX ? `${s.slice(0, SUBJECT_MAX - 1)}…` : s;
  return clipped.length >= SUBJECT_MIN && /\p{L}/u.test(clipped) ? clipped : "Mentoria combinada pelo Be My Mentor";
}

/**
 * Completa a mentoria do áudio já guardado com os dados do match e marca o match como 'realizada'.
 * Devolve o hash do parceiro (para o pedido de confirmação) ou null se não deu (o chamador segue com as perguntas).
 */
export async function completeFromMatch(deps: RegisterDeps, waId: string, audioId: string, match: MatchRow): Promise<{ partnerHash: string } | null> {
  const { repo } = deps;
  try {
    const isMentor = match.mentorWaId === waId;
    if (!isMentor && match.menteeWaId !== waId) return null;
    const partnerWaId = isMentor ? match.menteeWaId : match.mentorWaId;
    const [doubt, partnerReg] = await Promise.all([repo.getDoubtById(match.doubtId), repo.getRegistration(partnerWaId).catch(() => null)]);
    const partnerHash = await hashWaId(partnerWaId);
    const ok = await repo.completeMentoria(waId, {
      audioId, role: isMentor ? "mentor" : "mentorado", subject: subjectOf(doubt?.text),
      occurredOn: todayIn(deps.now, deps.timezone), partnerHash, partnerName: partnerReg?.values.full_name ?? null,
    });
    if (!ok) return null;
    await repo.saveMentoriaDraft(waId, null);
    await repo.updateMatch(match.id, { status: "realizada" }, deps.now);
    deps.logger.log("info", "mentoria_registered_from_match", { match: match.seq });
    return { partnerHash };
  } catch {
    deps.logger.log("warn", "mentoria_from_match_failed", { match: match.seq });
    return null;
  }
}
