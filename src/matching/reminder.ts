// Aviso com os NOMES, 5 minutos antes da mentoria. Até lá mentor e mentorado são anônimos um para o outro (confirmationText).
// Roda pelo cron de 1 em 1 minuto. Todo envio passa pelo `send` (sendGuarded): trava manual, anti-flood e "só quem já
// escreveu ao bot" continuam valendo (R1). Opt-out e limites por pessoa são respeitados (R2).
import { WEEKDAY_LABEL, fmtHour, type Weekday } from "../ai/types";
import { limited } from "../conversation/machine";
import type { MatchRow, Repo } from "../db/repo";
import { maskPhone, type Logger } from "../lib/logger";
import { countersFor } from "../mentoria/confirm";
import type { OutboundMessage, SendResult } from "../whatsapp/client";

/** Expressão do cron de 1 em 1 minuto (mesma string de wrangler.toml: o Worker escolhe a tarefa por ela). */
export const NAMES_CRON = "* * * * *";

/** Quanto tempo antes do início os nomes saem. */
export const NAMES_LEAD_MS = 5 * 60 * 1000;
/** Se o cron perdeu rodadas, ainda avisa quem começou há poucos minutos (melhor tarde que nunca). */
export const NAMES_LATE_GRACE_MS = 10 * 60 * 1000;

export interface ReminderDeps {
  repo: Repo;
  logger: Logger;
  send: (message: OutboundMessage) => Promise<SendResult>;
  maxPerDay: number;
  maxPer10Min: number;
  now: () => Date;
}

const firstName = (full: string | undefined): string => (full ?? "").trim().split(/\s+/)[0] ?? "";
const nameOf = async (repo: Repo, waId: string): Promise<string> =>
  firstName((await repo.getRegistration(waId).catch(() => null))?.values.full_name);

export function namesText(role: "mentor" | "mentorado", otherName: string, m: Pick<MatchRow, "chosenDay" | "chosenStart" | "chosenEnd" | "location">): string {
  const who = otherName || (role === "mentor" ? "o mentorado" : "o mentor");
  const label = role === "mentor" ? "Seu mentorado" : "Seu mentor";
  const when = m.chosenDay && m.chosenStart && m.chosenEnd
    ? `\n📅 ${WEEKDAY_LABEL[m.chosenDay as Weekday] ?? m.chosenDay} · ${fmtHour(m.chosenStart)} às ${fmtHour(m.chosenEnd)}`
    : "";
  const where = m.location ? `\n📍 ${m.location}` : "";
  return `Falta pouco pra mentoria! 🦎 ${label} é ${who}.${when}${where}`;
}

/** Envia os nomes dos matches que começam nos próximos 5 minutos. Nunca lança. Devolve quantos matches foram avisados. */
export async function sendNamesDue(deps: ReminderDeps): Promise<number> {
  const { repo, logger } = deps;
  const now = deps.now();
  let done = 0;
  let due: MatchRow[];
  try {
    due = await repo.listMatchesDueForNames(new Date(now.getTime() - NAMES_LATE_GRACE_MS), new Date(now.getTime() + NAMES_LEAD_MS));
  } catch {
    logger.log("error", "names_list_failed");
    return 0;
  }
  for (const m of due) {
    try {
      if (!(await repo.claimNamesSent(m.id, now))) continue; // outra rodada já enviou
      const [mentorName, menteeName] = await Promise.all([nameOf(repo, m.mentorWaId), nameOf(repo, m.menteeWaId)]);
      const targets = [
        { to: m.mentorWaId, body: namesText("mentor", menteeName, m) },
        { to: m.menteeWaId, body: namesText("mentorado", mentorName, m) },
      ];
      let sentAny = false;
      let allOk = true;
      for (const t of targets) {
        const optedOut = (await repo.getConversation(t.to)).optedOutAt !== null;
        // O aviso é de segurança (quem vai encontrar quem): limite por pessoa só adia se estourou; opt-out nunca recebe.
        if (optedOut || limited(await countersFor(t.to, deps))) { allOk = false; continue; }
        const r = await deps.send({ to: t.to, type: "text", text: { body: t.body } });
        if (r.status === "sent") sentAny = true;
        else {
          allOk = false;
          logger.log("info", "names_not_sent", { match: m.seq, to: maskPhone(t.to), status: r.status });
        }
      }
      if (allOk) done++;
      // Ninguém recebeu: tenta de novo na próxima rodada. Se um dos dois recebeu, mantém a reserva (reenviar duplicaria o aviso).
      else if (!sentAny) await repo.releaseNamesSent(m.id);
      else logger.log("warn", "names_partial", { match: m.seq });
    } catch {
      logger.log("error", "names_failed", { match: m.seq });
      await repo.releaseNamesSent(m.id).catch(() => undefined);
    }
  }
  return done;
}
