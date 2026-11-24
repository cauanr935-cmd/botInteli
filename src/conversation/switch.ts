// Troca de assunto no meio do registro de mentoria: a pessoa estava mandando o áudio/descrevendo a mentoria e diz que
// quer TIRAR UMA DÚVIDA. O bot não presume: pergunta "você vai registrar a mentoria agora?". Sim = segue de onde parou;
// Não = deixa o registro de lado (apaga o rascunho e o áudio incompleto) e começa a dúvida do zero.
import { buildButtons } from "../whatsapp/builders";
import type { IncomingMessage } from "../whatsapp/types";
import type { Reply } from "./texts";
import { normalizeText } from "./normalize";
import { intentsOf } from "./synonyms";

export const SWITCH_STATE = "SWITCH_DOUBT" as const;
export const SW_KEEP_ID = "sw_keep";
export const SW_DOUBT_ID = "sw_doubt";

/** Etapas do registro de mentoria (enviar o áudio e descrevê-la). Daqui a pessoa pode "trocar de assunto". */
const FLOW = /^(AWAIT_AUDIO|MENT_ROLE|MENT_SUBJECT|MENT_DATE|MENT_DATE_TEXT|MENT_PARTNER|MENT_EARLY_CONFIRM)$/;
export const inMentoriaFlow = (state: string): boolean => FLOW.test(state);

/** "quero tirar uma dúvida", "tenho uma dúvida", "preciso de ajuda com uma dúvida"... Pedido explícito, curto (não é o assunto da mentoria). */
export function wantsDoubt(raw: string): boolean {
  const t = normalizeText(raw);
  if (t.split(" ").length > 12) return false;
  return /\b(tirar|fazer|mandar|enviar|registrar|ter|tenho|com) (uma |minha |a )?(duvida|pergunta)\b/.test(t) ||
    /\b(quero|queria|preciso|gostaria|vou|posso|to|estou) (de |com )?(uma |minha )?(duvida|pergunta)\b/.test(t);
}

/**
 * "quero marcar uma nova mentoria", "preciso de um mentor", "agendar mentoria": pedido de UMA NOVA mentoria (receber ajuda).
 * Não é "registrar" uma mentoria que já aconteceu (áudio) nem oferecer-se para ser mentor.
 */
export function wantsNewMentoring(raw: string): boolean {
  const t = normalizeText(raw);
  if (t.split(" ").length > 14) return false;
  if (/\b(registrar|registro|anexar|enviar|mandar|gravar|audio|dar mentoria|ser mentor|oferec\w+|mentorar|fiz|tive|terminei)\b/.test(t)) return false;
  return /\b(marcar|agendar|pedir|solicitar|abrir|iniciar|criar|combinar|reservar)\b.*\b(mentoria|mentor)\b/.test(t) ||
    /\b(quero|queria|preciso de|precisava de|gostaria de|busco|procuro)\b.*\b(mentoria|um mentor|uma mentora)\b/.test(t);
}

/** Pedido que troca o assunto no meio do registro de mentoria (dúvida ou nova mentoria). */
export const wantsSwitch = (raw: string): boolean => wantsDoubt(raw) || wantsNewMentoring(raw);

/** Etapas em que "marcar nova mentoria" abre direto o pedido (a pessoa já é cadastrada e não está no meio de outra coisa). */
export const canOpenNewMentoring = (state: string): boolean => /^(MENU|COMPLETED|RETURNING_CHOICE|DOUBT_ASK)$/.test(state);

export function switchQuestion(): Reply {
  return buildButtons("Você vai registrar a mentoria agora?", [
    { id: SW_KEEP_ID, title: "Sim" }, { id: SW_DOUBT_ID, title: "Não" },
  ]);
}

/** Resposta à pergunta: sim (segue a mentoria), não (vai para a dúvida) ou nenhuma das duas (null). */
export function readSwitchAnswer(msg: IncomingMessage): "keep" | "doubt" | null {
  if (msg.type === "button_reply" || msg.type === "list_reply") return msg.id === SW_KEEP_ID ? "keep" : msg.id === SW_DOUBT_ID ? "doubt" : null;
  if (msg.type !== "text") return null;
  const t = normalizeText(msg.body);
  const it = intentsOf(msg.body);
  if (it.has("no") || /\b(duvida|pergunta)\b/.test(t)) return "doubt";
  if (it.has("yes") || /\b(registrar|continuar|seguir|mentoria|audio)\b/.test(t)) return "keep";
  return null;
}
