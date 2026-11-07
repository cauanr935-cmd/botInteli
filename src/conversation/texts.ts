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
  menu: "Menu de serviços: escolha uma opção. Para parar de receber mensagens, envie *sair*.",
  audioInstruction: "Envie o seu áudio para análise. Para voltar ao início, envie *menu*.",
  optOutConfirm: "Tudo bem, você não receberá mais mensagens. Se mudar de ideia, envie *voltar*.",
  hintNew: "Para começar, envie *oi*.",
  hintRegistration: "Para continuar, preencha o formulário de cadastro que enviamos acima.",
  hintMenu: "Escolha um serviço no menu acima ou envie *menu* para ver as opções.",
  hintAudio: "Envie um áudio para análise ou envie *menu* para voltar ao início.",
  resumeNew: "Que bom ter você de volta! Para começar, envie *oi*.",
} as const;

export const REPLIES = {
  welcome: text(TEXTS.welcome),
  registrationDone: text(TEXTS.registrationDone),
  menu: text(TEXTS.menu),
  audioInstruction: text(TEXTS.audioInstruction),
  optOutConfirm: text(TEXTS.optOutConfirm),
  hintNew: text(TEXTS.hintNew),
  hintRegistration: text(TEXTS.hintRegistration),
  hintMenu: text(TEXTS.hintMenu),
  hintAudio: text(TEXTS.hintAudio),
  resumeNew: text(TEXTS.resumeNew),
} as const;

/** Todos os textos que o bot pode enviar (varridos pelo teste C3.9). */
export function allBotTexts(): string[] {
  return Object.values(TEXTS);
}
