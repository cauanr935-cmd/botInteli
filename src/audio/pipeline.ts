// Pipeline de áudio (Etapa 6): baixar -> guardar no R2 -> analisador -> 1 mensagem com o resultado.
// Roda no MESMO processamento do evento (dentro do ctx.waitUntil do webhook), logo após a transição
// AWAIT_AUDIO -> PROCESSING_AUDIO. Nenhum envio acontece fora de deps.send (sendGuarded).
import type { Repo } from "../db/repo";
import { limited, type Counters } from "../conversation/machine";
import { REPLIES, type Reply } from "../conversation/texts";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import { fallbackContent, type Content } from "../services/content";
import { MENU_BUTTON_ID, MENU_FALLBACKS } from "../services/menu";
import { buildButtons, LIMITS } from "../whatsapp/builders";
import type { MediaClient, MediaInfo, OutboundMessage, SendResult } from "../whatsapp/client";
import type { AudioEvent } from "../whatsapp/types";
import type { AudioAnalyzer } from "./analyzer";
import { roleReply } from "../profile/decide";
import { PROFILE_TEXTS } from "../profile/texts";
import { MENTORIA_SAVED_TEXT } from "../mentoria/texts";
import { audioKey, canonicalAudioMime, isAllowedAudioMime, type AudioStore } from "./storage";

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
  maxPerDay: number;
  maxPer10Min: number;
  timezone: string;
  now?: () => Date;
  uuid?: () => string;
}

export type AudioOutcome = "done" | "invalid" | "failed" | "no_consent";

type RunResult =
  | { kind: "ok"; text: string }
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

  // Volta a AWAIT_AUDIO (o próximo áudio já é analisado sem nova instrução), salvo se a pessoa saiu no meio.
  const isHint = result.kind !== "ok";
  const sendHint = isHint && result.kind !== "no_consent" && !hintAlreadySent;
  let allowed = false;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const stored = await deps.repo.getConversation(msg.from);
    if (stored.state !== "PROCESSING_AUDIO") break; // ex.: "sair" durante o processamento: não responde
    const won = await deps.repo.saveConversation(msg.from, stored.version, {
      state: purpose === "profile" ? (isHint ? "REG_PROFILE_AUDIO" : "PROFILE_ROLE") : "AWAIT_AUDIO",
      previousState: null, optedOutAt: null,
      hintSentInState: isHint ? hintAlreadySent || sendHint : false,
    });
    if (won) { allowed = true; break; }
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
    const body = result.text.trim() === "" ? content.text("audioResultFallback", "Análise concluída.") : result.text;
    reply = buildButtons(body.length > LIMITS.body ? `${body.slice(0, LIMITS.body - 1)}…` : body, [
      { id: MENU_BUTTON_ID, title: content.text("menuButtonLabel", MENU_FALLBACKS.menuButtonLabel, 20) },
    ]);
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

  // Tipo declarado no webhook: recusa antes de qualquer chamada de rede.
  if (msg.mimeType !== undefined && !isAllowedAudioMime(msg.mimeType)) return { kind: "invalid" };

  let info: MediaInfo;
  try {
    info = await deps.media.getInfo(msg.mediaId);
  } catch {
    deps.logger.log("warn", "media_info_failed", { from });
    return { kind: "failed" };
  }
  let fetchedAt = clock();
  const mimeRaw = info.mimeType ?? msg.mimeType;
  if (mimeRaw === undefined || !isAllowedAudioMime(mimeRaw)) return { kind: "invalid" };
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

  const mime = canonicalAudioMime(mimeRaw) ?? "audio/mpeg"; // já validado acima: nunca cai no padrão
  const waIdHash = await hashWaId(msg.from);
  const id = (deps.uuid ?? (() => crypto.randomUUID()))();
  const key = audioKey(waIdHash, clock(), deps.timezone, id, mime);
  await deps.store.put(key, dl.bytes, mime);
  // Áudio do serviço "Registrar mentoria": só o arquivo (sem assunto nem parceiro). "Mentoria" marca o registro no painel/API.
  const mentoria = purpose === "profile" ? undefined : { subject: "Mentoria" };
  const serviceId = purpose === "profile" ? "perfil" : "mentoria";
  try {
    await deps.repo.insertAudio({
      id, waIdHash, r2Key: key, mime, bytes: dl.bytes.length, serviceId, ...(mentoria ? { mentoria } : {}),
      status: "processing", result: null, createdAt: clock(), finishedAt: null,
    });
  } catch (e) {
    await deps.store.delete(key).catch(() => undefined); // não deixa arquivo órfão sem registro
    throw e;
  }

  if (purpose === "profile") {
    // Só guarda: a transcrição e a análise do perfil são do sistema externo (via API).
    await deps.repo.finishAudio(id, "done", null, clock());
    return { kind: "ok", text: "" };
  }

  try {
    const res = await deps.analyzer.analyze({ bytes: dl.bytes, mime });
    await deps.repo.finishAudio(id, "done", res.raw, clock());
    // Analisador síncrono: o resultado já é a análise. Deferido: fica pendente até o sistema externo devolver pela API.
    if (mentoria && !deps.analyzer.deferred) await deps.repo.setAnalysisResult(id, res.raw, clock()).catch(() => undefined);
    return { kind: "ok", text: mentoria && deps.analyzer.deferred ? MENTORIA_SAVED_TEXT : res.text };
  } catch (e) {
    deps.logger.log("warn", "analyzer_failed", { from, error: e instanceof Error ? e.message : "unknown" });
    await deps.repo.finishAudio(id, "failed", null, clock()).catch(() => undefined);
    return { kind: "failed" };
  }
}
