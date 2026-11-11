// Textos do fluxo de mentoria (português). Cada um é UMA mensagem útil (R2).
export const MENTORIA_SERVICE_ID = "mentoria";
export const ROLE_MENTOR_ID = "role_mentor";
export const ROLE_MENTORADO_ID = "role_mentorado";

export const MENTORIA_TEXTS = {
  askRole: "Vamos registrar a mentoria. Você participou como mentor ou como mentorado?",
  roleMentor: "Fui mentor",
  roleMentorado: "Fui mentorado",
  askSubject: "Qual foi o assunto da mentoria? Escreva em poucas palavras.",
  askPartner: "Com quem foi a mentoria? Envie o nome da pessoa.",
  askAudio: "Agora envie o áudio da mentoria. Para cancelar, envie *menu*.",
  hintRole: "Toque em *Fui mentor* ou *Fui mentorado* na mensagem acima, ou envie *menu* para cancelar.",
  hintSubject: "Não consegui ler o assunto. Escreva o assunto da mentoria (de 3 a 200 caracteres).",
  hintPartner: "Não consegui ler o nome. Envie o nome de quem participou da mentoria (de 2 a 100 caracteres).",
} as const;

/** Resposta única depois que o áudio é guardado (a análise acontece depois, no sistema externo). */
export const MENTORIA_SAVED_TEXT =
  "Mentoria registrada! Seu áudio foi guardado. Para registrar outra, toque em Menu.";
