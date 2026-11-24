// Textos do cadastro (português). Cada um é UMA mensagem útil (R2).
export const REG_TEXTS = {
  flowWelcome:
    "Olá! Que bom ter você aqui. Para liberar os serviços, responda com o número da opção e preencha o cadastro rápido. Para parar de receber mensagens, envie *sair*.",
  flowCta: "Fazer cadastro",
  // O link do termo é acrescentado por quem monta a mensagem.
  consentWelcome:
    "Olá! Que bom ter você aqui. Para fazer o cadastro, precisamos do seu consentimento (LGPD) para tratar seus dados (nome, turma, áudios, dúvidas e mensagens), inclusive com inteligência artificial e serviços que podem ficar fora do Brasil, para conectar mentores e mentorados e validar horas complementares. Termos de uso e política de privacidade:",
  consentAfterLink: "Digite *1* para aceitar e continuar.",
  consentButton: "Aceito",
  hintConsent: "Para continuar, digite *1* (Aceito) conforme a mensagem acima. Para parar de receber mensagens, envie *sair*.",
  hintFlow: "Preencha o formulário de cadastro que enviamos acima. Para parar de receber mensagens, envie *sair*.",
  hintFlowInvalid: "Não consegui validar o formulário. Abra o cadastro acima e confira todos os campos, incluindo o aceite.",
  hintProfileAudio: "Me conta um pouco mais sobre você 😊 Pode ser sua data de nascimento, esporte, time do coração e hobbies, em um áudio ou em um texto com pelo menos 10 caracteres.",
  aboutNeedMore: "Valeu, anotei sua data de nascimento! Agora me conta um pouco mais sobre você: seu esporte favorito, o time do coração, hobbies ou o que você curte fazer. Pode ser em áudio ou texto 😊",
  registered: "Cadastro concluído.",
  nameConfirm: "Só para confirmar: *{name}* é mesmo o seu nome completo?",
  nameConfirmGeneric: "Só para confirmar: o nome que você enviou é mesmo o seu nome completo?",
  nameConfirmYes: "Sim, é meu nome",
  nameConfirmNo: "Não, corrigir",
  askNameAgain: "Tudo bem! Qual é o seu nome completo?",
  hintNameConfirm: "Digite *1* (Sim, é meu nome) ou *2* (Não, corrigir).",
  nameBlocked: "Esse nome eu não registro, não 🦎 Me conta o seu nome de verdade (nome e sobrenome)?",
  askAge: "Última coisa antes das curiosidades: quantos anos você tem?",
  hintAge: "Não peguei a idade 😅 Manda só o número (ex.: 20).",
  ageLiar26: "26?? Tá mentindo pra mim, né? kkkkkk 🦎 Fala a idade de verdade, vai.",
  ageOld: "Eita, o Be My Mentor é feito pra galera de {min} a {max} anos 🦎 Se você errou o número, manda de novo a idade certa.",
  ageYoung: "Poxa, o Be My Mentor ainda não é pra quem tem menos de {min} anos 🦎 Quando chegar a hora, volta aqui! Se você errou o número, manda a idade certa.",
  welcomeBack: "Que bom ver você de novo! Digite o número do serviço desejado.",
} as const;

export const CONSENT_BUTTON_ID = "consent_yes";
export const NAME_YES_ID = "name_yes";
export const NAME_NO_ID = "name_no";
