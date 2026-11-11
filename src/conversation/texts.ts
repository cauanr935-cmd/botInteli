import { MENU_FALLBACKS, menuReply } from "../services/menu";
import type { Content } from "../services/content";

// Textos do bot (português). Cada texto é UMA mensagem útil: nada de "aguarde",
// "processando" ou "recebi seu áudio" como mensagem separada (R2).

export type Reply =
  | { type: "text"; text: { body: string } }
  | { type: "interactive"; interactive: unknown };

const text = (body: string): Reply => ({ type: "text", text: { body } });

export const TEXTS = {
  welcome:
    "Olá! Que bom ter você aqui. Vamos fazer o seu cadastro rápido para liberar os serviços. Para parar de receber mensagens, envie *sair*.",
  registrationDone:
    "Cadastro concluído! Escolha um serviço no menu. Para parar de receber mensagens, envie *sair*.",
  menu: MENU_FALLBACKS.menu,
  audioInstruction: "Anexe o arquivo de áudio da mentoria. Para voltar ao início, envie *menu*.",
  optOutConfirm: "Tudo bem, você não receberá mais mensagens. Se mudar de ideia, envie *voltar*.",
  hintNew: "Para começar, envie *oi*.",
  hintRegistration: "Para continuar, preencha o formulário de cadastro que enviamos acima.",
  hintMenu: "Escolha um serviço no menu acima ou envie *menu* para ver as opções.",
  hintAudio: "Anexe o arquivo de áudio da mentoria ou envie *menu* para voltar ao início.",
  audioInvalid: "Não consegui usar esse arquivo. Envie um áudio (nota de voz ou arquivo de áudio) menor, ou envie *menu* para voltar ao início.",
  audioFailed: "Não consegui guardar o seu áudio agora. Envie o áudio de novo ou envie *menu* para voltar ao início.",
  audioResultFallback: "Análise concluída.",
  askAvailability: "Informe os seus dias e horários livres para mentorias (ex.: segunda e quarta, 14h às 18h). Para cancelar, envie *menu*.",
  hintAvailability: "Não consegui identificar os dias e horários. Escreva, por exemplo: segunda e quarta, das 14h às 18h. Ou envie *menu* para cancelar.",
  availabilitySaved: "Horários registrados! Para voltar ao início, toque em Menu.",
  resumeNew: "Que bom ter você de volta! Para começar, envie *oi*.",
} as const;

/** Resposta montada a partir do conteúdo (banco + fallback). */
export type ReplyFn = (c: Content) => Reply;

const fromKey = (key: keyof typeof TEXTS): ReplyFn => (c) => text(c.text(key, TEXTS[key]));

export const REPLIES = {
  welcome: fromKey("welcome"),
  registrationDone: fromKey("registrationDone"),
  menu: ((c) => menuReply(c)) as ReplyFn,
  audioInstruction: fromKey("audioInstruction"),
  optOutConfirm: fromKey("optOutConfirm"),
  hintNew: fromKey("hintNew"),
  hintRegistration: fromKey("hintRegistration"),
  hintMenu: fromKey("hintMenu"),
  askAvailability: fromKey("askAvailability"),
  hintAvailability: fromKey("hintAvailability"),
  hintAudio: fromKey("hintAudio"),
  resumeNew: fromKey("resumeNew"),
  audioInvalid: fromKey("audioInvalid"),
  audioFailed: fromKey("audioFailed"),
} as const;

/** Todos os textos que o bot pode enviar (varridos pelo teste C3.9). */
export function allBotTexts(): string[] {
  return Object.values(TEXTS);
}
