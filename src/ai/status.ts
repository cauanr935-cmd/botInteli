import { AI_PROVIDERS, isGeminiKey } from "../config";
// Estado da chave de IA (Groq/xAI) para o painel: faz uma chamada mínima (1 resposta de poucos tokens) e traduz o
// resultado: ok, limite estourado (qual e quando volta), chave inválida, modelo inexistente ou provedor fora do ar.
// Nunca devolve a chave nem o corpo bruto do provedor (o texto de erro traz o id da organização).
export type AiState = "ok" | "limit" | "invalid_key" | "no_key" | "bad_model" | "down" | "config_invalid";

export interface AiStatus {
  state: AiState;
  /** Frase pronta para o painel, em português. */
  message: string;
  provider: string;
  model: string;
  /** Quando a verificação foi feita (ISO). */
  checkedAt: string;
  /** Limites que o provedor informou (cabeçalhos), se vierem. */
  limits?: { requestsRemaining?: number; requestsLimit?: number; tokensRemaining?: number; tokensLimit?: number };
  /** Qual limite estourou (429): tokens/requisições por minuto ou por dia. */
  limitKind?: string;
  retryAfter?: string;
}

export interface AiStatusConfig { aiApiKey?: string | undefined; aiModel: string; aiBaseUrl: string }

const KINDS: Record<string, string> = {
  TPD: "tokens por dia", TPM: "tokens por minuto", RPD: "requisições por dia", RPM: "requisições por minuto",
};

const num = (v: string | null): number | undefined => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const providerName = (baseUrl: string): string =>
  /groq\.com/.test(baseUrl) ? "Groq" : /x\.ai/.test(baseUrl) ? "xAI (Grok)" : /googleapis\.com/.test(baseUrl) ? "Google Gemini" : /openrouter\.ai/.test(baseUrl) ? "OpenRouter" : "IA";

/** "6m12s" / "17.5s" -> frase curta (só o que o provedor disse; não inventa). */
const clean = (s: string): string => s.replace(/[^0-9a-z. ]/gi, "").replace(/\.+$/, "").trim().slice(0, 20);

/** Modelos de texto que a chave enxerga (GET /models, formato OpenAI). Vazio se não der para listar. Prioriza os "flash". */
async function listModels(cfg: AiStatusConfig, f: typeof fetch): Promise<string[]> {
  try {
    const res = await f(`${cfg.aiBaseUrl.replace(/\/+$/, "")}/models`, { headers: { Authorization: `Bearer ${cfg.aiApiKey}` } });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { id?: unknown }[] };
    const ids = (j.data ?? []).map((m) => (typeof m.id === "string" ? m.id.replace(/^models\//, "") : ""))
      .filter((id) => /^[\w.-]{1,60}$/.test(id) && !/embed|tts|image|imagen|veo|aqa|live|audio|vision|robotics|computer/i.test(id));
    const flash = ids.filter((id) => /flash/i.test(id));
    return [...flash, ...ids.filter((id) => !flash.includes(id))].slice(0, 8);
  } catch {
    return [];
  }
}

export async function checkAiStatus(cfg: AiStatusConfig, fetchImpl?: typeof fetch, now: () => Date = () => new Date()): Promise<AiStatus> {
  const provider = providerName(cfg.aiBaseUrl);
  const base = { provider, model: cfg.aiModel, checkedAt: now().toISOString() };
  if (!cfg.aiApiKey) {
    return { ...base, state: "no_key", message: "Sem chave de IA configurada: o bot funciona só com as regras fixas (sem entender frases livres)." };
  }
  const f = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ctrl = new AbortController();
  const TIMEOUT_MS = 20_000;
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const call = (extra: Record<string, unknown>) => f(`${cfg.aiBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.aiApiKey}` },
      body: JSON.stringify({ model: cfg.aiModel, temperature: 0, max_tokens: 8, stream: false, ...extra, messages: [{ role: "user", content: "oi" }] }),
    });
    // Mesmo pedido que o bot faz: no Gemini Flash, sem raciocínio (se o provedor recusar o parâmetro, repete sem ele).
    const fast = /googleapis\.com/.test(cfg.aiBaseUrl) && /flash/i.test(cfg.aiModel);
    let res = await call(fast ? { reasoning_effort: "none" } : {});
    if (fast && res.status === 400) res = await call({});
    const h = res.headers;
    const limits = {
      ...(num(h.get("x-ratelimit-remaining-requests")) !== undefined ? { requestsRemaining: num(h.get("x-ratelimit-remaining-requests"))! } : {}),
      ...(num(h.get("x-ratelimit-limit-requests")) !== undefined ? { requestsLimit: num(h.get("x-ratelimit-limit-requests"))! } : {}),
      ...(num(h.get("x-ratelimit-remaining-tokens")) !== undefined ? { tokensRemaining: num(h.get("x-ratelimit-remaining-tokens"))! } : {}),
      ...(num(h.get("x-ratelimit-limit-tokens")) !== undefined ? { tokensLimit: num(h.get("x-ratelimit-limit-tokens"))! } : {}),
    };
    const withLimits = Object.keys(limits).length > 0 ? { limits } : {};
    if (res.ok) return { ...base, ...withLimits, state: "ok", message: `${provider} respondendo normalmente. O limite NÃO estourou.` };
    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
      const msg = typeof body?.error?.message === "string" ? body.error.message : "";
      const kind = KINDS[/\((TPD|TPM|RPD|RPM)\)/.exec(msg)?.[1] ?? ""];
      const again = /try again in ([0-9a-z. ]{1,20})/i.exec(msg)?.[1] ?? h.get("retry-after") ?? undefined;
      const retryAfter = again ? clean(again.trim()) : undefined;
      return {
        ...base, ...withLimits, state: "limit", ...(kind ? { limitKind: kind } : {}), ...(retryAfter ? { retryAfter } : {}),
        message: `Limite do ${provider} estourado${kind ? ` (${kind})` : ""}${retryAfter ? `; volta em ${retryAfter}` : ""}. Enquanto isso o bot responde só com as regras fixas.`,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ...base, state: "invalid_key", message: `A chave do ${provider} foi recusada (inválida, revogada ou sem permissão). Gere outra e atualize o segredo AI_API_KEY.` };
    }
    if (res.status === 404) {
      // Lista o que a chave enxerga, para escolher um modelo que existe (os nomes mudam e saem de linha).
      const avail = await listModels(cfg, f);
      return {
        ...base, state: "bad_model",
        message: `O modelo "${cfg.aiModel}" não existe ou não está liberado para esta chave.` +
          (avail.length > 0 ? ` Modelos disponíveis para ela: ${avail.join(", ")}. Defina AI_MODEL com um deles.` : " Defina AI_MODEL com um modelo válido."),
      };
    }
    return { ...base, state: "down", message: `${provider} indisponível agora (erro ${res.status}).` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "erro";
    const why = name === "AbortError" || name === "TimeoutError"
      ? `sem resposta em ${TIMEOUT_MS / 1000} s (o ${provider} demorou demais)`
      : `erro de rede (${String(name).slice(0, 30)}${e instanceof Error && e.message ? ": " + e.message.replace(/AQ\.\S+|AIza\S+|gsk_\S+/g, "***").slice(0, 80) : ""})`;
    return { ...base, state: "down", message: `Não consegui falar com o ${provider}: ${why}.` };
  } finally {
    clearTimeout(timer);
  }
}

/** Uma linha do painel: o provedor, se é o que o bot usa agora e o resultado da verificação. */
export interface AiProviderStatus extends AiStatus { id: "groq" | "gemini" | "other"; active: boolean }
export interface AiOverview { items: AiProviderStatus[] }

const idOf = (baseUrl: string): AiProviderStatus["id"] =>
  /groq\.com/.test(baseUrl) ? "groq" : /googleapis\.com/.test(baseUrl) ? "gemini" : "other";
const strOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Verifica, em paralelo, o Groq e o Gemini (sempre as duas linhas) e, se o bot usa outro provedor, esse também.
 * A chave em uso vem de AI_API_KEY; a outra, se existir, de GROQ_API_KEY / GEMINI_API_KEY (só para o painel conferir).
 */
export async function checkAllAi(
  active: AiStatusConfig, env: Record<string, unknown>, fetchImpl?: typeof fetch, now: () => Date = () => new Date(),
): Promise<AiOverview> {
  const activeId = idOf(active.aiBaseUrl);
  const defs: { id: AiProviderStatus["id"]; label: string; secret: string; valid: (k: string) => boolean; cfg: { baseUrl: string; model: string } }[] = [
    { id: "groq", label: "Groq", secret: "GROQ_API_KEY", valid: (k) => k.startsWith("gsk_"), cfg: AI_PROVIDERS.groq },
    { id: "gemini", label: "Google Gemini", secret: "GEMINI_API_KEY", valid: isGeminiKey, cfg: AI_PROVIDERS.gemini },
  ];
  const jobs = defs.map(async (d): Promise<AiProviderStatus> => {
    if (activeId === d.id) return { ...(await checkAiStatus(active, fetchImpl, now)), id: d.id, active: true };
    const key = strOf(env[d.secret]);
    if (!d.valid(key)) {
      return {
        id: d.id, active: false, state: "no_key", provider: d.label, model: d.cfg.model, checkedAt: now().toISOString(),
        message: `Sem chave do ${d.label} para conferir (opcional: defina o segredo ${d.secret}).`,
      };
    }
    return { ...(await checkAiStatus({ aiApiKey: key, aiModel: d.cfg.model, aiBaseUrl: d.cfg.baseUrl }, fetchImpl, now)), id: d.id, active: false };
  });
  if (activeId === "other") jobs.push(checkAiStatus(active, fetchImpl, now).then((s) => ({ ...s, id: "other" as const, active: true })));
  return { items: await Promise.all(jobs) };
}
