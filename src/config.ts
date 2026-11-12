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
} as const;

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
  analyzerTimeoutMs: number;
  /** IA (Groq `gsk_…` ou xAI Grok `xai-…`; API no formato OpenAI). Sem chave, o bot funciona sem IA. */
  aiApiKey?: string;
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
  const privacyPolicyUrl = req("PRIVACY_POLICY_URL");
  const termsVersion = req("TERMS_VERSION");

  const stopAt = parseInteger(env, "ANTI_FLOOD_MAX_PER_DAY", 0, 0, problems);
  if (stopAt > MAX_ANTI_FLOOD_PER_DAY) {
    problems.push(`ANTI_FLOOD_MAX_PER_DAY deve ser <= ${MAX_ANTI_FLOOD_PER_DAY} (recebido ${stopAt})`);
  }

  const maxBotMsgsPerUserPerDay = parseInteger(env, "MAX_BOT_MSGS_PER_USER_PER_DAY", 12, 1, problems);
  const maxBotMsgsPerUserPer10Min = parseInteger(env, "MAX_BOT_MSGS_PER_USER_PER_10MIN", 4, 1, problems);
  const maxAudioBytes = parseInteger(env, "MAX_AUDIO_BYTES", 16_000_000, 1, problems);

  const analyzerTimeoutMs = parseInteger(env, "ANALYZER_TIMEOUT_MS", 8000, 100, problems);
  const aiTimeoutMs = parseInteger(env, "AI_TIMEOUT_MS", 6000, 500, problems);
  // Chave: AI_API_KEY (preferida) ou os nomes antigos XAI_API_KEY / GROQ_API_KEY. O provedor vem do prefixo da chave.
  const aiApiKey = opt("AI_API_KEY", "") || opt("XAI_API_KEY", "") || opt("GROQ_API_KEY", "");
  const provider = aiApiKey.startsWith("gsk_") ? AI_PROVIDERS.groq : AI_PROVIDERS.xai;
  const aiBaseUrl = opt("AI_BASE_URL", "") || opt("XAI_BASE_URL", "") || provider.baseUrl;
  if (!/^https:\/\//.test(aiBaseUrl)) problems.push("AI_BASE_URL deve começar com https://");
  const aiModel = opt("AI_MODEL", "") || opt("XAI_MODEL", "") || provider.model;

  if (problems.length > 0) throw new ConfigError(problems);

  const flow = opt("WHATSAPP_FLOW_ID", "");
  return {
    evolutionUrl, evolutionApiKey, evolutionInstance, evolutionWebhookToken, evolutionNativeInteractive,
    supabaseUrl, supabaseServiceKey,
    ...(analyzerApiUrl && analyzerApiKey ? { analyzerApiUrl, analyzerApiKey } : {}),
    adminToken,
    timezone: opt("TIMEZONE", "") || opt("META_ACCOUNT_TIMEZONE", "America/Sao_Paulo"),
    stopAt,
    maxBotMsgsPerUserPerDay, maxBotMsgsPerUserPer10Min,
    ...(flow ? { whatsappFlowId: flow } : {}),
    privacyPolicyUrl, termsVersion, maxAudioBytes, analyzerTimeoutMs,
    ...(aiApiKey ? { aiApiKey } : {}),
    aiModel, aiBaseUrl, aiTimeoutMs,
  };
}
