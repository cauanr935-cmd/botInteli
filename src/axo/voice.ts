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
const OR: Record<Step, string> = { days: "digite o número de um dia da lista", hours: "digite o número de um horário da lista" };

/** Acolhe o desabafo (1 frase) e volta a pedir só o horário, com a saída por botão. */
export function ventScheduleHint(raw: string, step: Step): string {
  const ask = EX[step];
  switch (registerOf(raw)) {
    case "casual":
      return `puxado mesmo, tudo se regenera por aqui. me diz só um respiro que sobra pra mentoria, tipo ${ask}. ou ${OR[step]}.`;
    case "direto":
      return `Entendido, semana pesada. Passe só o horário livre, ex.: ${ask}. Ou ${OR[step]}.`;
    default:
      return `Imagino, o Learning Backlog pesa mesmo. Me diz só quando sobra um respiro, tipo ${ask}. Se preferir, ${OR[step]}.`;
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
  {
    casual: "eita, não peguei o que você quis dizer 😅 me explica de outro jeito? se for dúvida ou mentoria, eu tô dentro.",
    neutro: "Não consegui entender o que você quis dizer. Pode explicar de outro jeito? Se for dúvida ou mentoria, eu ajudo.",
    direto: "Não entendi. O que você quis dizer?",
  },
  {
    casual: "hmm, essa eu não saquei 🦎 o que você quis dizer? resenha eu até curto, mas aqui o foco é mentoria.",
    neutro: "Essa eu não saquei. O que você quis dizer? Resenha eu até curto, mas aqui o foco é mentoria.",
    direto: "Não compreendi. Reescreva, por favor, o que você precisa.",
  },
  {
    casual: "essa escapou das minhas brânquias 🦎 me explica de outro jeito? se for dúvida ou mentoria, eu mergulho junto.",
    neutro: "Essa escapou das minhas brânquias. Pode explicar de outro jeito? Se for dúvida ou mentoria, eu mergulho junto.",
    direto: "Não captei. Explique de outro jeito o que você precisa.",
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
  // Só emoji, figura ou pontuação também ganha resposta (nunca silêncio de cara): pede para escrever.
  if (!/[a-zà-ú]{2,}/i.test(raw)) return slotsLeft === 1 ? OFF_TOPIC_LAST.casual : "hmm, não entendi esse aí 😅 o que você quis dizer? me escreve em palavras que eu te ajudo.";
  const register = registerOf(raw);
  if (slotsLeft === 1) return OFF_TOPIC_LAST[register];
  return OFF_TOPIC[Math.abs(variant) % OFF_TOPIC.length]![register];
}

// ---------------------------------------------------------------------------------------------------------------------
// Saudação no meio de uma etapa ("oi", "tá por aí?", "alô"): a pessoa NUNCA fica sem feedback. O bot confirma que está
// vivo e repete o que está esperando dela (a pergunta da etapa vai logo abaixo, montada pelo motor).

const RESUME: readonly Record<Register, string>[] = [
  {
    casual: "opa, tô por aqui sim! 🦎 a gente tava no meio de uma coisa, então me responde isso pra eu seguir:",
    neutro: "Oi! Estou por aqui. Ficou uma pergunta pendente, então responda a esta para eu continuar:",
    direto: "Estou aqui. Falta responder:",
  },
  {
    casual: "continuo aqui, firme! falta só você responder isso:",
    neutro: "Continuo aqui. Falta só responder isto:",
    direto: "Pendente:",
  },
  {
    casual: "bora retomar de onde a gente parou? é só responder aqui:",
    neutro: "Vamos concluir esta etapa? É só responder abaixo:",
    direto: "Responda abaixo para continuarmos:",
  },
  {
    casual: "tô aqui, de brânquias abertas! 🦎 só falta você responder isso pra gente seguir:",
    neutro: "Estou aqui, de brânquias abertas. Só falta responder isto para seguirmos:",
    direto: "Estou aqui. Falta apenas:",
  },
];

/** Abertura da mensagem que retoma a etapa pendente. `variant` alterna para não repetir a mesma fala. */
export function resumeLead(raw: string, variant = 0): string {
  return RESUME[Math.abs(variant) % RESUME.length]![registerOf(raw)];
}

/** Saudação quando não há pergunta pendente (fim do fluxo, etc.): mostra o que dá para fazer. */
export function idleGreeting(raw: string): string {
  return ({
    casual: "opa, tô por aqui! 🦎 quer tirar uma dúvida ou mexer em alguma coisa? manda *menu* que eu mostro as opções.",
    neutro: "Oi, estou por aqui! Quer tirar uma dúvida ou ajustar algo? Envie *menu* para ver as opções.",
    direto: "Estou aqui. Envie *menu* para ver as opções ou escreva sua dúvida.",
  } as Record<Register, string>)[registerOf(raw)];
}

export const OPTED_OUT_GREETING = "Oi! Você pausou as mensagens por aqui. Se quiser voltar, é só mandar *voltar*. 🦎";
export const PROCESSING_GREETING = "Tô por aqui! 🦎 Ainda estou cuidando do seu áudio, já já te respondo.";

/** Resposta a "valeu"/"tchau" depois do fim do fluxo (vem junto de uma figurinha de despedida). */
const FAREWELL: Record<Register, string>[] = [
  { casual: "vlw! 🦎 qualquer coisa é só chamar.", neutro: "Valeu! 🦎 Qualquer coisa, é só chamar.", direto: "Combinado. Qualquer coisa, é só chamar." },
  { casual: "tamo junto! 🦎 bons estudos.", neutro: "Tamo junto! 🦎 Bons estudos.", direto: "Até mais. Bons estudos." },
  { casual: "fechou! 🦎 me chama se precisar.", neutro: "Fechou! 🦎 Me chame se precisar.", direto: "Fechado. Me chame se precisar." },
  { casual: "vai com calma que tudo se regenera: ponderada, sprint, tudo. me chama quando precisar 🦎", neutro: "Vai com calma, que tudo se regenera: ponderada, sprint, tudo. Me chame quando precisar. 🦎", direto: "Até a próxima. Me chame quando precisar." },
];
export function farewellText(raw: string, variant = 0): string {
  return FAREWELL[Math.abs(variant) % FAREWELL.length]![registerOf(raw)];
}
