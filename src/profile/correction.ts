// Imprevistos depois de registrar a dúvida: a pessoa diz que a dúvida era OUTRA ("na verdade minha dúvida é como calcular
// um versor") ou que estava brincando / digitou errado. O Axo troca a dúvida registrada (se ainda estiver aberta) ou
// aceita a brincadeira, e segue com a pergunta da etapa. Funções puras (sem I/O).
import { parseScheduleText } from "../schedule/parse";
import { registerOf } from "../axo/voice";
import type { Register } from "../axo/style";
import { classifyDoubt } from "./categories";
import { isMentoringRequest, isNoDoubt } from "./decide";

/** Minúsculas e sem acento, mantendo o MESMO tamanho do texto (para fatiar o original pelo índice). */
const flat = (s: string): string => s.normalize("NFC").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// "na verdade/na realidade/na real ... (minha dúvida) (é/era) <nova dúvida>"
const AFTER_ACTUALLY = /\b(?:na verdade|na realidade|na real|alias|corrigindo|corrigindo:)\b[\s,:;.-]*(?:(?:a |minha |minh |meu )?duvida\s+)?(?:(?:e|eh|era|seria|foi)(?=[\s,:;.-]))?[\s,:;.-]*(.+)$/;
// "minha dúvida é/era <nova dúvida>" (sem "não" entre "dúvida" e o verbo)
const MY_DOUBT_IS = /\b(?:minha|minh|a)\s+duvida\s+(?:e|eh|era|seria|foi)\s+(?!aquela|essa|a primeira|outra)(.+)$/;

function slice(raw: string, flatText: string, m: RegExpExecArray): string {
  const start = flatText.length - m[1]!.length; // o grupo vai até o fim do texto
  return raw.normalize("NFC").slice(start).replace(/^[\s,:;.-]+|["“”'\s]+$/g, "").trim();
}

const looksLikeDoubt = (d: string): boolean => d.length >= 5 && d.length <= 500 && /\p{L}/u.test(d) && !isNoDoubt(d) && d.split(/\s+/).length >= 2;

/** Nova dúvida, se a mensagem corrige a anterior; `null` = não é uma correção. */
export function parseDoubtCorrection(raw: string): string | null {
  const t = flat(raw);
  for (const re of [AFTER_ACTUALLY, MY_DOUBT_IS]) {
    const m = re.exec(t);
    if (m) {
      const d = slice(raw, t, m);
      if (looksLikeDoubt(d)) return d;
    }
  }
  // Sem marcador, mas é claramente uma dúvida (e não dias/horários): "como calcular um versor?".
  if (isMentoringRequest(raw) && parseScheduleText(raw).slots.length === 0 && parseScheduleText(raw).loose.length === 0) {
    const d = raw.replace(/\s+/g, " ").trim();
    if (looksLikeDoubt(d) && classifyDoubt(d).length > 0) return d;
  }
  return null;
}

/** "eu tava zoando", "foi brincadeira", "digitei errado", "sem querer". */
export function isDoubtJoke(raw: string): boolean {
  const t = flat(raw);
  return /\b(zoando|zuando|zoeira|brincando|brincadeira|brincadeirinha|sem querer|digitei errado|digitei errad|errei|era teste|so um teste|foi mal)\b/.test(t) && t.split(" ").length <= 14;
}

const SAVED: Record<Register, (d: string) => string> = {
  casual: (d) => `fechou, troquei a dúvida 🦎 agora tá assim: “${d}”. bora fechar os horários:`,
  neutro: (d) => `Combinado, troquei a dúvida: “${d}”. Vamos fechar os horários:`,
  direto: (d) => `Dúvida atualizada: “${d}”. Falta o horário:`,
};
export const doubtChangedLine = (raw: string, doubt: string): string => SAVED[registerOf(raw)](doubt.length > 140 ? `${doubt.slice(0, 139)}…` : doubt);

const JOKE: Record<Register, string> = {
  casual: "kkk boa, pegou o Axo de surpresa 🦎 se a dúvida que registrei ficou errada, é só me mandar a certa que eu troco. se tá tudo certo, bora de horários:",
  neutro: "Sem problema! Se a dúvida que registrei ficou errada, me mande a certa que eu troco. Se estiver tudo certo, vamos aos horários:",
  direto: "Entendido. Se a dúvida registrada estiver errada, envie a correta. Caso contrário, informe os horários:",
};
export const doubtJokeLine = (raw: string): string => JOKE[registerOf(raw)];

/** Quando já não há dúvida aberta para trocar (já foi encaminhada a um mentor). */
export const doubtLockedLine = (raw: string): string => ({
  casual: "essa dúvida já foi pra um mentor, então não dá pra trocar por aqui 🦎 manda *marcar mentoria* que eu abro uma nova com a dúvida certa.",
  neutro: "Essa dúvida já foi encaminhada a um mentor e não dá para trocar por aqui. Envie *marcar mentoria* para abrir uma nova.",
  direto: "A dúvida já foi encaminhada. Envie *marcar mentoria* para abrir uma nova.",
} as Record<Register, string>)[registerOf(raw)];
