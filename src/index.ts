import { handleAdmin, type AdminDeps } from "./admin/budget";
import { handleStatusEvent } from "./budget/status";
import { loadConfig } from "./config";
import { handleIncomingMessage } from "./conversation/engine";
import { sendGuarded } from "./whatsapp/client";
import { SupabaseRepo } from "./db/supabase-repo";
import type { Repo } from "./db/repo";
import { createLogger, type Logger } from "./lib/logger";
import { handleVerification, handleWebhookPost, type EventHandler, type WaitUntilCtx } from "./webhook/handler";

export type Env = Record<string, unknown> & { AUDIOS?: R2Bucket };

export interface AppDeps {
  appSecret: string;
  verifyToken: string;
  repo: Repo;
  logger: Logger;
  onEvent?: EventHandler;
  now?: () => Date;
  /** Endpoints admin (/admin/*). Sem isso, respondem 500 (config inválida). */
  admin?: AdminDeps;
}

/** Roteador puro: recebe dependências já montadas (testável sem env). */
export async function route(request: Request, ctx: WaitUntilCtx, deps: AppDeps | null): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return new Response("ok", { status: 200 });
  }
  if (url.pathname.startsWith("/admin/")) {
    if (!deps?.admin) return new Response("server misconfigured", { status: 500 });
    return handleAdmin(request, deps.admin);
  }
  if (url.pathname === "/webhook") {
    if (!deps) return new Response("server misconfigured", { status: 500 });
    if (request.method === "GET") return handleVerification(url, deps.verifyToken);
    if (request.method === "POST") return handleWebhookPost(request, ctx, deps);
    return new Response("method not allowed", { status: 405 });
  }
  return new Response("not found", { status: 404 });
}

function buildDeps(env: Env, logger: Logger): AppDeps | null {
  try {
    const cfg = loadConfig(env);
    const repo = new SupabaseRepo(cfg.supabaseUrl, cfg.supabaseServiceKey);
    return {
      appSecret: cfg.appSecret,
      verifyToken: cfg.verifyToken,
      repo,
      logger,
      // Status webhooks: pricing -> outbound_log e trava manual (R1).
      onEvent: async (ev) => {
        if (ev.type === "status") {
          await handleStatusEvent(ev, { repo, logger, phoneNumberId: cfg.phoneNumberId });
          return;
        }
        // Mensagens: motor de conversa -> decide -> sendGuarded (R1/R2).
        await handleIncomingMessage(ev, {
          repo, logger,
          maxPerDay: cfg.maxBotMsgsPerUserPerDay,
          maxPer10Min: cfg.maxBotMsgsPerUserPer10Min,
          registration: {
            ...(cfg.whatsappFlowId ? { flowId: cfg.whatsappFlowId } : {}),
            privacyUrl: cfg.privacyPolicyUrl, termsVersion: cfg.termsVersion,
          },
          send: (message) =>
            sendGuarded(message, {
              repo, logger, phoneNumberId: cfg.phoneNumberId, whatsappToken: cfg.whatsappToken,
              graphApiVersion: cfg.graphApiVersion, stopAt: cfg.stopAt, timezone: cfg.metaAccountTimezone,
            }),
        });
      },
      admin: {
        adminToken: cfg.adminToken, repo, logger, phoneNumberId: cfg.phoneNumberId,
        stopAt: cfg.stopAt, timezone: cfg.metaAccountTimezone,
      },
    };
  } catch (e) {
    logger.log("error", "config_invalid", { message: (e as Error).message });
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env = {}, ctx?: ExecutionContext): Promise<Response> {
    const logger = createLogger();
    const pathname = new URL(request.url).pathname;
    const deps = pathname === "/webhook" || pathname.startsWith("/admin/") ? buildDeps(env, logger) : null;
    const safeCtx: WaitUntilCtx = ctx ?? { waitUntil: () => undefined };
    return route(request, safeCtx, deps);
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Cron diário: tarefas das próximas etapas. Por ora só valida a config.
    const logger = createLogger();
    try {
      loadConfig(env);
    } catch (e) {
      logger.log("error", "config_invalid", { message: (e as Error).message });
    }
  },
};
