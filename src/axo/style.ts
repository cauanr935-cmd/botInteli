// Analisador de estilo determinístico (spec "Motor de adaptação ao falante"). Puro: zero tokens, sem I/O.
// 3 registros, 3 níveis de urgência, 3 de energia. As listas podem vir do KV; aqui ficam os padrões.
import { normalizeText } from "../conversation/normalize";

export type Register = "casual" | "neutro" | "direto";
export type Level3 = "baixa" | "media" | "alta";

export interface StyleLists {
  slang: readonly string[];
  technical: readonly string[];
  urgency: readonly string[];
  negativeAffect: readonly string[];
  explicitRequest: readonly string[];
}

export const DEFAULT_STYLE_LISTS: StyleLists = {
  slang: ["vc", "tb", "pq", "mto", "mds", "sla", "mano", "cara", "tlgd", "slk", "pprt", "n", "q"],
  technical: ["mvc", "api", "endpoint", "query", "deploy", "arquitetura", "banco de dados"],
  urgency: ["hoje", "amanha", "agora", "socorro", "urgente", "prazo", "entrega"],
  negativeAffect: ["travado", "travada", "perdido", "perdida", "cansado", "cansada", "desesperado", "desesperada", "nao aguento"],
  explicitRequest: ["quero agendar", "preciso de mentor", "tenho horario", "preciso agendar", "quero um mentor"],
};

export interface MessageSignals {
  words: number;
  lowerRatio: number;
  noInitialCapital: boolean;
  slangUsed: string[];
  laugh: boolean;
  emojiCount: number;
  technical: boolean;
  urgency: Level3;
  negativeAffect: boolean;
  explicitRequest: boolean;
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const LAUGH_RE = /\b(?:k{3,}|(?:ha){2,}h?|(?:he){2,}|rs+)\b/i;
const REPEATED_LETTERS_RE = /([a-zà-ú])\1{2,}/i;

function hasPhrase(normalized: string, phrases: readonly string[]): boolean {
  const padded = ` ${normalized} `;
  return phrases.some((p) => padded.includes(` ${normalizeText(p)} `));
}

/** Mede os sinais de UMA mensagem. */
export function measureSignals(text: string, lists: StyleLists = DEFAULT_STYLE_LISTS): MessageSignals {
  const raw = text.trim();
  const norm = normalizeText(raw);
  const tokens = norm.split(" ").filter(Boolean);
  const letters = raw.match(/\p{L}/gu) ?? [];
  const lower = letters.filter((c) => c === c.toLowerCase()).length;
  const firstLetter = letters[0];
  const slangSet = new Set(lists.slang.map((s) => normalizeText(s)));
  const slangUsed = [...new Set(tokens.filter((t) => slangSet.has(t)))];
  const urgentHits = lists.urgency.filter((u) => hasPhrase(norm, [u])).length;
  const stretched = REPEATED_LETTERS_RE.test(raw) && hasPhrase(norm, lists.urgency);
  const urgency: Level3 = stretched || urgentHits >= 2 ? "alta" : urgentHits === 1 ? "media" : "baixa";
  return {
    words: tokens.length,
    lowerRatio: letters.length ? lower / letters.length : 0,
    noInitialCapital: firstLetter !== undefined && firstLetter === firstLetter.toLowerCase(),
    slangUsed,
    laugh: LAUGH_RE.test(raw),
    emojiCount: (raw.match(EMOJI_RE) ?? []).length,
    technical: hasPhrase(norm, lists.technical),
    urgency,
    negativeAffect: hasPhrase(norm, lists.negativeAffect),
    explicitRequest: hasPhrase(norm, lists.explicitRequest),
  };
}

/** Pontuação simples por sinal; empate vai para neutro. Positivo = casual, negativo = direto. */
export function registerScore(s: MessageSignals): number {
  let score = 0;
  if (s.lowerRatio >= 0.95 && s.words > 0) score += 1;
  if (s.noInitialCapital) score += 1;
  if (s.slangUsed.length > 0) score += 1;
  if (s.laugh) score += 1;
  if (s.technical) score -= 1;
  if (s.explicitRequest) score -= 1;
  if (s.words >= 14 && s.lowerRatio < 0.9) score -= 1;
  return score;
}

export const scoreToRegister = (score: number): Register => (score >= 2 ? "casual" : score <= -1 ? "direto" : "neutro");

const valueToRegister = (v: number): Register => (v >= 0.3 ? "casual" : v <= -0.3 ? "direto" : "neutro");

/** Estado de estilo da sessão (guardado em `conversas.estilo_sessao`). */
export interface SessionStyle {
  /** -1 (direto) .. 1 (casual), média móvel. */
  registerValue: number;
  /** 0..1 */
  energy: number;
  slang: string[];
  emojiUsed: boolean;
  avgWords: number;
  turns: number;
}
export const EMPTY_SESSION_STYLE: SessionStyle = { registerValue: 0, energy: 0.5, slang: [], emojiUsed: false, avgWords: 8, turns: 0 };

export const SESSION_WEIGHT = 0.4;
export const BASE_PROFILE_WEIGHT = 0.1;

function msgRegisterValue(s: MessageSignals): number {
  // Graduado (não só -1/0/1): uma mensagem muito casual pesa mais que uma levemente casual.
  return Math.max(-1, Math.min(1, registerScore(s) / 2));
}
function msgEnergy(s: MessageSignals): number {
  return Math.min(1, (s.laugh ? 0.4 : 0) + (s.emojiCount > 0 ? 0.2 : 0) + (s.urgency === "alta" ? 0.3 : 0) + 0.3);
}

/** Suavização: média móvel (peso 0,4 para a mensagem nova). A primeira mensagem não é suavizada. */
export function updateSessionStyle(prev: SessionStyle, s: MessageSignals, weight = SESSION_WEIGHT): SessionStyle {
  const w = prev.turns === 0 ? 1 : weight;
  const blend = (old: number, now: number): number => old * (1 - w) + now * w;
  return {
    registerValue: blend(prev.registerValue, msgRegisterValue(s)),
    energy: blend(prev.energy, msgEnergy(s)),
    slang: [...new Set([...prev.slang, ...s.slangUsed])].slice(-8),
    emojiUsed: prev.emojiUsed || s.emojiCount > 0,
    avgWords: blend(prev.avgWords, s.words),
    turns: prev.turns + 1,
  };
}

/** Entre sessões, o perfil base do aluno se move devagar (peso 0,1). */
export function updateBaseProfile(base: number, sessionValue: number): number {
  return base * (1 - BASE_PROFILE_WEIGHT) + sessionValue * BASE_PROFILE_WEIGHT;
}

export type Phase = "abertura" | "diagnostico" | "fechamento";

export interface StyleContext {
  /** Falha do sistema (encontro cancelado, sem mentor) ou aluno frustrado com o Axo: divergência, registro neutro. */
  failure?: boolean;
  careMode?: boolean;
  phase?: Phase;
}

export interface StyleDecision {
  register: Register;
  lowercase: boolean;
  emojiMax: 0 | 1;
  maxSentences: number;
  urgency: Level3;
  energy: Level3;
  welcomeFirst: boolean;
  goStraight: boolean;
  allowedSlang: string[];
  phase: Phase;
}

const level3 = (v: number): Level3 => (v >= 0.67 ? "alta" : v <= 0.33 ? "baixa" : "media");

/** Do sinal ao estilo: junta sessão + mensagem atual + contexto. */
export function decideStyle(session: SessionStyle, current: MessageSignals, ctx: StyleContext = {}): StyleDecision {
  const phase = ctx.phase ?? "diagnostico";
  const neutralize = ctx.failure === true || ctx.careMode === true;
  const register: Register = neutralize ? "neutro" : valueToRegister(session.registerValue);
  // Tamanho: no máximo 1,5x o do aluno, teto de 4 frases; fechamento é curto.
  const bySize = Math.max(1, Math.round((session.avgWords * 1.5) / 8));
  const maxSentences = Math.min(4, phase === "fechamento" ? Math.min(2, bySize) : bySize);
  return {
    register,
    lowercase: register === "casual" && session.registerValue > 0 && !neutralize,
    emojiMax: !neutralize && session.emojiUsed ? 1 : 0,
    maxSentences,
    urgency: current.urgency,
    energy: neutralize ? "baixa" : level3(session.energy),
    welcomeFirst: current.negativeAffect,
    goStraight: current.explicitRequest || current.urgency === "alta",
    // Espelhamento: só gírias que o próprio aluno usou nesta conversa.
    allowedSlang: neutralize ? [] : session.slang,
    phase,
  };
}

/** A linha única que vai ao modelo (spec: "O que vai para o modelo"). */
export function buildStyleLine(d: StyleDecision): string {
  const parts = [
    d.register,
    `minúsculas: ${d.lowercase ? "sim" : "não"}`,
    `emoji: ${d.emojiMax === 1 ? "até 1" : "nenhum"}`,
    `frases: até ${d.maxSentences}`,
  ];
  if (d.urgency === "alta") parts.push("urgência: alta → acolha em 1 frase e vá para a ação");
  else if (d.welcomeFirst) parts.push("acolha primeiro, depois ajude");
  else if (d.goStraight) parts.push("vá direto ao ponto");
  if (d.allowedSlang.length) parts.push(`gírias permitidas: ${d.allowedSlang.join(", ")}`);
  parts.push("uma pergunta por mensagem");
  return `ESTILO: ${parts.join(" | ")}`;
}

/** Variante de fala pronta (as 3 variantes escritas à mão) conforme o registro. */
export function pickVariant<T>(variants: Record<Register, T>, d: Pick<StyleDecision, "register">): T {
  return variants[d.register];
}

// --- Expressão do Axo (7 do brand book) ---
export type Expression = "feliz" | "triste" | "com_raiva" | "entediado" | "chateado" | "ansioso" | "empolgado";

export type ExpressionSituation =
  | "encontro_confirmado" | "duvida_resolvida" | "encontro_cancelado" | "aluno_foi_mal" | "erro_bobo_sistema"
  | "papo_livre" | "travado_de_novo" | "urgencia_alta" | "vespera" | "match_novo" | "tema_sensivel" | "neutro";

const EXPRESSION_BY_SITUATION: Record<ExpressionSituation, Expression | null> = {
  encontro_confirmado: "feliz", duvida_resolvida: "feliz",
  encontro_cancelado: "triste", aluno_foi_mal: "triste",
  erro_bobo_sistema: "com_raiva",
  papo_livre: "entediado",
  travado_de_novo: "chateado",
  urgencia_alta: "ansioso", vespera: "ansioso",
  match_novo: "empolgado",
  tema_sensivel: null,
  neutro: "feliz",
};

/** `null` = sem mascote animado (só texto). Falha grave ou modo cuidado nunca usam "com raiva" nem expressão alegre. */
export function chooseExpression(situation: ExpressionSituation, opts: { careMode?: boolean; graveFailure?: boolean } = {}): Expression | null {
  if (opts.careMode || situation === "tema_sensivel") return null;
  if (situation === "erro_bobo_sistema" && opts.graveFailure) return "triste";
  return EXPRESSION_BY_SITUATION[situation];
}
