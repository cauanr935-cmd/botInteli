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

/** Lê as áreas escolhidas ("1, 3", "programação e design"). Devolve as chaves, sem repetição (vazio = nada reconhecido). */
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
  if (/\bvida academica\b|\bacademic/.test(norm)) found.add("vida_academica");
  if (/\bux\b|\bdesign\b/.test(norm)) found.add("design");
  return CATEGORIES.map((c) => c.key).filter((k) => found.has(k));
}

/** Triagem da dúvida por palavras-chave. Sem acerto: lista vazia (o subagente externo categoriza depois). */
export function classifyDoubt(text: string): string[] {
  const norm = ` ${normalizeText(text)} `;
  return CATEGORIES.filter((c) => c.keywords.some((k) => norm.includes(` ${normalizeText(k)} `) || (k.length >= 5 && norm.includes(normalizeText(k))))).map((c) => c.key);
}
