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

    // 2. janela de 23h30
    let last: Date | null;
    try {
      last = await ctx.repo.getLastUserMessageAt(message.to);
    } catch {
      return { status: "error", code: "window_lookup_failed" };
    }
    if (!last || now.getTime() - last.getTime() > WINDOW_MS) return { status: "blocked_window" };

    // 3. trava manual (fail closed)
    try {
      if ((await ctx.repo.getManualLock(ctx.phoneNumberId)).locked) return { status: "blocked_manual_lock" };
    } catch {
      return { status: "error", code: "lock_lookup_failed" };
    }

    // 4. reserva atômica da vaga
    const month = monthKey(now, ctx.timezone);
    let outcome;
    try {
      outcome = await ctx.repo.reserveSlot(ctx.phoneNumberId, month, ctx.stopAt);
    } catch {
      ctx.logger.log("error", "budget_reserve_failed");
      return { status: "error", code: "reserve_failed" };
    }
    await emitAlerts(ctx, month, outcome);
    if (!outcome.ok) return { status: "blocked_budget" };

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
      }
    } catch {
      errorCode = "network_error";
    }

    // 6. outbound_log (falha aqui não muda o resultado do envio)
    try {
      await ctx.repo.insertOutboundLog({
        waIdHash: await hashWaId(message.to),
        messageType: message.type,
        wamid,
        reservedAt,
        sentOk: errorCode === null,
        errorCode,
      });
    } catch {
      ctx.logger.log("error", "outbound_log_failed");
    }
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
