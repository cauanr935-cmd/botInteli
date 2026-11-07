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
    try {
      const received = now();
      const fresh = await deps.repo.claimMessage(idempotencyKey(ev), received);
      if (!fresh) {
        deps.logger.log("debug", "duplicate_ignored", { type: ev.type });
        continue;
      }
      if (ev.type !== "status") {
        const at = ev.timestamp ? new Date(ev.timestamp * 1000) : received;
        await deps.repo.touchUser(ev.from, at <= received ? at : received);
      }
      await deps.onEvent?.(ev);
      deps.logger.log("info", "event_processed", {
        type: ev.type,
        ...(ev.type !== "status" ? { from: maskPhone(ev.from) } : {}),
      });
    } catch (e) {
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
