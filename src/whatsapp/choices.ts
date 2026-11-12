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
