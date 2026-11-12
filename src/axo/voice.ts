// Voz do Axo nas falas prontas (sem LLM): reconhece desabafo e responde acolhendo, no registro da pessoa.
// Brand Book: colega veterano, humor leve, sem fingir empolgação, "uma pergunta por mensagem".
import { normalizeText } from "../conversation/normalize";
import { measureSignals, registerScore, scoreToRegister, type Register } from "./style";

/** A pessoa está desabafando (cansaço, sobrecarga, falta de tempo) em vez de responder à pergunta. */
export function isVent(raw: string): boolean {
  const t = normalizeText(raw);
  return /\b(puxad[oa]s?|corrid[oa]s?|pesad[oa]s?|cansad[oa]s?|cansaco|exaust\w*|estressad[oa]s?|sobrecarreg\w*|apertad[oa]s?|loucura|caos|de saco cheio|nao aguento|to morrendo|tô morrendo)\b/.test(t) ||
    /\b(sem|nao tenho|falta de) tempo\b/.test(t) || /\bmuita (coisa|entrega|atividade|prova)\b/.test(t);
}

/** Registro da mensagem (casual / neutro / direto), medido só nela. */
export function registerOf(raw: string): Register {
  return scoreToRegister(registerScore(measureSignals(raw)));
}

type Step = "days" | "hours";

const EX: Record<Step, string> = {
  days: "\"quarta à tarde\" ou \"sexta das 14h às 16h\"",
  hours: "\"de manhã\" ou \"das 14h às 16h\"",
};
const OR: Record<Step, string> = { days: "*Escolher dias*", hours: "*Escolher horários*" };

/** Acolhe o desabafo (1 frase) e volta a pedir só o horário, com a saída por botão. */
export function ventScheduleHint(raw: string, step: Step): string {
  const ask = EX[step];
  switch (registerOf(raw)) {
    case "casual":
      return `puxado mesmo, tudo se regenera por aqui. me diz só um respiro que sobra pra mentoria, tipo ${ask}. ou toca em ${OR[step]}.`;
    case "direto":
      return `Entendido, semana pesada. Passe só o horário livre, ex.: ${ask}. Ou toque em ${OR[step]}.`;
    default:
      return `Imagino, o Learning Backlog pesa mesmo. Me diz só quando sobra um respiro, tipo ${ask}. Se preferir, toque em ${OR[step]}.`;
  }
}

/** Acolhimento que antecede as opções quando, no fim do fluxo, a pessoa desabafa. */
export function ventNudgeIntro(raw: string): string {
  switch (registerOf(raw)) {
    case "casual": return "puxado mesmo, mas ninguém se regenera sozinho. dá pra eu te ligar a um veterano que já passou por isso.";
    case "direto": return "Entendido. Posso te ligar a um veterano que já passou por isso.";
    default: return "Imagino, tá pesado. Por aqui eu ligo você a um veterano que já passou por isso.";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Assunto fora do escopo: aviso descontraído (substitui o silêncio). Política:
//   - nunca fica mudo de cara: a pessoa recebe um aviso antes de qualquer silêncio, mesmo que o cadastro já tenha gasto vagas;
//   - o aviso usa as vagas que sobram dentro dos limites por pessoa (R2): a ÚLTIMA vaga é sempre a despedida
//     ("vou ficar na minha"), então o silêncio que vem depois nunca é surpresa;
//   - se a pessoa insistir além disso, aí sim silêncio: o teto protege o orçamento (R1) e o anti-spam (R2).

const OFF_TOPIC: readonly Record<Register, string>[] = [
  {
    casual: "opa, aqui não é lugar de resenha, não 🦎 esse papo é pro grupo do Inteli ou pra mesa da biblioteca. por aqui eu cuido de mentoria, e nisso eu me garanto.",
    neutro: "Aqui não é lugar de resenha, hein. Esse papo rende mais no grupo do Inteli ou na biblioteca. Por aqui eu cuido de mentoria.",
    direto: "Isso foge do que eu faço: aqui é só mentoria. O resto fica pro grupo da turma.",
  },
  {
    casual: "kkk eu até ficaria de resenha, mas meu negócio aqui é mentoria. guarda esse papo pro intervalo e me diz se rola ajudar com alguma matéria.",
    neutro: "Eu até toparia essa resenha, mas meu negócio aqui é mentoria. Guarda esse papo pro intervalo e me diz se posso ajudar com alguma matéria.",
    direto: "Fora do meu escopo. Se tiver dúvida de alguma matéria, me fala que eu te ligo a um veterano.",
  },
];

/** Despedida: sai na última vaga de mensagens, avisando que o silêncio vem aí e como me chamar de volta. */
const OFF_TOPIC_LAST: Record<Register, string> = {
  casual: "tô te ouvindo, mas fora de mentoria eu não rendo. vou ficar na minha por um tempo; quando quiser falar de dúvida ou mentoria é só chamar 🦎",
  neutro: "Estou te ouvindo, mas fora de mentoria eu não rendo. Vou ficar quieto por um tempo; quando quiser falar de dúvida ou mentoria, é só chamar.",
  direto: "Vou ficar em silêncio sobre esse assunto. Para dúvida ou mentoria, é só chamar.",
};

/**
 * Aviso para um texto que o bot não trata. `null` = fica em silêncio (mensagem sem texto útil ou nenhuma vaga restante).
 * `slotsLeft` = quantas mensagens do bot ainda cabem nos limites por pessoa (10 min e dia); `variant` alterna a fala
 * para nunca repetir a mesma duas vezes seguidas.
 */
export function offTopicNotice(raw: string, slotsLeft: number, variant = 0): string | null {
  if (slotsLeft < 1) return null;
  if (!/[a-zà-ú]{2,}/i.test(raw)) return null; // só emoji, pontuação ou "k": não vale um aviso
  const register = registerOf(raw);
  if (slotsLeft === 1) return OFF_TOPIC_LAST[register];
  return OFF_TOPIC[Math.abs(variant) % OFF_TOPIC.length]![register];
}
