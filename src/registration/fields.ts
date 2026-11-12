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
/** "oi", "sim", "menu"... não são nomes: evita gravar uma saudação como dado. */
const isCommandWord = (s: string): boolean => intentsOf(s).size > 0;

function textBetween(min: number, max: number) {
  return (raw: string): string | null => {
    const v = clean(raw);
    if (v.length < min || v.length > max || !hasLetter(v) || isCommandWord(v) || v.includes("?")) return null; // "?" = pergunta, não nome
    return v;
  };
}

/**
 * Turma do Inteli: tem sempre um número (T27, T26, T24...). Letras sozinhas ("ciência da computação") não servem.
 * Só números muito discrepantes (4 dígitos ou mais seguidos) são recusados; o formato em si é flexível.
 */
export function validClassName(raw: string): string | null {
  const v = clean(raw);
  if (v.length < 2 || v.length > 40 || isCommandWord(v) || v.includes("?")) return null;
  const numbers = v.match(/\d+/g);
  if (!numbers) return null; // só letras
  if (numbers.some((n) => n.length > 3)) return null; // número fora do padrão
  return v;
}

export const FIELDS: readonly FieldDef[] = [
  {
    key: "full_name",
    prompt: "Qual é o seu nome completo?",
    hint: "Não consegui ler o nome. Envie seu nome completo (de 2 a 100 caracteres).",
    validate: textBetween(2, 100),
  },
  {
    key: "class_name",
    prompt: "Qual é a sua turma? (ex.: T27, T26, T24)",
    hint: "Não consegui ler a turma. As turmas têm um número, como T27, T26 ou T24. Envie o nome da sua turma.",
    validate: validClassName,
  },
];

export const FIELD_KEYS: readonly string[] = FIELDS.map((f) => f.key);
