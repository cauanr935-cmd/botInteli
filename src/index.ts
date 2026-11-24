import { configurePessoaIdSecret } from "./lib/hash";
import { handleAdmin, type AdminDeps, type ReprocessRequest, type ReprocessResult } from "./admin/budget";
import { loadConfig } from "./config";
import { createMediaClient, fetchRecentInbound } from "./whatsapp/evolutionClient";
import { recoverMissed } from "./webhook/recovery";
import { createAgent } from "./ai/grok";
import type { IntentAgent } from "./ai/agent";
import { legalResponse } from "./legal/page";
import { DeferredAudioAnalyzer, HttpAudioAnalyzer } from "./audio/analyzer";
import { R2AudioStore } from "./audio/storage";
import { SupabaseRepo } from "./db/supabase-repo";
import type { Repo } from "./db/repo";
import { ContentProvider } from "./services/provider";
import { createEventHandler, createSender, createTextSender } from "./webhook/events";
import { runScheduled } from "./ops/scheduled";
import { createLogger, type Logger } from "./lib/logger";
import { createAssetStickers } from "./whatsapp/stickers";
import { checkAllAi, type AiOverview } from "./ai/status";
import { createReprocessor, MANUAL_INTRO, REPROCESS_INTRO } from "./admin/reprocess";
import { handleApi } from "./mentoria/api";
import { handlePanel } from "./mentoria/panel";
import { createMatchingActions } from "./matching/actions";
import { NAMES_CRON, sendNamesDue } from "./matching/reminder";
import { createCuradoriaNotifier } from "./mentoria/curadoria-actions";
import { handleChat } from "./sim/chat";
import { PAGE_HTML } from "./sim/page";
import { handleWebhookPost, type EventHandler, type WaitUntilCtx } from "./webhook/handler";

export type Env = Record<string, unknown> & { AUDIOS?: R2Bucket; ASSETS?: Fetcher };

export interface AppDeps {
  webhookToken: string;
  repo: Repo;
  logger: Logger;
  onEvent?: EventHandler;
  now?: () => Date;
  /** Endpoints admin (/admin/*). Sem isso, respondem 500 (config inválida). */
  admin?: AdminDeps;
  agent?: IntentAgent;
  sendText?: (to: string, body: string) => Promise<void>;
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
    const agent = createAgent(cfg, logger);
    return {
      webhookToken: cfg.evolutionWebhookToken,
      repo,
      logger,
      ...(agent ? { agent, sendText: createTextSender(cfg, { repo, logger }) } : {}),
      onEvent: createEventHandler(cfg, {
        repo, logger, content,
        ...(agent ? { agent } : {}),
        ...(env.ASSETS ? { stickers: createAssetStickers({ fetch: (u) => env.ASSETS!.fetch(u) }) } : {}),
        // Áudio sempre é guardado (R2). Com analisador síncrono configurado, ele responde na hora; sem ele,
        // a análise é feita pelo sistema externo, que busca o áudio pela API (/api/v1).
        ...(env.AUDIOS
          ? {
              audio: {
                media: createMediaClient({ url: cfg.evolutionUrl, apiKey: cfg.evolutionApiKey, instance: cfg.evolutionInstance, mediaHosts: cfg.mediaUrlHosts }),
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
        ...(env.AUDIOS && cfg.mediaUrlHosts.length > 0
          ? {
              reprocessAudio: createReprocessor({ cfg, repo, logger, bucket: env.AUDIOS, content }, { intro: REPROCESS_INTRO, staged: false }),
            }
          : {}),
      },
    };
  } catch (e) {
    logger.log("error", "config_invalid", { message: (e as Error).message });
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env = {}, ctx?: ExecutionContext): Promise<Response> {
    configurePessoaIdSecret(env.PESSOA_ID_SECRET);
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
        // Avisar os participantes da decisão da equipe precisa da config completa (Evolution etc.); se ela estiver inválida,
        // a API continua gravando o resultado e só não avisa (o notebook reenvia).
        let notify: ReturnType<typeof createCuradoriaNotifier> | undefined;
        try { notify = createCuradoriaNotifier(loadConfig(env), { repo, logger }); } catch { notify = undefined; }
        return handleApi(request, {
          apiKey, repo, bucket: env.AUDIOS, people: repo,
          ...(notify ? { notify, ...(ctx ? { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) } : {}) } : {}),
        });
      }
      // Conectar mentor/mentorado pelo painel precisa da config completa (Evolution etc.); se ela estiver inválida, o painel
      // continua funcionando para leitura e os botões respondem 503.
      let matching: ReturnType<typeof createMatchingActions> | undefined;
      try { matching = createMatchingActions(loadConfig(env), { repo, logger }); } catch { matching = undefined; }
      const aiStatus = async (): Promise<AiOverview> => {
        try { return await checkAllAi(loadConfig(env), env); }
        catch { return { items: [{ id: "other", active: true, state: "config_invalid", message: "Configuração inválida: não deu para checar a IA.", provider: "IA", model: "", checkedAt: new Date().toISOString() }] }; }
      };
      // Enviar o áudio de uma mentoria pelo painel (arquivo grande que não chegou pelo WhatsApp): precisa da config e do R2.
      let manualAudio: ((r: ReprocessRequest) => Promise<ReprocessResult>) | undefined;
      try {
        if (env.AUDIOS) manualAudio = createReprocessor({ cfg: loadConfig(env), repo, logger, bucket: env.AUDIOS }, { intro: MANUAL_INTRO, staged: true });
      } catch { manualAudio = undefined; }
      return handlePanel(request, { env, repo, bucket: env.AUDIOS, aiStatus, ...(matching ? { matching } : {}), ...(manualAudio ? { manualAudio } : {}) });
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
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Dois crons (wrangler.toml): o de 1 em 1 minuto só envia os nomes 5 min antes das mentorias; o diário (C7.1) faz consulta
    // leve, limpeza de idempotência, destrava de áudio e uso do mês (e nunca envia mensagem).
    configurePessoaIdSecret(env.PESSOA_ID_SECRET);
    const logger = createLogger();
    try {
      const cfg = loadConfig(env);
      if (event.cron === NAMES_CRON) {
        const repo = new SupabaseRepo(cfg.supabaseUrl, cfg.supabaseServiceKey);
        await sendNamesDue({
          repo, logger, send: createSender(cfg, { repo, logger }), maxPerDay: cfg.maxBotMsgsPerUserPerDay, maxPer10Min: cfg.maxBotMsgsPerUserPer10Min,
          now: () => new Date(),
        });
        // Rede de segurança: responde o que chegou enquanto o bot, a internet ou a Evolution estavam fora do ar.
        try {
          const app = buildDeps(env, logger);
          if (app?.onEvent) {
            const evo = { url: cfg.evolutionUrl, apiKey: cfg.evolutionApiKey, instance: cfg.evolutionInstance };
            await recoverMissed({
              repo: app.repo, logger, onEvent: app.onEvent, ...(app.agent ? { agent: app.agent } : {}), ...(app.sendText ? { sendText: app.sendText } : {}),
              fetchRecent: (sinceSec) => fetchRecentInbound(evo, sinceSec),
            });
          }
        } catch (e) {
          logger.log("error", "recovery_failed", { error: e instanceof Error ? e.name : "unknown" });
        }
        return;
      }
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
