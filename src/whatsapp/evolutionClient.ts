// ÚNICO arquivo que conhece a Evolution API v2 (modo Baileys): endpoints de envio e de download de mídia.
// Toda mensagem do bot sai por sendGuarded (client.ts), que chama sendViaEvolution daqui.
// O motor de conversa continua falando o formato interno (o mesmo dos builders); a tradução acontece só aqui.
//
// ATENÇÃO (formatos NÃO verificados contra uma instância real — ver docs/PENDENCIAS_HUMANAS.md):
//  - sendText: corpo `{ number, text }` (código-fonte v2.3.x; a doc pública cita `textMessage.text`).
//  - sendButtons/sendList nativos: instáveis no Baileys; por isso o padrão é o texto numerado (choices.ts).
import type { OutboundMessage } from "./client";
import { describeInteractive, renderNumbered, toPending } from "./choices";
import type { PendingChoiceOption } from "../db/repo";
import type { DownloadResult, MediaClient, MediaInfo } from "./client";

export interface EvolutionConfig {
  /** Base, sem barra final (ex.: https://evo.exemplo.com). */
  url: string;
  apiKey: string;
  instance: string;
  /** true = sendButtons/sendList nativos; false = texto numerado (padrão). */
  nativeInteractive?: boolean;
}

export type TransportResult =
  | { ok: true; messageId: string | null; /** Opções a guardar para traduzir a resposta numérica; null = apagar. */ pending: PendingChoiceOption[] | null }
  | { ok: false; code: string; httpStatus?: number; detail?: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

interface Planned { path: string; body: Obj; pending: PendingChoiceOption[] | null }

/** Decide endpoint e corpo. null = tipo que a Evolution/Baileys não entrega (ex.: template, Flow). */
function plan(message: OutboundMessage, evo: EvolutionConfig): Planned | null {
  const { to } = message;
  if (message.type === "text") {
    const body = isObj(message.text) && typeof message.text.body === "string" ? message.text.body : null;
    return body === null ? null : { path: "sendText", body: { number: to, text: body }, pending: null };
  }
  if (message.type !== "interactive") return null;
  const shape = describeInteractive(message.interactive);
  if (!shape) return null;
  if (!evo.nativeInteractive) {
    return { path: "sendText", body: { number: to, text: renderNumbered(shape) }, pending: toPending(shape) };
  }
  if (shape.kind === "button") {
    return {
      path: "sendButtons",
      body: { number: to, title: shape.body, buttons: shape.options.map((o) => ({ type: "reply", displayText: o.title, id: o.id })) },
      pending: null,
    };
  }
  return {
    path: "sendList",
    body: {
      number: to, title: shape.sectionTitle, description: shape.body, buttonText: shape.buttonText,
      sections: [{ title: shape.sectionTitle, rows: shape.options.map((o) => ({ title: o.title, description: o.description ?? "", rowId: o.id })) }],
    },
    pending: null,
  };
}

/** Tipos que a Evolution/Baileys entrega aqui: texto e botões/lista (templates e Flows não existem neste canal). */
export function isSendable(message: OutboundMessage): boolean {
  return plan(message, { url: "", apiKey: "", instance: "" }) !== null;
}

export async function sendViaEvolution(
  message: OutboundMessage, evo: EvolutionConfig, fetchImpl?: typeof fetch,
): Promise<TransportResult> {
  const p = plan(message, evo);
  if (!p) return { ok: false, code: "unsupported_type" };
  const f = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const res = await f(`${evo.url}/message/${p.path}/${encodeURIComponent(evo.instance)}`, {
    method: "POST",
    headers: { apikey: evo.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(p.body),
  });
  if (!res.ok) {
    // Diagnóstico sem telefone nem conteúdo (R3).
    const err = (await res.json().catch(() => null)) as { message?: unknown; response?: { message?: unknown } } | null;
    const raw = err?.response?.message ?? err?.message;
    const detail = (typeof raw === "string" ? raw : JSON.stringify(raw ?? "")).replace(/\d{6,}/g, "***").slice(0, 200);
    return { ok: false, code: `http_${res.status}`, httpStatus: res.status, detail };
  }
  const json = (await res.json().catch(() => null)) as { key?: { id?: unknown } } | null;
  const id = json?.key?.id;
  return { ok: true, messageId: typeof id === "string" ? id : null, pending: p.pending };
}

/** ---- Mídia recebida ---- */
export interface EvolutionMediaOptions extends EvolutionConfig {
  fetchImpl?: typeof fetch;
}

const MEDIA_SCHEME = "evolution-media:";

/**
 * Baixa mídia pelo endpoint da Evolution (POST /chat/getBase64FromMediaMessage/{instance}).
 * Não há URL temporária como na Meta: `getInfo` só embrulha o id e o download pede o conteúdo em base64.
 * O pipeline de áudio continua igual (mesma interface MediaClient).
 */
export function createMediaClient(o: EvolutionMediaOptions): MediaClient {
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    async getInfo(mediaId): Promise<MediaInfo> {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(mediaId)) throw new Error("media_id inválido");
      return { url: MEDIA_SCHEME + mediaId };
    },
    async download(url, maxBytes): Promise<DownloadResult> {
      if (!url.startsWith(MEDIA_SCHEME)) return { ok: false, reason: "error" };
      const id = url.slice(MEDIA_SCHEME.length);
      let res: Response;
      try {
        res = await f(`${o.url}/chat/getBase64FromMediaMessage/${encodeURIComponent(o.instance)}`, {
          method: "POST",
          headers: { apikey: o.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { key: { id } }, convertToMp4: false }),
        });
      } catch {
        return { ok: false, reason: "error" };
      }
      if ([404, 410].includes(res.status)) return { ok: false, reason: "expired" };
      if (!res.ok) return { ok: false, reason: "error" };
      try {
        const j = (await res.json()) as { base64?: unknown; mimetype?: unknown };
        if (typeof j.base64 !== "string" || j.base64 === "") return { ok: false, reason: "error" };
        const b64 = j.base64.replace(/^data:[^;]*;base64,/, "");
        if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) return { ok: false, reason: "too_large" };
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (bytes.length > maxBytes) return { ok: false, reason: "too_large" };
        return { ok: true, bytes, ...(typeof j.mimetype === "string" ? { contentType: j.mimetype } : {}) };
      } catch {
        return { ok: false, reason: "error" };
      }
    },
  };
}
