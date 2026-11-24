import type { PendingChoiceOption, Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import type { IntentAgent } from "../ai/agent";
import { decideSensitive } from "../axo/sensitive";
import { intentsOf } from "../conversation/synonyms";
import { CONTROL_OPTION_IDS, isSelectAll, matchChoice, matchChoiceByWords, matchChoices, matchPastedList, PENDING_CHOICES_TTL_MS, renderNotUnderstood } from "../whatsapp/choices";
import { parseWebhookPayload } from "../whatsapp/parser";
import { extractWebhookToken, verifyWebhookToken } from "../whatsapp/signature";
import type { IncomingMessage, WebhookEvent } from "../whatsapp/types";

/** Gancho para o motor de conversa. */
export type EventHandler = (event: WebhookEvent) => Promise<void>;

export interface WebhookDeps {
  /** Segredo compartilhado com a Evolution (EVOLUTION_WEBHOOK_TOKEN). */
  webhookToken: string;
  repo: Repo;
  logger: Logger;
  onEvent?: EventHandler;
  now?: () => Date;
  /** IA (Groq) que entende a opção escrita por extenso ("computação", "segunda"). Sem ela, só número e título exato. */
  agent?: IntentAgent;
  /** Envia o "não entendi" (texto simples, pelo mesmo caminho guardado das demais mensagens). */
  sendText?: (to: string, body: string) => Promise<void>;
}

export interface WaitUntilCtx {
  waitUntil(p: Promise<unknown>): void;
}

/** Chave de idempotência: o `key.id` da mensagem (o Baileys reenvia/duplica eventos). */
export function idempotencyKey(ev: WebhookEvent): string {
  return ev.wamid;
}

/**
 * Texto numerado -> opção: se a pessoa respondeu "2" (ou o título) a um menu enviado como texto numerado,
 * o motor recebe o mesmo button_reply/list_reply de sempre. Qualquer falha aqui deixa o texto passar como está.
 */
async function resolveNumberedReply(ev: WebhookEvent, repo: Repo, now: Date, deps: Pick<WebhookDeps, "agent" | "sendText" | "logger">): Promise<WebhookEvent | null> {
  if (ev.type !== "text") return ev;
  try {
    const pending = await repo.getPendingChoices(await hashWaId(ev.from));
    if (!pending || now.getTime() - pending.createdAt.getTime() > PENDING_CHOICES_TTL_MS) return ev;
    // Vários números de uma vez só valem para a lista de áreas: viram o texto "Computação, Design", que o motor já entende.
    // Tema sensível (ex.: autoagressão) passa direto ao motor: lá a primeira rede responde com o CVV (188). Nunca vai à IA
    // nem vira "não entendi", mesmo que haja um menu numerado ativo.
    if (decideSensitive(ev.body, "whatsapp", now).sensitive) return ev;
    // Vários de uma vez: "1 3 5", a lista inteira copiada e colada, ou "todas". As linhas de controle (Terminei, Refazer tudo,
    // Concluir) ficam de fora: quem cola tudo quer escolher os itens, não encerrar nem apagar o que já anotou.
    const manyRaw = matchChoices(ev.body, pending.options) ?? matchPastedList(ev.body, pending.options) ?? (isSelectAll(ev.body) ? [...pending.options] : null);
    const many = manyRaw ? manyRaw.filter((o) => !CONTROL_OPTION_IDS.test(o.id)) : null;
    if (many && many.length === 1 && manyRaw && manyRaw.length > 1) {
      // Só sobrou uma opção de verdade: vale como se tivesse escolhido só ela.
      const only = many[0] as PendingChoiceOption;
      await repo.setPendingChoices(await hashWaId(ev.from), null, now);
      const { wamid, from, timestamp } = ev;
      return { wamid, from, ...(timestamp !== undefined ? { timestamp } : {}), type: "button_reply", id: only.id, title: only.title } as IncomingMessage;
    }
    if (many && many.length > 1 && many.every((o) => o.id.startsWith("cat_"))) {
      await repo.setPendingChoices(await hashWaId(ev.from), null, now);
      const { wamid, from, timestamp } = ev;
      return { wamid, from, ...(timestamp !== undefined ? { timestamp } : {}), type: "text", body: many.map((o) => o.title).join(", ") } as IncomingMessage;
    }
    // Vários dias ou horários de uma vez ("1,2,3"): viram o texto que o fluxo de horários já entende ("Segunda, Quarta").
    if (many && many.length > 1 && many.every((o) => o.id.startsWith("sch_day_") || /^sch_h_\d+_\d+$/.test(o.id)) && (many.every((o) => o.id.startsWith("sch_day_")) || many.every((o) => o.id.startsWith("sch_h_")))) {
      await repo.setPendingChoices(await hashWaId(ev.from), null, now);
      const { wamid, from, timestamp } = ev;
      const body = many.map((o) => {
        const h = /^sch_h_(\d+)_(\d+)$/.exec(o.id);
        return h ? `${h[1]}h às ${h[2]}h` : o.title;
      }).join(", ");
      return { wamid, from, ...(timestamp !== undefined ? { timestamp } : {}), type: "text", body } as IncomingMessage;
    }
    let hit = matchChoice(ev.body, pending.options) ?? matchChoiceByWords(ev.body, pending.options);
    if (!hit) {
      const text = ev.body.replace(/\s+/g, " ").trim().slice(0, 200);
      // Comandos (sair, menu, oi...) e textos vazios seguem para o motor; só o resto vai para a IA.
      if (!deps.agent || text.length < 2 || intentsOf(text).size > 0) return ev;
      // Antes do aceite (LGPD) nenhum texto da pessoa sai para a IA: segue para o motor, que trata as etapas do cadastro.
      const reg = await repo.getRegistration(ev.from);
      if (!reg.consentAt) return ev;
      const intent = await deps.agent.classify({
        question: "O bot mostrou uma lista numerada de opções e a pessoa respondeu escrevendo, em vez de mandar o número. Descubra qual opção ela quis dizer.",
        options: pending.options.map((o, i) => ({ intent: String(i + 1), description: `a pessoa escolheu "${o.title}" (opção ${i + 1})` })),
        text,
      }).catch(() => null);
      hit = intent ? (pending.options[Number(intent) - 1] ?? null) : null;
      if (!hit) {
        // Frase ou pergunta ("quem são os fundadores?"): não é tentativa de escolher opção. Segue para o motor, que responde
        // (FAQ/IA) ou avisa de fora de assunto, sempre repetindo a pergunta da etapa. O "não entendi" fica para textos curtos.
        if (text.split(" ").length >= 3 || text.includes("?")) return ev;
        if (!deps.sendText) return ev;
        deps.logger.log("info", "choice_not_understood", { from: maskPhone(ev.from) });
        await deps.sendText(ev.from, renderNotUnderstood(pending.options));
        // O envio de texto apaga as opções: restaura para a próxima tentativa ("1" ou o nome) funcionar.
        await repo.setPendingChoices(await hashWaId(ev.from), pending.options, now);
        return null;
      }
    }
    await repo.setPendingChoices(await hashWaId(ev.from), null, now); // uma escolha vale uma vez
    const { wamid, from, timestamp } = ev;
    const base = { wamid, from, ...(timestamp !== undefined ? { timestamp } : {}) };
    // Qualquer escolha chega como button_reply: o motor trata os dois pelo id da opção.
    const out: IncomingMessage = { ...base, type: "button_reply", id: hit.id, title: hit.title };
    return out;
  } catch {
    return ev;
  }
}

export async function processEvents(events: WebhookEvent[], deps: WebhookDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  for (const original of events) {
    let claimed = false;
    const received = now();
    try {
      // Reservar o id (idempotência) e registrar a última mensagem da pessoa são independentes: uma viagem só.
      // Duplicata: o registro da hora é inofensivo (mesmo horário); a mensagem continua sendo ignorada.
      const sentAt = original.timestamp ? new Date(original.timestamp * 1000) : received;
      const [claim, touched] = await Promise.allSettled([
        deps.repo.claimMessage(idempotencyKey(original), received),
        deps.repo.touchUser(original.from, sentAt <= received ? sentAt : received),
      ]);
      if (claim.status === "rejected") throw claim.reason;
      if (!claim.value) {
        deps.logger.log("debug", "duplicate_ignored", { type: original.type });
        continue;
      }
      claimed = true;
      if (touched.status === "rejected") throw touched.reason;
      const ev = await resolveNumberedReply(original, deps.repo, received, deps);
      if (!ev) continue;
      await deps.onEvent?.(ev);
      deps.logger.log("info", "event_processed", { type: ev.type, from: maskPhone(ev.from) });
    } catch (e) {
      deps.logger.log("error", "event_failed", {
        type: original.type, from: maskPhone(original.from), error: e instanceof Error ? e.name : "unknown",
      });
      // Falhou no meio SEM ter respondido nada: libera a mensagem UMA vez para a recuperação do cron responder. Se algo já foi
      // enviado, não libera (nunca resposta dupla); a marca "retry:" impede repetir sem fim.
      if (claimed) {
        try {
          const already = await deps.repo.listOutboundSince(await hashWaId(original.from), received);
          if (already.length === 0 && await deps.repo.claimMessage(`retry:${idempotencyKey(original)}`, now())) await deps.repo.unclaimMessage(idempotencyKey(original));
        } catch { /* sem banco: nada a fazer */ }
      }
    }
  }
}

export async function handleWebhookPost(request: Request, ctx: WaitUntilCtx, deps: WebhookDeps): Promise<Response> {
  // A Evolution não assina o corpo: o segredo compartilhado vem em header (comparação em tempo constante).
  if (!(await verifyWebhookToken(extractWebhookToken(request.headers), deps.webhookToken))) {
    deps.logger.log("warn", "invalid_webhook_token");
    return new Response("unauthorized", { status: 401 });
  }
  let events: WebhookEvent[] = [];
  try {
    events = parseWebhookPayload(await request.json());
  } catch {
    deps.logger.log("warn", "invalid_json");
  }
  ctx.waitUntil(
    processEvents(events, deps).catch((e) => {
      deps.logger.log("error", "processing_failed", { error: e instanceof Error ? e.name : "unknown" });
    }),
  );
  // Token válido: sempre 200 (a Evolution reenfileira em erro; o disjuntor só para de ENVIAR).
  return new Response("ok", { status: 200 });
}
