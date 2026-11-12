// Guardrails pós-LLM (spec "Guardrails e integridade"): quase tudo é código, não uma segunda chamada de LLM.
// O LLM só escreve marcadores ({opcao_1}); o código preenche com dados do banco.
import { normalizeText } from "../conversation/normalize";

export const PLACEHOLDERS = ["opcao_1", "opcao_2", "opcao_3", "mentor", "horario", "local"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

const PLACEHOLDER_RE = /\{([a-z_0-9]+)\}/g;

/** Formas de Portugal que nunca podem aparecer (spec: "O estudo está em português de Portugal: trocar"). */
export const PT_PT_FORBIDDEN: readonly RegExp[] = [
  /\bcaloiro\w*/i, /\bqueres\b/i, /\bestás\b/i, /\bfazes\b/i, /\bcontigo\b/i, /\becrã\w*/i, /\bequipa\w*/i,
  /\bregisto\w*/i, /\bestou a \w+/i, /\bestamos a \w+/i, /\bestás a \w+/i,
];
export const findPtPtForms = (text: string): string[] => PT_PT_FORBIDDEN.flatMap((re) => text.match(re) ?? []);

// Horário (14h, 14:30, 18h30) e sala (sala 3, lab 12, ateliê 2): nunca fora dos marcadores.
const TIME_RE = /\b(?:[01]?\d|2[0-3])\s*(?:h(?:\s*[0-5]\d)?\b|:[0-5]\d)/i;
const ROOM_RE = /\b(?:sala|lab(?:oratório)?|ateli[eê]|andar|bloco)\s*[a-z]?\d+\b/i;

export interface GuardContext {
  /** Nomes (e primeiros nomes) de usuários cadastrados, exceto o próprio aluno. */
  otherUserNames: readonly string[];
}

export type GuardIssue = "marcador_desconhecido" | "nome_de_usuario" | "horario" | "sala" | "portugues_de_portugal" | "vazia";

/** Confere a fala do LLM. Qualquer problema → descartar e usar fala pronta. */
export function checkSpeech(speech: string, ctx: GuardContext): GuardIssue[] {
  const issues = new Set<GuardIssue>();
  if (!speech.trim()) issues.add("vazia");
  const known = new Set<string>(PLACEHOLDERS);
  for (const m of speech.matchAll(PLACEHOLDER_RE)) if (!known.has(m[1]!)) issues.add("marcador_desconhecido");
  const outside = speech.replace(PLACEHOLDER_RE, " ");
  if (TIME_RE.test(outside)) issues.add("horario");
  if (ROOM_RE.test(outside)) issues.add("sala");
  const padded = ` ${normalizeText(outside)} `;
  for (const name of ctx.otherUserNames) {
    // Nome completo ou qualquer parte dele (primeiro nome, sobrenome).
    const parts = [normalizeText(name), ...normalizeText(name).split(" ")];
    if (parts.some((n) => n.length >= 3 && padded.includes(` ${n} `))) issues.add("nome_de_usuario");
  }
  if (findPtPtForms(outside).length) issues.add("portugues_de_portugal");
  return [...issues];
}

/** Preenche os marcadores com dados do banco. Marcador sem valor → null (o chamador usa fala pronta). */
export function fillPlaceholders(speech: string, values: Partial<Record<Placeholder, string>>): string | null {
  let missing = false;
  const out = speech.replace(PLACEHOLDER_RE, (_all, key: string) => {
    const v = values[key as Placeholder];
    if (v === undefined) { missing = true; return ""; }
    return v;
  });
  return missing ? null : out;
}

export interface LlmTurn {
  fala: string;
  dados: Record<string, unknown>;
  intencao: string;
  sinal_sensivel: boolean;
}

/** Valida o JSON do modelo. Texto livre ao redor do JSON é tolerado (bloco ```json). `null` = inválido → próximo provedor. */
export function parseLlmTurn(raw: string): LlmTurn | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.fala !== "string" || typeof o.intencao !== "string" || typeof o.sinal_sensivel !== "boolean") return null;
  const dados = typeof o.dados === "object" && o.dados !== null && !Array.isArray(o.dados) ? (o.dados as Record<string, unknown>) : {};
  return { fala: o.fala, dados, intencao: o.intencao, sinal_sensivel: o.sinal_sensivel };
}

/** Só o primeiro nome vai ao provedor; e-mail e telefone nunca. */
export const firstNameOnly = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/** O texto do aluno vai delimitado no prompt, para reduzir injeção; o delimitador é removido do próprio texto. */
export function wrapStudentText(text: string): string {
  return `<<<ALUNO\n${text.replace(/<<<|>>>/g, "").slice(0, 1_000)}\n>>>`;
}

/** Dados extraídos só entram no banco depois de validar contra uma taxonomia fechada (o LLM propõe, o código grava). */
export function validateAgainst<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
