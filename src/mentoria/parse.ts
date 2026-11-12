// Leitura (PURA) dos textos do fluxo de mentoria: assunto, data e parceiro.
import { intentsOf } from "../conversation/synonyms";

export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 200;

/**
 * Assunto seguro: uma linha só. O notebook escreve `mentor: <nome>` / `mentorado: <nome>` num arquivo de texto
 * ao lado do assunto; uma quebra de linha (ou separador Unicode) no assunto deixaria alguém forjar essas linhas.
 * Por isso: troca controles e separadores por espaço, junta espaços e desarma "mentor:" / "mentorado:".
 */
export function sanitizeSubject(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\b(mentorad[oa]|mentor)\s*:/giu, "$1 -")
    .trim();
}

export type SubjectCheck = { ok: true; value: string } | { ok: false; reason: "short" | "long" };

export function checkSubject(raw: string): SubjectCheck {
  if (raw.length > 1000) return { ok: false, reason: "long" };
  const v = sanitizeSubject(raw);
  if (v.length > SUBJECT_MAX) return { ok: false, reason: "long" };
  if (v.length < SUBJECT_MIN || !/\p{L}/u.test(v) || intentsOf(v).size > 0) return { ok: false, reason: "short" };
  return { ok: true, value: v };
}

// ---- Datas (texto "YYYY-MM-DD", sem fuso: o "hoje" chega pronto por parâmetro) ----

/** Data de hoje (YYYY-MM-DD) no fuso informado. */
export function todayIn(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export const yesterdayOf = (today: string): string => addDays(today, -1);

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
/** Mais antiga que isto = provável engano de digitação (o certificado seria de uma data errada). */
export const MAX_AGE_DAYS = 365;

export type DateCheck = { ok: true; date: string } | { ok: false; reason: "invalid" | "future" | "old" };

export function parseOccurredOn(raw: string, today: string): DateCheck {
  const t = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/.\-\s]/g, " ").replace(/\s+/g, " ").trim();
  const year = Number(today.slice(0, 4));
  let date: string | null = null;
  if (t === "hoje") date = today;
  else if (t === "ontem") date = addDays(today, -1);
  else if (t === "anteontem") date = addDays(today, -2);
  else {
    let m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
    if (m) {
      const y = m[3] === undefined ? year : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      date = valid(y, Number(m[2]), Number(m[1]));
    } else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) {
      date = valid(Number(m[1]), Number(m[2]), Number(m[3]));
    } else if ((m = /^(?:dia )?(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?$/.exec(t))) {
      const mo = MONTHS[m[2] as string];
      if (mo) date = valid(m[3] === undefined ? year : Number(m[3]), mo, Number(m[1]));
    }
  }
  if (date === null) return { ok: false, reason: "invalid" };
  if (date > today) return { ok: false, reason: "future" };
  if (date < addDays(today, -MAX_AGE_DAYS)) return { ok: false, reason: "old" };
  return { ok: true, date };
}

/** 2026-11-05 -> 05/11/2026. */
export const formatDateBr = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

// ---- Parceiro: número de telefone e nome ----

const digits = (s: string): string => s.replace(/\D/g, "");

/**
 * Possíveis wa_id de um número informado. Celulares do Brasil aparecem com e sem o 9º dígito
 * (ex.: 5511987654321 e 551187654321); testamos as duas formas. Aceita DDD+número ou 55+DDD+número.
 */
export function phoneCandidates(raw: string): string[] {
  let n = digits(raw);
  if (n.startsWith("00")) n = n.slice(2);
  if (raw.trim().startsWith("+") && !n.startsWith("55")) return []; // outro país: só pelo contato compartilhado
  if (n.length === 10 || n.length === 11) n = `55${n}`;
  if (!(n.startsWith("55") && (n.length === 12 || n.length === 13))) return [];
  const ddd = n.slice(2, 4);
  if (ddd.startsWith("0")) return [];
  const rest = n.slice(4);
  const out = [n];
  if (rest.length === 9 && rest.startsWith("9")) out.push(`55${ddd}${rest.slice(1)}`);
  else if (rest.length === 8 && /^[6-9]/.test(rest)) out.push(`55${ddd}9${rest}`);
  return out;
}

/** wa_id vindo do contato compartilhado (já é o identificador da Meta): só dígitos, 8 a 15. */
export function contactWaId(raw: string): string | null {
  const n = digits(raw);
  return n.length >= 8 && n.length <= 15 ? n : null;
}

/** Texto que é um número de telefone (quase só dígitos), e não um nome. */
export function looksLikePhone(raw: string): boolean {
  const d = digits(raw);
  return d.length >= 8 && !/\p{L}/u.test(raw);
}

/** Palavras de busca por nome: minúsculas, sem acento e sem pontuação (mesma regra da função SQL). */
export function nameTokens(raw: string): string[] {
  const t = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  return [...new Set(t)].slice(0, 5);
}
export const foldName = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
