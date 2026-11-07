// Campos do cadastro: o ÚNICO lugar para trocar/acrescentar campos (provisórios; ver DECISOES.md).
// Para trocar: edite FIELDS, a migração das colunas e flows/cadastro.json (o teste C4.6 confere os três).
import { intentsOf } from "../conversation/synonyms";

export interface FieldDef {
  /** Chave: nome da coluna em `users` e do campo no formulário (Flow). */
  key: string;
  /** Pergunta no modo sem formulário (fallback). */
  prompt: string;
  /** Dica única quando o valor é inválido. */
  hint: string;
  /** Devolve o valor normalizado ou null se inválido. */
  validate: (raw: string) => string | null;
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
const hasLetter = (s: string): boolean => /\p{L}/u.test(s);
/** "oi", "sim", "menu"... não são nome nem cidade: evita gravar uma saudação como dado. */
const isCommandWord = (s: string): boolean => intentsOf(s).size > 0;

function textBetween(min: number, max: number) {
  return (raw: string): string | null => {
    const v = clean(raw);
    if (v.length < min || v.length > max || !hasLetter(v) || isCommandWord(v)) return null;
    return v;
  };
}

export function validateEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v.length > 254 || /\s/.test(v)) return null;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/.test(v) ? v : null;
}

export const FIELDS: readonly FieldDef[] = [
  {
    key: "full_name",
    prompt: "Qual é o seu nome completo?",
    hint: "Não consegui ler o nome. Envie seu nome completo (de 2 a 100 caracteres).",
    validate: textBetween(2, 100),
  },
  {
    key: "email",
    prompt: "Qual é o seu e-mail?",
    hint: "Esse e-mail não parece válido. Envie no formato nome@exemplo.com.",
    validate: validateEmail,
  },
  {
    key: "city",
    prompt: "Em qual cidade você mora?",
    hint: "Não consegui ler a cidade. Envie o nome da sua cidade (de 2 a 80 caracteres).",
    validate: textBetween(2, 80),
  },
];

export const FIELD_KEYS: readonly string[] = FIELDS.map((f) => f.key);
