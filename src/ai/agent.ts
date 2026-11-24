// Agente de IA que INTERVÉM quando o bot não entende (ou decide errado). Ele NUNCA escreve para a pessoa:
// só escolhe UMA opção de uma lista fechada; o código executa a ação com a mesma lógica dos botões (e as mesmas
// travas de orçamento, anti-spam e consentimento). Assim a IA não consegue mandar mensagem livre nem gastar vaga extra.
import type { ParsedAvailability } from "./types";
import { MENU_BUTTON_ID } from "../services/menu";
import { DOUBT_NO_ID, DOUBT_YES_ID, RET_AREAS_ID, RET_DOUBT_ID, ROLE_BUTTON_BOTH, ROLE_BUTTON_MENTOR, ROLE_BUTTON_MENTORADO } from "../profile/texts";

export interface IntentOption {
  intent: string;
  description: string;
}
export type FaqResult = { kind: "answer"; text: string } | { kind: "mentor_doubt" } | { kind: "off_topic" };

export interface IntentQuery {
  /** Situação da conversa, em português, para a IA entender o contexto. */
  question: string;
  options: readonly IntentOption[];
  /** Texto da pessoa (já limitado em tamanho; sem nome nem telefone). */
  text: string;
  /** Últimas mensagens da conversa ("pessoa: ...", "atendimento: ..."), curtas e sem nome nem telefone. Opcional. */
  recent?: readonly string[];
}
/** Situações em que o Axo improvisa uma frase curta (o texto fixo continua como reserva). */
export type RiffSituation = "off_topic" | "off_topic_last" | "farewell" | "resume";
export interface RiffQuery {
  situation: RiffSituation;
  /** Texto da pessoa (curto, sem nome nem telefone). */
  text: string;
  /** Linha ESTILO montada pelo código (registro, tamanho, emoji, gírias). */
  style?: string;
  recent?: readonly string[];
}
export interface IntentAgent {
  /**
   * Improvisa UMA fala curta do Axo (descontraída, no registro da pessoa) para a situação. É só o "tempero": o código
   * decide quando falar e acrescenta a pergunta da etapa. `null` = falhou ou saiu estranho (vale o texto fixo).
   */
  riff?(q: RiffQuery): Promise<string | null>;
  /** Devolve o `intent` escolhido (um dos ids de `options`) ou null se não houver certeza/falhar. */
  classify(q: IntentQuery): Promise<string | null>;
  /**
   * Lê dias e horários livres escritos em linguagem natural. `null` = a IA falhou (o bot usa o plano B);
   * `{ slots: [] }` = a IA leu e não encontrou horários.
   */
  extractAvailability?(text: string): Promise<ParsedAvailability | null>;
  /** O texto parece um nome completo REAL de pessoa? `null` = a IA falhou/não teve certeza (vale a regra do bot). */
  judgeName?(name: string): Promise<{ real: boolean } | null>;
  /**
   * Pergunta sobre o PROGRAMA (como funciona o bot/mentoria, cadastro, horários, contato): responde.
   * Dúvida de conteúdo (cálculo, programação...) NÃO é respondida: é para um mentor. Assunto sem relação = `off_topic`.
   */
  answerFaq?(text: string, recent?: readonly string[], extra?: { excerpts?: readonly string[]; step?: string | undefined }): Promise<FaqResult | null>;
  /** Resume em poucas palavras o ASSUNTO de uma mentoria, a partir da dúvida (e do assunto que a pessoa informou). `null` = falhou. */
  summarizeSubject?(doubt: string, informedSubject: string | null): Promise<string | null>;
}

export interface RouteOption extends IntentOption {
  /** Botão que a escolha equivale (executado pela lógica normal). null = manter a decisão do bot. */
  buttonId: string | null;
  /** true = a mensagem não tem a ver com o programa: o bot fica em SILÊNCIO (nada é guardado nem enviado). */
  silent?: boolean;
}
export interface Route {
  question: string;
  /** true = consulta a IA mesmo quando o bot acha que entendeu (ex.: conferir se o texto é mesmo uma dúvida). */
  always: boolean;
  options: readonly RouteOption[];
}

/** Estados em que a IA pode intervir -> opções permitidas. Fora desta tabela, a IA nunca é consultada. */
export const ROUTES: Record<string, Route> = {
  RETURNING_CHOICE: {
    question: "A pessoa já é cadastrada e viu as opções: tirar uma dúvida, mudar as áreas em que dá mentoria, ou abrir o menu de serviços.",
    always: false,
    options: [
      { intent: "tirar_duvida", description: "quer tirar uma dúvida / pedir ajuda de um mentor", buttonId: RET_DOUBT_ID },
      { intent: "mudar_areas", description: "quer mudar, incluir ou dar mentoria em outras áreas (ex.: computação, design, liderança)", buttonId: RET_AREAS_ID },
      { intent: "menu", description: "quer ver o menu de serviços (registrar mentoria, horários, contato)", buttonId: MENU_BUTTON_ID },
    ],
  },
  COMPLETED: {
    question: "A pessoa já concluiu o cadastro e escreveu algo fora das opções. As opções são: tirar uma dúvida, mudar as áreas de mentoria, menu.",
    always: false,
    options: [
      { intent: "tirar_duvida", description: "quer tirar uma dúvida / pedir ajuda de um mentor", buttonId: RET_DOUBT_ID },
      { intent: "mudar_areas", description: "quer mudar, incluir ou dar mentoria em outras áreas", buttonId: RET_AREAS_ID },
      { intent: "menu", description: "quer ver o menu de serviços", buttonId: MENU_BUTTON_ID },
    ],
  },
  DOUBT_ASK: {
    question: "O bot perguntou: \"Você tem uma dúvida agora?\" (Sim ou Não).",
    always: false,
    options: [
      { intent: "tem_duvida", description: "sim, tem uma dúvida agora", buttonId: DOUBT_YES_ID },
      { intent: "sem_duvida", description: "não tem dúvida agora", buttonId: DOUBT_NO_ID },
    ],
  },
  PROFILE_ROLE: {
    question: "O bot perguntou: \"Você quer ser mentor, mentorado ou os dois?\".",
    always: false,
    options: [
      { intent: "mentor", description: "quer ajudar outras pessoas (ser mentor)", buttonId: ROLE_BUTTON_MENTOR },
      { intent: "mentorado", description: "quer receber ajuda (ser mentorado)", buttonId: ROLE_BUTTON_MENTORADO },
      { intent: "ambos", description: "quer os dois: ajudar e receber ajuda", buttonId: ROLE_BUTTON_BOTH },
    ],
  },
  DOUBT_TEXT: {
    question: "O bot pediu para a pessoa descrever a dúvida dela. Confira se o texto é mesmo uma dúvida ou se ela quis dizer outra coisa.",
    always: true,
    options: [
      { intent: "duvida", description: "o texto é uma dúvida ou assunto de estudos, faculdade, carreira ou mentoria em que ela quer ajuda de um mentor", buttonId: null },
      { intent: "fora_do_tema", description: "o texto NÃO tem relação com estudos, faculdade, carreira ou mentoria (ex.: previsão do tempo, piadas, assuntos aleatórios)", buttonId: null, silent: true },
      { intent: "sem_duvida", description: "ela diz que NÃO tem dúvida agora", buttonId: DOUBT_NO_ID },
      { intent: "mudar_areas", description: "ela quer mudar ou incluir áreas em que dá mentoria", buttonId: RET_AREAS_ID },
      { intent: "menu", description: "ela quer ver o menu de serviços", buttonId: MENU_BUTTON_ID },
    ],
  },
};
