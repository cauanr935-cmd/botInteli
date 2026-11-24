import { parseAdminIds } from "./matching/admin";
/**
 * Limitador anti-flood (antes "orçamento Meta"). No canal Evolution/Baileys não existe franquia nem cobrança por
 * conversa: o teto diário de envios existe para proteger o número contra BANIMENTO por excesso de volume.
 * 0 = desligado (padrão). O teto máximo continua 990 porque a função SQL de reserva limita `stop_at` a 990.
 */
export const MAX_ANTI_FLOOD_PER_DAY = 990;

/** Provedores de IA com API no formato OpenAI (chat/completions). O modelo é só um padrão: troque por AI_MODEL. */
export const AI_PROVIDERS = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  xai: { baseUrl: "https://api.x.ai/v1", model: "grok-4" },
  /** Google Gemini (camada gratuita do AI Studio), pela API compatível com OpenAI. Chave `AIza…`. */
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", /** Apelido que sempre aponta para o Flash atual (o gemini-2.5-flash foi aposentado). */ model: "gemini-flash-latest" },
} as const;

/** Chave do Google Gemini: formato antigo `AIza…` ou novo `AQ.…`. */
export const isGeminiKey = (k: string): boolean => k.startsWith("AIza") || k.startsWith("AQ.");

/** Um provedor de IA (chave + modelo + endereço). */
export interface AiProviderConfig { apiKey: string; model: string; baseUrl: string }

export interface Config {
  /** Evolution API (canal WhatsApp, modo Baileys). */
  evolutionUrl: string;
  evolutionApiKey: string;
  evolutionInstance: string;
  /** Segredo compartilhado que a Evolution envia em cada chamada ao /webhook. */
  evolutionWebhookToken: string;
  /** true = tenta botões/listas nativos (instável no Baileys); false = texto numerado (padrão). */
  evolutionNativeInteractive: boolean;
  supabaseUrl: string;
  supabaseServiceKey: string;
  /** O analisador é opcional durante a implantação inicial. Sem ele, áudios ficam desativados. */
  analyzerApiUrl?: string;
  analyzerApiKey?: string;
  adminToken: string;
  /** Números (só dígitos, E.164) que podem usar os comandos /duvidas e /mentores no WhatsApp. Vazio = ninguém. */
  adminWaIds: string[];
  /** Guardrail de abertura da rede: até `openAt` só quem está em `allow` pode pedir mentoria (cadastro é livre). Ausente = rede aberta. */
  networkGate?: { openAt: Date; allow: string[] };
  /** Fuso que define a virada do dia (contador anti-flood e limites por pessoa). */
  timezone: string;
  /** Teto de envios por dia do número (anti-flood). 0 = desligado. */
  stopAt: number;
  maxBotMsgsPerUserPerDay: number;
  maxBotMsgsPerUserPer10Min: number;
  whatsappFlowId?: string;
  privacyPolicyUrl: string;
  termsVersion: string;
  maxAudioBytes: number;
  /** Teto para arquivos copiados em stream do S3 da Evolution (sem carregar na memória). */
  maxAudioStreamBytes: number;
  /** Hosts permitidos para a URL do arquivo no S3 (MEDIA_URL_HOSTS, separados por vírgula). Vazio = stream desligado. */
  mediaUrlHosts: string[];
  analyzerTimeoutMs: number;
  /** IA (Groq `gsk_…`, Google Gemini `AIza…`/`AQ.…` ou xAI Grok `xai-…`; API no formato OpenAI). Sem chave, o bot funciona sem IA. */
  aiApiKey?: string;
  /** Outros provedores com chave definida (ex.: Groq quando o principal é o Gemini): usados quando o principal falha (503, 429, timeout). */
  aiFallbacks?: AiProviderConfig[];
  aiModel: string;
  aiBaseUrl: string;
  aiTimeoutMs: number;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super("Configuração inválida: " + problems.join("; "));
    this.name = "ConfigError";
  }
}

type Env = Record<string, unknown>;

function parseInteger(
  env: Env,
  key: string,
  def: number,
  min: number,
  problems: string[],
): number {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return def;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) {
    problems.push(`${key} deve ser um número inteiro (recebido "${s}")`);
    return def;
  }
  const n = Number(s);
  if (n < min) {
    problems.push(`${key} deve ser >= ${min} (recebido ${n})`);
    return def;
  }
  return n;
}

export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const req = (key: string): string => {
    const v = env[key];
    if (typeof v !== "string" || v.trim() === "") {
      problems.push(`variável obrigatória ausente: ${key}`);
      return "";
    }
    return v.trim();
  };
  const opt = (key: string, def: string): string => {
    const v = env[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : def;
  };

  const evolutionUrl = req("EVOLUTION_URL").replace(/\/+$/, "");
  if (evolutionUrl !== "" && !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(evolutionUrl)) {
    problems.push("EVOLUTION_URL deve começar com https:// (http:// só para localhost)");
  }
  const evolutionApiKey = req("EVOLUTION_API_KEY");
  const evolutionInstance = req("EVOLUTION_INSTANCE");
  if (evolutionInstance !== "" && !/^[A-Za-z0-9_.-]{1,64}$/.test(evolutionInstance)) {
    problems.push("EVOLUTION_INSTANCE deve ter só letras, números, ponto, hífen ou sublinhado (até 64)");
  }
  const evolutionWebhookToken = req("EVOLUTION_WEBHOOK_TOKEN");
  if (evolutionWebhookToken !== "" && evolutionWebhookToken.length < 16) {
    problems.push("EVOLUTION_WEBHOOK_TOKEN deve ter pelo menos 16 caracteres");
  }
  const evolutionNativeInteractive = opt("EVOLUTION_NATIVE_INTERACTIVE", "false").toLowerCase() === "true";
  const supabaseUrl = req("SUPABASE_URL");
  const supabaseServiceKey = req("SUPABASE_SERVICE_KEY");
  const analyzerApiUrl = opt("ANALYZER_API_URL", "");
  const analyzerApiKey = opt("ANALYZER_API_KEY", "");
  if ((analyzerApiUrl === "") !== (analyzerApiKey === "")) {
    problems.push("ANALYZER_API_URL e ANALYZER_API_KEY devem ser configuradas juntas");
  }
  const adminToken = req("ADMIN_TOKEN");
  const adminWaIds = parseAdminIds(opt("ADMIN_WA_IDS", ""));
  if (adminWaIds === null) problems.push("ADMIN_WA_IDS deve ter números E.164 (8 a 15 dígitos) separados por vírgula");
  // Abertura da rede: NETWORK_OPEN_AT (ISO com fuso, ex.: 2026-11-23T00:00:00-03:00) e NETWORK_EARLY_ACCESS (números liberados antes).
  const openAtRaw = opt("NETWORK_OPEN_AT", "");
  const openAt = openAtRaw === "" ? null : new Date(openAtRaw);
  if (openAt !== null && Number.isNaN(openAt.getTime())) problems.push("NETWORK_OPEN_AT deve ser uma data ISO com fuso (ex.: 2026-11-23T00:00:00-03:00)");
  const earlyAccess = parseAdminIds(opt("NETWORK_EARLY_ACCESS", ""));
  if (earlyAccess === null) problems.push("NETWORK_EARLY_ACCESS deve ter números (8 a 15 dígitos) separados por vírgula");
  const privacyPolicyUrl = req("PRIVACY_POLICY_URL");
  const termsVersion = req("TERMS_VERSION");

  const stopAt = parseInteger(env, "ANTI_FLOOD_MAX_PER_DAY", 0, 0, problems);
  if (stopAt > MAX_ANTI_FLOOD_PER_DAY) {
    problems.push(`ANTI_FLOOD_MAX_PER_DAY deve ser <= ${MAX_ANTI_FLOOD_PER_DAY} (recebido ${stopAt})`);
  }

  const maxBotMsgsPerUserPerDay = parseInteger(env, "MAX_BOT_MSGS_PER_USER_PER_DAY", 200, 1, problems);
  const maxBotMsgsPerUserPer10Min = parseInteger(env, "MAX_BOT_MSGS_PER_USER_PER_10MIN", 30, 1, problems);
  const maxAudioBytes = parseInteger(env, "MAX_AUDIO_BYTES", 16_000_000, 1, problems);
  const maxAudioStreamBytes = parseInteger(env, "MAX_AUDIO_STREAM_BYTES", 300_000_000, 1, problems);
  const mediaUrlHosts = opt("MEDIA_URL_HOSTS", "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

  const analyzerTimeoutMs = parseInteger(env, "ANALYZER_TIMEOUT_MS", 8000, 100, problems);
  const aiTimeoutMs = parseInteger(env, "AI_TIMEOUT_MS", 6000, 500, problems);
  // Chave: AI_API_KEY (preferida) ou os nomes antigos XAI_API_KEY / GROQ_API_KEY. O provedor vem do prefixo da chave.
  // Se existir uma chave do Google Gemini (AIza…) em qualquer um dos nomes, o bot usa o Gemini; senão, a primeira chave definida.
  const keys = ["AI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "GROQ_API_KEY"].map((k) => opt(k, "")).filter((k) => k !== "");
  const aiApiKey = keys.find(isGeminiKey) ?? keys[0] ?? "";
  const provider = aiApiKey.startsWith("gsk_") ? AI_PROVIDERS.groq : isGeminiKey(aiApiKey) ? AI_PROVIDERS.gemini : AI_PROVIDERS.xai;
  // Chave Groq (gsk_) com XAI_BASE_URL/XAI_MODEL herdados de uma config antiga da xAI: ignora os nomes antigos
  // (senão toda chamada falharia e o bot cairia sempre no "não entendi").
  const legacy = (name: string): string => (provider === AI_PROVIDERS.xai ? opt(name, "") : "");
  // Com chave do Gemini, AI_BASE_URL/AI_MODEL que sobraram de outro provedor (ex.: Groq) são ignorados: senão toda chamada falharia.
  const forGemini = provider === AI_PROVIDERS.gemini;
  const baseOverride = opt("AI_BASE_URL", "");
  const modelOverride = opt("AI_MODEL", "");
  const aiBaseUrl = (forGemini && !/googleapis\.com/.test(baseOverride) ? "" : baseOverride) || legacy("XAI_BASE_URL") || provider.baseUrl;
  if (!/^https:\/\//.test(aiBaseUrl)) problems.push("AI_BASE_URL deve começar com https://");
  const aiModel = (forGemini && !/^(models\/)?gemini/i.test(modelOverride) ? "" : modelOverride) || legacy("XAI_MODEL") || provider.model;

  // Reserva: toda OUTRA chave de provedor diferente do principal vira fallback (Groq antes de xAI, que é mais lenta e paga).
  const providerOf = (k: string) => (k.startsWith("gsk_") ? AI_PROVIDERS.groq : isGeminiKey(k) ? AI_PROVIDERS.gemini : AI_PROVIDERS.xai);
  const rank = (b: string): number => (b === AI_PROVIDERS.groq.baseUrl ? 0 : b === AI_PROVIDERS.gemini.baseUrl ? 1 : 2);
  const seenProviders = new Set<string>([provider.baseUrl]);
  const aiFallbacks: AiProviderConfig[] = [];
  for (const k of keys) {
    const pv = providerOf(k);
    if (k === aiApiKey || seenProviders.has(pv.baseUrl)) continue;
    seenProviders.add(pv.baseUrl);
    aiFallbacks.push({ apiKey: k, model: pv.model, baseUrl: pv.baseUrl });
  }
  aiFallbacks.sort((a, b) => rank(a.baseUrl) - rank(b.baseUrl));

  if (problems.length > 0) throw new ConfigError(problems);

  const flow = opt("WHATSAPP_FLOW_ID", "");
  return {
    evolutionUrl, evolutionApiKey, evolutionInstance, evolutionWebhookToken, evolutionNativeInteractive,
    supabaseUrl, supabaseServiceKey,
    ...(analyzerApiUrl && analyzerApiKey ? { analyzerApiUrl, analyzerApiKey } : {}),
    adminToken,
    adminWaIds: adminWaIds ?? [],
    ...(openAt !== null && !Number.isNaN(openAt.getTime()) ? { networkGate: { openAt, allow: earlyAccess ?? [] } } : {}),
    timezone: opt("TIMEZONE", "") || opt("META_ACCOUNT_TIMEZONE", "America/Sao_Paulo"),
    stopAt,
    maxBotMsgsPerUserPerDay, maxBotMsgsPerUserPer10Min,
    ...(flow ? { whatsappFlowId: flow } : {}),
    privacyPolicyUrl, termsVersion, maxAudioBytes, maxAudioStreamBytes, mediaUrlHosts, analyzerTimeoutMs,
    ...(aiApiKey ? { aiApiKey } : {}),
    ...(aiApiKey && aiFallbacks.length > 0 ? { aiFallbacks } : {}),
    aiModel, aiBaseUrl, aiTimeoutMs,
  };
}
