// Conteúdo do bot (serviços + respostas prontas): tipos, fallbacks e validação. PURO (sem I/O nem relógio).
import type { Logger } from "../lib/logger";
import { LIMITS } from "../whatsapp/builders";

export interface Service {
  id: string;
  title: string;
  description: string;
  requiresAudio: boolean;
  sortOrder: number;
}

export interface Content {
  /** Até 10 serviços ativos, em ordem. */
  services: readonly Service[];
  /** Texto do banco (canned_responses) ou o fallback do código se a chave faltar/for inválida. */
  text(key: string, fallback: string, maxLen?: number): string;
}

/** Fonte de dados (subconjunto do Repo). */
export interface ContentSource {
  listActiveServices(): Promise<Service[]>;
  listCannedResponses(): Promise<Record<string, string>>;
}

/** Serviços usados se o banco estiver vazio ou fora (mesmo conteúdo do seed). */
export const DEFAULT_SERVICES: readonly Service[] = [
  { id: "mentoria", title: "Registrar mentoria", description: "Anexe o áudio da mentoria", requiresAudio: true, sortOrder: 5 },
  { id: "horarios", title: "Horários", description: "Informe seus dias e horários livres", requiresAudio: false, sortOrder: 20 },
  { id: "contato", title: "Contato", description: "Fale com o Cauan, da Be My Mentor", requiresAudio: false, sortOrder: 30 },
];

export const MENU_MAX_SERVICES = LIMITS.listMaxRows;

export function makeContent(services: readonly Service[], canned: Record<string, string>, logger?: Logger): Content {
  return {
    services,
    text(key, fallback, maxLen = LIMITS.body) {
      const v = Object.prototype.hasOwnProperty.call(canned, key) ? canned[key] : undefined;
      if (typeof v !== "string" || v.trim() === "") return fallback;
      if (v.length > maxLen) {
        logger?.log("warn", "canned_response_too_long", { key });
        return fallback;
      }
      return v;
    },
  };
}

/** Conteúdo só com os fallbacks do código (sem banco). */
export const fallbackContent: Content = makeContent(DEFAULT_SERVICES, {});

function validService(s: Service): boolean {
  return (
    s.title.length >= 1 && s.title.length <= LIMITS.listRowTitle &&
    s.description.length <= LIMITS.listRowDescription &&
    `svc_${s.id}`.length <= LIMITS.id
  );
}

/** Aplica ordem, descarta linhas inválidas e corta em 10 (com warn). */
export function prepareServices(rows: readonly Service[], logger?: Logger): Service[] {
  const valid = rows.filter((s) => {
    const ok = validService(s);
    if (!ok) logger?.log("warn", "service_invalid_skipped", { id: s.id });
    return ok;
  });
  valid.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  if (valid.length > MENU_MAX_SERVICES) {
    logger?.log("warn", "menu_truncated", { active: valid.length, shown: MENU_MAX_SERVICES });
    return valid.slice(0, MENU_MAX_SERVICES);
  }
  return valid;
}
