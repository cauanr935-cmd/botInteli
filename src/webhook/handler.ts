import type { Repo } from "../db/repo";
import { maskPhone, type Logger } from "../lib/logger";
import { parseWebhookPayload } from "../whatsapp/parser";
import { verifySignature } from "../whatsapp/signature";
import type { WebhookEvent } from "../whatsapp/types";

/** Gancho para as próximas etapas (motor de conversa, status/orçamento). */
export type EventHandler = (event: WebhookEvent) => Promise<void>;

export interface WebhookDeps {
  appSecret: string;
  verifyToken: string;
  repo: Repo;
  logger: Logger;
  onEvent?: EventHandler;
  now?: () => Date;
}

export interface WaitUntilCtx {
  waitUntil(p: Promise<unknown>): void;
}

export function handleVerification(url: URL, verifyToken: string): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token !== null && verifyToken !== "" && token === verifyToken && challenge !== null) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

/** Chave de idempotência: wamid para mensagens; id+status para status webhooks. */
export function idempotencyKey(ev: WebhookEvent): string {
  return ev.type === "status" ? `status:${ev.id}:${ev.status}` : ev.wamid;
}

export async function processEvents(events: WebhookEvent[], deps: WebhookDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  for (const ev of events) {
    let claimedKey: string | null = null;
    try {
      const received = now();
      // Reservar o wamid (idempotência) e registrar a última mensagem da pessoa são independentes: uma viagem só.
      // Duplicata: o registro da hora é inofensivo (mesmo horário); a mensagem continua sendo ignorada.
      const key = idempotencyKey(ev);
      const sentAt = ev.type !== "status" && ev.timestamp ? new Date(ev.timestamp * 1000) : received;
      const touch = ev.type !== "status" ? deps.repo.touchUser(ev.from, sentAt <= received ? sentAt : received) : Promise.resolve();
      const [claim, touched] = await Promise.allSettled([deps.repo.claimMessage(key, received), touch]);
      if (claim.status === "rejected") throw claim.reason;
      if (!claim.value) {
        deps.logger.log("debug", "duplicate_ignored", { type: ev.type });
        continue;
      }
      claimedKey = key;
      if (touched.status === "rejected") throw touched.reason;
      await deps.onEvent?.(ev);
      deps.logger.log("info", "event_processed", {
        type: ev.type,
        ...(ev.type !== "status" ? { from: maskPhone(ev.from) } : {}),
      });
    } catch (e) {
      // Status é idempotente (ligar a trava de novo é seguro): libera a chave para que o
      // reenvio da Meta seja reprocessado e o sinal "billable" não se perca.
      if (ev.type === "status" && claimedKey !== null) {
        try {
          await deps.repo.unclaimMessage(claimedKey);
        } catch {
          deps.logger.log("error", "unclaim_failed");
        }
      }
      deps.logger.log("error", "event_failed", {
        type: ev.type,
        ...(ev.type !== "status" ? { from: maskPhone(ev.from) } : {}),
        error: e instanceof Error ? e.name : "unknown",
      });
    }
  }
}

export async function handleWebhookPost(request: Request, ctx: WaitUntilCtx, deps: WebhookDeps): Promise<Response> {
  const raw = await request.arrayBuffer();
  const ok = await verifySignature(raw, request.headers.get("X-Hub-Signature-256"), deps.appSecret);
  if (!ok) {
    deps.logger.log("warn", "invalid_signature");
    return new Response("unauthorized", { status: 401 });
  }
  let events: WebhookEvent[] = [];
  try {
    events = parseWebhookPayload(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    deps.logger.log("warn", "invalid_json");
  }
  ctx.waitUntil(
    processEvents(events, deps).catch((e) => {
      deps.logger.log("error", "processing_failed", { error: e instanceof Error ? e.name : "unknown" });
    }),
  );
  return new Response("ok", { status: 200 });
}
