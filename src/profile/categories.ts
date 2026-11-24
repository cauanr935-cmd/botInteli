// Áreas de conhecimento (mentor) e classificação simples de dúvidas por palavras-chave (PURO).
// A classificação definitiva é do subagente externo de dúvidas; aqui fica uma triagem inicial para o match.
import { normalizeText } from "../conversation/normalize";

export interface Category { key: string; label: string; keywords: string[] }

export const CATEGORIES: readonly Category[] = [
  { key: "computacao", label: "Computação", keywords: ["computacao", "computador", "redes", "sistema operacional", "linux", "hardware", "banco de dados", "algoritmo", "seguranca", "cloud", "nuvem", "programacao", "codigo", "python", "java", "javascript", "typescript", "html", "css", "react", "api", "bug", "git", "github", "c++", "sql", "programar"] },
  { key: "matematica", label: "Matemática", keywords: ["matematica", "calculo", "algebra", "geometria", "estatistica", "probabilidade", "equacao", "derivada", "integral", "matriz"] },
  { key: "lideranca", label: "Liderança", keywords: ["lideranca", "lider", "equipe", "time de trabalho", "gestao", "gerenciar", "conflito", "comunicacao", "motivar"] },
  { key: "negocios", label: "Negócios", keywords: ["negocio", "negocios", "empresa", "startup", "empreender", "empreendedorismo", "vendas", "marketing", "financeiro", "mercado", "carreira"] },
  { key: "design", label: "Design/UX", keywords: ["design", "figma", "identidade visual", "logo", "tipografia", "cores", "layout", "ux", "usabilidade", "prototipo", "pesquisa com usuario", "experiencia do usuario", "wireframe", "persona"] },
  { key: "vida_academica", label: "Vida Acadêmica", keywords: ["iniciacao cientifica", "monitoria", "bolsa", "prova", "recuperacao", "troca de curso", "faculdade", "curso", "nota", "disciplina", "estudar", "tcc"] },
];

/** Ids das linhas da lista de áreas (seleção em rodadas: uma área por toque, "Concluir" no fim). */
export const CATEGORY_ROW_PREFIX = "cat_";
export const CATEGORY_DONE_ID = "cat_done";
/** Linhas da lista "qual área retirar" (prefixo próprio: não confunde com a escolha de áreas). */
export const REMOVE_ROW_PREFIX = "catrm_";
/** Descrição curta (<= 72) de cada área na lista; Vida Acadêmica traz o resumo da explicação. */
export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  vida_academica: "Iniciação científica, monitoria, bolsas, provas, troca de curso",
};
/** "cat_design" -> "design" (só chaves conhecidas). */
export function categoryFromRowId(id: string): string | null {
  if (!id.startsWith(CATEGORY_ROW_PREFIX)) return null;
  const key = id.slice(CATEGORY_ROW_PREFIX.length);
  return CATEGORIES.some((c) => c.key === key) ? key : null;
}

export const ACADEMIC_LIFE_EXPLANATION =
  "Vida Acadêmica: orientar estudantes em início de curso sobre iniciação científica, monitoria, bolsas de estudo, preparação para provas, recuperação e processos de troca de curso.";

/** Mensagem com as áreas numeradas e a explicação de Vida Acadêmica (cabe em 1 mensagem, <= 1024). */
export function categoriesPrompt(): string {
  const list = CATEGORIES.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
  return `Em quais áreas você topa ajudar? Responda com os números ou nomes, separados por vírgula (ex.: 1, 3, 6).\n\n${list}\n\n${ACADEMIC_LIFE_EXPLANATION}`;
}

/** Palavras e apelidos que a pessoa costuma escrever para cada área (já sem acento), além do próprio nome. */
const CATEGORY_ALIASES: Record<string, readonly string[]> = {
  computacao: ["comp", "computacao", "computador", "ti", "tech", "dev", "programacao", "programar", "codigo", "python", "java", "javascript", "typescript", "web", "redes", "software", "hardware", "sql", "dados", "ia"],
  matematica: ["mat", "matematica", "calculo", "algebra", "geometria", "estatistica", "probabilidade", "matriz", "derivada", "integral"],
  lideranca: ["lider", "lideranca", "gestao", "equipe", "liderar"],
  negocios: ["negocio", "negocios", "empreendedorismo", "empreender", "startup", "vendas", "marketing", "financas", "adm", "administracao"],
  design: ["design", "ux", "ui", "figma", "designer"],
  vida_academica: ["vida", "academica", "academico", "monitoria", "bolsa", "bolsas", "tcc", "ic", "faculdade"],
};

/** Distância de edição até 1 (troca, falta ou sobra de uma letra): perdoa "computaçao", "matemtica", "lideranca". */
function nearly(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  let i = 0, j = 0, diffs = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diffs > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return diffs + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Lê as áreas escolhidas: números ("1, 3"), nomes ("computação, matemática"), apelidos ("comp e mat", "programação, cálculo"),
 * com erro de digitação, vírgula, "e", barra ou quebra de linha. Devolve as chaves, sem repetição (vazio = nada reconhecido).
 */
export function parseCategories(raw: string): string[] {
  const norm = normalizeText(raw);
  const found = new Set<string>();
  for (const tok of norm.split(" ")) {
    if (/^[1-6]$/.test(tok)) found.add(CATEGORIES[Number(tok) - 1]!.key);
  }
  for (const c of CATEGORIES) {
    const label = normalizeText(c.label);
    if (norm.includes(label)) found.add(c.key);
  }
  if (/\btodas( as areas)?\b/.test(norm)) for (const c of CATEGORIES) found.add(c.key);
  if (/\bvida academica\b|\bacademic/.test(norm)) found.add("vida_academica");
  if (/\bux\b|\bdesign\b/.test(norm)) found.add("design");
  // Palavra por palavra: apelido exato, início de palavra (comput…, matem…) ou uma letra errada.
  for (const tok of norm.split(" ")) {
    if (tok.length < 2) continue;
    for (const c of CATEGORIES) {
      const words = [...(CATEGORY_ALIASES[c.key] ?? []), ...normalizeText(c.label).split(" ")];
      if (words.some((w) => w === tok || (tok.length >= 4 && w.startsWith(tok)) || nearly(tok, w))) found.add(c.key);
    }
  }
  return CATEGORIES.map((c) => c.key).filter((k) => found.has(k));
}

/** Triagem da dúvida por palavras-chave. Sem acerto: lista vazia (o subagente externo categoriza depois). */
export function classifyDoubt(text: string): string[] {
  const norm = ` ${normalizeText(text)} `;
  return CATEGORIES.filter((c) => c.keywords.some((k) => norm.includes(` ${normalizeText(k)} `) || (k.length >= 5 && norm.includes(normalizeText(k))))).map((c) => c.key);
}
