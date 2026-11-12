import type { Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import { matchChoice, PENDING_CHOICES_TTL_MS } from "../whatsapp/choices";
import { parseWebhookPayload } from "../whatsapp/parser";
import { extractWebhookToken, verifyWebhookToken } from "../whatsapp/signature";
import type { IncomingMessage, WebhookEvent } from "../whatsapp/types";

/** Gancho para o motor de conversa. */
export type EventHandler = (event: WebhookEvent) => Promise<void>;

export interface WebhookDeps {
  /** Segredo compartilhado com a Evolution (EVOLUTION_WEBHOOK_TOKEN). */
  webhookToken: string;
  repo: Repo;
  logger: Logger;
  onEvent?: EventHandler;
  now?: () => Date;
}

export interface WaitUntilCtx {
  waitUntil(p: Promise<unknown>): void;
}

/** Chave de idempotência: o `key.id` da mensagem (o Baileys reenvia/duplica eventos). */
export function idempotencyKey(ev: WebhookEvent): string {
  return ev.wamid;
}

/**
 * Texto numerado -> opção: se a pessoa respondeu "2" (ou o título) a um menu enviado como texto numerado,
 * o motor recebe o mesmo button_reply/list_reply de sempre. Qualquer falha aqui deixa o texto passar como está.
 */
async function resolveNumberedReply(ev: WebhookEvent, repo: Repo, now: Date): Promise<WebhookEvent> {
  if (ev.type !== "text") return ev;
  try {
    const pending = await repo.getPendingChoices(await hashWaId(ev.from));
    if (!pending || now.getTime() - pending.createdAt.getTime() > PENDING_CHOICES_TTL_MS) return ev;
    const hit = matchChoice(ev.body, pending.options);
    if (!hit) return ev;
    await repo.setPendingChoices(await hashWaId(ev.from), null, now); // uma escolha vale uma vez
    const { wamid, from, timestamp } = ev;
    const base = { wamid, from, ...(timestamp !== undefined ? { timestamp } : {}) };
    // Qualquer escolha chega como button_reply: o motor trata os dois pelo id da opção.
    const out: IncomingMessage = { ...base, type: "button_reply", id: hit.id, title: hit.title };
    return out;
  } catch {
    return ev;
  }
}

export async function processEvents(events: WebhookEvent[], deps: WebhookDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  for (const original of events) {
    try {
      const received = now();
      // Reservar o id (idempotência) e registrar a última mensagem da pessoa são independentes: uma viagem só.
      // Duplicata: o registro da hora é inofensivo (mesmo horário); a mensagem continua sendo ignorada.
      const sentAt = original.timestamp ? new Date(original.timestamp * 1000) : received;
      const [claim, touched] = await Promise.allSettled([
        deps.repo.claimMessage(idempotencyKey(original), received),
        deps.repo.touchUser(original.from, sentAt <= received ? sentAt : received),
      ]);
      if (claim.status === "rejected") throw claim.reason;
      if (!claim.value) {
        deps.logger.log("debug", "duplicate_ignored", { type: original.type });
        continue;
      }
      if (touched.status === "rejected") throw touched.reason;
      const ev = await resolveNumberedReply(original, deps.repo, received);
      await deps.onEvent?.(ev);
      deps.logger.log("info", "event_processed", { type: ev.type, from: maskPhone(ev.from) });
    } catch (e) {
      deps.logger.log("error", "event_failed", {
        type: original.type, from: maskPhone(original.from), error: e instanceof Error ? e.name : "unknown",
      });
    }
  }
}

export async function handleWebhookPost(request: Request, ctx: WaitUntilCtx, deps: WebhookDeps): Promise<Response> {
  // A Evolution não assina o corpo: o segredo compartilhado vem em header (comparação em tempo constante).
  if (!(await verifyWebhookToken(extractWebhookToken(request.headers), deps.webhookToken))) {
    deps.logger.log("warn", "invalid_webhook_token");
    return new Response("unauthorized", { status: 401 });
  }
  let events: WebhookEvent[] = [];
  try {
    events = parseWebhookPayload(await request.json());
  } catch {
    deps.logger.log("warn", "invalid_json");
  }
  ctx.waitUntil(
    processEvents(events, deps).catch((e) => {
      deps.logger.log("error", "processing_failed", { error: e instanceof Error ? e.name : "unknown" });
    }),
  );
  // Token válido: sempre 200 (a Evolution reenfileira em erro; o disjuntor só para de ENVIAR).
  return new Response("ok", { status: 200 });
}
