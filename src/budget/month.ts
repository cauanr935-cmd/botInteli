/** month_key "YYYY-MM" no fuso da conta Meta; vira à meia-noite do dia 1 nesse fuso. */
export function monthKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  if (!y || !m) throw new Error("não foi possível calcular month_key");
  return `${y}-${m}`;
}
