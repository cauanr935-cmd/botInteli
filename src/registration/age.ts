// Faixa de idade do Be My Mentor: de 17 a 25 anos. A idade NÃO é gravada (só decide se o cadastro segue).
export const MIN_AGE = 17;
export const MAX_AGE = 25;

/** Lê a idade: "20", "tenho 20 anos", ano de nascimento ("2004") ou data ("12/03/2004"). null = não deu para entender. */
export function parseAge(raw: string, now: Date): number | null {
  const t = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (t === "" || t.length > 60 || t.includes("?")) return null;
  const date = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
  if (date) {
    const d = Number(date[1]), m = Number(date[2]), y = Number(date[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > now.getUTCFullYear()) return null;
    let age = now.getUTCFullYear() - y;
    if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
    return age;
  }
  const nums = t.match(/\d+/g);
  if (!nums || nums.length !== 1) return null;
  const n = Number(nums[0]);
  if (/^\d{4}$/.test(nums[0] as string)) return n >= 1900 && n <= now.getUTCFullYear() ? now.getUTCFullYear() - n : null;
  return n >= 1 && n <= 120 ? n : null;
}

export type AgeVerdict = "ok" | "young" | "liar26" | "old";
export const ageVerdict = (age: number): AgeVerdict =>
  age < MIN_AGE ? "young" : age === 26 ? "liar26" : age > MAX_AGE ? "old" : "ok";
