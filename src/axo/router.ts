// Roteador de provedores de LLM e regras de orçamento (spec "Orçamento de custo zero"). Puro: o contador diário
// (tabela `uso_provedor` no banco) entra como dado; a decisão não faz I/O. Só provedores que não treinam com os dados.

export type ProviderId = "workers-ai" | "groq-gpt-oss-20b" | "groq-llama-8b";

export interface ProviderLimits {
  /** Chamadas por dia (null = sem limite próprio). */
  requestsPerDay: number | null;
  tokensPerDay: number | null;
  tokensPerMinute: number | null;
  requestsPerMinute: number | null;
  neuronsPerDay: number | null;
  /** Capacidade estimada em turnos por dia (peso no cálculo da cota total). */
  turnCapacity: number;
}

/** Ordem de preferência = ordem deste objeto. Gemini gratuito e modelos `:free` do OpenRouter ficam de fora (podem treinar). */
export const PROVIDERS: Record<ProviderId, ProviderLimits> = {
  "workers-ai": { requestsPerDay: null, tokensPerDay: null, tokensPerMinute: null, requestsPerMinute: null, neuronsPerDay: 10_000, turnCapacity: 280 },
  "groq-gpt-oss-20b": { requestsPerDay: 14_400, tokensPerDay: 500_000, tokensPerMinute: 6_000, requestsPerMinute: 30, neuronsPerDay: null, turnCapacity: 357 },
  "groq-llama-8b": { requestsPerDay: 14_400, tokensPerDay: 500_000, tokensPerMinute: 6_000, requestsPerMinute: 30, neuronsPerDay: null, turnCapacity: 357 },
};
export const PROVIDER_ORDER: readonly ProviderId[] = ["workers-ai", "groq-gpt-oss-20b", "groq-llama-8b"];

/** Estimativa por turno, usada para decidir ANTES de chamar (evita gastar uma requisição com erro 429). */
export const TURN_ESTIMATE = { tokensIn: 1_250, tokensOut: 150, neurons: 34 } as const;

export const ECONOMY_THRESHOLD = 0.85;
export const MAX_LLM_TURNS_PER_STUDENT_PER_DAY = 15;
export const MAX_MSGS_PER_STUDENT_PER_MINUTE = 10;

export interface ProviderUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  neurons: number;
  /** Janela do último minuto (para os limites por minuto do Groq). */
  callsLastMinute?: number;
  tokensLastMinute?: number;
}
export type UsageToday = Partial<Record<ProviderId, ProviderUsage>>;

const zero: ProviderUsage = { calls: 0, tokensIn: 0, tokensOut: 0, neurons: 0 };
const usageOf = (u: UsageToday, p: ProviderId): ProviderUsage => u[p] ?? zero;

/** Fração da cota diária usada por um provedor (0..1+): a maior entre requisições, tokens e neurons. */
export function providerFraction(p: ProviderId, usage: ProviderUsage, limits: ProviderLimits = PROVIDERS[p]): number {
  const fr = (used: number, max: number | null): number => (max === null ? 0 : used / max);
  return Math.max(fr(usage.calls, limits.requestsPerDay), fr(usage.tokensIn + usage.tokensOut, limits.tokensPerDay), fr(usage.neurons, limits.neuronsPerDay));
}

/** Cabe mais um turno estimado neste provedor, sem passar de nenhum limite (dia e minuto)? */
export function hasRoom(p: ProviderId, usage: ProviderUsage, limits: ProviderLimits = PROVIDERS[p]): boolean {
  const turnTokens = TURN_ESTIMATE.tokensIn + TURN_ESTIMATE.tokensOut;
  const ok = (used: number, add: number, max: number | null): boolean => max === null || used + add <= max;
  return (
    ok(usage.calls, 1, limits.requestsPerDay) &&
    ok(usage.tokensIn + usage.tokensOut, turnTokens, limits.tokensPerDay) &&
    ok(usage.neurons, TURN_ESTIMATE.neurons, limits.neuronsPerDay) &&
    ok(usage.callsLastMinute ?? 0, 1, limits.requestsPerMinute) &&
    ok(usage.tokensLastMinute ?? 0, turnTokens, limits.tokensPerMinute)
  );
}

/** Cota total usada, ponderada pela capacidade em turnos de cada provedor. */
export function totalFraction(usage: UsageToday): number {
  const total = PROVIDER_ORDER.reduce((s, p) => s + PROVIDERS[p].turnCapacity, 0);
  const used = PROVIDER_ORDER.reduce((s, p) => s + Math.min(1, providerFraction(p, usageOf(usage, p))) * PROVIDERS[p].turnCapacity, 0);
  return used / total;
}

export type BudgetMode = "normal" | "economico" | "esgotado";

/** 85% da cota total → econômico; sem provedor com vaga (100%) → esgotado. */
export function budgetMode(usage: UsageToday): BudgetMode {
  if (!PROVIDER_ORDER.some((p) => hasRoom(p, usageOf(usage, p)))) return "esgotado";
  return totalFraction(usage) >= ECONOMY_THRESHOLD ? "economico" : "normal";
}

export type LlmReason = "ajuda" | "papo" | "resumo";

export type RouteDecision =
  | { use: "llm"; provider: ProviderId; mode: BudgetMode }
  | { use: "script"; reason: "teto_aluno" | "modo_economico_papo" | "cota_esgotada" | "roteiro_cobre"; mode: BudgetMode };

export interface RouteInput {
  usage: UsageToday;
  /** Turnos de LLM deste aluno hoje. */
  studentTurnsToday: number;
  reason: LlmReason;
  /** O roteiro (falas prontas) cobre este turno? Então não gasta LLM. */
  scriptCovers: boolean;
  /** Provedores que já falharam neste turno (JSON inválido, lentidão >8 s): pula para o próximo. */
  failed?: readonly ProviderId[];
}

/** Decide se o turno usa LLM e qual provedor. Resumos em segundo plano não contam no teto do aluno nem no modo papo. */
export function routeTurn(input: RouteInput): RouteDecision {
  const mode = budgetMode(input.usage);
  if (input.scriptCovers) return { use: "script", reason: "roteiro_cobre", mode };
  if (input.reason !== "resumo" && input.studentTurnsToday >= MAX_LLM_TURNS_PER_STUDENT_PER_DAY) return { use: "script", reason: "teto_aluno", mode };
  if (mode === "esgotado") return { use: "script", reason: "cota_esgotada", mode };
  if (mode === "economico" && input.reason === "papo") return { use: "script", reason: "modo_economico_papo", mode };
  const provider = PROVIDER_ORDER.find((p) => !(input.failed ?? []).includes(p) && hasRoom(p, usageOf(input.usage, p)));
  if (!provider) return { use: "script", reason: "cota_esgotada", mode: "esgotado" };
  return { use: "llm", provider, mode };
}

/** Falas fixas do modo esgotado (o Axo avisa na voz dele e mostra os botões). */
export const EXHAUSTED_NOTICE = "tô com as brânquias cansadas hoje 🦎 vou seguir só pelas opções numeradas, tá?";

/** Limite de mensagens por minuto por aluno (janela deslizante simples, sobre os horários já lidos do banco). */
export function rateLimited(recentTimestamps: readonly Date[], now: Date, perMinute = MAX_MSGS_PER_STUDENT_PER_MINUTE): boolean {
  return recentTimestamps.filter((t) => now.getTime() - t.getTime() < 60_000).length >= perMinute;
}

/** O reset das cotas da Cloudflare é 00h UTC (21h em Brasília): o "dia" do contador é a data UTC. */
export const usageDay = (now: Date): string => now.toISOString().slice(0, 10);
