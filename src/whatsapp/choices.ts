// Botões e listas em texto numerado (fallback do canal Evolution/Baileys).
// Funções puras: não conhecem a Evolution nem a rede. Quem envia é evolutionClient; quem guarda é o Repo.
import type { PendingChoiceOption } from "../db/repo";

/** Opções vivas por 12 h: depois disso um "1" solto volta a ser texto comum. */
export const PENDING_CHOICES_TTL_MS = 12 * 60 * 60 * 1000;

export interface InteractiveShape {
  kind: "button" | "list";
  body: string;
  options: { id: string; title: string; description?: string }[];
  /** Só lista. */
  buttonText?: string;
  sectionTitle?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Lê a mensagem interativa no formato interno (o mesmo dos builders) e devolve a forma neutra. null = não suportada. */
export function describeInteractive(interactive: unknown): InteractiveShape | null {
  if (!isObj(interactive) || !isObj(interactive.body) || typeof interactive.body.text !== "string") return null;
  const body = interactive.body.text;
  const action = isObj(interactive.action) ? interactive.action : null;
  if (!action) return null;
  if (interactive.type === "button" && Array.isArray(action.buttons)) {
    const options = action.buttons.flatMap((b) =>
      isObj(b) && isObj(b.reply) && typeof b.reply.id === "string" && typeof b.reply.title === "string"
        ? [{ id: b.reply.id, title: b.reply.title }] : []);
    return options.length > 0 ? { kind: "button", body, options } : null;
  }
  if (interactive.type === "list" && Array.isArray(action.sections)) {
    const options: InteractiveShape["options"] = [];
    let sectionTitle = "";
    for (const sec of action.sections) {
      if (!isObj(sec)) continue;
      if (!sectionTitle && typeof sec.title === "string") sectionTitle = sec.title;
      for (const r of Array.isArray(sec.rows) ? sec.rows : []) {
        if (isObj(r) && typeof r.id === "string" && typeof r.title === "string") {
          options.push({ id: r.id, title: r.title, ...(typeof r.description === "string" && r.description ? { description: r.description } : {}) });
        }
      }
    }
    return options.length > 0
      ? { kind: "list", body, options, buttonText: typeof action.button === "string" ? action.button : "Opções", sectionTitle: sectionTitle || "Opções" }
      : null;
  }
  return null; // ex.: "flow" (WhatsApp Flows não existe no Baileys)
}

/** Um corpo de texto só: a mensagem continua custando 1 envio (R2). */
export function renderNumbered(shape: InteractiveShape): string {
  const lines = shape.options.map((o, i) => `${i + 1}) ${o.title}${o.description ? ` — ${o.description}` : ""}`);
  return `${shape.body}\n\n${lines.join("\n")}\n\nResponda com o número da opção.`;
}

export function toPending(shape: InteractiveShape): PendingChoiceOption[] {
  return shape.options.map((o) => ({ id: o.id, title: o.title }));
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * Converte o texto da pessoa em uma das opções pendentes: "2", "2)", "opção 2" ou o título exato.
 * Qualquer outra coisa devolve null (segue como texto normal).
 */
export function matchChoice(text: string, options: readonly PendingChoiceOption[]): PendingChoiceOption | null {
  const t = fold(text);
  const m = /^(?:opcao |opção |numero |n )?(\d{1,2})$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= options.length ? (options[n - 1] ?? null) : null;
  }
  return options.find((o) => fold(o.title) === t) ?? null;
}

/**
 * Vários números de uma vez ("1 3 5", "1, 3 e 5"): devolve as opções na ordem digitada, sem repetir.
 * null se houver só um número, texto misto ou número fora da lista (o chamador cai no matchChoice).
 */
export function matchChoices(text: string, options: readonly PendingChoiceOption[]): PendingChoiceOption[] | null {
  // Faixa "1-3" ou "1 a 3" vira 1 2 3 (antes do fold, que apaga o hífen).
  const expanded = text.toLowerCase().replace(/(\d{1,2})\s*(?:-|–|a|até|ate)\s*(\d{1,2})/gu, (_m, a: string, b: string) => {
    const from = Number(a), to = Number(b);
    return to > from && to - from < 12 ? Array.from({ length: to - from + 1 }, (_v, i) => from + i).join(" ") : `${a} ${b}`;
  });
  const t = fold(expanded).replace(/\be\b/g, " ").replace(/\s+/g, " ").trim();
  if (!/^\d{1,2}( \d{1,2})+$/.test(t)) return null;
  const out: PendingChoiceOption[] = [];
  for (const n of t.split(" ").map(Number)) {
    const o = options[n - 1];
    if (!o) return null;
    if (!out.includes(o)) out.push(o);
  }
  return out.length > 1 ? out : null;
}

/** Linhas de controle de uma lista (concluir, refazer, "nenhum desses"): nunca entram numa seleção em bloco. */
export const CONTROL_OPTION_IDS = /^(cat_done|sch_done|sch_reset|sch_dayend|mm_none)$/;

/**
 * Pessoa que COPIA E COLA a lista inteira (ou várias linhas dela), "1) Segunda\n2) Terça ...\nResponda com o número da opção.":
 * vale cada linha "N) título" cujo número existe na lista. Linhas que não são opção (o rodapé, o enunciado) são ignoradas.
 * null = o texto não tem pelo menos 2 linhas de opção (o chamador segue com os outros reconhecedores).
 */
export function matchPastedList(text: string, options: readonly PendingChoiceOption[]): PendingChoiceOption[] | null {
  const out: PendingChoiceOption[] = [];
  let lines = 0;
  for (const raw of text.split(/\r?\n/)) {
    // Tolera "[14:05, 18/11/2026] Axo: " na frente (copiar do histórico), negrito/marcadores e número em emoji ("1️⃣ Segunda").
    const m = /^\s*(?:\[[^\]]{3,40}\][^:\d]{0,40}:\s*)?[*_~\-•]*\s*(\d{1,2})(?:\uFE0F?\u20E3\s*[).:\-–—]?|\s*[).:\-–—])\s*(.+?)\s*$/u.exec(raw);
    if (!m) continue;
    const o = options[Number(m[1]) - 1];
    if (!o) return null;
    lines++;
    if (!out.includes(o)) out.push(o);
  }
  return lines >= 2 && out.length >= 1 ? out : null;
}

/**
 * Resposta digitada a um menu cujas opções o código conhece pelo ESTADO da conversa (sem depender das opções pendentes, que podem
 * ter expirado ou sido apagadas): "1", "opção 2" ou o título. Devolve a opção ou null.
 */
export function typedOption<T extends PendingChoiceOption>(text: string, options: readonly T[]): T | null {
  return matchChoice(text, options) as T | null;
}

/** "todas", "todos", "tudo", "todas as opções", "quero todos": seleciona a lista inteira (sem as linhas de controle). */
export function isSelectAll(text: string): boolean {
  return /^(quero |pode ser |pode |seleciona |marca |manda |escolho )?(todas?|todos|tudo|todas as opcoes|todos os dias|todas as areas|todas as areas)( ai| ae| por favor| pfv| mesmo)?$/.test(fold(text));
}

/**
 * Texto livre que nomeia UMA opção sem ser o título exato ("computacao", "segunda" para "Segunda-feira").
 * Casa por palavras inteiras, sem acento; se mais de uma opção servir, devolve null (a IA desempata).
 */
export function matchChoiceByWords(text: string, options: readonly PendingChoiceOption[]): PendingChoiceOption | null {
  const t = fold(text);
  if (t.length < 3) return null;
  // Linha copiada do menu ("7) Terminei — Já informei todos os dias"): vale o número, se o título bate.
  const copied = /^(\d{1,2}) (.+)$/.exec(t);
  if (copied) {
    const opt = options[Number(copied[1]) - 1];
    if (opt && ` ${copied[2]} `.includes(` ${fold(opt.title)} `)) return opt;
  }
  const padded = ` ${t} `;
  const hits = options.filter((o) => {
    const title = fold(o.title);
    return title !== "" && (` ${title} `.includes(padded) || padded.includes(` ${title} `));
  });
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/** Resposta descontraída quando nem o bot nem a IA entenderam a escolha; repete as opções para a pessoa tentar de novo. */
export function renderNotUnderstood(options: readonly PendingChoiceOption[]): string {
  const lines = options.map((o, i) => `${i + 1}) ${o.title}`);
  return `Eita, não entendi você 😅 Tenta de novo com o número ou o nome da opção:\n\n${lines.join("\n")}`;
}
