// Horário real da mentoria (PURO): a pessoa escolhe um horário livre do mentor (ex.: 8h às 20h) e diz de que horas a que horas a
// mentoria vai durar de fato (em média 1 h; mínimo 20 min). Também converte "data local + hora" em instante UTC.

export const MIN_MENTORING_MINUTES = 20;

const pad = (n: number): string => String(n).padStart(2, "0");
export const hhmm = (min: number): string => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const minutesOfHHMM = (t: string): number => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1] ?? 0);

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** "8h às 9h", "das 8 às 8:30", "8h às 8h20", "8 as 8 e 20", "de 8 a 9", "14h30-15h30", "8h por 1 hora", "às 8h, uns 40 minutos". */
function timesIn(raw: string): { starts: number[]; duration: number | null } {
  let t = ` ${fold(raw)} `;
  t = t.replace(/(\d{1,2})\s*e\s*meia\b/g, "$1:30");
  t = t.replace(/(\d{1,2})\s*h\s*(\d{2})\b/g, "$1:$2");
  t = t.replace(/(\d{1,2})\s*e\s*(\d{2})\b(?!\s*(?:min|m\b))/g, "$1:$2");
  // Duração (só vale com UM horário): "por 1 hora", "meia hora", "40 minutos", "1h30 de duração".
  let duration: number | null = null;
  const dur = /(?:por|durante|dura(?:r|cao)?|uns?|umas?)\s+(?:(\d{1,3})\s*(min(?:utos?)?|h(?:oras?)?)|(meia hora|uma hora|1 hora))/.exec(t) ??
    /(\d{1,3})\s*(min(?:utos?)?)\b/.exec(t);
  if (dur) {
    if (dur[3]) duration = dur[3] === "meia hora" ? 30 : 60;
    else if (dur[1] && dur[2]) duration = dur[2].startsWith("m") ? Number(dur[1]) : Number(dur[1]) * 60;
    t = t.replace(dur[0], " ");
  }
  t = t.replace(/(\d{1,2})\s*h\b/g, "$1:00");
  t = t.replace(/(\d{1,2})\s*horas?\b/g, "$1:00");
  const starts: number[] = [];
  for (const m of t.matchAll(/(?<![\d:])(\d{1,2})(?::(\d{2}))?(?![\d:])/g)) {
    let h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h > 23 || mi > 59) continue;
    if (h >= 1 && h <= 7) h += 12; // a faixa do bot é de 8h às 20h: "das 2 às 3" é a tarde
    starts.push(h * 60 + mi);
  }
  return { starts, duration };
}

export type TimeWindow = { ok: true; start: string; end: string } | { ok: false; reason: "unparsed" | "short" | "outside" | "order" };

/**
 * Lê o intervalo da mentoria e confere com a faixa livre do mentor (`slotStart`/`slotEnd`, "HH:MM").
 * Regras: começa antes de terminar, dentro da faixa, com pelo menos 20 minutos.
 */
export function parseMentoringWindow(raw: string, slotStart: string, slotEnd: string): TimeWindow {
  const { starts, duration } = timesIn(raw.slice(0, 200));
  let a: number, b: number;
  if (starts.length >= 2) { a = starts[0] as number; b = starts[1] as number; }
  else if (starts.length === 1 && duration !== null) { a = starts[0] as number; b = a + duration; }
  else return { ok: false, reason: "unparsed" };
  if (b <= a) return { ok: false, reason: "order" };
  if (b - a < MIN_MENTORING_MINUTES) return { ok: false, reason: "short" };
  if (a < minutesOfHHMM(slotStart) || b > minutesOfHHMM(slotEnd)) return { ok: false, reason: "outside" };
  return { ok: true, start: hhmm(a), end: hhmm(b) };
}

/** Diferença (ms) entre o relógio local de `timeZone` e o UTC no instante dado. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value])) as Record<string, string>;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** "2026-11-20" + "08:30" no fuso da conta -> instante UTC. */
export function zonedToUtc(isoDate: string, time: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const mins = minutesOfHHMM(time);
  const guess = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}
