// Armazenamento dos áudios (Cloudflare R2) + versão em memória para testes.
import { monthKey } from "../budget/month";

export interface AudioStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Grava um stream de tamanho conhecido sem carregá-lo na memória (arquivos grandes). */
  putStream?(key: string, body: ReadableStream<Uint8Array>, size: number, mime: string): Promise<void>;
}

export class R2AudioStore implements AudioStore {
  constructor(private readonly bucket: R2Bucket) {}
  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  }
  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
  async putStream(key: string, body: ReadableStream<Uint8Array>, size: number, mime: string): Promise<void> {
    // O R2 exige o tamanho de antemão para um stream: FixedLengthStream recusa se os bytes não baterem com `size`.
    const fixed = new FixedLengthStream(size);
    const piping = body.pipeTo(fixed.writable);
    try {
      await this.bucket.put(key, fixed.readable, { httpMetadata: { contentType: mime } });
      await piping;
    } catch (e) {
      await piping.catch(() => undefined);
      await this.bucket.delete(key).catch(() => undefined);
      throw e;
    }
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
  async putStream(key: string, body: ReadableStream<Uint8Array>, size: number, mime: string): Promise<void> {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    if (bytes.length !== size) throw new Error("tamanho do stream diferente do informado");
    this.objects.set(key, { bytes, mime });
  }
}

// Formatos aceitos: os do WhatsApp (nota de voz e arquivo de áudio) e os de arquivos gravados antes, em qualquer app
// ou gravador (WAV, M4A, MP3, WebM, FLAC...). O bot só guarda; a análise é do serviço externo (via API).
const EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/3gpp": "3gp",
  "audio/aiff": "aiff",
  "audio/x-ms-wma": "wma",
};
export const ALLOWED_AUDIO_MIMES: readonly string[] = Object.keys(EXT);

/** Nomes alternativos que navegadores e aparelhos usam para os mesmos formatos. */
const ALIASES: Record<string, string> = {
  "audio/mp3": "audio/mpeg", "audio/mpeg3": "audio/mpeg", "audio/x-mpeg-3": "audio/mpeg", "audio/x-mpeg": "audio/mpeg", "audio/mpga": "audio/mpeg",
  "audio/m4a": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/x-mp4": "audio/mp4", "audio/mp4a-latm": "audio/mp4", "audio/x-m4p": "audio/mp4", "audio/x-m4b": "audio/mp4", "audio/m4b": "audio/mp4",
  "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav", "audio/vnd.wav": "audio/wav",
  "audio/x-aac": "audio/aac", "audio/aacp": "audio/aac",
  "audio/x-flac": "audio/flac",
  "application/ogg": "audio/ogg", "audio/x-ogg": "audio/ogg", "audio/vorbis": "audio/ogg",
  "audio/x-opus+ogg": "audio/ogg",
  // Um .mp4 (gravação de tela/reunião, vídeo enviado como vídeo ou como documento) é aceito como o áudio dele: o serviço de análise lê a faixa de áudio.
  "video/mp4": "audio/mp4", "video/x-m4v": "audio/mp4", "video/m4v": "audio/mp4", "video/webm": "audio/webm", "video/3gpp": "audio/3gpp", "video/3gpp2": "audio/3gpp",
  // MPEG (.mpeg/.mpg/.mp2) e Ogg em vídeo: o contêiner é aceito como o áudio dele.
  "video/mpeg": "audio/mpeg", "video/x-mpeg": "audio/mpeg", "audio/mp2": "audio/mpeg", "audio/x-mp2": "audio/mpeg", "video/ogg": "audio/ogg",
  "audio/3gpp2": "audio/3gpp", "audio/x-aiff": "audio/aiff", "audio/wma": "audio/x-ms-wma",
};
/** Extensão do arquivo -> tipo (para quando o aparelho não informa o tipo ou informa "application/octet-stream"). */
const BY_EXTENSION: Record<string, string> = {
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus", mp3: "audio/mpeg", mpga: "audio/mpeg", mpeg: "audio/mpeg", mpg: "audio/mpeg", mp2: "audio/mpeg", ogv: "audio/ogg", spx: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4", m4v: "audio/mp4", m4p: "audio/mp4", m4b: "audio/mp4", m4r: "audio/mp4",
  aac: "audio/aac", amr: "audio/amr", wav: "audio/wav", wave: "audio/wav", webm: "audio/webm", weba: "audio/webm",
  flac: "audio/flac", "3gp": "audio/3gpp", "3gpp": "audio/3gpp", aif: "audio/aiff", aiff: "audio/aiff", wma: "audio/x-ms-wma",
};

/** "audio/ogg; codecs=opus" -> "audio/ogg". */
export function baseMime(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}
/** Tipo canônico (o que é guardado e enviado ao analisador) ou null se não for um áudio aceito. */
export function canonicalAudioMime(mime: string): string | null {
  const b = baseMime(mime);
  const c = ALIASES[b] ?? b;
  return ALLOWED_AUDIO_MIMES.includes(c) ? c : null;
}
export function isAllowedAudioMime(mime: string): boolean {
  return canonicalAudioMime(mime) !== null;
}
/** Tipo de áudio pela extensão do nome do arquivo (ex.: "reuniao.m4a"); null se não for uma extensão de áudio conhecida. */
export function audioMimeFromFilename(name: string | undefined): string | null {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec((name ?? "").trim());
  return m ? (BY_EXTENSION[(m[1] as string).toLowerCase()] ?? null) : null;
}
/** Melhor tipo de áudio para um arquivo: o declarado, se for um áudio aceito; senão o da extensão do nome. */
export function resolveAudioMime(declared: string | undefined, filename?: string): string | null {
  const d = declared ? canonicalAudioMime(declared) : null;
  if (d) return d;
  // Tipo ausente ou genérico: confia na extensão. Um tipo claramente não-áudio (ex.: application/pdf) continua recusado.
  const generic = !declared || baseMime(declared) === "application/octet-stream" || baseMime(declared) === "binary/octet-stream";
  return generic ? audioMimeFromFilename(filename) : null;
}

/** Pastas do bucket: "informacoes" = áudios de perfil (gostos, time, nascimento...); "mentorias" = só mentorias registradas. */
/** "rejeitados" = quarentena: arquivo de um tipo que o bot não aceitou, guardado para a equipe conferir e corrigir. */
export type AudioFolder = "informacoes" | "mentorias" | "rejeitados";

/** audios/<pasta>/<hash do telefone>/<YYYY-MM>/<uuid>.<ext>: nunca o telefone em claro (R3/R6). */
export function audioKey(waIdHash: string, at: Date, timezone: string, id: string, mime: string, folder: AudioFolder = "mentorias"): string {
  return `audios/${folder}/${waIdHash}/${monthKey(at, timezone)}/${id}.${EXT[canonicalAudioMime(mime) ?? baseMime(mime)] ?? "bin"}`;
}
