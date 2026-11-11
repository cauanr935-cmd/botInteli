// Integração (com I/O): webhook -> decide -> sendGuarded. A lógica de decisão fica em machine.ts.
import type { Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import type { OutboundMessage, SendResult } from "../whatsapp/client";
import type { AudioEvent, DocumentEvent, IncomingMessage } from "../whatsapp/types";
import {
  decideRegistration, isRegistrationState, registrationPrompt, type RegDecision, type RegistrationContext,
  type RegistrationEffect,
} from "../registration/decide";
import { fallbackContent, type Content } from "../services/content";
import { decideAvailability, type AvailabilityEffect } from "../availability/decide";
import { decideSchedule, isScheduleState, schedulePrompt } from "../schedule/decide";
import { decideProfile, isProfileState, profilePrompt, type ProfileEffect } from "../profile/decide";
import { ROUTES, type FaqResult, type IntentAgent } from "../ai/agent";
import type { ParsedAvailability } from "../ai/types";
import { intentsOf } from "./synonyms";
import { decide, limited, type Counters, type State, type UserState } from "./machine";

export interface EngineDeps {
  repo: Repo;
  logger: Logger;
  /** Envio pela única porta de saída (sendGuarded já com o contexto). */
  send: (message: OutboundMessage) => Promise<SendResult>;
  maxPerDay: number;
  maxPer10Min: number;
  now?: () => Date;
  /** Cadastro (Etapa 4). Sem isto, vale o comportamento provisório da Etapa 3. */
  /** Conteúdo do banco com cache (Etapa 5). Sem isto, valem os textos e serviços do código. */
  content?: { load(): Promise<Content> };
  /** Pipeline de áudio (Etapa 6). Sem isto, o áudio só muda o estado (comportamento da Etapa 3). */
  audio?: { process(msg: AudioEvent, hintAlreadySent: boolean, purpose?: "mentoria" | "profile"): Promise<unknown> };
  /** Material anexado junto da dúvida: baixa e guarda. Sem isto, o documento é ignorado. */
  material?: { process(msg: DocumentEvent): Promise<unknown> };
  /** IA (Grok) que intervém quando o bot não entende. Sem isto, só valem as regras do código. */
  agent?: IntentAgent;
  /** Últimas mensagens da conversa, só para dar contexto à IA (canal que guarda o histórico, como o chat de teste). */
  recentContext?: readonly string[];
  registration?: { flowId?: string; privacyUrl: string; termsVersion: string };
}

const MAX_CAS_ATTEMPTS = 4;
const TEN_MIN_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function handleIncomingMessage(msg: IncomingMessage, deps: EngineDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const waIdHash = await hashWaId(msg.from);
  const sent = await deps.repo.listOutboundSince(waIdHash, new Date(now.getTime() - DAY_MS));
  const content = deps.content ? await deps.content.load() : fallbackContent;
  const lastBot = sent.reduce<Date | null>((m, t) => (m === null || t > m ? t : m), null);
  const counters: Counters = {
    lastBotMsgAt: lastBot,
    sentLastDay: sent.length,
    sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length,
    maxPerDay: deps.maxPerDay,
    maxPer10Min: deps.maxPer10Min,
  };

  let nameCheck: "real" | "suspicious" | undefined | "unset" = "unset";
  let availParsed: ParsedAvailability | null | undefined | "unset" = "unset";
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const stored = await deps.repo.getConversation(msg.from);
    const user: UserState = {
      state: stored.state as State,
      previousState: stored.previousState as State | null,
      hintSentInState: stored.hintSentInState,
      optedOutAt: stored.optedOutAt,
      ...(stored.lastServiceId ? { lastServiceId: stored.lastServiceId } : {}),
    };
    // Horários: a IA lê os dias/horários escritos em linguagem natural (uma consulta por mensagem).
    if (availParsed === "unset") {
      availParsed = undefined;
      const text = msg.type === "text" ? msg.body.replace(/\s+/g, " ").trim().slice(0, 500) : "";
      if (user.state === "AVAILABILITY_TEXT" && deps.agent?.extractAvailability && text.length >= 2 && intentsOf(text).size === 0) {
        availParsed = await deps.agent.extractAvailability(text).catch(() => null);
        deps.logger.log("info", "ai_availability", { from: maskPhone(msg.from), ok: availParsed !== null, slots: availParsed?.slots.length ?? 0 });
      }
    }
    // Nome: a IA diz se parece um nome REAL (só quando a regra do bot ainda não o considerou suspeito).
    if (nameCheck === "unset") {
      let verdict: "real" | "suspicious" | undefined;
      const text = msg.type === "text" ? msg.body.replace(/\s+/g, " ").trim().slice(0, 100) : "";
      if (user.state === "REG_FIELD_full_name" && deps.agent?.judgeName && text.split(" ").length >= 2 && intentsOf(text).size === 0) {
        const j = await deps.agent.judgeName(text).catch(() => null);
        verdict = j === null ? undefined : j.real ? "real" : "suspicious";
        deps.logger.log("info", "ai_name_check", { from: maskPhone(msg.from), result: verdict ?? "none" });
      }
      nameCheck = verdict;
    }
    const evaluate = async (m: IncomingMessage) => {
      let d: RegDecision = decide(user, m, counters, now, content);
      let effect: RegistrationEffect | undefined;
      if (deps.registration) {
        const reg = deps.registration;
        const needsRecord = user.state === "NEW" || isRegistrationState(user.state);
        const rec = needsRecord ? await deps.repo.getRegistration(msg.from) : null;
        const ctx: RegistrationContext = {
          ...(reg.flowId ? { flowId: reg.flowId } : {}),
          privacyUrl: reg.privacyUrl,
          content,
          registered: rec?.registeredAt != null,
          hasConsent: rec?.consentAt != null,
          ...(nameCheck !== undefined && nameCheck !== "unset" ? { nameCheck } : {}),
        };
        const rd = decideRegistration(user, m, counters, now, ctx);
        if (rd) {
          d = rd;
          effect = rd.effect;
        } else if (user.state === "OPTED_OUT" && d.outcome === "transition" && isRegistrationState(d.nextState.state)) {
          // "voltar" para um estado de cadastro: reapresenta a pergunta certa (e não a dica genérica).
          const prompt = registrationPrompt(d.nextState.state, { ...ctx, registered: false, hasConsent: false });
          if (prompt) d = { ...d, replies: [prompt] };
        }
      }
      // Perfil (papel -> áreas -> dúvida) e volta de quem já concluiu o cadastro.
      let profileEffect: ProfileEffect | undefined;
      const needsProfile = user.state === "MENTOR_CATEGORIES" || user.state === "MENTOR_CATEGORIES_BOTH" ||
        user.state === "RETURNING_CHOICE" || user.state === "DOUBT_TEXT" || user.state === "COMPLETED" || isScheduleState(user.state);
      const regRec = needsProfile ? await deps.repo.getRegistration(msg.from) : null;
      const savedSlots = regRec?.availabilitySlots ?? [];
      const pd = decideProfile(user, m, counters, now, content, {
        selected: regRec?.mentorCategories ?? [], role: regRec?.profileRole ?? null,
        hasAvailability: savedSlots.length > 0,
        scheduleFresh: savedSlots.length > 0 && regRec?.availabilityAt != null && now.getTime() - regRec.availabilityAt.getTime() < 2 * 60 * 60 * 1000,
      });
      if (pd) {
        d = { replies: pd.replies, nextState: pd.nextState, outcome: pd.outcome };
        effect = undefined;
        profileEffect = pd.effect;
      } else if (user.state === "OPTED_OUT" && d.outcome === "transition" && isProfileState(d.nextState.state)) {
        const prompt = profilePrompt(d.nextState.state, content);
        if (prompt) d = { ...d, replies: [prompt] };
      }
      // Dias e horários escolhidos em listas (mentor no cadastro; mentorado depois da dúvida).
      let scheduleEffect: AvailabilityEffect | undefined;
      const sd = decideSchedule(user, m, counters, now, content, { slots: savedSlots as never });
      if (sd) {
        d = { replies: sd.replies, nextState: sd.nextState, outcome: sd.outcome };
        effect = undefined;
        profileEffect = undefined;
        scheduleEffect = sd.effect;
      } else if (user.state === "OPTED_OUT" && d.outcome === "transition" && isScheduleState(d.nextState.state)) {
        const prompt = schedulePrompt(d.nextState.state, savedSlots as never, content);
        if (prompt) d = { ...d, replies: [prompt] };
      }
      // Horários livres (serviço "Horários"): pede os dias/horários em texto e grava.
      let availabilityEffect: AvailabilityEffect | undefined;
      const ad = decideAvailability(user, m, counters, now, content, availParsed === "unset" ? undefined : availParsed);
      if (ad) {
        d = { replies: ad.replies, nextState: ad.nextState, outcome: ad.outcome };
        effect = undefined;
        availabilityEffect = ad.effect;
      }
      return { d, effect, profileEffect, availabilityEffect: availabilityEffect ?? scheduleEffect };
    };
    let ev = await evaluate(msg);
    // IA: só quando o bot não entendeu (dica/silêncio) ou, na dúvida, para conferir se o texto é mesmo uma dúvida.
    const routed = await routeWithAgent(msg, user, ev.d.outcome, counters, deps);
    if (routed?.kind === "button") ev = await evaluate(routed.msg);
    else if (routed?.kind === "silent") {
      // Assunto sem relação com o programa: silêncio (nada é guardado nem enviado).
      ev = { d: { replies: [], nextState: user, outcome: "silent" }, effect: undefined, profileEffect: undefined, availabilityEffect: undefined };
    } else if (routed?.kind === "faq") {
      ev = { d: { replies: [{ type: "text", text: { body: routed.answer } }], nextState: user, outcome: "reply" }, effect: undefined, profileEffect: undefined, availabilityEffect: undefined };
    }
    const { effect, profileEffect, availabilityEffect, d } = ev;
    const changed =
      d.nextState.state !== user.state ||
      d.nextState.hintSentInState !== user.hintSentInState ||
      d.nextState.previousState !== user.previousState ||
      (d.nextState.lastServiceId ?? null) !== (user.lastServiceId ?? null) ||
      d.nextState.optedOutAt?.getTime() !== user.optedOutAt?.getTime();
    if (effect) await applyEffect(effect, msg.from, deps, now); // idempotente: repetir não causa dano
    if (profileEffect?.kind === "material") {
      // Falha ao guardar o material não derruba a conversa (o mentorado pode reenviar).
      if (msg.type === "document" && deps.material) {
        try { await deps.material.process(msg); } catch { deps.logger.log("error", "material_process_failed", { from: maskPhone(msg.from) }); }
      }
    } else if (profileEffect) await applyProfileEffect(profileEffect, msg.from, deps, now); // idempotente
    if (availabilityEffect) await deps.repo.saveAvailability(msg.from, availabilityEffect.text, now, availabilityEffect.slots);
    // Entrou no fluxo de dias e horários vindo de fora: começa do zero (horários antigos não se misturam com os novos).
    if (isScheduleState(d.nextState.state) && !isScheduleState(user.state) && user.state !== "OPTED_OUT") {
      await deps.repo.saveAvailability(msg.from, "", now, []);
    }
    if (changed) {
      const won = await deps.repo.saveConversation(msg.from, stored.version, d.nextState);
      if (!won) continue; // outra mensagem mudou o estado: reavalia com o estado novo
    }
    deps.logger.log("info", "conversation_decision", {
      from: maskPhone(msg.from), outcome: d.outcome, state: d.nextState.state,
    });
    for (const reply of d.replies) {
      const result = await deps.send({ to: msg.from, ...reply });
      if (result.status !== "sent") {
        // "error" = o envio à Meta falhou (o motivo detalhado está no log whatsapp_send_failed/exception).
        deps.logger.log(result.status === "error" ? "warn" : "info", "reply_not_sent", {
          from: maskPhone(msg.from), status: result.status, ...(result.status === "error" ? { code: result.code } : {}),
        });
      }
    }
    // Áudio aceito: processa no mesmo tratamento do evento (a URL da mídia expira em 5 min).
    if (
      deps.audio && msg.type === "audio" && d.nextState.state === "PROCESSING_AUDIO" &&
      (user.state === "AWAIT_AUDIO" || user.state === "REG_PROFILE_AUDIO")
    ) {
      try {
        await deps.audio.process(msg, user.hintSentInState, user.state === "REG_PROFILE_AUDIO" ? "profile" : "mentoria");
      } catch {
        deps.logger.log("error", "audio_process_failed", { from: maskPhone(msg.from) });
      }
    }
    return;
  }
  // Disputa persistente: melhor ficar em silêncio do que responder em duplicidade.
  deps.logger.log("warn", "conversation_contention", { from: maskPhone(msg.from) });
}

type Routed =
  | { kind: "button"; msg: IncomingMessage }
  | { kind: "silent" }
  | { kind: "faq"; answer: string }
  | null;

/** Estados pós-cadastro em que uma pergunta sobre o programa pode ser respondida pela IA. */
const FAQ_STATES: readonly string[] = ["COMPLETED", "RETURNING_CHOICE", "MENU"];

/**
 * Pede ao agente de IA para traduzir um texto livre numa das opções do estado atual. A IA só ESCOLHE entre
 * opções fechadas (ROUTES): o resultado vira o mesmo "botão" que a pessoa poderia ter tocado e passa por toda a lógica
 * normal (limites, consentimento, orçamento). A IA NUNCA tira dúvidas de conteúdo (isso é do mentor): só responde sobre
 * o funcionamento do programa e fica em silêncio com assuntos sem relação. Falha ou dúvida = null (o bot decide sozinho).
 */
async function routeWithAgent(
  msg: IncomingMessage, user: UserState, outcome: string, counters: Counters, deps: EngineDeps,
): Promise<Routed> {
  if (!deps.agent || msg.type !== "text") return null;
  const route = ROUTES[user.state];
  const canFaq = FAQ_STATES.includes(user.state) && !!deps.agent.answerFaq;
  if (!route && !canFaq) return null;
  const unclear = outcome === "hint" || outcome === "silent";
  if (!(route?.always || unclear)) return null;
  const text = msg.body.replace(/\s+/g, " ").trim().slice(0, 500);
  if (text.length < 2) return null;
  // Comandos que o bot já entende (sair, menu, oi, sim, não...) nunca passam pela IA: ficam previsíveis e baratos.
  if (intentsOf(text).size > 0) return null;

  if (route) {
    let intent: string | null = null;
    try {
      intent = await deps.agent.classify({ question: route.question, options: route.options, text, ...(deps.recentContext?.length ? { recent: deps.recentContext } : {}) });
    } catch {
      intent = null;
    }
    const chosen = route.options.find((o) => o.intent === intent);
    if (chosen?.silent) {
      deps.logger.log("info", "ai_off_topic", { from: maskPhone(msg.from), state: user.state });
      return { kind: "silent" };
    }
    if (chosen && chosen.buttonId !== null) {
      deps.logger.log("info", "ai_routed", { from: maskPhone(msg.from), state: user.state, intent: chosen.intent });
      return {
        kind: "button",
        msg: {
          wamid: msg.wamid, from: msg.from, ...(msg.timestamp !== undefined ? { timestamp: msg.timestamp } : {}),
          type: "button_reply", id: chosen.buttonId, title: "",
        },
      };
    }
    if (chosen) return null; // a IA confirmou o que o bot já decidiu (ex.: "duvida")
  }

  // Pergunta sobre o programa: responde (1 mensagem, dentro dos limites por pessoa). Outro assunto: silêncio.
  if (canFaq && unclear) {
    const faq: FaqResult | null = await deps.agent.answerFaq!(text, deps.recentContext).catch(() => null);
    if (faq?.kind === "answer") {
      if (limited(counters)) return { kind: "silent" };
      deps.logger.log("info", "ai_faq_answer", { from: maskPhone(msg.from), state: user.state, chars: faq.text.length });
      return { kind: "faq", answer: faq.text.slice(0, 1024) };
    }
    if (faq?.kind === "off_topic") {
      deps.logger.log("info", "ai_off_topic", { from: maskPhone(msg.from), state: user.state });
      return { kind: "silent" };
    }
  }
  return null;
}

/** Grava o cadastro (com consentimento primeiro). Lança em erro: a mensagem não é respondida (fail silent). */
async function applyEffect(effect: RegistrationEffect, waId: string, deps: EngineDeps, now: Date): Promise<void> {
  const reg = deps.registration;
  if (!reg) return;
  const waIdHash = await hashWaId(waId);
  switch (effect.kind) {
    case "consent":
      await deps.repo.saveRegistration(waId, { waIdHash, consentAt: now, termsVersion: reg.termsVersion });
      return;
    case "field":
      await deps.repo.saveRegistration(waId, { values: { [effect.key]: effect.value } });
      return;
    case "about":
      await deps.repo.saveRegistration(waId, { profileAbout: effect.text });
      return;
    case "profile":
      await deps.repo.saveRegistration(waId, {
        ...(effect.withConsent ? { waIdHash, consentAt: now, termsVersion: reg.termsVersion } : {}),
        values: effect.values,
      });
      return;
    case "complete":
      await deps.repo.saveRegistration(waId, {
        waIdHash, values: effect.values, registeredAt: now,
        ...(effect.withConsent ? { consentAt: now, termsVersion: reg.termsVersion } : {}),
      });
      return;
  }
}

/** Grava papel, áreas e dúvidas. O papel conclui o cadastro (registered_at). Lança em erro (fail silent). */
async function applyProfileEffect(effect: ProfileEffect, waId: string, deps: EngineDeps, now: Date): Promise<void> {
  switch (effect.kind) {
    case "role":
      if (effect.keepCategories) {
        // Quem volta para mudar as áreas: só ajusta o papel (mantém as áreas atuais e a data do cadastro).
        await deps.repo.saveRegistration(waId, { profileRole: effect.role });
        return;
      }
      // Mentor/ambos: a seleção de áreas começa do zero (a lista é montada em rodadas, uma área por toque).
      await deps.repo.saveRegistration(waId, { profileRole: effect.role, registeredAt: now, ...(effect.role !== "mentorado" ? { mentorCategories: [] } : {}) });
      return;
    case "categories":
      await deps.repo.saveRegistration(waId, { mentorCategories: effect.categories });
      return;
    case "material":
      return; // tratado em handleIncomingMessage (precisa da mensagem)
    case "doubt":
      await deps.repo.insertDoubt(waId, { waIdHash: await hashWaId(waId), text: effect.text, categories: effect.categories, at: now });
      return;
  }
}
