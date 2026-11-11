// Serviço "Horários": a pessoa informa, em texto, os dias e horários livres. Decisão PURA (sem I/O).
import { finish, moveTo, type Counters, type Decision, type UserState } from "../conversation/machine";
import { intentsOf, type Intent } from "../conversation/synonyms";
import { REPLIES, type Reply } from "../conversation/texts";
import { fallbackContent, type Content } from "../services/content";
import { findService, MENU_BUTTON_ID, MENU_FALLBACKS, menuReply } from "../services/menu";
import { summarizeSlots, type AvailabilitySlot, type ParsedAvailability } from "../ai/types";
import { buildButtons } from "../whatsapp/builders";
import type { IncomingMessage } from "../whatsapp/types";

export const AVAILABILITY_SERVICE_ID = "horarios";

export type AvailabilityEffect = { kind: "availability"; text: string; slots?: AvailabilitySlot[] };
export type AvailabilityDecision = Decision & { effect?: AvailabilityEffect };

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Plano B (IA fora do ar ou não configurada): aceita qualquer texto com letra ou número, sem comando. */
function looseAvailability(raw: string): string | null {
  const v = clean(raw);
  if (v.length < 3 || v.length > 500 || !/[\p{L}\p{N}]/u.test(v)) return null;
  return intentsOf(v).size > 0 ? null : v;
}

/**
 * `parsed`: leitura da IA para o texto desta mensagem. `undefined`/`null` = IA não consultada ou falhou (plano B:
 * guarda o texto como veio); `{ slots: [] }` = a IA leu e não achou dias/horários (pede de novo, 1 dica).
 */
export function decideAvailability(
  user: UserState, input: IncomingMessage, counters: Counters, now: Date, content: Content = fallbackContent,
  parsed?: ParsedAvailability | null,
): AvailabilityDecision | null {
  const c = content;
  const intents: Set<Intent> = input.type === "text" ? intentsOf(input.body) : new Set<Intent>();
  const silent = (): AvailabilityDecision => ({ replies: [], nextState: user, outcome: "silent" });

  // Entrada: serviço "Horários" escolhido no menu.
  if (user.state === "MENU" && input.type === "list_reply" && findService(c, input.id)?.id === AVAILABILITY_SERVICE_ID) {
    return finish(user, moveTo(user, "AVAILABILITY_TEXT", now), [REPLIES.askAvailability(c)], counters, "reply");
  }

  if (user.state !== "AVAILABILITY_TEXT") return null;
  if (input.type === "text" && intents.has("quit")) return null; // opt-out é da máquina principal

  // Cancelar: "menu" (texto ou botão) volta ao menu.
  if ((input.type === "text" && intents.has("menu")) || (input.type === "button_reply" && input.id === MENU_BUTTON_ID)) {
    return finish(user, moveTo(user, "MENU", now), [menuReply(c)], counters, "transition");
  }
  if (input.type !== "text") return silent();

  const hint = (): AvailabilityDecision => {
    if (user.hintSentInState) return silent();
    return finish(user, { ...user, hintSentInState: true }, [REPLIES.hintAvailability(c)], counters, "hint");
  };
  const raw = clean(input.body).slice(0, 500);
  let slots: AvailabilitySlot[] | undefined;
  if (parsed) {
    if (parsed.slots.length === 0) return hint(); // a IA entendeu a mensagem e não há dias/horários nela
    slots = parsed.slots;
  } else if (looseAvailability(input.body) === null) {
    return hint();
  }
  const base = c.text("availabilitySaved", "Horários registrados! Para voltar ao início, toque em Menu.");
  const body = slots
    ? `Anotei seus horários livres:\n${summarizeSlots(slots)}\n\nSe algo estiver errado, escolha Horários de novo e envie outra vez. Para voltar ao início, toque em Menu.`
    : base;
  const saved: Reply = buildButtons(body.slice(0, 1024), [
    { id: MENU_BUTTON_ID, title: c.text("menuButtonLabel", MENU_FALLBACKS.menuButtonLabel, 20) },
  ]);
  const d = finish(user, moveTo(user, "MENU", now), [saved], counters, "reply");
  return d.outcome === "limited" ? d : { ...d, effect: { kind: "availability", text: raw, ...(slots ? { slots } : {}) } };
}
