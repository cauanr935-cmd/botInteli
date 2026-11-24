// Ações do matching para o painel web: conectar mentor <-> mentorado e cancelar. Usam o MESMO fluxo dos comandos de WhatsApp
// (connectMatch/cancelMatchBySeq): o bot já identifica a dúvida, pergunta os horários ao mentor e conduz o resto.
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import type { Logger } from "../lib/logger";
import { createSender } from "../webhook/events";
import type { Weekday } from "../ai/types";
import { cancelMatchBySeq, confirmMatch, connectMatch, type MatchResult } from "./flow";

export interface MatchingActions {
  connect(doubtSeq: number, mentorSeq: number): Promise<MatchResult>;
  cancel(matchSeq: number): Promise<{ ok: boolean; text: string }>;
  /** Fecha o horário na mão e avisa mentor e mentorado (mesmo fluxo do /confirmar). */
  confirm(p: { seq: number; day: Weekday; start: string; end: string; location: string }): Promise<{ ok: boolean; text: string }>;
}

export function createMatchingActions(cfg: Config, p: { repo: Repo; logger: Logger; now?: () => Date; fetchImpl?: typeof fetch }): MatchingActions {
  const send = createSender(cfg, p);
  const flow = () => ({ repo: p.repo, send, logger: p.logger, now: (p.now ?? (() => new Date()))(), timezone: cfg.timezone, adminWaIds: cfg.adminWaIds });
  return {
    connect: (doubtSeq, mentorSeq) => connectMatch({ doubtSeq, mentorSeq }, "painel", flow()),
    cancel: (matchSeq) => cancelMatchBySeq(matchSeq, flow()),
    confirm: (p) => confirmMatch(p, flow()),
  };
}
