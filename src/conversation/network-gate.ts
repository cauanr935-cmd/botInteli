// Guardrail de abertura da rede: ATÉ `openAt` as pessoas podem se cadastrar (mentor, mentorado, horários, perfil), mas NÃO podem
// pedir mentoria (dúvida, "Marcar nova mentoria"). Só os números de acesso antecipado (`allow`) passam. Sem `openAt` = rede aberta.
// Puro: o horário chega por parâmetro. O bot nunca avisa por conta própria quando a rede abre (R1: só responde a quem escreve).
import { isAdmin } from "../matching/admin";

export interface NetworkGate {
  /** Instante em que a rede abre para todos. */
  openAt: Date;
  /** Números (E.164, só dígitos) liberados antes da abertura. */
  allow: readonly string[];
}

/** A rede está fechada PARA ESTA PESSOA agora? */
export function isNetworkClosed(gate: NetworkGate | undefined, waId: string, now: Date): boolean {
  if (!gate || now.getTime() >= gate.openAt.getTime()) return false;
  return !isAdmin(waId, gate.allow); // mesmo casamento de telefone dos admins (com/sem 55 e 9º dígito)
}

/** Estados e efeitos que significam "a pessoa está pedindo uma mentoria". */
export const isMentoringRequestState = (s: string): boolean => s === "DOUBT_ASK" || s === "DOUBT_TEXT" || /^SCHED_(DAYS|HOURS|CONFIRM)_doubt(_|$)/.test(s);

const WEEKDAY = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "segunda-feira (23/11)" no fuso da conta. */
export function openingLabel(openAt: Date, timezone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(openAt).map((x) => [x.type, x.value])) as Record<string, string>;
  const dow = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
  return `${WEEKDAY[dow]} (${p.day}/${p.month})`;
}

export function closedNetworkText(gate: NetworkGate, timezone: string): string {
  return `Seu cadastro está valendo! 🦎 A rede da Be My Mentor abre na ${openingLabel(gate.openAt, timezone)}. Até lá dá pra se cadastrar, mas ainda não dá pra pedir mentoria. Quando abrir, é só me chamar que eu te ajudo a marcar. 💙`;
}
