// Liga o aviso da curadoria ao envio de produção (mesmo `createSender` do matching): o Worker envia fora do webhook.
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import type { Logger } from "../lib/logger";
import { createSender } from "../webhook/events";
import { notifyCuradoria } from "./curadoria";

export function createCuradoriaNotifier(
  cfg: Config, p: { repo: Repo; logger: Logger; now?: () => Date; fetchImpl?: typeof fetch },
): (mentoriaId: string, result: unknown) => Promise<number> {
  const send = createSender(cfg, p);
  return (mentoriaId, result) => notifyCuradoria(mentoriaId, result, {
    repo: p.repo, logger: p.logger, send, maxPerDay: cfg.maxBotMsgsPerUserPerDay, maxPer10Min: cfg.maxBotMsgsPerUserPer10Min,
    timezone: cfg.timezone, now: p.now ?? (() => new Date()),
  });
}
