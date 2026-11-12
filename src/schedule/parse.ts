// Lê, em texto livre, vários dias e horários de uma vez ("segunda e quarta das 8h às 12h; sexta à tarde").
// Regras fixas e previsíveis (sem IA, sem custo, sem rede); a IA só entra quando isto não achar nada. PURO.
// Faixa de atendimento: 8h às 20h, em passos de 30 minutos. Minutos arredondam para fora até o próximo meio-hora
// (8h10 às 11h40 -> 8h às 12h); 15h às 16h30 fica exatamente 15h às 16h30.
import { WEEKDAYS, type AvailabilitySlot, type Weekday } from "../ai/types";

export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 20;
const OPEN_MIN = OPEN_HOUR * 60;
const CLOSE_MIN = CLOSE_HOUR * 60;
const STEP = 30;

export interface ParsedSchedule {
  /** Dia e faixa explícitos no texto, já dentro de 8h às 20h, uma faixa por dia/intervalo, sem sobreposição. */
  slots: AvailabilitySlot[];
  /** Horários que vieram sem dia ("das 14h às 16h"), em minutos desde 0h: servem ao dia que a pessoa já escolheu. */
  loose: [number, number][];
  /** Citou dias mas nenhum horário (para a dica pedir os dois juntos). */
  daysOnly: Weekday[];
}

const DAY_RE = "(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|seg|qua|qui|sex|sab|dom|ter(?=\\s*(?:\\d|(?:seg|qua|qui|sex|sab|dom)\\b)))s?(?:\\s*feira)?";
const dayOf = (w: string): Weekday | null => {
  const s = w.replace(/\s*feira$/, "").replace(/s$/, "");
  const map: Record<string, Weekday> = {
    segunda: "segunda", seg: "segunda", terca: "terca", ter: "terca", quarta: "quarta", qua: "quarta", quinta: "quinta", qui: "quinta",
    sexta: "sexta", sex: "sexta", sabado: "sabado", sab: "sabado", domingo: "domingo", dom: "domingo",
  };
  return map[s] ?? map[s.replace(/s$/, "")] ?? null;
};
const idx = (d: Weekday): number => WEEKDAYS.indexOf(d);

const TIME_PART = "(\\d{1,2})(?:[:h]\\s*(\\d{2}))?";
const UNIT = "(?:\\s*(?:h\\b|hrs?\\b|horas?\\b))?";
const RANGE_RE = `${TIME_PART}${UNIT}\\s*(?:-|a|as|ate as|ate a|ate)\\s*${TIME_PART}${UNIT}`;
const SINGLE_RE = "(\\d{1,2})(?:[:h]\\s*(\\d{2})|\\s*h\\b|\\s*hrs?\\b)";

// Ordem importa: faixa de dias antes de dia; faixa de horas antes de hora solta.
const TOKEN = new RegExp([
  `(?<dayrange>\\b(${DAY_RE})\\s*(?:a|ate)\\s*(${DAY_RE})\\b)`,
  "(?<all>\\b(?:todos os dias|todo dia|todo os dias|diariamente|toda a semana|a semana toda)\\b)",
  "(?<util>\\b(?:dias uteis|dia util|de segunda a sexta)\\b)",
  "(?<weekend>\\b(?:fim|fins|final|finais) de semana\\b)",
  `(?<day>\\b(${DAY_RE})\\b)`,
  `(?<range>${RANGE_RE})`,
  "(?<fullday>\\b(?:dia todo|dia inteiro|o dia todo|integral)\\b)",
  "(?<morning>\\b(?:manha|de manha)\\b)",
  "(?<afternoon>\\b(?:tarde)\\b)",
  "(?<evening>\\b(?:noite)\\b)",
  `(?<single>${SINGLE_RE})`,
].join("|"), "g");

const normalize = (raw: string): string =>
  raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—−]/g, "-").replace(/[^a-z0-9:\-\s]/g, " ").replace(/\s+/g, " ").trim();

/** Hora escrita -> hora de 24h dentro do expediente (1h a 7h só podem ser da tarde: 2 -> 14). */
const toHour = (h: number): number => (h >= 1 && h <= 7 ? h + 12 : h);

/** Limita ao expediente e arredonda para fora, em passos de 30 min. Minutos desde 0h. */
function clampRange(startMin: number, endMin: number): [number, number] | null {
  const s = Math.max(OPEN_MIN, Math.floor(startMin / STEP) * STEP);
  const e = Math.min(CLOSE_MIN, Math.ceil(endMin / STEP) * STEP);
  return s < e ? [s, e] : null;
}

function rangeFrom(h1: string, m1: string | undefined, h2: string, m2: string | undefined): [number, number] | null {
  const a = Number(h1), b = Number(h2);
  if (a > 24 || b > 24 || (m1 && Number(m1) > 59) || (m2 && Number(m2) > 59)) return null;
  let start = a * 60 + Number(m1 ?? 0);
  let end = b * 60 + Number(m2 ?? 0);
  if (a <= 7 && b <= 7) { start += 720; end += 720; } // "das 2 às 5": só pode ser da tarde
  else if (end <= start) end += 720; // "12 às 2"
  return clampRange(start, end);
}

function mergeRanges(ranges: readonly [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [s0, e0] of sorted) {
    const last = out[out.length - 1];
    if (last && s0 <= last[1]) last[1] = Math.max(last[1], e0);
    else out.push([s0, e0]);
  }
  return out;
}

const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function toSlots(byDay: Map<Weekday, [number, number][]>): AvailabilitySlot[] {
  const out: AvailabilitySlot[] = [];
  for (const d of WEEKDAYS) {
    const r = byDay.get(d);
    if (r) for (const [s, e] of mergeRanges(r)) out.push({ day: d, start: hhmm(s), end: hhmm(e) });
  }
  return out;
}

const minutesOf = (t: string): number => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1] ?? 0);

export function parseScheduleText(raw: string): ParsedSchedule {
  const text = normalize(raw.slice(0, 600));
  const byDay = new Map<Weekday, [number, number][]>();
  const loose: [number, number][] = [];
  const daysOnly = new Set<Weekday>();
  let days: Weekday[] = [];
  let times: [number, number][] = [];
  let carried: [number, number][] = []; // horários vistos antes de qualquer dia ("das 8 às 12 na segunda e quarta")

  const add = (d: Weekday, r: [number, number][]): void => { byDay.set(d, [...(byDay.get(d) ?? []), ...r]); };
  const flush = (): void => {
    if (days.length > 0 && times.length > 0) for (const d of days) add(d, times);
    else if (days.length > 0 && carried.length > 0) { for (const d of days) add(d, carried); carried = []; }
    else if (days.length > 0) for (const d of days) daysOnly.add(d);
    else if (times.length > 0) carried = [...carried, ...times];
    days = []; times = [];
  };

  for (const m of text.matchAll(TOKEN)) {
    const g = m.groups ?? {};
    const addDays = (ds: Weekday[]): void => {
      if (times.length > 0) flush(); // começou outro grupo de dias: fecha o anterior
      days = [...days, ...ds.filter((d) => !days.includes(d))];
    };
    if (g.dayrange !== undefined) {
      const a = dayOf(m[2] ?? ""), b = dayOf(m[3] ?? "");
      if (a && b) {
        const list: Weekday[] = [];
        for (let i = idx(a); ; i = (i + 1) % 7) { list.push(WEEKDAYS[i] as Weekday); if (i === idx(b) || list.length > 7) break; }
        addDays(list);
      }
    } else if (g.all !== undefined) addDays([...WEEKDAYS]);
    else if (g.util !== undefined) addDays(["segunda", "terca", "quarta", "quinta", "sexta"]);
    else if (g.weekend !== undefined) addDays(["sabado", "domingo"]);
    else if (g.day !== undefined) { const d = dayOf(g.day.trim()); if (d) addDays([d]); }
    else if (g.range !== undefined) {
      const r = timeRangeFromMatch(g.range);
      if (r) times.push(r);
    } else if (g.fullday !== undefined) times.push([OPEN_MIN, CLOSE_MIN]);
    else if (g.morning !== undefined) times.push([480, 720]);
    else if (g.afternoon !== undefined) times.push([720, 1080]);
    else if (g.evening !== undefined) times.push([1080, 1200]);
    else if (g.single !== undefined) {
      const s = new RegExp(`^${SINGLE_RE}`).exec(g.single);
      if (s) { const st = toHour(Number(s[1])) * 60 + Number(s[2] ?? 0); const r = clampRange(st, st + 60); if (r) times.push(r); }
    }
  }
  flush();
  if (carried.length > 0) loose.push(...mergeRanges(carried));
  return { slots: toSlots(byDay), loose, daysOnly: [...daysOnly].filter((d) => !byDay.has(d)) };
}

function timeRangeFromMatch(s: string): [number, number] | null {
  const m = new RegExp(`^${RANGE_RE}$`).exec(s.trim());
  return m ? rangeFrom(m[1] as string, m[2], m[3] as string, m[4]) : null;
}

/** Une faixas novas às que já existem (por dia, sem repetir horários). */
export function mergeSlots(current: readonly AvailabilitySlot[], extra: readonly AvailabilitySlot[]): AvailabilitySlot[] {
  const byDay = new Map<Weekday, [number, number][]>();
  for (const sl of [...current, ...extra]) {
    const r = clampRange(minutesOf(sl.start), minutesOf(sl.end));
    if (r) byDay.set(sl.day, [...(byDay.get(sl.day) ?? []), r]);
  }
  return toSlots(byDay);
}

/** Aplica horários sem dia (`loose`, em minutos) a um dia. */
export function slotsForDay(day: Weekday, ranges: readonly [number, number][]): AvailabilitySlot[] {
  return toSlots(new Map([[day, mergeRanges(ranges)]]));
}

/** Minutos livres de um dia (para saber se uma opção da lista já está toda coberta). */
export function coveredMinutes(slots: readonly AvailabilitySlot[], day: Weekday, from: number, to: number): number {
  let total = 0;
  for (const sl of slots) {
    if (sl.day !== day) continue;
    total += Math.max(0, Math.min(minutesOf(sl.end), to) - Math.max(minutesOf(sl.start), from));
  }
  return total;
}

/** Pedido de correção escrito: tirar dias ("tirar sexta"), trocar os horários de um dia ("na verdade sexta 14h às 16h") ou refazer tudo ("só segunda 8h às 10h"). */
export interface ScheduleEdit { remove: Weekday[]; replaceDays: boolean; replaceAll: boolean }
export function parseScheduleEdit(raw: string): ScheduleEdit {
  const t = normalize(raw.slice(0, 600));
  const parsed = parseScheduleText(raw);
  const mentioned = [...new Set<Weekday>([...parsed.slots.map((x) => x.day), ...parsed.daysOnly])];
  const removing = /\b(tirar|tira|tire|remover|remove|exclui|excluir|apagar|apaga|retirar|retira|cancelar|cancela|sem)\b/.test(t) || /\bnao (posso|consigo|da|vai dar|quero)\b/.test(t);
  const remove = removing && parsed.slots.length === 0 ? mentioned : removing && /\b(tirar|tira|tire|remover|remove|exclui|excluir|apagar|apaga|retirar|retira|cancelar|cancela)\b/.test(t) && !/\d/.test(t) ? mentioned : [];
  const replaceAll = !removing && /\b(so|somente|apenas)\b/.test(t) && parsed.slots.length > 0;
  const replaceDays = !removing && !replaceAll && /\b(trocar|troca|trocando|mudar|muda|corrigir|corrige|alterar|altera|na verdade|errei|errado|em vez|ao inves)\b/.test(t) && parsed.slots.length > 0;
  return { remove, replaceDays, replaceAll };
}
