// Reprocesso de áudio: devolve a conversa ao fluxo de mentoria como se o áudio tivesse chegado pelo WhatsApp.
// Usado pelo endpoint admin (URL assinada do S3/R2) e pelo painel (arquivo enviado pela equipe e guardado em staging no R2).
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import type { Logger } from "../lib/logger";
import type { ContentProvider } from "../services/provider";
import type { MediaClient } from "../whatsapp/client";
import { createMediaClient } from "../whatsapp/evolutionClient";
import { createSender } from "../webhook/events";
import { DeferredAudioAnalyzer } from "../audio/analyzer";
import { processAudio } from "../audio/pipeline";
import { R2AudioStore } from "../audio/storage";
import type { ReprocessRequest, ReprocessResult } from "./budget";

export const STAGED_PREFIX = "staged:";
export const STAGING_FOLDER = "staging/";

export const REPROCESS_INTRO = "Poxa, conseguimos processar a sua mentoria! 🎉 Desculpa o perrengue com o arquivo grande.";
export const MANUAL_INTRO = "Recebemos o áudio da sua mentoria! 🎉 Desculpa o perrengue com o arquivo.";

/** Cliente de mídia que lê o arquivo de staging do próprio R2 (url `staged:<chave>`); o resto cai no cliente da Evolution. */
export function stagedMediaClient(bucket: R2Bucket, base: MediaClient): MediaClient {
  return {
    ...base,
    async openStream(url) {
      if (!url.startsWith(STAGED_PREFIX)) return base.openStream ? base.openStream(url) : { ok: false };
      const key = url.slice(STAGED_PREFIX.length);
      if (!key.startsWith(STAGING_FOLDER)) return { ok: false };
      const obj = await bucket.get(key);
      return obj ? { ok: true, body: obj.body, size: obj.size } : { ok: false };
    },
  };
}

export interface ReprocessorDeps { cfg: Config; repo: Repo; logger: Logger; bucket: R2Bucket; content?: ContentProvider }

/** `intro` é a frase de sucesso; `staged` liga a leitura do arquivo guardado no R2 pelo painel. */
export function createReprocessor(d: ReprocessorDeps, opts: { intro: string; staged: boolean }): (r: ReprocessRequest) => Promise<ReprocessResult> {
  const { cfg, repo, logger, bucket } = d;
  return async (r) => {
    // R1: só reprocessa quem já escreveu ao bot (sendGuarded também recusa contato frio).
    if ((await repo.getLastUserMessageAt(r.phone)) === null) return "unknown_contact";
    const stored = await repo.getConversation(r.phone);
    // Marca como "processando" para o pipeline poder devolver a conversa a AWAIT_AUDIO/MENT_ROLE.
    const moved = await repo.saveConversation(r.phone, stored.version, {
      state: "PROCESSING_AUDIO", previousState: null, optedOutAt: null, hintSentInState: true,
    });
    if (!moved) return "failed";
    const base = createMediaClient({ url: cfg.evolutionUrl, apiKey: cfg.evolutionApiKey, instance: cfg.evolutionInstance, mediaHosts: cfg.mediaUrlHosts });
    return processAudio(
      { type: "audio", wamid: r.messageId, from: r.phone, mediaId: r.messageId, mimeType: r.mimeType, voice: false, mediaUrl: r.mediaUrl, ...(r.fileSize ? { fileSize: r.fileSize } : {}) },
      true,
      {
        repo, logger, send: createSender(cfg, { repo, logger }), ...(d.content ? { content: d.content } : {}),
        media: opts.staged ? stagedMediaClient(bucket, base) : base,
        store: new R2AudioStore(bucket), analyzer: new DeferredAudioAnalyzer(),
        maxAudioBytes: cfg.maxAudioBytes, maxAudioStreamBytes: cfg.maxAudioStreamBytes,
        maxPerDay: cfg.maxBotMsgsPerUserPerDay, maxPer10Min: cfg.maxBotMsgsPerUserPer10Min, timezone: cfg.timezone,
        successIntro: opts.intro,
      },
      "mentoria",
    );
  };
}
