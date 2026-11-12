import { handleAdmin, type AdminDeps } from "./admin/budget";
import { loadConfig } from "./config";
import { createMediaClient } from "./whatsapp/evolutionClient";
import { createAgent } from "./ai/grok";
import { legalResponse } from "./legal/page";
import { DeferredAudioAnalyzer, HttpAudioAnalyzer } from "./audio/analyzer";
import { R2AudioStore } from "./audio/storage";
import { SupabaseRepo } from "./db/supabase-repo";
import type { Repo } from "./db/repo";
import { ContentProvider } from "./services/provider";
import { createEventHandler } from "./webhook/events";
import { runScheduled } from "./ops/scheduled";
import { createLogger, type Logger } from "./lib/logger";
import { handleApi } from "./mentoria/api";
import { handlePanel } from "./mentoria/panel";
import { handleChat } from "./sim/chat";
import { PAGE_HTML } from "./sim/page";
import { handleWebhookPost, type EventHandler, type WaitUntilCtx } from "./webhook/handler";

export type Env = Record<string, unknown> & { AUDIOS?: R2Bucket };

export interface AppDeps {
  webhookToken: string;
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
      webhookToken: cfg.evolutionWebhookToken,
      repo,
      logger,
      onEvent: createEventHandler(cfg, {
        repo, logger, content,
        ...((a) => (a ? { agent: a } : {}))(createAgent(cfg, logger)),
        // Áudio sempre é guardado (R2). Com analisador síncrono configurado, ele responde na hora; sem ele,
        // a análise é feita pelo sistema externo, que busca o áudio pela API (/api/v1).
        ...(env.AUDIOS
          ? {
              audio: {
                media: createMediaClient({ url: cfg.evolutionUrl, apiKey: cfg.evolutionApiKey, instance: cfg.evolutionInstance }),
                store: new R2AudioStore(env.AUDIOS),
                analyzer: cfg.analyzerApiUrl && cfg.analyzerApiKey
                  ? new HttpAudioAnalyzer({ url: cfg.analyzerApiUrl, apiKey: cfg.analyzerApiKey, timeoutMs: cfg.analyzerTimeoutMs })
                  : new DeferredAudioAnalyzer(),
              },
            }
          : (logger.log("warn", "r2_binding_missing"), {})),
      }),
      admin: {
        adminToken: cfg.adminToken, repo, logger, phoneNumberId: cfg.evolutionInstance,
        stopAt: cfg.stopAt, timezone: cfg.timezone,
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
    // Painel de metadados (login) e API de integração do analisador. Independentes das credenciais da Evolution.
    if (pathname === "/painel" || pathname.startsWith("/painel/") || pathname.startsWith("/api/v1/")) {
      const url = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim() : "";
      const key = typeof env.SUPABASE_SERVICE_KEY === "string" ? env.SUPABASE_SERVICE_KEY.trim() : "";
      if (!url || !key) return new Response("server misconfigured", { status: 500 });
      const repo = new SupabaseRepo(url, key);
      if (pathname.startsWith("/api/v1/")) {
        const apiKey = typeof env.INTEGRATION_API_KEY === "string" ? env.INTEGRATION_API_KEY.trim() : "";
        return handleApi(request, { apiKey, repo, bucket: env.AUDIOS });
      }
      return handlePanel(request, { env, repo, bucket: env.AUDIOS });
    }
    // Termos de Uso e Política de Privacidade (LGPD): página pública, o link citado no consentimento.
    if (request.method === "GET" && (pathname === "/privacidade" || pathname === "/termos" || pathname === "/lgpd")) return legalResponse();
    // Simulador de chat web (canal alternativo, sem WhatsApp). Desligado por padrão.
    if (pathname === "/chat" || pathname.startsWith("/chat/")) {
      return handleChat(request, { env, logger, pageHtml: PAGE_HTML });
    }
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
        phoneNumberId: cfg.evolutionInstance, stopAt: cfg.stopAt, timezone: cfg.timezone,
        ...(env.AUDIOS ? { store: new R2AudioStore(env.AUDIOS) } : {}),
      });
    } catch (e) {
      logger.log("error", "config_invalid", { message: (e as Error).message });
    }
  },
};
