// Ponto ÚNICO de saída do bot: toda mensagem passa por sendGuarded (nenhum outro arquivo envia).
// Este arquivo NÃO conhece a Evolution: o transporte vive em evolutionClient.ts (o único que a conhece).
//
// Mudança de semântica (migração Meta Cloud API -> Evolution/Baileys): as travas de "custo Meta" (franquia de
// 1.000 conversas, janela de 24h, recusa de template) deixaram de existir. O que sobrou é PROTEÇÃO ANTI-BAN:
//  - trava manual (disjuntor humano, endpoint admin);
//  - limitador anti-flood OPCIONAL: teto de envios por dia do número (ANTI_FLOOD_MAX_PER_DAY, 0 = desligado),
//    reaproveitando a reserva atômica do banco com a chave do DIA no lugar da do mês.
//  - nunca escrever para quem nunca escreveu ao bot (mensagem fria a desconhecido é o maior gatilho de banimento
//    no Baileys). Não é a janela de 24h: vale para qualquer pessoa que já tenha falado com o bot, em qualquer época.
// Continua fail closed: erro ao consultar trava/contador = não envia.
import { dayKey } from "../budget/month";
import type { Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import type { Logger } from "../lib/logger";
import { isSendable, sendViaEvolution, type EvolutionConfig, type TransportResult } from "./evolutionClient";

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
  /** Chave da trava manual e do contador: o nome da instância da Evolution (coluna legada `phone_number_id`). */
  phoneNumberId: string;
  evolutionUrl: string;
  evolutionApiKey: string;
  evolutionInstance: string;
  evolutionNativeInteractive?: boolean;
  /** Teto de envios por dia (anti-flood). 0 ou ausente = limitador desligado. */
  stopAt: number;
  timezone: string;
  fetchImpl?: typeof fetch;
  /**
   * Substitui o transporte (Evolution). Usado pelo chat web simulador, que entrega a mensagem na tela em vez do
   * WhatsApp. Tudo antes (travas, anti-flood) e depois (log) do envio continua igual.
   */
  transport?: (message: OutboundMessage, evo: EvolutionConfig, fetchImpl?: typeof fetch) => Promise<TransportResult>;
  now?: () => Date;
}

export type SendResult =
  | { status: "sent"; wamid: string | null }
  | { status: "blocked_budget" }
  | { status: "blocked_manual_lock" }
  | { status: "blocked_unknown_contact" }
  | { status: "error"; code: string };

export async function sendGuarded(message: OutboundMessage, ctx: SendContext): Promise<SendResult> {
  try {
    // 0. tipo que o canal não entrega (template, Flow...): recusa antes de gastar vaga do anti-flood.
    if (!ctx.transport && !isSendable(message)) return { status: "error", code: "unsupported_type" };

    const now = (ctx.now ?? (() => new Date()))();

    // 1. trava manual e contato conhecido: leituras independentes, em paralelo (fail closed: erro = não envia)
    const [lockRes, lastRes] = await Promise.allSettled([
      ctx.repo.getManualLock(ctx.phoneNumberId),
      ctx.repo.getLastUserMessageAt(message.to),
    ]);
    if (lockRes.status === "rejected") return { status: "error", code: "lock_lookup_failed" };
    if (lockRes.value.locked) return { status: "blocked_manual_lock" };
    if (lastRes.status === "rejected") return { status: "error", code: "contact_lookup_failed" };
    if (lastRes.value === null) return { status: "blocked_unknown_contact" };

    // 2. anti-flood opcional: reserva atômica de uma vaga no dia
    let alerts: Promise<void> = Promise.resolve();
    if (ctx.stopAt > 0) {
      const period = dayKey(now, ctx.timezone);
      let outcome;
      try {
        outcome = await ctx.repo.reserveSlot(ctx.phoneNumberId, period, ctx.stopAt);
      } catch {
        ctx.logger.log("error", "budget_reserve_failed");
        return { status: "error", code: "reserve_failed" };
      }
      alerts = emitAlerts(ctx, period, outcome);
      if (!outcome.ok) {
        await alerts;
        return { status: "blocked_budget" };
      }
    }

    // 3. envio (a vaga NÃO é devolvida se falhar: contagem conservadora)
    const hashP = hashWaId(message.to);
    let wamid: string | null = null;
    let errorCode: string | null = null;
    let pending: { options: { id: string; title: string }[] } | null | undefined;
    try {
      const r = await (ctx.transport ?? sendViaEvolution)(
        message,
        {
          url: ctx.evolutionUrl, apiKey: ctx.evolutionApiKey, instance: ctx.evolutionInstance,
          ...(ctx.evolutionNativeInteractive ? { nativeInteractive: true } : {}),
        },
        ctx.fetchImpl,
      );
      if (r.ok) {
        wamid = r.messageId;
        pending = r.pending ? { options: r.pending } : null;
      } else {
        errorCode = r.code;
        ctx.logger.log("warn", "whatsapp_send_failed", { status: r.httpStatus ?? null, code: r.code, messageType: message.type, detail: r.detail ?? "" });
      }
    } catch (e) {
      errorCode = "network_error";
      ctx.logger.log("warn", "whatsapp_send_exception", { messageType: message.type, error: e instanceof Error ? e.name : "unknown" });
    }

    // 4. opções do texto numerado: mensagem interativa grava; qualquer outro envio apaga (um "1" depois de uma
    // pergunta aberta não pode virar a opção 1 de um menu antigo). Falha aqui não muda o resultado do envio.
    if (pending !== undefined) {
      try {
        await ctx.repo.setPendingChoices(await hashP, pending ? pending.options : null, now);
      } catch {
        ctx.logger.log("error", "pending_choices_failed");
      }
    }

    // 5. outbound_log (falha aqui não muda o resultado do envio)
    try {
      await ctx.repo.insertOutboundLog({
        waIdHash: await hashP,
        messageType: message.type,
        wamid,
        reservedAt: now,
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
  period: string,
  o: { reservedCount: number; stopAt: number; tripped: boolean },
): Promise<void> {
  try {
    if (o.reservedCount >= Math.ceil(o.stopAt * WARN_RATIO) && (await ctx.repo.claimBudgetAlert(ctx.phoneNumberId, period, "warn"))) {
      ctx.logger.log("warn", "flood_limit_80_percent", { period, reserved: o.reservedCount, stopAt: o.stopAt });
    }
    if ((o.tripped || o.reservedCount >= o.stopAt) && (await ctx.repo.claimBudgetAlert(ctx.phoneNumberId, period, "trip"))) {
      ctx.logger.log("critical", "flood_limit_reached", { period, reserved: o.reservedCount, stopAt: o.stopAt });
    }
  } catch {
    // alerta é best-effort; nunca afeta a decisão de envio
  }
}

/** ---- Mídia recebida: contrato usado pelos pipelines (a implementação está em evolutionClient.ts) ---- */
export interface MediaInfo {
  url: string;
  mimeType?: string;
  fileSize?: number;
}
export type DownloadResult =
  | { ok: true; bytes: Uint8Array; contentType?: string }
  | { ok: false; reason: "expired" | "too_large" | "error" };

export interface MediaClient {
  /** Resolve o id da mídia (na Evolution só embrulha o id; não há URL temporária). */
  getInfo(mediaId: string): Promise<MediaInfo>;
  /** Baixa o conteúdo. Recusa acima de `maxBytes`. */
  download(url: string, maxBytes: number): Promise<DownloadResult>;
}
