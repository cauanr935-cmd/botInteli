/** Franquia gratuita da Meta por número/mês. Constante: nunca vem do ambiente (R1). */
export const META_FREE_TIER_PER_MONTH = 1000;
export const MIN_SAFETY_MARGIN = 10;
export const DEFAULT_SAFETY_MARGIN = 50;
export const MAX_STOP_AT = 990;
/** Margem máxima: garante STOP_AT >= 500 (nunca zero/negativo). */
export const MAX_SAFETY_MARGIN = 500;

export interface Config {
  whatsappToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  graphApiVersion: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  analyzerApiUrl: string;
  analyzerApiKey: string;
  adminToken: string;
  metaAccountTimezone: string;
  budgetSafetyMargin: number;
  stopAt: number;
  maxBotMsgsPerUserPerDay: number;
  maxBotMsgsPerUserPer10Min: number;
  whatsappFlowId?: string;
  privacyPolicyUrl: string;
  termsVersion: string;
  maxAudioBytes: number;
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

  const whatsappToken = req("WHATSAPP_TOKEN");
  const phoneNumberId = req("PHONE_NUMBER_ID");
  const appSecret = req("APP_SECRET");
  const verifyToken = req("VERIFY_TOKEN");
  const supabaseUrl = req("SUPABASE_URL");
  const supabaseServiceKey = req("SUPABASE_SERVICE_KEY");
  const analyzerApiUrl = req("ANALYZER_API_URL");
  const analyzerApiKey = req("ANALYZER_API_KEY");
  const adminToken = req("ADMIN_TOKEN");
  const privacyPolicyUrl = req("PRIVACY_POLICY_URL");
  const termsVersion = req("TERMS_VERSION");
  const graphApiVersion = req("GRAPH_API_VERSION");

  const budgetSafetyMargin = parseInteger(
    env, "BUDGET_SAFETY_MARGIN", DEFAULT_SAFETY_MARGIN, MIN_SAFETY_MARGIN, problems,
  );
  const stopAt = META_FREE_TIER_PER_MONTH - budgetSafetyMargin;
  if (budgetSafetyMargin > MAX_SAFETY_MARGIN) {
    problems.push(
      `BUDGET_SAFETY_MARGIN deve ser <= ${MAX_SAFETY_MARGIN} (recebido ${budgetSafetyMargin}); STOP_AT ficaria ${stopAt}`,
    );
  }
  if (stopAt > MAX_STOP_AT) {
    problems.push(`STOP_AT (${stopAt}) não pode passar de ${MAX_STOP_AT}`);
  }

  const maxBotMsgsPerUserPerDay = parseInteger(env, "MAX_BOT_MSGS_PER_USER_PER_DAY", 12, 1, problems);
  const maxBotMsgsPerUserPer10Min = parseInteger(env, "MAX_BOT_MSGS_PER_USER_PER_10MIN", 4, 1, problems);
  const maxAudioBytes = parseInteger(env, "MAX_AUDIO_BYTES", 16_000_000, 1, problems);

  if (problems.length > 0) throw new ConfigError(problems);

  const flow = opt("WHATSAPP_FLOW_ID", "");
  return {
    whatsappToken, phoneNumberId, appSecret, verifyToken, graphApiVersion,
    supabaseUrl, supabaseServiceKey, analyzerApiUrl, analyzerApiKey, adminToken,
    metaAccountTimezone: opt("META_ACCOUNT_TIMEZONE", "America/Sao_Paulo"),
    budgetSafetyMargin, stopAt,
    maxBotMsgsPerUserPerDay, maxBotMsgsPerUserPer10Min,
    ...(flow ? { whatsappFlowId: flow } : {}),
    privacyPolicyUrl, termsVersion, maxAudioBytes,
  };
}
