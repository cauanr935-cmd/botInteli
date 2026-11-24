// Dicionário de sinônimos: o ÚNICO lugar para editar o que o bot reconhece.
// As entradas passam por normalizeText ao carregar, então podem ser escritas
// com acento e pontuação normais.
import { normalizeText } from "./normalize";

export type Intent = "greeting" | "yes" | "no" | "menu" | "quit" | "resume";

export const SYNONYMS: Record<Intent, string[]> = {
  greeting: [
    "oi", "ola", "olá", "opa", "e ai", "e aí", "eae", "bom dia", "boa tarde", "boa noite",
    "hey", "hello", "inicio", "início", "começar", "comecar",
    // "tá por aí?", "alô", "tem alguém?": quem volta a puxar assunto sem dizer o que quer.
    "alo", "alô", "ei", "eai", "iae", "hi", "oie", "fala", "fala aí", "salve", "tudo bem", "td bem", "tudo bom", "como vai", "como vai você",
    "tá aí", "ta ai", "tá por aí", "ta por ai", "tá on", "ta on", "tem alguém", "tem alguem", "tem alguém aí", "tem alguem ai", "alguém aí", "alguem ai",
    "cadê você", "cade voce", "voltei", "to aqui", "tô aqui", "bom dia a todos", "boa tarde a todos",
  ],
  yes: ["sim", "s", "ok", "aceito", "concordo", "claro", "pode", "👍"],
  no: ["nao", "não", "n", "recuso", "👎"],
  menu: ["menu", "voltar", "inicio", "início", "opcoes", "opções"],
  quit: ["sair", "parar", "cancelar", "stop"],
  // Só vale no estado OPTED_OUT.
  resume: ["voltar", "retomar", "reativar"],
};

const NORMALIZED: Record<Intent, Set<string>> = Object.fromEntries(
  (Object.keys(SYNONYMS) as Intent[]).map((k) => [k, new Set(SYNONYMS[k].map(normalizeText))]),
) as Record<Intent, Set<string>>;

/** Saudações compostas ("oi bom dia") também contam como saudação. */
function isGreetingSequence(norm: string): boolean {
  const tokens = norm.split(" ");
  const phrases = [...NORMALIZED.greeting];
  const memo = new Map<number, boolean>();
  const cover = (i: number): boolean => {
    if (i === tokens.length) return true;
    const cached = memo.get(i);
    if (cached !== undefined) return cached;
    let ok = false;
    for (const p of phrases) {
      const pt = p.split(" ");
      if (pt.every((t, j) => tokens[i + j] === t) && cover(i + pt.length)) {
        ok = true;
        break;
      }
    }
    memo.set(i, ok);
    return ok;
  };
  return norm !== "" && cover(0);
}

/** Todas as intenções que o texto representa (pode ser mais de uma, ex.: "inicio"). */
export function intentsOf(text: string): Set<Intent> {
  const norm = normalizeText(text);
  const out = new Set<Intent>();
  if (norm === "") return out;
  for (const k of Object.keys(NORMALIZED) as Intent[]) if (NORMALIZED[k].has(norm)) out.add(k);
  if (!out.has("greeting") && isGreetingSequence(norm)) out.add("greeting");
  return out;
}
