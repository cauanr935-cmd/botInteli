// Monta o tratador de eventos do webhook (mensagem -> motor -> sendGuarded).
// Vive aqui (e não em index.ts) para o simulador da Etapa 8 usar exatamente a mesma fiação de produção.
import type { Config } from "../config";
import { handleIncomingMessage } from "../conversation/engine";
import type { Repo } from "../db/repo";
import type { Logger } from "../lib/logger";
import type { AudioAnalyzer } from "../audio/analyzer";
import { processAudio } from "../audio/pipeline";
import type { AudioStore } from "../audio/storage";
import type { ContentProvider } from "../services/provider";
import { sendGuarded, type MediaClient, type OutboundMessage, type SendContext } from "../whatsapp/client";
import type { IntentAgent } from "../ai/agent";
import type { AudioEvent, DocumentEvent } from "../whatsapp/types";
import { processMaterial } from "../materials/pipeline";
import type { EventHandler } from "./handler";

export interface EventHandlerPorts {
  repo: Repo;
  logger: Logger;
  content: ContentProvider;
  /** Sem estes três, o áudio só muda o estado (binding R2 ausente). */
  audio?: { media: MediaClient; store: AudioStore; analyzer: AudioAnalyzer };
  fetchImpl?: typeof fetch;
  /** Troca o transporte de saída (chat web simulador). */
  transport?: SendContext["transport"];
  now?: () => Date;
  /** IA (Grok) opcional que intervém quando o bot não entende. */
  agent?: IntentAgent;
  /** Contexto recente da conversa para a IA (só canais que guardam o histórico; o webhook do WhatsApp não tem). */
  recentContext?: readonly string[];
}

export function createEventHandler(cfg: Config, p: EventHandlerPorts): EventHandler {
  const { repo, logger, content } = p;
  return async (ev) => {
    const send = (message: OutboundMessage) =>
      sendGuarded(message, {
        repo, logger, phoneNumberId: cfg.evolutionInstance, evolutionUrl: cfg.evolutionUrl,
        evolutionApiKey: cfg.evolutionApiKey, evolutionInstance: cfg.evolutionInstance,
        evolutionNativeInteractive: cfg.evolutionNativeInteractive, stopAt: cfg.stopAt, timezone: cfg.timezone,
        ...(p.fetchImpl ? { fetchImpl: p.fetchImpl } : {}), ...(p.transport ? { transport: p.transport } : {}),
        ...(p.now ? { now: p.now } : {}),
      });
    const a = p.audio;
    const audio = a
      ? {
          process: (m: AudioEvent, hintAlreadySent: boolean, purpose?: "mentoria" | "profile") =>
            processAudio(m, hintAlreadySent, {
              repo, logger, send, content, media: a.media, store: a.store, analyzer: a.analyzer,
              maxAudioBytes: cfg.maxAudioBytes, maxPerDay: cfg.maxBotMsgsPerUserPerDay,
              maxPer10Min: cfg.maxBotMsgsPerUserPer10Min, timezone: cfg.timezone,
              ...(p.now ? { now: p.now } : {}),
            }, purpose),
        }
      : undefined;
    const material = a
      ? {
          process: (m: DocumentEvent) =>
            processMaterial(m, {
              repo, logger, media: a.media, store: a.store, maxBytes: cfg.maxAudioBytes, timezone: cfg.timezone,
              ...(p.now ? { now: p.now } : {}),
            }),
        }
      : undefined;
    await handleIncomingMessage(ev, {
      ...(audio ? { audio } : {}), ...(material ? { material } : {}), ...(p.agent ? { agent: p.agent } : {}), ...(p.recentContext?.length ? { recentContext: p.recentContext } : {}), send, repo, logger, content,
      maxPerDay: cfg.maxBotMsgsPerUserPerDay,
      maxPer10Min: cfg.maxBotMsgsPerUserPer10Min,
      ...(p.now ? { now: p.now } : {}),
      mentoria: { timezone: cfg.timezone, ...(a ? { store: a.store } : {}) },
      registration: {
        ...(cfg.whatsappFlowId ? { flowId: cfg.whatsappFlowId } : {}),
        privacyUrl: cfg.privacyPolicyUrl, termsVersion: cfg.termsVersion,
      },
    });
  };
}
