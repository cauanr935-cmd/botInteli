// Integração (com I/O): webhook -> decide -> sendGuarded. A lógica de decisão fica em machine.ts.
import type { MatchRow, Repo } from "../db/repo";
import type { AudioStore } from "../audio/storage";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import type { OutboundMessage, SendResult } from "../whatsapp/client";
import type { AudioEvent, DocumentEvent, IncomingMessage } from "../whatsapp/types";
import {
  BIRTH_PREFIX, decideRegistration, isRegistrationState, registrationPrompt, type RegDecision, type RegistrationContext,
  type RegistrationEffect,
} from "../registration/decide";
import { fallbackContent, type Content } from "../services/content";
import { menuReply } from "../services/menu";
import { REPLIES, type Reply } from "./texts";
import { decideAvailability, type AvailabilityEffect } from "../availability/decide";
import { decideSchedule, isMatchScheduleState, isScheduleState, schedulePrompt } from "../schedule/decide";
import { closedNetworkText, isMentoringRequestState, isNetworkClosed, type NetworkGate } from "./network-gate";
import { handleCertificateRequest, wantsCertificate } from "../mentoria/certificate-request";
import { completeFromMatch, matchForAudio } from "../matching/register";
import { ANONYMITY_REPLY, NAMES_ALREADY_SENT_REPLY, asksCounterpartIdentity } from "../matching/anonymity";
import { notifyMenteeEffect, onMentorDeclined, onMentorSlotsDone, persistMenteeEffect } from "../matching/flow";
import { acceptReply, decideMatchMentee, decideMatchMentor, isMatchMenteeState, isMatchMentorAcceptState, pickReply, placePrompt, timePrompt, type MenteeEffect, type MentorAcceptEffect } from "../matching/decide";
import { parseScheduleText } from "../schedule/parse";
import { consentShortReply, planAnswer, PRE_CONSENT, shouldAnswer, withStepPrompt } from "./faq";
import { categoriesListReply, decideProfile, isCourtesy, isMentoringRequest, nudgeToMentoring, isProfileState, profilePrompt, removeCategoriesReply, type ProfileEffect } from "../profile/decide";
import { offTopicNotice } from "../axo/voice";
import { CARE_FOOTER, CARE_MODE_MS, decideSensitive } from "../axo/sensitive";
import { ROUTES, type FaqResult, type IntentAgent, type RiffSituation } from "../ai/agent";
import type { ParsedAvailability } from "../ai/types";
import { intentsOf } from "./synonyms";
import { farewellText, idleGreeting, OPTED_OUT_GREETING, PROCESSING_GREETING, resumeLead } from "../axo/voice";
import { isAdmin, parseAdminCommand, runAdminCommand } from "../matching/admin";
import { decide, limited, type Counters, type State, type UserState } from "./machine";
import { handlePartnerAnswer, notifyPartner, offerPendingConfirmation, waIdHashes, type ConfirmDeps } from "../mentoria/confirm";
import {
  decideMentoria, isMentoriaState, mentoriaPrompt, type MentoriaEffect, type PartnerResolution,
} from "../mentoria/decide";
import { contactWaId, looksLikePhone, nameTokens, phoneCandidates, todayIn } from "../mentoria/parse";
import { canOpenNewMentoring, inMentoriaFlow, readSwitchAnswer, switchQuestion, SWITCH_STATE, wantsNewMentoring, wantsSwitch } from "./switch";
import { doubtChangedLine, doubtJokeLine, doubtLockedLine, isDoubtJoke, parseDoubtCorrection } from "../profile/correction";
import { classifyDoubt } from "../profile/categories";
import { asksToDoWork, workRefusal } from "../axo/work";
import { buildStyleLine, decideStyle, EMPTY_SESSION_STYLE, measureSignals, updateSessionStyle } from "../axo/style";
import { checkSpeech } from "../axo/guardrails";
import { findService } from "../services/menu";
import { NEW_MENTORING_SERVICE_ID } from "../services/content";
import { isStickerTrigger, type StickerCategory, type StickerPicker } from "../whatsapp/stickers";
import { CONFIRM_NO_PREFIX, CONFIRM_YES_PREFIX, PARTNER_OTHER_ID, PARTNER_PICK_PREFIX, REVIEW_PREFIX } from "../mentoria/texts";
import { handleReviewRequest } from "../mentoria/curadoria";

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
  /** Canal da conversa, só para o registro do evento sensível (padrão: "whatsapp"). */
  channel?: string;
  /** Registro de mentoria: fuso da data ("hoje"/"ontem") e R2 (apagar o arquivo ao cancelar ou na recusa do parceiro). */
  mentoria?: { timezone: string; store?: AudioStore };
  /** Números de admin (só dígitos): de lá, mensagens começadas em "/" são comandos do matching manual. */
  adminWaIds?: readonly string[];
  /** Guardrail de abertura da rede: antes de `openAt`, só `allow` pode pedir mentoria (o cadastro é livre). */
  networkGate?: NetworkGate;
  /** Figurinhas do Axo: quem manda figurinha ou imagem recebe uma figurinha de volta. Sem isto, segue o silêncio. */
  stickers?: StickerPicker;
}

const MAX_CAS_ATTEMPTS = 4;
/** Saudações em rajada: só a primeira recebe a retomada da etapa dentro desta janela. */
const RESUME_COOLDOWN_MS = 8_000;
const TEN_MIN_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function handleIncomingMessage(msg: IncomingMessage, deps: EngineDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const tz = deps.mentoria?.timezone ?? "America/Sao_Paulo";
  const waIdHash = await hashWaId(msg.from);
  // Leituras independentes em paralelo (cada ida ao banco custa uma viagem de rede): envios recentes, conteúdo e conversa.
  // O parceiro que responde a uma confirmação pode mudar a conversa antes da leitura, então nesse caso ela fica para depois.
  const isPartnerAnswer = msg.type === "button_reply" && (msg.id.startsWith(CONFIRM_YES_PREFIX) || msg.id.startsWith(CONFIRM_NO_PREFIX));
  const [sent, content, firstStored, lastSensitive] = await Promise.all([
    deps.repo.listOutboundSince(waIdHash, new Date(now.getTime() - DAY_MS)),
    deps.content ? deps.content.load() : Promise.resolve(fallbackContent),
    isPartnerAnswer ? Promise.resolve(null) : deps.repo.getConversation(msg.from),
    // Falha na leitura = sem modo cuidado (o detector em si não depende do banco).
    deps.repo.lastSensitiveEventAt(waIdHash).catch(() => null),
  ]);
  // Modo cuidado (1 h depois de um tema sensível): cada resposta fecha com o CVV.
  const careMode = lastSensitive !== null && now.getTime() - lastSensitive.getTime() < CARE_MODE_MS;
  const careOut = (r: Reply): Reply => (careMode ? withCareFooter(r) : r);
  // Figurinhas só fora do modo cuidado (1 h depois de um tema sensível: nada de brincadeira).
  const stickersOn = !!deps.stickers && !careMode;
  const lastBot = sent.reduce<Date | null>((m, t) => (m === null || t > m ? t : m), null);
  const counters: Counters = {
    lastBotMsgAt: lastBot,
    sentLastDay: sent.length,
    sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length,
    maxPerDay: deps.maxPerDay,
    maxPer10Min: deps.maxPer10Min,
  };

  // Comandos de admin (/duvidas, /mentores): só de números autorizados, antes de qualquer fluxo e sem mexer no estado
  // da conversa. De quem não é admin, "/algo" segue como texto comum.
  if (msg.type === "text" && deps.adminWaIds?.length && isAdmin(msg.from, deps.adminWaIds)) {
    const cmd = parseAdminCommand(msg.body);
    if (cmd) {
      let body: string;
      try { body = await runAdminCommand(cmd, { repo: deps.repo, now, from: msg.from, send: deps.send, logger: deps.logger, timezone: tz, adminWaIds: deps.adminWaIds ?? [] }); }
      catch { deps.logger.log("error", "admin_command_failed", { from: maskPhone(msg.from), cmd: cmd.kind }); return; }
      deps.logger.log("info", "admin_command", { from: maskPhone(msg.from), cmd: cmd.kind });
      const r = await deps.send({ to: msg.from, type: "text", text: { body } });
      if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
      return;
    }
  }

  // Temas sensíveis (specs.md): a primeira rede roda ANTES de tudo. O texto não vai a nenhum LLM, não é gravado
  // nem logado; só o evento (nível, canal, data). O fluxo não avança: a pessoa retoma de onde parou. Quem pediu
  // opt-out continua sem receber nada. A mensagem fixa passa só pelo sendGuarded (orçamento R1 vale sempre).
  if (msg.type === "text") {
    const sens = decideSensitive(msg.body, deps.channel ?? "whatsapp", now);
    if (sens.sensitive) {
      if (firstStored?.optedOutAt) return;
      try { await deps.repo.recordSensitiveEvent(waIdHash, sens.level, sens.event.channel, now); }
      catch { deps.logger.log("error", "sensitive_event_failed", { from: maskPhone(msg.from) }); }
      deps.logger.log("warn", "sensitive_topic", { from: maskPhone(msg.from), level: sens.level });
      const r = await deps.send({ to: msg.from, type: "text", text: { body: sens.reply } });
      if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
      return;
    }
  }

  const confirmDeps: ConfirmDeps = {
    repo: deps.repo, logger: deps.logger, send: deps.send, maxPerDay: deps.maxPerDay, maxPer10Min: deps.maxPer10Min,
    now: () => now, ...(deps.mentoria?.store ? { store: deps.mentoria.store } : {}),
  };
  // Resposta do parceiro (Sim/Não): vale em qualquer estado, pois o botão carrega o id da mentoria.
  if (msg.type === "button_reply" && (msg.id.startsWith(CONFIRM_YES_PREFIX) || msg.id.startsWith(CONFIRM_NO_PREFIX))) {
    if (await handlePartnerAnswer(msg, counters, confirmDeps)) return;
  }
  // [Pedir revisão] da mensagem de recusa da curadoria: vale em qualquer estado (o botão carrega o id da mentoria).
  if (msg.type === "button_reply" && msg.id.startsWith(REVIEW_PREFIX)) {
    if (await handleReviewRequest(msg, counters, { repo: deps.repo, logger: deps.logger, send: deps.send, now: () => now })) return;
  }
  let faqTried = false;
  let partnerRes: PartnerResolution | undefined | "unset" = "unset";
  let offered = false;
  let nameCheck: "real" | "suspicious" | undefined | "unset" = "unset";
  let availParsed: ParsedAvailability | null | undefined | "unset" = "unset";
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const stored = attempt === 0 && firstStored ? firstStored : await deps.repo.getConversation(msg.from);
    // O cadastro é lido no máximo uma vez por tentativa (a decisão pode ser avaliada duas vezes quando a IA reencaminha).
    let regPromise: ReturnType<Repo["getRegistration"]> | undefined;
    const getReg = (): ReturnType<Repo["getRegistration"]> => (regPromise ??= deps.repo.getRegistration(msg.from));
    // Quem tem uma mentoria confirmada pode mandar o áudio dela direto (sem passar pelo menu): vale como se estivesse em AWAIT_AUDIO.
    const audioViaMatch = msg.type === "audio" && ["COMPLETED", "MENU", "RETURNING_CHOICE"].includes(stored.state) &&
      (await deps.repo.getConfirmedMatchFor(msg.from).catch(() => null)) !== null;
    const user: UserState = {
      state: (audioViaMatch ? "AWAIT_AUDIO" : stored.state) as State,
      previousState: stored.previousState as State | null,
      hintSentInState: stored.hintSentInState,
      optedOutAt: stored.optedOutAt,
      ...(stored.lastServiceId ? { lastServiceId: stored.lastServiceId } : {}),
    };
    // Mentor no fluxo de horários de um match: os horários vão para o match (não para o perfil). Match cancelado/inexistente
    // com a pessoa ainda nesse estado: solta a pessoa (COMPLETED) e reavalia, para ninguém ficar preso.
    let activeMatch: MatchRow | null = null;
    const asMentor = isMatchScheduleState(user.state) || isMatchMentorAcceptState(user.state);
    if (asMentor || isMatchMenteeState(user.state)) {
      activeMatch = await deps.repo.getActiveMatchFor(msg.from);
      if (!activeMatch || (asMentor ? activeMatch.mentorWaId : activeMatch.menteeWaId) !== msg.from) {
        await deps.repo.saveConversation(msg.from, stored.version, { state: "COMPLETED", previousState: null, hintSentInState: false, optedOutAt: stored.optedOutAt });
        continue;
      }
    }
    // Confirmação de mentoria pendente para esta pessoa (parceiro que escreve pela primeira vez depois do pedido).
    if (!offered && msg.type === "text" && !intentsOf(msg.body).has("quit")) {
      offered = true;
      if (await offerPendingConfirmation(msg.from, user.state, counters, confirmDeps)) return;
    }
    // Anonimato: quem tem mentoria marcada/em andamento e pergunta "quem é meu mentor/mentorado?" (nome, contato, inicial...) recebe
    // SEMPRE o texto fixo, sem IA e sem dado do outro lado. Os nomes só saem 5 min antes (matching/reminder.ts).
    if (msg.type === "text" && user.state !== "OPTED_OUT" && asksCounterpartIdentity(msg.body) && !intentsOf(msg.body).has("quit")) {
      const pair = (await deps.repo.getConfirmedMatchFor(msg.from).catch(() => null)) ?? (await deps.repo.getActiveMatchFor(msg.from).catch(() => null));
      if (pair) {
        deps.logger.log("info", "anonymity_asked", { from: maskPhone(msg.from) });
        if (limited(counters)) return;
        const body = pair.namesSentAt ? NAMES_ALREADY_SENT_REPLY : ANONYMITY_REPLY;
        const r = await deps.send({ to: msg.from, ...careOut({ type: "text", text: { body } }) });
        if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
        return;
      }
    }
    // Pedido de certificado (mentor ou mentorado já cadastrados): confere a curadoria, grava o pedido e avisa a equipe. Fora das
    // etapas de cadastro e de texto livre (a palavra "certificado" numa dúvida ou assunto não é um pedido).
    if (
      msg.type === "text" && !/^(NEW|AWAIT_REGISTRATION|REG_.*|OPTED_OUT|MENT_SUBJECT|MENT_DATE_TEXT|MENT_PARTNER|DOUBT_TEXT|AVAILABILITY_TEXT)$/.test(user.state) &&
      wantsCertificate(msg.body) && !intentsOf(msg.body).has("quit") && (await getReg()).consentAt
    ) {
      if (limited(counters)) return;
      const body = await handleCertificateRequest(msg.from, { repo: deps.repo, logger: deps.logger, send: deps.send, now, adminWaIds: deps.adminWaIds ?? [] });
      const r = await deps.send({ to: msg.from, ...careOut({ type: "text", text: { body } }) });
      if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
      return;
    }
    // Pergunta sobre o programa, os termos/LGPD ou o motivo de uma etapa ("pra que você pergunta isso?"): responde em 1 mensagem
    // e devolve a pergunta da etapa. Dúvida de conteúdo (ex.: "como funciona um rotacional?") não é respondida.
    const mentoringAsk = msg.type === "text" && (user.state === "COMPLETED" || user.state === "RETURNING_CHOICE") && isMentoringRequest(msg.body);
    const switching = msg.type === "text" && inMentoriaFlow(user.state) && wantsSwitch(msg.body);
    // Menu: escolheu "Marcar nova mentoria"; ou escreveu que quer marcar uma (em etapas em que isso abre o pedido direto).
    const menuNewMentoring = user.state === "MENU" && (msg.type === "list_reply" || msg.type === "button_reply") && findService(content, msg.id)?.id === NEW_MENTORING_SERVICE_ID;
    // Imprevisto depois de registrar a dúvida (etapa de horários da dúvida, ou logo depois de concluir): a pessoa corrige a dúvida
    // ("na verdade minha dúvida é...") ou diz que estava brincando. O Axo troca a dúvida / aceita a brincadeira e segue.
    const afterDoubt = msg.type === "text" && (/^SCHED_(DAYS|HOURS|CONFIRM)_doubt(_|$)/.test(user.state) || user.state === "COMPLETED");
    const newDoubt = afterDoubt && msg.type === "text" ? parseDoubtCorrection(msg.body) : null;
    const doubtJoke = afterDoubt && msg.type === "text" && user.state !== "COMPLETED" && newDoubt === null && isDoubtJoke(msg.body);
    const asksWork = msg.type === "text" && canOpenNewMentoring(user.state) && asksToDoWork(msg.body);
    const typedNewMentoring = msg.type === "text" && canOpenNewMentoring(user.state) && wantsNewMentoring(msg.body);
    if (!faqTried && msg.type === "text" && !mentoringAsk && !switching && !typedNewMentoring && !asksWork && newDoubt === null && !doubtJoke && shouldAnswer(msg.body, user.state)) {
      faqTried = true;
      const plan = await planAnswer(msg.body, user.state, {
        agent: deps.agent, recent: deps.recentContext,
        // Só os dados de QUEM escreve (msg.from); o nome do parceiro só depois que o bot já o enviou (anonimato).
        self: async () => {
          const reg = await getReg();
          const pair = (await deps.repo.getConfirmedMatchFor(msg.from).catch(() => null)) ?? (await deps.repo.getActiveMatchFor(msg.from).catch(() => null));
          const isMentor = pair?.mentorWaId === msg.from;
          const partnerName = pair?.namesSentAt ? (await deps.repo.getRegistration(isMentor ? pair.menteeWaId : pair.mentorWaId).catch(() => null))?.values.full_name : undefined;
          return {
            consented: reg.consentAt !== null, fullName: reg.values.full_name, className: reg.values.class_name, timezone: tz,
            mentoria: pair ? { role: isMentor ? "mentor" : "mentorado", status: pair.status, scheduledAt: pair.scheduledAt, location: pair.location, partnerName } : null,
          };
        },
      });
      if (plan === "silent") {
        deps.logger.log("info", "faq_off_topic", { from: maskPhone(msg.from), state: user.state });
        await sendOffTopic(msg, user, stored, counters, deps, content, careOut, stickersOn, careMode);
        return;
      }
      if (plan) {
        if (limited(counters)) return; // sem vaga de mensagem: silêncio (R2)
        const url = deps.registration?.privacyUrl ?? "";
        const reply = PRE_CONSENT.test(user.state)
          ? consentShortReply(plan.answer, url, content)
          : withStepPrompt(plan.answer, plan.withLink && url ? url : null, await stepPrompt(user.state as State, msg.from, deps, content));
        if (user.state === "NEW") {
          // Primeira mensagem foi uma pergunta: responde e já pede o consentimento (o próximo passo do cadastro).
          const won = await deps.repo.saveConversation(msg.from, stored.version, { state: "REG_CONSENT", previousState: null, hintSentInState: false, optedOutAt: null });
          if (!won) continue;
        }
        deps.logger.log("info", "faq_answered", { from: maskPhone(msg.from), state: user.state, chars: plan.answer.length });
        const r = await deps.send({ to: msg.from, ...careOut(reply) });
        if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
        return;
      }
    }
    // Registro de mentoria: rascunho e (no passo do parceiro) a busca da pessoa indicada.
    const mentoriaDraft = isMentoriaState(user.state) ? await deps.repo.getMentoriaDraft(msg.from) : {};
    if (partnerRes === "unset") {
      partnerRes = user.state === "MENT_PARTNER" ? await resolvePartner(msg, deps.repo) : undefined;
    }
    // Horários: a IA lê os dias/horários escritos em linguagem natural (uma consulta por mensagem).
    if (availParsed === "unset") {
      availParsed = undefined;
      const text = msg.type === "text" ? msg.body.replace(/\s+/g, " ").trim().slice(0, 500) : "";
      // Nas listas de dias/horários, a IA só é consultada se as regras do bot não acharam nada no texto.
      const needsAi = user.state === "AVAILABILITY_TEXT" ||
        (isScheduleState(user.state) && (() => { const r = parseScheduleText(text); return r.slots.length === 0 && r.loose.length === 0; })());
      if (needsAi && deps.agent?.extractAvailability && text.length >= 2 && intentsOf(text).size === 0) {
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
        const rec = needsRecord ? await getReg() : null;
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
      const needsProfile = user.state === "MENTOR_CATEGORIES" || user.state === "MENTOR_CATEGORIES_BOTH" || user.state === "REMOVE_CATEGORIES" ||
        user.state === "RETURNING_CHOICE" || user.state === "DOUBT_TEXT" || user.state === "COMPLETED" || isScheduleState(user.state);
      const regRec = needsProfile ? await getReg() : null;
      const savedSlots = activeMatch ? (activeMatch.mentorSlots ?? []) : (regRec?.availabilitySlots ?? []);
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
      let mentoriaEffect: MentoriaEffect | undefined;
      const sd = decideSchedule(user, m, counters, now, content, { slots: savedSlots as never, ai: availParsed === "unset" ? undefined : availParsed });
      if (sd) {
        d = { replies: sd.replies, nextState: sd.nextState, outcome: sd.outcome };
        effect = undefined;
        profileEffect = undefined;
        scheduleEffect = sd.effect;
      } else if (user.state === "OPTED_OUT" && d.outcome === "transition" && isScheduleState(d.nextState.state)) {
        const prompt = schedulePrompt(d.nextState.state, savedSlots as never, content);
        if (prompt) d = { ...d, replies: [prompt] };
      }
      // Matching manual: o mentorado escolhe o horário do mentor e diz o local.
      let matchEffect: MenteeEffect | undefined;
      // Mentor: aceita ou não a mentoria (antes de qualquer horário).
      let acceptEffect: MentorAcceptEffect | undefined;
      if (activeMatch && isMatchMentorAcceptState(user.state)) {
        const ma = decideMatchMentor(user, m, counters, now, content);
        if (ma) {
          d = { replies: ma.replies, nextState: ma.nextState, outcome: ma.outcome };
          effect = undefined;
          profileEffect = undefined;
          scheduleEffect = undefined;
          acceptEffect = ma.effect;
        }
      }
      if (activeMatch && isMatchMenteeState(user.state)) {
        const mm = decideMatchMentee(user, m, counters, now, { match: activeMatch, timezone: tz });
        if (mm) {
          d = { replies: mm.replies, nextState: mm.nextState, outcome: mm.outcome };
          effect = undefined;
          profileEffect = undefined;
          scheduleEffect = undefined;
          matchEffect = mm.effect;
        }
      }
      // Papel -> assunto -> data -> parceiro (depois do arquivo guardado).
      const md = decideMentoria(user, m, counters, now, content, {
        draft: mentoriaDraft, today: todayIn(now, deps.mentoria?.timezone ?? "America/Sao_Paulo"),
        ...(partnerRes !== "unset" && partnerRes ? { partner: partnerRes } : {}),
      });
      if (md) {
        d = { replies: md.replies, nextState: md.nextState, outcome: md.outcome };
        effect = undefined;
        profileEffect = undefined;
        scheduleEffect = undefined;
        mentoriaEffect = md.effect;
      } else if (user.state === "OPTED_OUT" && d.outcome === "transition" && isMentoriaState(d.nextState.state)) {
        const prompt = mentoriaPrompt(d.nextState.state);
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
      return { d, effect, profileEffect, availabilityEffect: availabilityEffect ?? scheduleEffect, mentoriaEffect, matchEffect, acceptEffect };
    };
    // Troca de assunto no meio do registro de mentoria ("quero tirar uma dúvida"): pergunta antes de largar o que estava fazendo.
    if ((newDoubt !== null || doubtJoke) && msg.type === "text") {
      if (limited(counters)) return;
      let line: string | null = null;
      if (newDoubt !== null) {
        const replaced = await deps.repo.replaceOpenDoubt(msg.from, { text: newDoubt, categories: classifyDoubt(newDoubt) }).catch(() => false);
        if (replaced) { line = doubtChangedLine(msg.body, newDoubt); deps.logger.log("info", "doubt_replaced", { from: maskPhone(msg.from), state: user.state }); }
        else if (user.state !== "COMPLETED") line = doubtLockedLine(msg.body);
      } else line = doubtJokeLine(msg.body);
      if (line !== null) {
        const reply = withStepPrompt(line, null, await stepPrompt(user.state, msg.from, deps, content));
        const r = await deps.send({ to: msg.from, ...careOut(reply) });
        if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
        return;
      }
    }
    if (asksWork && msg.type === "text") {
      // Integridade acadêmica: não faz a ponderada pelo aluno; explica sem bronca e oferece uma mentoria. Não muda a etapa.
      if (limited(counters)) return;
      deps.logger.log("info", "work_request_declined", { from: maskPhone(msg.from), state: user.state });
      const reply = withStepPrompt(workRefusal(msg.body), null, await stepPrompt(user.state, msg.from, deps, content));
      const r = await deps.send({ to: msg.from, ...careOut(reply) });
      if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
      return;
    }
    // Rede ainda fechada para esta pessoa: pode se cadastrar, mas não pedir mentoria (guardrail de abertura, network-gate.ts).
    const networkClosed = isNetworkClosed(deps.networkGate, msg.from, now);
    const closedReply = (): Reply => ({ type: "text", text: { body: closedNetworkText(deps.networkGate as NetworkGate, tz) } });
    if (networkClosed && (menuNewMentoring || typedNewMentoring)) {
      if (limited(counters)) return;
      deps.logger.log("info", "network_closed_request", { from: maskPhone(msg.from), via: menuNewMentoring ? "menu" : "text" });
      const r = await deps.send({ to: msg.from, ...careOut(closedReply()) });
      if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
      return;
    }
    if (menuNewMentoring || typedNewMentoring) {
      // Abre o pedido de uma nova mentoria: a pessoa conta do que precisa (vira a dúvida), depois escolhe os horários e o admin conecta o mentor.
      if (limited(counters)) return;
      const won = await deps.repo.saveConversation(msg.from, stored.version, { state: "DOUBT_TEXT", previousState: null, hintSentInState: false, optedOutAt: null });
      if (!won) continue;
      deps.logger.log("info", "new_mentoring_opened", { from: maskPhone(msg.from), via: menuNewMentoring ? "menu" : "text" });
      const reply = withStepPrompt("Bora marcar uma nova mentoria! 🦎", null, await stepPrompt("DOUBT_TEXT", msg.from, deps, content));
      const r = await deps.send({ to: msg.from, ...careOut(reply) });
      if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
      return;
    }
    if (msg.type === "text" && inMentoriaFlow(user.state) && wantsSwitch(msg.body)) {
      if (limited(counters)) return;
      const won = await deps.repo.saveConversation(msg.from, stored.version, { state: SWITCH_STATE, previousState: user.state, hintSentInState: false, optedOutAt: null });
      if (!won) continue;
      deps.logger.log("info", "switch_asked", { from: maskPhone(msg.from), from_state: user.state });
      const r = await deps.send({ to: msg.from, ...careOut(switchQuestion()) });
      if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
      return;
    }
    if (user.state === SWITCH_STATE && !limited(counters)) {
      const ans = readSwitchAnswer(msg);
      if (ans === "doubt" && isNetworkClosed(deps.networkGate, msg.from, now)) {
        // Queria largar o registro da mentoria para tirar uma dúvida, mas a rede ainda não abriu: segue o registro.
        const back: State = user.previousState && inMentoriaFlow(user.previousState) ? user.previousState : "AWAIT_AUDIO";
        const won = await deps.repo.saveConversation(msg.from, stored.version, { state: back, previousState: null, hintSentInState: false, optedOutAt: null });
        if (!won) continue;
        const r = await deps.send({ to: msg.from, ...careOut(withStepPrompt(closedNetworkText(deps.networkGate as NetworkGate, tz), null, await stepPrompt(back, msg.from, deps, content))) });
        if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
        return;
      }
      if (ans) {
        const back: State = user.previousState && inMentoriaFlow(user.previousState) ? user.previousState : "AWAIT_AUDIO";
        const next: UserState = ans === "keep"
          ? { state: back, previousState: null, hintSentInState: false, optedOutAt: null }
          : { state: "DOUBT_TEXT", previousState: null, hintSentInState: false, optedOutAt: null };
        const won = await deps.repo.saveConversation(msg.from, stored.version, next);
        if (!won) continue;
        let reply: Reply;
        if (ans === "keep") {
          reply = withStepPrompt("Beleza, seguimos com a mentoria.", null, await stepPrompt(back, msg.from, deps, content));
        } else {
          // Deixa o registro de lado: apaga o rascunho e o áudio incompleto (R6) e começa a dúvida do zero.
          const draft = await deps.repo.getMentoriaDraft(msg.from).catch(() => ({} as { audioId?: string }));
          await applyMentoriaEffect({ kind: "cancel", audioId: draft.audioId ?? null }, msg.from, deps).catch(() => undefined);
          reply = withStepPrompt("Fechou, deixei o registro da mentoria de lado.", null, await stepPrompt("DOUBT_TEXT", msg.from, deps, content));
        }
        deps.logger.log("info", "switch_answered", { from: maskPhone(msg.from), choice: ans });
        const r = await deps.send({ to: msg.from, ...careOut(reply) });
        if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
        return;
      }
    }
    if (stickersOn && msg.type === "unsupported" && isStickerTrigger(msg.rawType) && user.state !== "OPTED_OUT" && user.state !== "PROCESSING_AUDIO") {
      // Figurinha ou imagem não mudam a etapa: o Axo só devolve uma figurinha (descontraído), dentro dos limites do R2.
      await sendStickerBack(msg, counters, deps);
      return;
    }
    let ev = await evaluate(msg);
    // IA: só quando o bot não entendeu (dica/silêncio) ou, na dúvida, para conferir se o texto é mesmo uma dúvida.
    const routed = await routeWithAgent(msg, user, ev.d.outcome, counters, deps);
    if (routed?.kind === "button") ev = await evaluate(routed.msg);
    else if (routed?.kind === "silent") {
      // Assunto sem relação com o programa: nada é guardado; o Axo só avisa (descontraído) que aqui é mentoria.
      await sendOffTopic(msg, user, stored, counters, deps, content, careOut, stickersOn, careMode);
      return;
    } else if (!routed && msg.type === "text" && ev.d.outcome === "silent" && intentsOf(msg.body).has("greeting") && !intentsOf(msg.body).has("quit")) {
      // Saudação que nenhuma etapa respondeu: nunca silêncio (a pessoa não sabe se o bot caiu). Repete o que está pendente.
      await sendResume(msg, user, stored, counters, deps, content, careOut, careMode);
      return;
    } else if (!routed && user.state === "COMPLETED" && msg.type === "text" && ev.d.outcome === "silent" && isCourtesy(msg.body)) {
      // "valeu", "tchau" depois do fim do fluxo: responde ("vlw") e, se houver figurinhas, manda a de despedida (só se acabamos de falar com a pessoa).
      await sendFarewell(msg, counters, deps, careOut, stickersOn, careMode);
      return;
    } else if (
      !routed && user.state === "COMPLETED" && msg.type === "text" && ev.d.outcome === "silent" &&
      !isCourtesy(msg.body) && intentsOf(msg.body).size === 0
    ) {
      // Fim do fluxo e a pessoa escreveu algo que nem as regras nem a IA trataram: volta ao assunto (mentoria), uma vez.
      ev = { d: nudgeToMentoring(user, counters, now, content, msg.body), effect: undefined, profileEffect: undefined, availabilityEffect: undefined, mentoriaEffect: undefined, matchEffect: undefined, acceptEffect: undefined };
    } else if (
      !routed && msg.type === "text" && ev.d.outcome === "silent" && user.state !== "OPTED_OUT" && user.state !== "PROCESSING_AUDIO" &&
      !isCourtesy(msg.body) && !intentsOf(msg.body).has("quit") && !intentsOf(msg.body).has("greeting")
    ) {
      // Texto que nenhuma regra nem a IA trataram (e a dica única já foi usada): em vez de calar, avisa uma vez e com graça.
      await sendOffTopic(msg, user, stored, counters, deps, content, careOut, stickersOn, careMode);
      return;
    } else if (routed?.kind === "faq") {
      ev = { d: { replies: [withStepPrompt(routed.answer, null, await stepPrompt(user.state, msg.from, deps, content))], nextState: user, outcome: "reply" }, effect: undefined, profileEffect: undefined, availabilityEffect: undefined, mentoriaEffect: undefined, matchEffect: undefined, acceptEffect: undefined };
    }
    // Guardrail da rede fechada (pós-decisão): o cadastro segue (papel, categorias, horários), mas qualquer passo que registraria
    // uma dúvida ou levaria a pessoa a pedir mentoria vira o aviso de abertura, sem gravar dúvida.
    if (networkClosed && ev.d.outcome !== "limited" && (ev.profileEffect?.kind === "doubt" || isMentoringRequestState(ev.d.nextState.state)) && !isMentoringRequestState(user.state)) {
      deps.logger.log("info", "network_closed_doubt_blocked", { from: maskPhone(msg.from), state: user.state });
      const nextState: UserState = { state: "COMPLETED", previousState: null, hintSentInState: false, optedOutAt: null };
      ev = { ...ev, profileEffect: ev.profileEffect?.kind === "doubt" ? undefined : ev.profileEffect, d: { replies: [closedReply()], nextState, outcome: "reply" } };
    } else if (networkClosed && ev.d.outcome !== "limited" && ev.profileEffect?.kind === "doubt") {
      // Já estava no meio do pedido (antes da guardrail): não grava a dúvida e encerra com o aviso.
      const nextState: UserState = { state: "COMPLETED", previousState: null, hintSentInState: false, optedOutAt: null };
      ev = { ...ev, profileEffect: undefined, d: { replies: [closedReply()], nextState, outcome: "reply" } };
    }
    const { effect, profileEffect, availabilityEffect, mentoriaEffect, matchEffect, acceptEffect, d } = ev;
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
    if (availabilityEffect) {
      if (activeMatch) await deps.repo.updateMatch(activeMatch.id, { mentorSlots: [...(availabilityEffect.slots ?? [])] }, now);
      else await deps.repo.saveAvailability(msg.from, availabilityEffect.text, now, availabilityEffect.slots);
    }
    if (mentoriaEffect) await applyMentoriaEffect(mentoriaEffect, msg.from, deps); // idempotente
    const flowDeps = { repo: deps.repo, send: deps.send, logger: deps.logger, now, timezone: tz, adminWaIds: deps.adminWaIds ?? [] };
    if (matchEffect && activeMatch) await persistMenteeEffect(matchEffect, activeMatch, flowDeps);
    // Entrou no fluxo de dias e horários vindo de fora: começa do zero (horários antigos não se misturam com os novos).
    // Exceção: horários de um match ficam no match; o perfil do mentor não pode ser apagado ao aceitar a mentoria.
    if (isScheduleState(d.nextState.state) && !isMatchScheduleState(d.nextState.state) && !isScheduleState(user.state) && user.state !== "OPTED_OUT") {
      await deps.repo.saveAvailability(msg.from, "", now, []);
    }
    if (changed) {
      const won = await deps.repo.saveConversation(msg.from, stored.version, d.nextState);
      if (!won) continue; // outra mensagem mudou o estado: reavalia com o estado novo
    }
    deps.logger.log("info", "conversation_decision", {
      from: maskPhone(msg.from), outcome: d.outcome, state: d.nextState.state,
    });
    // Figurinhas por situação: abertura (primeira mensagem) vem ANTES do texto, para as opções numeradas da resposta ficarem por último.
    const stickerRoom = stickersOn && d.outcome !== "limited" && d.nextState.state !== "OPTED_OUT" && d.replies.length > 0 &&
      hasRoom(counters, d.replies.length + 1);
    if (stickerRoom && user.state === "NEW") await sendSticker("abertura", msg.from, deps);
    for (const reply of d.replies) {
      const result = await deps.send({ to: msg.from, ...careOut(reply) });
      if (result.status !== "sent") {
        // "error" = o envio à Meta falhou (o motivo detalhado está no log whatsapp_send_failed/exception).
        deps.logger.log(result.status === "error" ? "warn" : "info", "reply_not_sent", {
          from: maskPhone(msg.from), status: result.status, ...(result.status === "error" ? { code: result.code } : {}),
        });
      }
    }
    // Terminou o fluxo: despedida com figurinha.
    if (stickerRoom && d.nextState.state === "COMPLETED" && user.state !== "COMPLETED") await sendSticker("despedida", msg.from, deps);
    // Mentor terminou a grade do match: guarda no match e segue o fluxo (avisa o admin).
    if (activeMatch && availabilityEffect && d.nextState.state === "COMPLETED" && d.outcome !== "limited") {
      try {
        await onMentorSlotsDone(activeMatch, availabilityEffect.slots ?? [], flowDeps);
      } catch { deps.logger.log("error", "match_slots_done_failed", { from: maskPhone(msg.from) }); }
    }
    // Mentor recusou a mentoria: desfaz o match e avisa o admin (a dúvida volta para a lista).
    if (acceptEffect?.kind === "decline" && activeMatch && d.outcome !== "limited") {
      try { await onMentorDeclined(activeMatch, flowDeps); }
      catch { deps.logger.log("error", "match_decline_failed", { from: maskPhone(msg.from) }); }
    }
    // Mentorado decidiu (horário, "nenhum desses" ou local): avisa mentor e admin.
    if (matchEffect && activeMatch && d.outcome !== "limited") {
      try {
        // O match já foi gravado acima: os avisos usam a versão atualizada (dia/hora escolhidos).
        const fresh = (await deps.repo.getMatchBySeq(activeMatch.seq)) ?? activeMatch;
        await notifyMenteeEffect(matchEffect, fresh, flowDeps);
      } catch { deps.logger.log("error", "match_notify_failed", { from: maskPhone(msg.from) }); }
    }
    // Áudio chegou antes do horário e a pessoa confirmou que a mentoria já aconteceu: completa com os dados do match.
    if (mentoriaEffect?.kind === "early_confirm" && d.outcome !== "limited") {
      const found = await matchForAudio(deps.repo, msg.from, now);
      const done = found ? await completeFromMatch({ repo: deps.repo, logger: deps.logger, now, timezone: tz }, msg.from, mentoriaEffect.audioId, found.match) : null;
      if (done) await notifyPartner(mentoriaEffect.audioId, done.partnerHash, confirmDeps);
      else deps.logger.log("warn", "mentoria_early_confirm_failed", { from: maskPhone(msg.from) });
    }
    // Mentoria completa: avisa o parceiro (uma vez: só depois de o estado ter sido gravado).
    if (mentoriaEffect?.kind === "complete" && d.outcome !== "limited") {
      await notifyPartner(mentoriaEffect.audioId, mentoriaEffect.partnerHash, confirmDeps);
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

/** A pergunta da etapa atual (para continuar de onde a pessoa parou depois de responder a dúvida). */
async function stepPrompt(state: State, waId: string, deps: EngineDeps, content: Content): Promise<Reply | undefined> {
  const privacyUrl = deps.registration?.privacyUrl ?? "";
  if (state === "AWAIT_REGISTRATION" || state === "REG_CONSENT") {
    return registrationPrompt(state, { privacyUrl, content, registered: false, hasConsent: false });
  }
  if (state === "REG_NAME_CONFIRM" || state === "REG_AGE" || state === "REG_PROFILE_AUDIO" || state.startsWith("REG_FIELD_")) {
    return registrationPrompt(state, { privacyUrl, content, registered: false, hasConsent: true });
  }
  if (state === "PROFILE_ROLE" || state === "DOUBT_ASK" || state === "RETURNING_CHOICE" || state === "DOUBT_TEXT") return profilePrompt(state, content);
  if (isMentoriaState(state)) return mentoriaPrompt(state);
  if (state === "AVAILABILITY_TEXT") return REPLIES.askAvailability(content);
  if (state === "MENTOR_CATEGORIES" || state === "MENTOR_CATEGORIES_BOTH") {
    const rec = await deps.repo.getRegistration(waId);
    return categoriesListReply(rec.mentorCategories ?? [], content);
  }
  if (state === "REMOVE_CATEGORIES") {
    const rec = await deps.repo.getRegistration(waId);
    return removeCategoriesReply(rec.mentorCategories ?? [], content);
  }
  if (isMatchMentorAcceptState(state)) return acceptReply();
  if (isMatchMenteeState(state)) {
    const m = await deps.repo.getActiveMatchFor(waId);
    if (!m) return undefined;
    if (state === "MATCH_MENTEE_PICK") return pickReply(m.mentorSlots, new Date(), deps.mentoria?.timezone ?? "America/Sao_Paulo");
    if (state === "MATCH_MENTEE_TIME" && m.chosenDay && m.chosenStart && m.chosenEnd) return timePrompt(m.chosenDay as never, m.chosenStart, m.chosenEnd);
    return placePrompt();
  }
  if (isScheduleState(state)) {
    const rec = await deps.repo.getRegistration(waId);
    return schedulePrompt(state, (rec.availabilitySlots ?? []) as never, content);
  }
  if (state === SWITCH_STATE) return switchQuestion();
  if (state === "MENU") return menuReply(content);
  if (state === "AWAIT_AUDIO") return REPLIES.audioInstruction(content);
  return undefined; // COMPLETED: só a resposta
}

/**
 * Saudação ("oi", "tá por aí?") no meio de uma etapa que o motor deixou sem resposta: a pessoa SEMPRE recebe feedback.
 * Confirma que o bot está vivo e repete o que está esperando dela (a pergunta da etapa). Respeita os limites por pessoa (R2).
 */
async function sendResume(
  msg: IncomingMessage, user: UserState, stored: { version: number }, counters: Counters, deps: EngineDeps, content: Content,
  careOut: (r: Reply) => Reply, care = false,
): Promise<void> {
  if (msg.type !== "text" || limited(counters)) return;
  const now = (deps.now ?? (() => new Date()))();
  let fresh: Counters;
  let lastBot: Date | null;
  try {
    const sent = await deps.repo.listOutboundSince(await hashWaId(msg.from), new Date(now.getTime() - DAY_MS));
    fresh = { ...counters, sentLastDay: sent.length, sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length };
    lastBot = sent.reduce<Date | null>((m, t) => (m === null || t > m ? t : m), null);
  } catch { return; } // sem conseguir contar, não arrisca (R1/R2)
  if (limited(fresh)) return;
  // "oi oi oi" em sequência: a pessoa acabou de receber o feedback (poucos segundos atrás), uma resposta basta (anti-rajada).
  if (lastBot !== null && now.getTime() - lastBot.getTime() < RESUME_COOLDOWN_MS) return;
  const won = await deps.repo.saveConversation(msg.from, stored.version, user);
  if (!won) return;
  let reply: Reply;
  if (user.state === "OPTED_OUT") reply = { type: "text", text: { body: OPTED_OUT_GREETING } };
  else if (user.state === "PROCESSING_AUDIO") reply = { type: "text", text: { body: PROCESSING_GREETING } };
  else {
    const prompt = await stepPrompt(user.state, msg.from, deps, content).catch(() => undefined);
    if (!prompt) reply = { type: "text", text: { body: idleGreeting(msg.body) } };
    else {
      const lead = await speak(deps, user.state, "resume", msg.body, resumeLead(msg.body, fresh.sentLast10Min), care);
      reply = withStepPrompt(lead, null, prompt);
      // Se a pergunta não coube junto da abertura, manda só a pergunta: o importante é a pessoa saber o que responder.
      if (!replyBody(reply).includes(replyBody(prompt).slice(0, 40))) reply = prompt;
    }
  }
  deps.logger.log("info", "greeting_resume", { from: maskPhone(msg.from), state: user.state });
  const r = await deps.send({ to: msg.from, ...careOut(reply) });
  if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
}

/** Devolve uma figurinha a quem mandou figurinha/imagem. Mesmos limites e anti-rajada (8 s) da retomada por saudação. */
async function sendStickerBack(msg: IncomingMessage, counters: Counters, deps: EngineDeps): Promise<void> {
  if (!deps.stickers || limited(counters)) return;
  const now = (deps.now ?? (() => new Date()))();
  try {
    const sent = await deps.repo.listOutboundSince(await hashWaId(msg.from), new Date(now.getTime() - DAY_MS));
    const fresh: Counters = { ...counters, sentLastDay: sent.length, sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length };
    if (limited(fresh)) return;
    const lastBot = sent.reduce<Date | null>((m, t) => (m === null || t > m ? t : m), null);
    if (lastBot !== null && now.getTime() - lastBot.getTime() < RESUME_COOLDOWN_MS) return;
  } catch { return; } // sem conseguir contar, não arrisca (R1/R2)
  await sendSticker("reacao", msg.from, deps);
}

/**
 * Fala dinâmica do Axo pela IA (Groq): só o "tempero" da mensagem. Sem IA, antes do aceite (LGPD: nada da pessoa sai
 * para a IA), em opt-out ou se a IA falhar/demorar, vale o texto fixo. Nunca lança.
 */
async function speak(
  deps: EngineDeps, state: State, situation: RiffSituation, text: string, fallback: string, care = false,
): Promise<string> {
  if (!deps.agent?.riff || PRE_CONSENT.test(state) || state === "OPTED_OUT" || state === "PROCESSING_AUDIO") return fallback;
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!/[a-zà-ú]{2,}/i.test(clean)) return fallback;
  try {
    // Estilo medido em código (spec "Motor de adaptação"): registro, tamanho, emoji, gírias. Modo cuidado = neutro.
    const signals = measureSignals(clean);
    const decided = decideStyle(updateSessionStyle(EMPTY_SESSION_STYLE, signals), signals, { careMode: care, phase: situation === "farewell" ? "fechamento" : "diagnostico" });
    // Decisão do dono: o Axo segue usando emoji (até 1, o 🦎 é a assinatura), exceto no modo cuidado.
    const style = { ...decided, emojiMax: care ? (0 as const) : (1 as const) };
    const raw = await deps.agent.riff({ situation, text: clean, style: buildStyleLine(style), ...(deps.recentContext?.length ? { recent: deps.recentContext } : {}) });
    if (!raw) return fallback;
    // Guardrails da spec: sem nome, horário, sala, marcador nem português de Portugal; tamanho coerente com o estilo.
    if (/[{}]/.test(raw) || checkSpeech(raw, { otherUserNames: [] }).length > 0) return fallback;
    if ((raw.match(/[.!?…]+(\s|$)/g)?.length ?? 1) > style.maxSentences + 1) return fallback;
    // No máximo 1 emoji (nenhum no modo cuidado).
    const emojis = raw.match(/\p{Extended_Pictographic}\uFE0F?/gu) ?? [];
    let line = raw;
    if (emojis.length > style.emojiMax) {
      let kept = 0;
      line = raw.replace(/\p{Extended_Pictographic}\uFE0F?/gu, (m) => (kept++ < style.emojiMax ? m : "")).replace(/\s{2,}/g, " ").replace(/\s+([.!?,])/g, "$1").trim();
    }
    return line.length >= 4 ? line : fallback;
  } catch { return fallback; }
}

/** Cabem `n` mensagens a mais dentro dos limites por pessoa (R2)? */
function hasRoom(c: Counters, n: number): boolean {
  return c.sentLast10Min + n <= c.maxPer10Min && c.sentLastDay + n <= c.maxPerDay;
}

/** Envia uma figurinha da categoria (sem figurinha disponível = não envia). Nunca lança. */
async function sendSticker(category: StickerCategory, to: string, deps: EngineDeps): Promise<void> {
  if (!deps.stickers) return;
  try {
    const sticker = await deps.stickers.pick(category);
    if (!sticker) return;
    deps.logger.log("info", "sticker_sent", { from: maskPhone(to), category });
    const r = await deps.send({ to, type: "sticker", sticker });
    if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(to), status: r.status });
  } catch { deps.logger.log("warn", "sticker_failed", { category }); }
}

/** "valeu"/"tchau" no fim do fluxo: "vlw" + figurinha de despedida. Só se o bot falou há pouco (é resposta ao nosso fecho), com anti-rajada. */
async function sendFarewell(msg: IncomingMessage, counters: Counters, deps: EngineDeps, careOut: (r: Reply) => Reply, stickersOn: boolean, care = false): Promise<void> {
  const need = stickersOn ? 2 : 1;
  if (msg.type !== "text" || limited(counters) || !hasRoom(counters, need)) return;
  const now = (deps.now ?? (() => new Date()))();
  try {
    const sent = await deps.repo.listOutboundSince(await hashWaId(msg.from), new Date(now.getTime() - DAY_MS));
    const fresh: Counters = { ...counters, sentLastDay: sent.length, sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length };
    if (!hasRoom(fresh, need)) return;
    const lastBot = sent.reduce<Date | null>((m, t) => (m === null || t > m ? t : m), null);
    if (lastBot === null || now.getTime() - lastBot.getTime() < RESUME_COOLDOWN_MS || now.getTime() - lastBot.getTime() > TEN_MIN_MS) return;
  } catch { return; }
  if (stickersOn) await sendSticker("despedida", msg.from, deps);
  const body = await speak(deps, "COMPLETED", "farewell", msg.body, farewellText(msg.body, counters.sentLast10Min), care);
  const r = await deps.send({ to: msg.from, ...careOut({ type: "text", text: { body } }) });
  if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
}

function replyBody(r: Reply): string {
  if (r.type === "text") return r.text.body;
  const i = (r as unknown as { interactive?: { body?: { text?: string } } }).interactive;
  return i?.body?.text ?? "";
}

type Routed =
  | { kind: "button"; msg: IncomingMessage }
  | { kind: "silent" }
  | { kind: "faq"; answer: string }
  | null;

/** Estados pós-cadastro em que uma pergunta sobre o programa pode ser respondida pela IA. */

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
  // Em qualquer etapa depois do aceite (LGPD) o Groq pode entender o texto e responder com o "senso" do bot;
  // antes do aceite só as respostas locais valem (nenhum texto da pessoa sai para a IA).
  const canFaq = !PRE_CONSENT.test(user.state) && user.state !== "OPTED_OUT" && user.state !== "PROCESSING_AUDIO" && !!deps.agent.answerFaq;
  if (!route && !canFaq) return null;
  const unclear = outcome === "hint" || outcome === "silent";
  if (!(route?.always || unclear)) return null;
  const text = msg.body.replace(/\s+/g, " ").trim().slice(0, 500);
  if (text.length < 2) return null;
  // Comandos que o bot já entende (sair, menu, oi, sim, não...) nunca passam pela IA: ficam previsíveis e baratos.
  if (intentsOf(text).size > 0 || isCourtesy(text)) return null;

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
    case "about": {
      // Só a data já guardada + o resto das curiosidades = um texto só.
      const saved = (await deps.repo.getRegistration(waId)).profileAbout;
      await deps.repo.saveRegistration(waId, {
        profileAbout: saved?.startsWith(BIRTH_PREFIX) && !effect.text.startsWith(BIRTH_PREFIX) ? `${saved}. ${effect.text}`.slice(0, 1100) : effect.text,
      });
      return;
    }
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

/** Grava no banco o passo decidido (idempotente: repetir o mesmo passo não muda nada). */
async function applyMentoriaEffect(e: MentoriaEffect, waId: string, deps: EngineDeps): Promise<void> {
  const { repo } = deps;
  switch (e.kind) {
    case "role": await repo.saveMentoriaDraft(waId, { role: e.role }); return;
    case "subject": await repo.saveMentoriaDraft(waId, { subject: e.subject }); return;
    case "date": await repo.saveMentoriaDraft(waId, { occurredOn: e.occurredOn }); return;
    case "complete": {
      const ok = await repo.completeMentoria(waId, {
        audioId: e.audioId, role: e.role, subject: e.subject, occurredOn: e.occurredOn, partnerHash: e.partnerHash, partnerName: e.partnerName,
      });
      if (!ok) deps.logger.log("warn", "mentoria_complete_missing_audio", { from: maskPhone(waId) });
      await repo.saveMentoriaDraft(waId, null);
      return;
    }
    case "early_confirm": return; // completado depois de gravar o estado (matchForAudio + completeFromMatch), ver handleIncomingMessage
    case "cancel": {
      // Quem cancela não quer a gravação guardada: apaga o arquivo e o registro incompleto (R6: minimização).
      if (e.audioId) {
        const gone = await repo.discardIncompleteMentoria(e.audioId);
        if (gone && deps.mentoria?.store) await deps.mentoria.store.delete(gone.r2Key).catch(() => undefined);
      }
      await repo.saveMentoriaDraft(waId, null);
      return;
    }
  }
}

/** Quem é o parceiro indicado: botão de escolha, contato compartilhado, número ou nome. */
async function resolvePartner(msg: IncomingMessage, repo: Repo): Promise<PartnerResolution | undefined> {
  const own = new Set(await waIdHashes(msg.from)); // o próprio número, com e sem o 9º dígito
  if (msg.type === "button_reply") {
    if (msg.id === PARTNER_OTHER_ID) return { kind: "other" };
    if (!msg.id.startsWith(PARTNER_PICK_PREFIX)) return undefined;
    const hash = msg.id.slice(PARTNER_PICK_PREFIX.length);
    if (own.has(hash)) return { kind: "self" };
    const person = await repo.findPersonByWaIdHash(hash);
    return person?.consentAt ? { kind: "partner", hash: person.waIdHash, name: person.fullName } : { kind: "none" };
  }
  let ids: string[] = [];
  if (msg.type === "contacts") {
    for (const c of msg.contacts) {
      const w = c.waId ? contactWaId(c.waId) : null;
      ids = w ? [w, ...phoneCandidates(w)] : c.phone ? phoneCandidates(c.phone) : [];
      if (ids.length > 0) break;
    }
    if (ids.length === 0) return { kind: "none" };
  } else if (msg.type === "text") {
    if (intentsOf(msg.body).size > 0) return { kind: "none" };
    if (looksLikePhone(msg.body)) {
      ids = phoneCandidates(msg.body);
      if (ids.length === 0) return { kind: "none" };
    } else {
      const tokens = nameTokens(msg.body);
      if (tokens.length === 0 || tokens.join("").length < 4) return { kind: "none" };
      const people = (await repo.findPeopleByName(tokens, 4)).filter((p) => !own.has(p.waIdHash));
      if (people.length === 0) return { kind: "none" };
      if (people.length > 3) return { kind: "toomany" };
      return { kind: "people", people: people.map((p) => ({ hash: p.waIdHash, name: p.fullName ?? "" })) };
    }
  } else return undefined;
  const idHashes = await Promise.all(ids.map(hashWaId));
  if (idHashes.some((h) => own.has(h))) return { kind: "self" };
  for (const h of idHashes) {
    const person = await repo.findPersonByWaIdHash(h);
    if (person?.consentAt) return { kind: "partner", hash: person.waIdHash, name: person.fullName };
  }
  return { kind: "partner", hash: idHashes[0] as string, name: null };
}

/** Acrescenta "CVV: 188, 24h" ao fim da resposta (modo cuidado), sem passar do limite de 1024 caracteres do corpo. */
export function withCareFooter(reply: Reply): Reply {
  const add = (body: string): string => (body.length + CARE_FOOTER.length + 2 <= 1024 ? `${body}\n\n${CARE_FOOTER}` : body);
  if (reply.type === "text") return { type: "text", text: { body: add(reply.text.body) } };
  const i = reply.interactive as { body?: { text?: string } } | null;
  if (i && typeof i === "object" && typeof i.body?.text === "string") {
    return { type: "interactive", interactive: { ...i, body: { ...i.body, text: add(i.body.text) } } };
  }
  return reply;
}

/**
 * Aviso de assunto fora do escopo (1 mensagem, R2): a fala do Axo + a pergunta da etapa, se houver.
 * Antes de enviar, reserva o turno com um compare-and-set na conversa: numa rajada de mensagens simultâneas só uma
 * vence e avisa; as outras ficam em silêncio (o aviso não pode ser multiplicado pelo paralelismo). Sem vaga = silêncio.
 */
async function sendOffTopic(
  msg: IncomingMessage, user: UserState, stored: { version: number }, counters: Counters, deps: EngineDeps, content: Content,
  careOut: (r: Reply) => Reply, stickersOn = false, care = false,
): Promise<void> {
  if (msg.type !== "text" || limited(counters)) return;
  // Os contadores vieram da leitura do início do processamento: numa rajada, todas as mensagens leram "0 enviados".
  // Relê os envios logo antes de avisar, para o teto valer de verdade.
  const now = (deps.now ?? (() => new Date()))();
  let fresh: Counters;
  try {
    const sent = await deps.repo.listOutboundSince(await hashWaId(msg.from), new Date(now.getTime() - DAY_MS));
    fresh = { ...counters, sentLastDay: sent.length, sentLast10Min: sent.filter((t) => now.getTime() - t.getTime() < TEN_MIN_MS).length };
  } catch { return; } // sem conseguir contar, não arrisca (R1/R2: na dúvida, não envia)
  if (limited(fresh)) return;
  const slotsLeft = Math.min(fresh.maxPer10Min - fresh.sentLast10Min, fresh.maxPerDay - fresh.sentLastDay);
  const notice = offTopicNotice(msg.body, slotsLeft, fresh.sentLast10Min);
  if (notice === null) return;
  const won = await deps.repo.saveConversation(msg.from, stored.version, user);
  if (!won) {
    deps.logger.log("info", "off_topic_notice_skipped", { from: maskPhone(msg.from), state: user.state });
    return;
  }
  const line = await speak(deps, user.state, slotsLeft === 1 ? "off_topic_last" : "off_topic", msg.body, notice, care);
  const reply = withStepPrompt(line, null, await stepPrompt(user.state, msg.from, deps, content));
  deps.logger.log("info", "off_topic_notice", { from: maskPhone(msg.from), state: user.state });
  // Figurinha de resenha antes do aviso (as opções numeradas da etapa vão por último). Não gasta a vaga da despedida.
  if (stickersOn && slotsLeft >= 3) await sendSticker("resenha", msg.from, deps);
  const r = await deps.send({ to: msg.from, ...careOut(reply) });
  if (r.status !== "sent") deps.logger.log("info", "reply_not_sent", { from: maskPhone(msg.from), status: r.status });
}
