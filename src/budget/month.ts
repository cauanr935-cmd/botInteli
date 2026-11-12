/** month_key "YYYY-MM" no fuso configurado (legado do orçamento mensal da Meta; o limitador atual usa dayKey). */
export function monthKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  if (!y || !m) throw new Error("não foi possível calcular month_key");
  return `${y}-${m}`;
}

/** "YYYY-MM-DD" no fuso configurado: chave do contador anti-flood (vira à meia-noite desse fuso). */
export function dayKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)?.value;
  if (!g("year") || !g("month") || !g("day")) throw new Error("não foi possível calcular day_key");
  return `${g("year")}-${g("month")}-${g("day")}`;
}
