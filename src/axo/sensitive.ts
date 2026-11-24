// Detector de temas sensíveis (spec "Protocolo de temas sensíveis"). Puro e sem I/O.
// Primeira rede: roda ANTES de tudo; se bater, o texto não vai a nenhum LLM nem é gravado.
// Segunda rede: o LLM marca `sinal_sensivel: true` e o código troca a fala pela mensagem fixa.
// ATENÇÃO: as listas abaixo são um PONTO DE PARTIDA e precisam de revisão de um profissional (psicólogo/CDL) antes de produção.
import { normalizeText } from "../conversation/normalize";

export type SensitiveLevel = "A" | "B";

/** Nível A: risco à vida. Nível B: sofrimento. Frases já em forma "humana"; passam por normalizeText ao compilar. */
export const DEFAULT_SENSITIVE_LISTS: Record<SensitiveLevel, readonly string[]> = {
  A: [
    "suicidio", "suicidar", "me matar", "quero morrer", "vou morrer", "queria morrer", "quero sumir pra sempre", "sumir pra sempre", "queria sumir",
    "acabar com minha vida", "acabar com a minha vida", "tirar minha vida", "tirar a minha vida", "nao quero mais viver",
    "nao quero viver", "melhor sem mim", "mundo melhor sem mim", "me machucar", "me cortar", "me enforcar",
    "tomar todos os remedios", "pular da janela", "pular do predio", "se eu morresse", "se eu sumisse",
  ],
  B: [
    "depressao", "deprimido", "deprimida", "crise de panico", "ataque de panico", "sem saida", "nao tem saida",
    "nao vejo saida", "nao vejo sentido", "vida sem sentido", "nao consigo sair da cama", "nao consigo mais",
    "vazio por dentro", "me sinto vazio", "me sinto vazia", "ninguem se importa", "sozinho demais", "sozinha demais",
    "automutilacao", "ansiedade insuportavel", "nao aguento mais viver",
  ],
};

/** Abreviações comuns expandidas antes de conferir (a lista já está normalizada). */
const ABBREVIATIONS: Record<string, string> = {
  vc: "voce", pq: "porque", mt: "muito", mto: "muito", n: "nao", nn: "nao", td: "tudo", tb: "tambem", tbm: "tambem",
  q: "que", pra: "para", p: "para", sla: "sei la", mds: "meu deus", dps: "depois", vlw: "valeu", msm: "mesmo",
};

/** Normaliza para a comparação: minúsculas, sem acento/pontuação, letras repetidas reduzidas, abreviações expandidas. */
export function normalizeForSensitive(text: string): string {
  const base = normalizeText(text);
  return base.split(" ").map((w) => ABBREVIATIONS[w] ?? w).join(" ");
}

export interface SensitiveMatcher {
  /** Devolve o nível mais grave encontrado, ou null. */
  detect(text: string): SensitiveLevel | null;
}

/** Monta o detector. A lista pode vir do KV; sem ela vale a lista padrão. A comparação é por palavra inteira (sem "pega" em meio de palavra). */
export function createSensitiveMatcher(lists: Record<SensitiveLevel, readonly string[]> = DEFAULT_SENSITIVE_LISTS): SensitiveMatcher {
  // Mesma função de normalização dos dois lados: letras duplas colapsam igualmente na lista e na mensagem.
  const compile = (phrases: readonly string[]): string[] => phrases.map((p) => normalizeForSensitive(p)).filter((p) => p.length > 0);
  const a = compile(lists.A);
  const b = compile(lists.B);
  const has = (haystack: string, needles: readonly string[]): boolean => {
    const padded = ` ${haystack} `;
    return needles.some((n) => padded.includes(` ${n} `) || (!n.includes(" ") && n.length >= 8 && padded.includes(` ${n}`)));
  };
  return {
    detect(text: string): SensitiveLevel | null {
      const t = normalizeForSensitive(text);
      if (!t) return null;
      if (has(t, a)) return "A";
      if (has(t, b)) return "B";
      return null;
    },
  };
}

export const defaultSensitiveMatcher: SensitiveMatcher = createSensitiveMatcher();

/** Mensagens fixas: ficam no código-fonte, sob revisão (nunca no KV). Texto da spec. */
export const SENSITIVE_MESSAGES: Record<SensitiveLevel, string> = {
  A: "Ei, o que você escreveu é sério, e eu quero que você converse com uma pessoa agora. Eu sou um bot e não consigo te ajudar com isso do jeito que você merece. Liga *188*, do CVV (Centro de Valorização da Vida): é de graça, 24 horas, de qualquer lugar do Brasil. Se preferir escrever, tem chat em cvv.org.br. Se você estiver em perigo agora, liga *192* (SAMU).",
  B: "Sinto muito que você esteja passando por isso. Isso merece conversa com gente de verdade, não com um bot. O CVV (Centro de Valorização da Vida) atende de graça, 24 horas: liga *188* ou escreve em cvv.org.br.",
};

/** Rodapé do modo cuidado em respostas acadêmicas. */
export const CARE_FOOTER = "CVV: 188, 24h";
/** Duração do modo cuidado: 1 hora depois do tema sensível; passou disso, o rodapé do CVV e o tom neutro deixam de aparecer. */
export const CARE_MODE_MS = 60 * 60 * 1000;

/** Único registro permitido do evento: nível, data e canal. Nunca o texto. */
export interface SensitiveEvent {
  level: SensitiveLevel;
  channel: string;
  at: Date;
}

export type SensitiveDecision =
  | { sensitive: false }
  | { sensitive: true; level: SensitiveLevel; reply: string; careModeUntil: Date; event: SensitiveEvent; source: "list" | "llm" };

export function decideSensitive(
  text: string, channel: string, now: Date, matcher: SensitiveMatcher = defaultSensitiveMatcher,
): SensitiveDecision {
  const level = matcher.detect(text);
  if (!level) return { sensitive: false };
  return buildDecision(level, channel, now, "list");
}

/** Segunda rede: o LLM marcou `sinal_sensivel`. A fala gerada é descartada; sem nível claro, vale o B (mensagem de apoio). */
export function decideFromLlmSignal(channel: string, now: Date, level: SensitiveLevel = "B"): SensitiveDecision {
  return buildDecision(level, channel, now, "llm");
}

function buildDecision(level: SensitiveLevel, channel: string, now: Date, source: "list" | "llm"): SensitiveDecision {
  return {
    sensitive: true, level, reply: SENSITIVE_MESSAGES[level], source,
    careModeUntil: new Date(now.getTime() + CARE_MODE_MS), event: { level, channel, at: now },
  };
}

export const inCareMode = (careModeUntil: Date | null, now: Date): boolean => careModeUntil !== null && careModeUntil.getTime() > now.getTime();
