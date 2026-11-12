// ÚNICO arquivo que conhece a URL da Graph API de envio (R1).
// Toda mensagem do bot sai por sendGuarded.
import { monthKey } from "../budget/month";
import type { Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import type { Logger } from "../lib/logger";

/** 23h30: 30 min de margem sobre a janela de 24h da Meta. */
export const WINDOW_MS = (23 * 60 + 30) * 60 * 1000;
const WARN_RATIO = 0.8;

export interface OutboundMessage {
  to: string;
  type: string;
  text?: { body: string; preview_url?: boolean };
  interactive?: unknown;
  [key: string]: unknown;
}

export interface SendContext {
  repo: Repo;
  logger: Logger;
  phoneNumberId: string;
  whatsappToken: string;
  graphApiVersion: string;
  stopAt: number;
  timezone: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export type SendResult =
  | { status: "sent"; wamid: string | null }
  | { status: "blocked_budget" }
  | { status: "blocked_manual_lock" }
  | { status: "blocked_window" }
  | { status: "blocked_template" }
  | { status: "error"; code: string };

function isTemplate(m: OutboundMessage): boolean {
  return String(m.type).trim().toLowerCase() === "template" || "template" in m;
}

export async function sendGuarded(message: OutboundMessage, ctx: SendContext): Promise<SendResult> {
  try {
    // 1. templates nunca (não são grátis)
    if (isTemplate(message)) return { status: "blocked_template" };

    const now = (ctx.now ?? (() => new Date()))();

    // 2 e 3. janela de 23h30 e trava manual: as duas leituras são independentes e rodam juntas (uma viagem de rede a menos).
    // A ordem das decisões é a mesma de antes e continua fail closed: erro em qualquer uma = não envia.
    const hashP = hashWaId(message.to);
    const [windowRes, lockRes] = await Promise.allSettled([
      ctx.repo.getLastUserMessageAt(message.to),
      ctx.repo.getManualLock(ctx.phoneNumberId),
    ]);
    if (windowRes.status === "rejected") return { status: "error", code: "window_lookup_failed" };
    const last = windowRes.value;
    if (!last || now.getTime() - last.getTime() > WINDOW_MS) return { status: "blocked_window" };
    if (lockRes.status === "rejected") return { status: "error", code: "lock_lookup_failed" };
    if (lockRes.value.locked) return { status: "blocked_manual_lock" };

    // 4. reserva atômica da vaga
    const month = monthKey(now, ctx.timezone);
    let outcome;
    try {
      outcome = await ctx.repo.reserveSlot(ctx.phoneNumberId, month, ctx.stopAt);
    } catch {
      ctx.logger.log("error", "budget_reserve_failed");
      return { status: "error", code: "reserve_failed" };
    }
    // Alertas de 80% e de disjuntor são só log: rodam junto com o envio, sem atrasá-lo (e são aguardados no fim).
    const alerts = emitAlerts(ctx, month, outcome);
    if (!outcome.ok) {
      await alerts;
      return { status: "blocked_budget" };
    }

    // 5. envio (a vaga NÃO é devolvida se falhar)
    const reservedAt = now;
    let wamid: string | null = null;
    let errorCode: string | null = null;
    try {
      const { to, ...rest } = message;
      const f = ctx.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
      const res = await f(
        `https://graph.facebook.com/${ctx.graphApiVersion}/${ctx.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${ctx.whatsappToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...rest }),
        },
      );
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
        wamid = body?.messages?.[0]?.id ?? null;
      } else {
        errorCode = `http_${res.status}`;
        // Diagnóstico: o erro da Meta (código/mensagem), nunca o conteúdo da mensagem nem o telefone.
        const err = (await res.json().catch(() => null)) as
          { error?: { message?: string; type?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } } | null;
        ctx.logger.log("warn", "whatsapp_send_failed", {
          status: res.status, messageType: message.type, metaCode: err?.error?.code ?? null, metaSubcode: err?.error?.error_subcode ?? null,
          metaType: err?.error?.type ?? null, metaMessage: (err?.error?.error_data?.details ?? err?.error?.message ?? "").replace(/\d{6,}/g, "***").slice(0, 200), // sem telefones (R3)
        });
      }
    } catch (e) {
      errorCode = "network_error";
      ctx.logger.log("warn", "whatsapp_send_exception", { messageType: message.type, error: e instanceof Error ? e.name : "unknown" });
    }

    // 6. outbound_log (falha aqui não muda o resultado do envio)
    try {
      await ctx.repo.insertOutboundLog({
        waIdHash: await hashP,
        messageType: message.type,
        wamid,
        reservedAt,
        sentOk: errorCode === null,
        errorCode,
      });
    } catch {
      ctx.logger.log("error", "outbound_log_failed");
    }
    await alerts;
    return errorCode === null ? { status: "sent", wamid } : { status: "error", code: errorCode };
  } catch {
    return { status: "error", code: "unexpected" };
  }
}

async function emitAlerts(
  ctx: SendContext,
  month: string,
  o: { reservedCount: number; stopAt: number; tripped: boolean },
): Promise<void> {
  try {
    if (o.reservedCount >= Math.ceil(o.stopAt * WARN_RATIO) && (await ctx.repo.claimBudgetAlert(ctx.phoneNumberId, month, "warn"))) {
      ctx.logger.log("warn", "budget_80_percent", { month, reserved: o.reservedCount, stopAt: o.stopAt });
    }
    if ((o.tripped || o.reservedCount >= o.stopAt) && (await ctx.repo.claimBudgetAlert(ctx.phoneNumberId, month, "trip"))) {
      ctx.logger.log("critical", "budget_circuit_open", { month, reserved: o.reservedCount, stopAt: o.stopAt });
    }
  } catch {
    // alerta é best-effort; nunca afeta a decisão de envio
  }
}

/** ---- Mídia recebida (Etapa 6) ---- */
export interface MediaInfo {
  url: string;
  mimeType?: string;
  fileSize?: number;
}
export type DownloadResult =
  | { ok: true; bytes: Uint8Array; contentType?: string }
  | { ok: false; reason: "expired" | "too_large" | "error" };

export interface MediaClient {
  /** GET /{media_id}: devolve a URL (expira em 5 min). */
  getInfo(mediaId: string): Promise<MediaInfo>;
  /** Baixa a URL com o token. Recusa acima de `maxBytes` (olha o Content-Length antes de ler). */
  download(url: string, maxBytes: number): Promise<DownloadResult>;
}

export interface MediaClientOptions {
  whatsappToken: string;
  graphApiVersion: string;
  fetchImpl?: typeof fetch;
}

export function createMediaClient(o: MediaClientOptions): MediaClient {
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const auth = { Authorization: `Bearer ${o.whatsappToken}` };
  return {
    async getInfo(mediaId) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(mediaId)) throw new Error("media_id inválido");
      const res = await f(`https://graph.facebook.com/${o.graphApiVersion}/${mediaId}`, { headers: auth });
      if (!res.ok) throw new Error(`media_info_http_${res.status}`);
      const j = (await res.json()) as { url?: unknown; mime_type?: unknown; file_size?: unknown };
      if (typeof j.url !== "string" || !j.url.startsWith("https://")) throw new Error("media_info_sem_url");
      return {
        url: j.url,
        ...(typeof j.mime_type === "string" ? { mimeType: j.mime_type } : {}),
        ...(typeof j.file_size === "number" ? { fileSize: j.file_size } : {}),
      };
    },
    async download(url, maxBytes) {
      if (!url.startsWith("https://")) return { ok: false, reason: "error" };
      let res: Response;
      try {
        res = await f(url, { headers: auth });
      } catch {
        return { ok: false, reason: "error" };
      }
      if ([401, 403, 404, 410].includes(res.status)) return { ok: false, reason: "expired" };
      if (!res.ok) return { ok: false, reason: "error" };
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > maxBytes) return { ok: false, reason: "too_large" };
      try {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > maxBytes) return { ok: false, reason: "too_large" };
        const ct = res.headers.get("content-type");
        return { ok: true, bytes, ...(ct ? { contentType: ct } : {}) };
      } catch {
        return { ok: false, reason: "error" };
      }
    },
  };
}
