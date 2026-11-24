// Comandos de admin pelo WhatsApp para o matching manual (/duvidas, /mentores). Só números de ADMIN_WA_IDS.
// Funções puras (autorização, leitura do comando, textos); a leitura do banco fica em runAdminCommand.
import { maskPhone } from "../lib/logger";
import { CATEGORIES } from "../profile/categories";
import { summarizeSlots, type AvailabilitySlot } from "../ai/types";
import { phoneCandidates } from "../mentoria/parse";
import type { DoubtRow, MentorRow, Repo } from "../db/repo";
import { cancelMatchCommand, confirmMatchCommand, startMatch, type FlowDeps } from "./flow";

export type AdminCommand = { kind: "duvidas" } | { kind: "mentores" } | { kind: "match"; args: string } | { kind: "cancelar"; args: string } | { kind: "confirmar"; args: string } | { kind: "ajuda" };

/** ADMIN_WA_IDS: números E.164 separados por vírgula ("+5511999990000, 5511988887777") -> só dígitos. Inválido = null. */
export function parseAdminIds(raw: string | undefined): string[] | null {
  const parts = (raw ?? "").split(",").map((p) => p.trim()).filter((p) => p !== "");
  const out: string[] = [];
  for (const p of parts) {
    const d = p.replace(/[\s()-]/g, "").replace(/^\+/, "");
    if (!/^\d{8,15}$/.test(d)) return null;
    out.push(d);
  }
  return out;
}

/** O remetente é admin? Compara com e sem o 9º dígito brasileiro (o WhatsApp às vezes entrega sem ele). */
export function isAdmin(waId: string, adminIds: readonly string[]): boolean {
  if (adminIds.length === 0) return false;
  const mine = new Set([waId.replace(/\D/g, ""), ...phoneCandidates(waId)]);
  return adminIds.some((a) => mine.has(a) || phoneCandidates(a).some((c) => mine.has(c)));
}

/** "/duvidas", "/mentores"; qualquer outra mensagem começada em "/" vira ajuda. Texto sem "/" = null (conversa normal). */
export function parseAdminCommand(text: string): AdminCommand | null {
  const t = text.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!t.startsWith("/")) return null;
  const word = t.slice(1).split(/\s+/)[0] ?? "";
  if (word === "duvidas" || word === "duvida") return { kind: "duvidas" };
  if (word === "mentores" || word === "mentor") return { kind: "mentores" };
  const args = t.slice(1 + word.length).trim();
  if (word === "match") return { kind: "match", args };
  if (word === "cancelar") return { kind: "cancelar", args };
  if (word === "confirmar") return { kind: "confirmar", args: args.replace(/\s+/g, " ") };
  return { kind: "ajuda" };
}

export const ADMIN_HELP =
  "Comandos de admin:\n/duvidas — lista as dúvidas abertas (D1, D2...)\n/mentores — lista os mentores cadastrados (M1, M2...)\n/match D12 M3 — liga a dúvida D12 ao mentor M3\n/cancelar 5 — desfaz o match #5\n/confirmar 5 segunda 18-20 [local] — fecha o horário do match #5 e avisa mentor e mentorado";

const LIST_LIMIT = 15;
const MAX_CHARS = 3500;
const labelOf = (k: string): string => CATEGORIES.find((c) => c.key === k)?.label ?? k;
const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** "há 5 min" / "há 3 h" / "há 2 d". */
export function ago(from: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / (24 * 60))} d`;
}

export function renderDoubts(rows: readonly { d: DoubtRow; name: string | null }[], now: Date): string {
  if (rows.length === 0) return "Nenhuma dúvida aberta agora. 🎉";
  const lines = rows.map(({ d, name }) => {
    const cats = d.categories.length > 0 ? ` [${d.categories.map(labelOf).join(", ")}]` : "";
    return `*D${d.seq}* · ${name ?? "sem nome"} (${maskPhone(d.waId)}) · ${ago(d.createdAt, now)}${cats}\n${clip(d.text.replace(/\s+/g, " "), 160)}`;
  });
  return clip(`Dúvidas abertas (${rows.length}):\n\n${lines.join("\n\n")}`, MAX_CHARS);
}

export function renderMentors(rows: readonly MentorRow[]): string {
  if (rows.length === 0) return "Nenhum mentor cadastrado ainda.";
  const lines = rows.map((m) => {
    const cats = m.categories.length > 0 ? m.categories.map(labelOf).join(", ") : "sem áreas";
    const slots = m.slots.length > 0 ? `\n${summarizeSlots(m.slots as AvailabilitySlot[])}` : "\nsem horários informados";
    return `*M${m.seq}* · ${m.name ?? "sem nome"} (${maskPhone(m.waId)})\nÁreas: ${cats}${slots}`;
  });
  return clip(`Mentores (${rows.length}):\n\n${lines.join("\n\n")}`, MAX_CHARS);
}

export interface AdminCmdDeps {
  repo: Repo;
  now: Date;
  /** Quem mandou o comando (vira `created_by` do match). */
  from: string;
  timezone: string;
  adminWaIds?: readonly string[];
  send: FlowDeps["send"];
  logger: FlowDeps["logger"];
}

/** Executa o comando e devolve o texto da resposta (1 mensagem). */
export async function runAdminCommand(cmd: AdminCommand, deps: AdminCmdDeps): Promise<string> {
  switch (cmd.kind) {
    case "duvidas": {
      const doubts = await deps.repo.listOpenDoubts(LIST_LIMIT);
      const rows = await Promise.all(doubts.map(async (d) => ({
        d, name: (await deps.repo.getRegistration(d.waId).catch(() => null))?.values.full_name ?? null,
      })));
      return renderDoubts(rows, deps.now);
    }
    case "mentores":
      return renderMentors(await deps.repo.listMentors(LIST_LIMIT));
    case "match":
      return startMatch(cmd.args, deps.from, deps);
    case "cancelar":
      return cancelMatchCommand(cmd.args, deps);
    case "confirmar":
      return confirmMatchCommand(cmd.args, deps);
    case "ajuda":
      return ADMIN_HELP;
  }
}
