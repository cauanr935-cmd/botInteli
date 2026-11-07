// Normalizador de texto (puro). Usado para reconhecer entradas com variações.

/** Emojis com significado, mapeados antes de qualquer limpeza. */
const EMOJI_MEANING: Record<string, string> = {
  "👍": " sim ",
  "👍🏻": " sim ",
  "👍🏼": " sim ",
  "👍🏽": " sim ",
  "👍🏾": " sim ",
  "👍🏿": " sim ",
  "👌": " sim ",
  "✅": " sim ",
  "👎": " nao ",
  "❌": " nao ",
  "🚫": " nao ",
};

/**
 * minúsculas, emoji com significado -> palavra, sem acentos, sem pontuação/emoji,
 * letras repetidas colapsadas ("oiii" -> "oi", "simmm" -> "sim"), espaços colapsados.
 * Letras duplas legítimas também colapsam ("hello" -> "helo"): o dicionário de
 * sinônimos passa pela MESMA função, então a comparação continua consistente.
 */
export function normalizeText(input: string): string {
  let s = String(input);
  for (const [emoji, word] of Object.entries(EMOJI_MEANING)) s = s.split(emoji).join(word);
  s = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/([a-z])\1+/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}
