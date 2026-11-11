// Tipos da leitura de horários por IA (sem dependências: usados pela decisão pura e pelo cliente).
export const WEEKDAYS = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  segunda: "Segunda", terca: "Terça", quarta: "Quarta", quinta: "Quinta", sexta: "Sexta", sabado: "Sábado", domingo: "Domingo",
};

export interface AvailabilitySlot {
  day: Weekday;
  /** "HH:MM" (24h) */
  start: string;
  end: string;
}
export interface ParsedAvailability {
  slots: AvailabilitySlot[];
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const toMin = (t: string): number => { const m = HHMM.exec(t)!; return Number(m[1]) * 60 + Number(m[2]); };
const pad = (t: string): string => { const m = HHMM.exec(t)!; return `${m[1]!.padStart(2, "0")}:${m[2]}`; };

/** Valida o que a IA devolveu: dia conhecido, HH:MM, início < fim, sem repetição, no máximo 21 faixas. */
export function sanitizeSlots(raw: unknown): AvailabilitySlot[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AvailabilitySlot[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const day = typeof o.dia === "string" ? o.dia.trim().toLowerCase() : typeof o.day === "string" ? o.day.trim().toLowerCase() : "";
    const start = String(o.inicio ?? o.start ?? "").trim();
    const end = String(o.fim ?? o.end ?? "").trim();
    if (!(WEEKDAYS as readonly string[]).includes(day) || !HHMM.test(start) || !HHMM.test(end)) continue;
    if (toMin(start) >= toMin(end)) continue;
    const slot: AvailabilitySlot = { day: day as Weekday, start: pad(start), end: pad(end) };
    const key = `${slot.day}|${slot.start}|${slot.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
    if (out.length >= 21) break;
  }
  const order = (d: Weekday): number => WEEKDAYS.indexOf(d);
  return out.sort((a, b) => order(a.day) - order(b.day) || a.start.localeCompare(b.start));
}

/** "14:00" -> "14h"; "14:30" -> "14h30". */
export const fmtHour = (t: string): string => { const [h, m] = t.split(":"); return `${Number(h)}h${m === "00" ? "" : m}`; };

/** Texto legível, uma linha por dia: "Segunda: 14h às 18h, 19h às 21h". */
export function summarizeSlots(slots: readonly AvailabilitySlot[]): string {
  const byDay = new Map<Weekday, string[]>();
  for (const s of slots) byDay.set(s.day, [...(byDay.get(s.day) ?? []), `${fmtHour(s.start)} às ${fmtHour(s.end)}`]);
  return WEEKDAYS.filter((d) => byDay.has(d)).map((d) => `• ${WEEKDAY_LABEL[d]}: ${byDay.get(d)!.join(", ")}`).join("\n");
}
