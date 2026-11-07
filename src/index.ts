import { handleAdmin, type AdminDeps } from "./admin/budget";
import { handleStatusEvent } from "./budget/status";
import { loadConfig } from "./config";
import { handleIncomingMessage } from "./conversation/engine";
import { createMediaClient, sendGuarded } from "./whatsapp/client";
import { HttpAudioAnalyzer } from "./audio/analyzer";
import { processAudio } from "./audio/pipeline";
import { R2AudioStore } from "./audio/storage";
import { SupabaseRepo } from "./db/supabase-repo";
import type { Repo } from "./db/repo";
import { ContentProvider } from "./services/provider";
import type { AudioEvent } from "./whatsapp/types";
import { runScheduled } from "./ops/scheduled";
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

// Cache de conteúdo (TTL) vive no isolate: sobrevive entre requisições, evitando uma consulta por mensagem.
const contentProviders = new Map<string, ContentProvider>();

function buildDeps(env: Env, logger: Logger): AppDeps | null {
  try {
    const cfg = loadConfig(env);
    const repo = new SupabaseRepo(cfg.supabaseUrl, cfg.supabaseServiceKey);
    let content = contentProviders.get(cfg.supabaseUrl);
    if (!content) {
      content = new ContentProvider(repo, logger);
      contentProviders.set(cfg.supabaseUrl, content);
    }
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
        const send = (message: Parameters<typeof sendGuarded>[0]) =>
          sendGuarded(message, {
            repo, logger, phoneNumberId: cfg.phoneNumberId, whatsappToken: cfg.whatsappToken,
            graphApiVersion: cfg.graphApiVersion, stopAt: cfg.stopAt, timezone: cfg.metaAccountTimezone,
          });
        if (!env.AUDIOS) logger.log("error", "r2_binding_missing");
        const audio = env.AUDIOS
          ? {
              process: (m: AudioEvent, hintAlreadySent: boolean) =>
                processAudio(m, hintAlreadySent, {
                  repo, logger, send, content,
                  media: createMediaClient({ whatsappToken: cfg.whatsappToken, graphApiVersion: cfg.graphApiVersion }),
                  store: new R2AudioStore(env.AUDIOS as R2Bucket),
                  analyzer: new HttpAudioAnalyzer({ url: cfg.analyzerApiUrl, apiKey: cfg.analyzerApiKey, timeoutMs: cfg.analyzerTimeoutMs }),
                  maxAudioBytes: cfg.maxAudioBytes, maxPerDay: cfg.maxBotMsgsPerUserPerDay,
                  maxPer10Min: cfg.maxBotMsgsPerUserPer10Min, timezone: cfg.metaAccountTimezone,
                }),
            }
          : undefined;
        await handleIncomingMessage(ev, {
          ...(audio ? { audio } : {}), send,
          repo, logger, content,
          maxPerDay: cfg.maxBotMsgsPerUserPerDay,
          maxPer10Min: cfg.maxBotMsgsPerUserPer10Min,
          registration: {
            ...(cfg.whatsappFlowId ? { flowId: cfg.whatsappFlowId } : {}),
            privacyUrl: cfg.privacyPolicyUrl, termsVersion: cfg.termsVersion,
          },
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
    // Cron diário (C7.1): consulta leve, limpeza de idempotência, destrava de áudio e uso do mês.
    const logger = createLogger();
    try {
      const cfg = loadConfig(env);
      await runScheduled({
        repo: new SupabaseRepo(cfg.supabaseUrl, cfg.supabaseServiceKey), logger,
        phoneNumberId: cfg.phoneNumberId, stopAt: cfg.stopAt, timezone: cfg.metaAccountTimezone,
      });
    } catch (e) {
      logger.log("error", "config_invalid", { message: (e as Error).message });
    }
  },
};
