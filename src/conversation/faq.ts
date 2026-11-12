// Perguntas sobre o programa, os termos ou o motivo de cada pergunta do bot, feitas EM QUALQUER etapa da conversa
// (inclusive no consentimento, antes de aceitar). Ordem de resposta (1 mensagem, R2):
//   1. "por que você pergunta isso?" -> texto fixo do motivo da etapa (sem IA);
//   2. antes do aceite (LGPD/R6): resposta montada SÓ com trechos dos Termos e da Política (busca local, nada sai para fora);
//   3. depois do aceite: a IA (Grok) responde usando como base (RAG) os trechos mais parecidos dos Termos/Política + a base do programa;
//      se a IA falhar, vale a resposta local.
// A resposta traz de volta a pergunta da etapa (os botões/lista continuam à vista) e, se o assunto for os termos, o link.
// Dúvida de conteúdo (ex.: "como funciona um rotacional?") NUNCA é respondida; assunto sem relação = silêncio.
import { intentsOf } from "./synonyms";
import { normalizeText } from "./normalize";
import type { IntentAgent } from "../ai/agent";
import type { Content } from "../services/content";
import type { Reply } from "./texts";
import { buildButtons, LIMITS } from "../whatsapp/builders";
import { CONSENT_BUTTON_ID, REG_TEXTS } from "../registration/texts";
import { parseCategories } from "../profile/categories";
import { parseScheduleText } from "../schedule/parse";
import { metaAnswer, metaKind } from "../axo/meta";
import { legalAnswer } from "../rag/legal-faq";
import { buildCorpus, isLegalTopic, isWhyQuestion, MIN_SCORE, retrieve, whyWeAsk, type Chunk, type Hit } from "../rag/corpus";

/** Etapas em que a pergunta pode ser respondida. Fora daqui o texto livre é a resposta esperada (dúvida, assunto, curiosidades...). */
const QA_STATE = /^(NEW|AWAIT_REGISTRATION|REG_CONSENT|REG_NAME_CONFIRM|REG_FIELD_.+|PROFILE_ROLE|MENTOR_CATEGORIES(_BOTH)?|DOUBT_ASK|SCHED_(DAYS|HOURS)_.+|RETURNING_CHOICE|COMPLETED|MENU|AWAIT_AUDIO)$/;
/** Etapas antes do aceite: a mensagem da pessoa NÃO vai para a IA (promessa dos Termos: a IA só vê o texto depois do aceite). */
export const PRE_CONSENT = /^(NEW|AWAIT_REGISTRATION|REG_CONSENT)$/;

const QUESTION_START = /^(me explica|explica|me fala|fale|queria entender|quero entender|quero saber|gostaria de saber|como|qual|quais|quando|onde|aonde|por ?que|porque|pra que|para que|o que|oque|quem|quanto|quantos|posso|pode|podem|tem como|da pra|existe|existem|vou|vai|preciso|precisa|serve|sera)\b|\b(lgpd|privacidade)\b/;
export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return t.includes("?") || QUESTION_START.test(normalizeText(t));
}

/** A mensagem é uma pergunta que cabe responder agora? (comandos e respostas que o bot já entende ficam de fora) */
export function shouldAnswer(text: string, state: string): boolean {
  // Descrevendo a dúvida: o texto livre é a dúvida, MAS pergunta sobre o bot/anexo/plataforma não é dúvida acadêmica.
  const metaInDoubt = state === "DOUBT_TEXT" && metaKind(text) !== null;
  if (!QA_STATE.test(state) && !metaInDoubt && !(state === "REG_PROFILE_AUDIO" && isWhyQuestion(text))) return false;
  if (!metaInDoubt && !isQuestion(text)) return false;
  if (intentsOf(text).size > 0) return false;
  if (state.startsWith("SCHED_")) { const p = parseScheduleText(text); if (p.slots.length > 0 || p.loose.length > 0) return false; }
  if (state.startsWith("MENTOR_CATEGORIES") && parseCategories(text).length > 0) return false;
  return true;
}

export interface FaqPlan {
  /** Texto da resposta (sem a pergunta da etapa). */
  answer: string;
  /** Mostrar o link dos Termos e da Política junto. */
  withLink: boolean;
}

let corpusCache: Chunk[] | undefined;
const corpus = (): Chunk[] => (corpusCache ??= buildCorpus());

const cut = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("\n"), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return end > max * 0.5 ? head.slice(0, end + 1).trim() : `${head.slice(0, max - 1).trimEnd()}…`;
};
const clean = (s: string): string => s.replace(/\s*—\s*/g, " — ").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

/** Resposta montada só com os trechos (sem IA). `null` = a base não tem resposta boa. */
function localAnswer(hits: readonly Hit[]): string | null {
  const good = hits.filter((h) => h.score >= MIN_SCORE);
  const top = good[0];
  if (!top) return null;
  const parts = [clean(top.chunk.text)];
  const second = good[1];
  if (second && second.score >= top.score * 0.6 && second.chunk.title !== top.chunk.title) parts.push(clean(second.chunk.text));
  return cut(parts.join("\n\n"), 560);
}

export async function planAnswer(
  text: string, state: string, deps: { agent?: IntentAgent | undefined; recent?: readonly string[] | undefined },
): Promise<FaqPlan | "silent" | null> {
  const q = text.replace(/\s+/g, " ").trim().slice(0, 500);
  // LGPD, uso dos dados e privacidade: resposta pronta, em qualquer etapa e ANTES do aceite (a pessoa precisa de base para decidir).
  // Sem IA e sem enviar o texto dela para fora; vem dos Termos e da Política, e o link vai junto.
  const meta = metaAnswer(q);
  if (meta) return { answer: meta, withLink: false };
  const legal = legalAnswer(q);
  if (legal) return { answer: legal.answer, withLink: true };

  const why = whyWeAsk(state);
  if (isWhyQuestion(q) && why) return { answer: why, withLink: PRE_CONSENT.test(state) };

  const hits = retrieve(q, corpus(), 3);
  const legalHit = isLegalTopic(q, hits);

  if (PRE_CONSENT.test(state) || !deps.agent?.answerFaq) {
    const a = localAnswer(hits);
    return a ? { answer: a, withLink: legalHit } : (why && /\b(voce|vc|bot)\b/.test(normalizeText(q)) ? { answer: why, withLink: false } : null);
  }

  // Depois do aceite: a IA responde com os trechos como base. Só o texto da pergunta vai para ela.
  const excerpts = hits.filter((h) => h.score >= MIN_SCORE * 0.6).map((h) => `${h.chunk.title}: ${clean(h.chunk.text)}`);
  const r = await deps.agent.answerFaq(q, deps.recent, { excerpts, step: why ?? undefined }).catch(() => null);
  if (r?.kind === "answer") return { answer: r.text, withLink: legalHit };
  if (r?.kind === "off_topic") return "silent";
  if (r?.kind === "mentor_doubt") return null; // dúvida de conteúdo: é de um mentor; o bot segue o fluxo normal da etapa
  const a = localAnswer(hits); // IA indisponível: a base local ainda responde sobre os termos
  return a ? { answer: a, withLink: legalHit } : null;
}

export const LINK_LABEL = "Termos de Uso e Política de Privacidade:";

/** Versão curta do pedido de consentimento (cabe depois de uma resposta). */
export function consentShortReply(answer: string, url: string, c: Content): Reply {
  const tail = `Para continuar o cadastro, precisamos do seu consentimento (LGPD). ${LINK_LABEL} ${url}\n\n${c.text("consentAfterLink", REG_TEXTS.consentAfterLink)}`;
  return buildButtons(`${cut(answer, LIMITS.body - tail.length - 2)}\n\n${tail}`, [{ id: CONSENT_BUTTON_ID, title: c.text("consentButton", REG_TEXTS.consentButton, 20) }]);
}

type Interactive = { type: "interactive"; interactive: { body: { text: string } } & Record<string, unknown> };

/** Junta a resposta à pergunta da etapa em UMA mensagem (corpo <= 1024). Sem pergunta da etapa, só a resposta. */
export function withStepPrompt(answer: string, link: string | null, prompt: Reply | undefined): Reply {
  const linkLine = link ? `\n\n${LINK_LABEL} ${link}` : "";
  const alone = (): Reply => ({ type: "text", text: { body: cut(answer, LIMITS.body - linkLine.length) + linkLine } });
  if (!prompt) return alone();
  const body = prompt.type === "text" ? prompt.text.body : prompt.type === "interactive" && (prompt as unknown as Interactive).interactive.body ? (prompt as unknown as Interactive).interactive.body.text : null;
  if (body === null || (prompt.type === "interactive" && !["button", "list"].includes(String((prompt as unknown as { interactive: { type?: string } }).interactive.type)))) return alone();
  const room = LIMITS.body - body.length - linkLine.length - 2;
  if (room < 200) return alone(); // a pergunta da etapa já está à vista na conversa
  const joined = `${cut(answer, room)}${linkLine}\n\n${body}`;
  if (prompt.type === "text") return { type: "text", text: { body: joined } };
  const p = prompt as unknown as Interactive;
  return { ...p, interactive: { ...p.interactive, body: { text: joined } } } as unknown as Reply;
}
