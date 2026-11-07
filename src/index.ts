import { handleAdmin, type AdminDeps } from "./admin/budget";
import { loadConfig } from "./config";
import { createMediaClient } from "./whatsapp/client";
import { HttpAudioAnalyzer } from "./audio/analyzer";
import { R2AudioStore } from "./audio/storage";
import { SupabaseRepo } from "./db/supabase-repo";
import type { Repo } from "./db/repo";
import { ContentProvider } from "./services/provider";
import { createEventHandler } from "./webhook/events";
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
      onEvent: createEventHandler(cfg, {
        repo, logger, content,
        ...(env.AUDIOS
          ? {
              audio: {
                media: createMediaClient({ whatsappToken: cfg.whatsappToken, graphApiVersion: cfg.graphApiVersion }),
                store: new R2AudioStore(env.AUDIOS),
                analyzer: new HttpAudioAnalyzer({ url: cfg.analyzerApiUrl, apiKey: cfg.analyzerApiKey, timeoutMs: cfg.analyzerTimeoutMs }),
              },
            }
          : (logger.log("error", "r2_binding_missing"), {})),
      }),
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
