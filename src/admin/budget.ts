import { dayKey } from "../budget/month";
import type { Repo } from "../db/repo";
import type { Logger } from "../lib/logger";

export interface AdminDeps {
  adminToken: string;
  repo: Repo;
  logger: Logger;
  /** Chave da trava e do contador: nome da instância da Evolution. */
  phoneNumberId: string;
  /** Teto anti-flood por dia (0 = desligado). */
  stopAt: number;
  timezone: string;
  now?: () => Date;
  /** Reprocessa um áudio antes recusado (arquivo grande já no S3/R2 da Evolution). Ausente = 501. */
  reprocessAudio?: (req: ReprocessRequest) => Promise<ReprocessResult>;
}

export interface ReprocessRequest { phone: string; mediaUrl: string; mimeType: string; fileSize?: number; messageId: string }
export type ReprocessResult = "done" | "invalid" | "failed" | "no_consent" | "unknown_contact";

export const UNLOCK_CONFIRM = "EU_ENTENDO_O_RISCO";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Comparação em tempo constante via hash (tamanhos iguais). */
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function snapshot(deps: AdminDeps) {
  const now = (deps.now ?? (() => new Date()))();
  const period = dayKey(now, deps.timezone);
  const [budget, lock] = await Promise.all([
    deps.repo.getBudget(deps.phoneNumberId, period),
    deps.repo.getManualLock(deps.phoneNumberId),
  ]);
  // Antes (Meta) o período era o mês e o teto a franquia grátis; agora é o dia e um limitador anti-flood opcional.
  return {
    period,
    flood_limit_enabled: deps.stopAt > 0,
    reserved_count: budget?.reservedCount ?? 0,
    stop_at: budget?.stopAt ?? deps.stopAt,
    tripped: budget?.tripped ?? false,
    manual_lock: {
      locked: lock.locked,
      reason: lock.reason,
      locked_at: lock.lockedAt?.toISOString() ?? null,
      unlocked_at: lock.unlockedAt?.toISOString() ?? null,
      unlocked_by: lock.unlockedBy,
    },
  };
}

export async function handleAdmin(request: Request, deps: AdminDeps): Promise<Response> {
  const url = new URL(request.url);
  const header = request.headers.get("Authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  const ok = deps.adminToken !== "" && m !== null && (await tokenMatches(m[1] ?? "", deps.adminToken));
  if (!ok) return json({ error: "unauthorized" }, 401);

  try {
    if (url.pathname === "/admin/budget" && request.method === "GET") {
      return json(await snapshot(deps));
    }
    if (url.pathname === "/admin/budget/unlock" && request.method === "POST") {
      if (url.searchParams.get("confirm") !== UNLOCK_CONFIRM) {
        return json({ error: `confirmação ausente: use ?confirm=${UNLOCK_CONFIRM}` }, 400);
      }
      const by = (request.headers.get("X-Admin-User") ?? "admin").replace(/[^\w.@-]/g, "").slice(0, 64) || "admin";
      await deps.repo.clearManualLock(deps.phoneNumberId, by);
      deps.logger.log("warn", "manual_lock_cleared", { by });
      return json(await snapshot(deps));
    }
    if (url.pathname === "/admin/reprocess-audio" && request.method === "POST") {
      if (!deps.reprocessAudio) return json({ error: "reprocesso indisponível (R2/MEDIA_URL_HOSTS)" }, 501);
      const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const phone = typeof b?.phone === "string" ? b.phone.replace(/\D/g, "") : "";
      const mediaUrl = typeof b?.mediaUrl === "string" ? b.mediaUrl : "";
      const mimeType = typeof b?.mimeType === "string" ? b.mimeType : "";
      const messageId = typeof b?.messageId === "string" && /^[\w-]{1,100}$/.test(b.messageId) ? b.messageId : "";
      const fileSize = typeof b?.fileSize === "number" && b.fileSize > 0 ? b.fileSize : undefined;
      if (!phone || !mediaUrl || !mimeType || !messageId) return json({ error: "campos obrigatórios: phone, mediaUrl, mimeType, messageId" }, 400);
      const outcome = await deps.reprocessAudio({ phone, mediaUrl, mimeType, messageId, ...(fileSize ? { fileSize } : {}) });
      deps.logger.log("info", "audio_reprocessed", { outcome });
      return json({ outcome }, outcome === "done" ? 200 : outcome === "unknown_contact" ? 404 : 422);
    }
    return json({ error: "not found" }, 404);
  } catch {
    deps.logger.log("error", "admin_failed");
    return json({ error: "internal" }, 500);
  }
}
