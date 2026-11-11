// Material anexado junto da dúvida (documentos para o mentor ver antes da mentoria).
// Baixa a mídia, guarda no R2 e registra em `doubt_materials`. NÃO envia mensagem (a resposta é da decisão pura).
import type { Repo } from "../db/repo";
import { monthKey } from "../budget/month";
import { baseMime, type AudioStore } from "../audio/storage";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import type { MediaClient } from "../whatsapp/client";
import type { DocumentEvent } from "../whatsapp/types";

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
};
export const ALLOWED_DOC_MIMES: readonly string[] = Object.keys(EXT);
export const isAllowedDocMime = (mime: string): boolean => ALLOWED_DOC_MIMES.includes(baseMime(mime));

/** materiais/<hash do telefone>/<YYYY-MM>/<uuid>.<ext>: nunca o telefone em claro (R3/R6). */
export function materialKey(waIdHash: string, at: Date, timezone: string, id: string, mime: string): string {
  return `materiais/${waIdHash}/${monthKey(at, timezone)}/${id}.${EXT[baseMime(mime)] ?? "bin"}`;
}

export interface MaterialDeps {
  repo: Repo;
  logger: Logger;
  media: MediaClient;
  store: AudioStore;
  maxBytes: number;
  timezone: string;
  now?: () => Date;
  uuid?: () => string;
}
export type MaterialOutcome = "stored" | "invalid" | "failed" | "no_consent";

export async function processMaterial(msg: DocumentEvent, deps: MaterialDeps): Promise<MaterialOutcome> {
  const clock = deps.now ?? (() => new Date());
  const from = maskPhone(msg.from);
  // R6: sem consentimento gravado, nada é baixado nem guardado.
  const reg = await deps.repo.getRegistration(msg.from);
  if (!reg.consentAt) {
    deps.logger.log("warn", "material_without_consent", { from });
    return "no_consent";
  }
  if (msg.mimeType !== undefined && !isAllowedDocMime(msg.mimeType)) return "invalid";
  let info;
  try {
    info = await deps.media.getInfo(msg.mediaId);
  } catch {
    deps.logger.log("warn", "material_info_failed", { from });
    return "failed";
  }
  const mimeRaw = info.mimeType ?? msg.mimeType;
  if (mimeRaw === undefined || !isAllowedDocMime(mimeRaw)) return "invalid";
  if (info.fileSize !== undefined && info.fileSize > deps.maxBytes) return "invalid";
  const dl = await deps.media.download(info.url, deps.maxBytes);
  if (!dl.ok) return dl.reason === "too_large" ? "invalid" : "failed";
  if (dl.bytes.length === 0 || dl.bytes.length > deps.maxBytes) return "invalid";

  const mime = baseMime(mimeRaw);
  const waIdHash = await hashWaId(msg.from);
  const id = (deps.uuid ?? (() => crypto.randomUUID()))();
  const key = materialKey(waIdHash, clock(), deps.timezone, id, mime);
  await deps.store.put(key, dl.bytes, mime);
  try {
    await deps.repo.insertMaterial(msg.from, {
      id, waIdHash, r2Key: key, mime, bytes: dl.bytes.length,
      ...(msg.filename ? { filename: msg.filename.slice(0, 200) } : {}), at: clock(),
    });
  } catch (e) {
    await deps.store.delete(key).catch(() => undefined); // não deixa arquivo órfão sem registro
    throw e;
  }
  return "stored";
}
