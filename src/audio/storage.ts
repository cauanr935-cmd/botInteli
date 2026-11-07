// Armazenamento dos áudios (Cloudflare R2) + versão em memória para testes.
import { monthKey } from "../budget/month";

export interface AudioStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class R2AudioStore implements AudioStore {
  constructor(private readonly bucket: R2Bucket) {}
  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  }
  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

export class MemoryAudioStore implements AudioStore {
  readonly objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    this.objects.set(key, { bytes, mime });
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

const EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
};
export const ALLOWED_AUDIO_MIMES: readonly string[] = Object.keys(EXT);

/** "audio/ogg; codecs=opus" -> "audio/ogg". */
export function baseMime(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}
export function isAllowedAudioMime(mime: string): boolean {
  return ALLOWED_AUDIO_MIMES.includes(baseMime(mime));
}

/** audios/<hash do telefone>/<YYYY-MM>/<uuid>.<ext>: nunca o telefone em claro (R3/R6). */
export function audioKey(waIdHash: string, at: Date, timezone: string, id: string, mime: string): string {
  return `audios/${waIdHash}/${monthKey(at, timezone)}/${id}.${EXT[baseMime(mime)] ?? "bin"}`;
}
