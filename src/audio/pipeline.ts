// Pipeline de áudio (Etapa 6): baixar -> guardar no R2 -> analisador -> 1 mensagem com o resultado.
// Roda no MESMO processamento do evento (dentro do ctx.waitUntil do webhook), logo após a transição
// AWAIT_AUDIO -> PROCESSING_AUDIO. Nenhum envio acontece fora de deps.send (sendGuarded).
import type { Repo } from "../db/repo";
import { limited, type Counters, type State } from "../conversation/machine";
import { REPLIES, type Reply } from "../conversation/texts";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import { fallbackContent, type Content } from "../services/content";
import type { MediaClient, MediaInfo, OutboundMessage, SendResult } from "../whatsapp/client";
import type { AudioEvent } from "../whatsapp/types";
import type { AudioAnalyzer } from "./analyzer";
import { roleReply } from "../profile/decide";
import { PROFILE_TEXTS } from "../profile/texts";
import { audioSavedQuestion, earlyQuestion, savedFromMatchReply } from "../mentoria/decide";
import { completeFromMatch, matchForAudio } from "../matching/register";
import { notifyPartner } from "../mentoria/confirm";
import { audioKey, baseMime, canonicalAudioMime, isAllowedAudioMime, type AudioStore } from "./storage";

/** A URL da mídia expira em 5 minutos; com 30 s de folga, pedimos outra antes de baixar. */
export const MEDIA_URL_TTL_MS = 5 * 60 * 1000;
export const MEDIA_URL_SAFETY_MS = 30 * 1000;

export interface AudioPipelineDeps {
  repo: Repo;
  logger: Logger;
  send: (message: OutboundMessage) => Promise<SendResult>;
  media: MediaClient;
  store: AudioStore;
  analyzer: AudioAnalyzer;
  content?: { load(): Promise<Content> };
  maxAudioBytes: number;
  /** Teto para arquivos copiados em stream do S3 da Evolution (padrão: maxAudioBytes). */
  maxAudioStreamBytes?: number;
  maxPerDay: number;
  maxPer10Min: number;
  timezone: string;
  now?: () => Date;
  uuid?: () => string;
  /** Frase colocada antes da resposta de sucesso (reprocesso de um arquivo antes recusado). */
  successIntro?: string;
}

/** Junta a frase ao corpo da resposta (texto ou botões) sem criar uma segunda mensagem (R2). */
function withIntro(reply: Reply, intro: string | undefined): Reply {
  if (!intro) return reply;
  const r = reply as { type: string; text?: { body: string }; interactive?: { body?: { text?: string } } };
  if (r.type === "text" && r.text) return { ...reply, text: { ...r.text, body: `${intro}\n\n${r.text.body}` } } as Reply;
  const body = r.interactive?.body;
  if (body?.text) return { ...reply, interactive: { ...r.interactive, body: { ...body, text: `${intro}\n\n${body.text}` } } } as Reply;
  return reply;
}

export type AudioOutcome = "done" | "invalid" | "failed" | "no_consent";

type RunResult =
  | { kind: "ok"; text: string; /** Só no áudio de mentoria: id do arquivo guardado. */ audioId?: string }
  | { kind: "invalid" }
  | { kind: "failed" }
  | { kind: "no_consent" };

const DAY_MS = 24 * 60 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const MAX_CAS_ATTEMPTS = 4;

/** "mentoria": áudio do serviço (analisa e responde). "profile": áudio de perfil do cadastro (só guarda; análise é externa). */
export type AudioPurpose = "mentoria" | "profile";

export async function processAudio(
  msg: AudioEvent, hintAlreadySent: boolean, deps: AudioPipelineDeps, purpose: AudioPurpose = "mentoria",
): Promise<AudioOutcome> {
  const clock = deps.now ?? (() => new Date());
  const from = maskPhone(msg.from);
  const content = deps.content ? await deps.content.load().catch(() => fallbackContent) : fallbackContent;

  let result: RunResult;
  try {
    result = await run(msg, content, deps, purpose);
  } catch (e) {
    deps.logger.log("error", "audio_pipeline_error", { from, error: e instanceof Error ? e.name : "unknown" });
    result = { kind: "failed" };
  }

  // Quem tem uma mentoria CONFIRMADA no matching só manda o áudio: papel, parceiro, assunto e data vêm do match (nada de perguntar
  // contato nem assunto). Áudio antes do horário marcado pede confirmação em vez de ser recusado (MENT_EARLY_CONFIRM).
  let fromMatch: { state: State; reply: Reply; notify?: { audioId: string; partnerHash: string } } | null = null;
  if (purpose === "mentoria" && result.kind === "ok" && result.audioId) {
    const found = await matchForAudio(deps.repo, msg.from, clock());
    if (found?.early) {
      fromMatch = { state: "MENT_EARLY_CONFIRM", reply: earlyQuestion() };
    } else if (found) {
      const done = await completeFromMatch({ repo: deps.repo, logger: deps.logger, now: clock(), timezone: deps.timezone }, msg.from, result.audioId, found.match);
      if (done) fromMatch = { state: "AWAIT_AUDIO", reply: savedFromMatchReply(content), notify: { audioId: result.audioId, partnerHash: done.partnerHash } };
    }
  }

  // Volta a AWAIT_AUDIO (o próximo áudio já é analisado sem nova instrução), salvo se a pessoa saiu no meio.
  const isHint = result.kind !== "ok";
  const sendHint = isHint && result.kind !== "no_consent" && !hintAlreadySent;
  let allowed = false;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const stored = await deps.repo.getConversation(msg.from);
    if (stored.state !== "PROCESSING_AUDIO") break; // ex.: "sair" durante o processamento: não responde
    const won = await deps.repo.saveConversation(msg.from, stored.version, {
      // Áudio de mentoria guardado: a pessoa descreve a mentoria (papel -> assunto -> data -> parceiro).
      state: purpose === "profile" ? (isHint ? "REG_PROFILE_AUDIO" : "PROFILE_ROLE") : (isHint ? "AWAIT_AUDIO" : (fromMatch?.state ?? "MENT_ROLE")),
      previousState: null, optedOutAt: null,
      hintSentInState: isHint ? hintAlreadySent || sendHint : false,
    });
    if (won) { allowed = true; break; }
  }

  // Mentoria já completa pelo match: pede a confirmação à outra pessoa (mesmo que a resposta a quem enviou não caiba nos limites).
  if (fromMatch?.notify) {
    await notifyPartner(fromMatch.notify.audioId, fromMatch.notify.partnerHash, {
      repo: deps.repo, logger: deps.logger, send: deps.send, maxPerDay: deps.maxPerDay, maxPer10Min: deps.maxPer10Min, now: clock,
    });
  }

  const outcome: AudioOutcome =
    result.kind === "ok" ? "done" : result.kind === "invalid" ? "invalid" : result.kind === "failed" ? "failed" : "no_consent";
  if (!allowed || result.kind === "no_consent") return outcome;
  if (result.kind !== "ok" && !sendHint) return outcome; // dica única já usada: silêncio

  // Limites por pessoa (R2): sem vaga, silêncio (o resultado já está salvo).
  const now = clock();
  const sent = await deps.repo.listOutboundSince(await hashWaId(msg.from), new Date(now.getTime() - DAY_MS));
  const counters: Counters = {
    lastBotMsgAt: null, sentLastDay: sent.length,
    sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length,
    maxPerDay: deps.maxPerDay, maxPer10Min: deps.maxPer10Min,
  };
  if (limited(counters)) {
    deps.logger.log("info", "audio_reply_limited", { from });
    return outcome;
  }

  let reply: Reply;
  if (result.kind === "ok" && purpose === "profile") {
    reply = roleReply(content); // áudio de perfil guardado: a próxima pergunta é o papel
  } else if (result.kind === "ok") {
    reply = withIntro(fromMatch?.reply ?? audioSavedQuestion(), deps.successIntro); // mentoria: avisa que foi registrada + a primeira pergunta (resposta única)
  } else {
    reply = purpose === "profile"
      ? { type: "text", text: { body: content.text("audioProfileFailed", PROFILE_TEXTS.audioProfileFailed) } }
      : (result.kind === "invalid" ? REPLIES.audioInvalid : REPLIES.audioFailed)(content);
  }
  const r = await deps.send({ to: msg.from, ...reply });
  if (r.status !== "sent") deps.logger.log("info", "audio_reply_not_sent", { from, status: r.status });
  return outcome;
}

async function run(msg: AudioEvent, content: Content, deps: AudioPipelineDeps, purpose: AudioPurpose): Promise<RunResult> {
  const clock = deps.now ?? (() => new Date());
  const from = maskPhone(msg.from);

  // R6: sem consentimento gravado, nada é baixado nem guardado.
  const reg = await deps.repo.getRegistration(msg.from);
  if (!reg.consentAt) {
    deps.logger.log("warn", "audio_without_consent", { from });
    return { kind: "no_consent" };
  }

  // Tipo declarado no webhook inaceito: ainda baixa o arquivo para a QUARENTENA (a equipe confere e corrige), mas responde "inválido".
  const declaredBad = msg.mimeType !== undefined && !isAllowedAudioMime(msg.mimeType);

  if (!msg.mediaUrl) deps.logger.log("info", "audio_without_media_url", { from, size: msg.fileSize ?? null });
  // Arquivo grande: a Evolution já gravou no S3 (R2) e mandou a URL. Copia em stream (sem carregar na memória), sem o limite de 16 MB.
  if (msg.mediaUrl && deps.media.openStream && deps.store.putStream) {
    const limit = deps.maxAudioStreamBytes ?? deps.maxAudioBytes;
    if (msg.fileSize !== undefined && msg.fileSize > limit) return { kind: "invalid" };
    const opened = await deps.media.openStream(msg.mediaUrl);
    if (!opened.ok) {
      // Diagnóstico: mostra só o host (sem caminho nem parâmetros assinados) para configurar MEDIA_URL_HOSTS.
      let host = "invalido";
      try { host = new URL(msg.mediaUrl).hostname; } catch { /* mantém "invalido" */ }
      deps.logger.log("warn", "media_url_not_streamed", { from, host });
    }
    if (opened.ok) {
      const size = opened.size ?? msg.fileSize;
      if (size === undefined || size <= 0 || size > limit) {
        await opened.body.cancel().catch(() => undefined);
        return size !== undefined && size > limit ? { kind: "invalid" } : { kind: "failed" };
      }
      const waIdHash = await hashWaId(msg.from);
      const id = (deps.uuid ?? (() => crypto.randomUUID()))();
      const streamMime = msg.mimeType === undefined ? null : canonicalAudioMime(msg.mimeType);
      if (declaredBad || streamMime === null) {
        deps.logger.log("warn", "audio_type_rejected", { from, mime: baseMime(msg.mimeType ?? "desconhecido"), declared: baseMime(msg.mimeType ?? "nenhum"), bytes: size });
        const qMime = baseMime(msg.mimeType ?? "") || "application/octet-stream";
        await deps.store.putStream(audioKey(waIdHash, clock(), deps.timezone, id, qMime, "rejeitados"), opened.body, size, qMime).catch(() => undefined);
        return { kind: "invalid" };
      }
      const key = audioKey(waIdHash, clock(), deps.timezone, id, streamMime, purpose === "profile" ? "informacoes" : "mentorias");
      try {
        await deps.store.putStream(key, opened.body, size, streamMime);
      } catch {
        deps.logger.log("warn", "audio_stream_failed", { from, bytes: size });
        return { kind: "failed" };
      }
      return register(msg, deps, purpose, { id, waIdHash, key, mime: streamMime, bytes: size });
    }
  }

  let info: MediaInfo;
  try {
    info = await deps.media.getInfo(msg.mediaId);
  } catch {
    deps.logger.log("warn", "media_info_failed", { from });
    return { kind: "failed" };
  }
  let fetchedAt = clock();
  const mimeRaw = info.mimeType ?? msg.mimeType;
  const rejected = declaredBad || mimeRaw === undefined || !isAllowedAudioMime(mimeRaw);
  if (rejected) deps.logger.log("warn", "audio_type_rejected", { from, mime: baseMime(mimeRaw ?? "desconhecido"), declared: baseMime(msg.mimeType ?? "nenhum"), bytes: info.fileSize ?? null });
  if (info.fileSize !== undefined && info.fileSize > deps.maxAudioBytes) return { kind: "invalid" };

  let refreshed = false;
  const refresh = async (): Promise<boolean> => {
    refreshed = true;
    try {
      info = await deps.media.getInfo(msg.mediaId);
      fetchedAt = clock();
      return true;
    } catch {
      return false;
    }
  };

  // A URL vale 5 min: se o relógio indica que está perto de vencer, pede outra (uma vez só).
  if (clock().getTime() - fetchedAt.getTime() >= MEDIA_URL_TTL_MS - MEDIA_URL_SAFETY_MS) {
    if (!(await refresh())) return { kind: "failed" };
  }
  let dl = await deps.media.download(info.url, deps.maxAudioBytes);
  if (!dl.ok && dl.reason === "expired" && !refreshed) {
    if (!(await refresh())) return { kind: "failed" };
    dl = await deps.media.download(info.url, deps.maxAudioBytes);
  }
  if (!dl.ok) return dl.reason === "too_large" ? { kind: "invalid" } : { kind: "failed" };
  if (dl.bytes.length === 0 || dl.bytes.length > deps.maxAudioBytes) return { kind: "invalid" };

  const waIdHash = await hashWaId(msg.from);
  const id = (deps.uuid ?? (() => crypto.randomUUID()))();
  if (rejected) {
    // Quarentena: só o arquivo no R2 (sem registro, sem análise, sem avançar a conversa). Falha ao guardar não muda a resposta.
    const qMime = baseMime(mimeRaw ?? msg.mimeType ?? "") || "application/octet-stream";
    await deps.store.put(audioKey(waIdHash, clock(), deps.timezone, id, qMime, "rejeitados"), dl.bytes, qMime).catch(() => undefined);
    return { kind: "invalid" };
  }
  const mime = canonicalAudioMime(mimeRaw as string) ?? "audio/mpeg"; // já validado acima: nunca cai no padrão
  // Áudio de perfil (informações pessoais) e áudio de mentoria vão para pastas diferentes do bucket.
  const key = audioKey(waIdHash, clock(), deps.timezone, id, mime, purpose === "profile" ? "informacoes" : "mentorias");
  await deps.store.put(key, dl.bytes, mime);
  return register(msg, deps, purpose, { id, waIdHash, key, mime, bytes: dl.bytes.length });
}

interface StoredAudio { id: string; waIdHash: string; key: string; mime: string; bytes: number }

/** Registra o arquivo já guardado no R2 (igual para download em memória e cópia em stream). */
async function register(msg: AudioEvent, deps: AudioPipelineDeps, purpose: AudioPurpose, f: StoredAudio): Promise<RunResult> {
  const clock = deps.now ?? (() => new Date());
  const { id, waIdHash, key, mime } = f;
  // Mentoria: só o arquivo por enquanto (assunto, data e parceiro vêm da conversa; a mentoria só fica completa depois).
  const serviceId = purpose === "profile" ? "perfil" : "mentoria";
  try {
    await deps.repo.insertAudio({
      id, waIdHash, r2Key: key, mime, bytes: f.bytes, serviceId,
      status: "processing", result: null, createdAt: clock(), finishedAt: null,
    });
    // O rascunho aponta para este arquivo; recomeça limpo (um rascunho velho não se mistura com o novo).
    if (purpose !== "profile") {
      await deps.repo.saveMentoriaDraft(msg.from, null);
      await deps.repo.saveMentoriaDraft(msg.from, { audioId: id });
    }
  } catch (e) {
    await deps.repo.discardIncompleteMentoria(id).catch(() => undefined);
    await deps.store.delete(key).catch(() => undefined); // não deixa arquivo órfão sem registro
    throw e;
  }

  if (purpose === "profile") {
    // Só guarda: a transcrição e a análise do perfil são do sistema externo (via API).
    await deps.repo.finishAudio(id, "done", null, clock());
    return { kind: "ok", text: "" };
  }

  // R6: a análise (API externa) só acontece depois de o parceiro confirmar, e é feita pelo notebook via /api/v1.
  // Por isso o analisador síncrono NÃO é chamado aqui: a voz do parceiro está na gravação.
  return { kind: "ok", text: "", audioId: id };
}
