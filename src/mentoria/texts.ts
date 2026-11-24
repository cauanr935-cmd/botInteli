// Textos do fluxo de mentoria (português). Cada um é UMA mensagem útil (R2): nada de "aguarde" nem "recebi".
export const MENTORIA_SERVICE_ID = "mentoria";
export const ROLE_MENTOR_ID = "ment_role_mentor";
export const ROLE_MENTORADO_ID = "ment_role_mentorado";
export const DATE_TODAY_ID = "ment_date_today";
export const DATE_YESTERDAY_ID = "ment_date_yesterday";
export const DATE_OTHER_ID = "ment_date_other";
/** Áudio que chegou antes do horário marcado: "vocês já fizeram a mentoria?". */
export const EARLY_YES_ID = "ment_early_yes";
export const EARLY_NO_ID = "ment_early_no";
/** Escolha do parceiro: `ment_pt:<hash do telefone>`; "outra pessoa" volta a perguntar. */
export const PARTNER_PICK_PREFIX = "ment_pt:";
export const PARTNER_OTHER_ID = "ment_pt_other";
/** Resposta do parceiro: `ment_ok:<id da mentoria>` / `ment_no:<id da mentoria>`. */
export const CONFIRM_YES_PREFIX = "ment_ok:";
export const CONFIRM_NO_PREFIX = "ment_no:";
/** Botão "Pedir revisão" da mensagem de recusa: `ment_rev:<id da mentoria>`. */
export const REVIEW_PREFIX = "ment_rev:";

export const MENTORIA_TEXTS = {
  askRoleAfterAudio:
    "Recebi o seu áudio e a sua mentoria já está registrada! 🎉 Agora só preciso de alguns dados para completar: você foi mentor ou mentorado nela?",
  askRole: "Arquivo guardado. Agora vamos registrar a mentoria: você foi mentor ou mentorado nela?",
  roleMentor: "Fui mentor",
  roleMentorado: "Fui mentorado",
  askSubject: "Qual foi o assunto da mentoria? Escreva em uma frase curta (até 200 caracteres). Para cancelar, envie *menu*.",
  askDate: "Quando a mentoria aconteceu?",
  dateToday: "Hoje",
  dateYesterday: "Ontem",
  dateOther: "Outra data",
  askDateText: "Envie a data da mentoria, por exemplo *05/11* ou *05/11/2026*.",
  askPartner:
    "Com quem foi a mentoria? Envie o *contato* da pessoa (clipe > Contato), o *número com DDD* ou o *nome* dela, se já tiver cadastro.",
  askEarly:
    "Esse áudio chegou antes do horário marcado para a mentoria. Vocês já realizaram a mentoria antes do combinado e esse áudio é dela mesmo?",
  earlyYes: "Sim, já fizemos",
  earlyNo: "Não, é outro",
  hintEarly: "Responde só *sim* (já fizemos e o áudio é dessa mentoria) ou *não* (aí eu ignoro o áudio). Para cancelar, envie *menu*.",
  earlyDiscarded: "Beleza, ignorei esse áudio e apaguei. Quando a mentoria acontecer, é só me mandar o áudio dela. 🦎",
  savedFromMatch:
    "Mentoria registrada! 🎉 Eu já tinha os dados dela (quem foi, o assunto e o horário), então não precisa me passar nada. A outra pessoa vai receber um pedido de confirmação e, quando confirmar, a mentoria segue para análise. Para registrar outra, envie outro arquivo ou envie *menu*.",
  hintRole: "Digite *1* (Fui mentor) ou *2* (Fui mentorado), ou envie *menu* para cancelar.",
  hintSubject: "Não consegui usar esse assunto. Escreva uma frase curta (de 3 a 200 caracteres) ou envie *menu* para cancelar.",
  hintDate: "Não entendi a data. Digite o número de uma opção acima ou escreva, por exemplo, *05/11/2026*.",
  hintDateFuture: "A data não pode ser no futuro. Digite o número de uma opção acima ou escreva a data em que a mentoria aconteceu.",
  hintDateOld: "Essa data é muito antiga (limite de 1 ano). Confira e envie a data certa, por exemplo *05/11/2026*.",
  hintPartner:
    "Não encontrei essa pessoa. Envie o *contato* dela (clipe > Contato) ou o *número com DDD*. Para cancelar, envie *menu*.",
  hintPartnerMany: "Há mais de uma pessoa com esse nome. Envie o *contato* dela (clipe > Contato) ou o *número com DDD*.",
  hintPartnerSelf: "Esse é o seu próprio contato. Envie o contato ou o número de quem foi o seu parceiro na mentoria.",
  pickOne: "Encontrei esta pessoa. Foi com ela a mentoria?",
  pickMany: "Encontrei estas pessoas. Com quem foi a mentoria?",
  pickOther: "Outra pessoa",
  savedRegistered: (name: string) =>
    `Mentoria registrada! Pedimos a confirmação de ${name}. Quando a pessoa confirmar, a mentoria segue para análise. Para registrar outra, envie outro arquivo ou envie *menu*.`,
  savedUnregistered:
    "Mentoria registrada! Essa pessoa ainda não tem cadastro: peça para ela enviar *oi* para este número e concluir o cadastro. A confirmação dela vem depois. Para registrar outra, envie outro arquivo ou envie *menu*.",
  confirmYes: "Sim",
  confirmNo: "Não",
  confirmAsk: (name: string, date: string, subject: string) =>
    `Você participou de uma mentoria com ${name} em ${date}, sobre ${subject}?`,
  confirmedThanks: "Obrigado! Sua participação foi confirmada.",
  reviewButton: "Pedir revisão",
  reviewRecorded: "Pedido de revisão registrado. A equipe vai analisar a sua mentoria.",
  rejectedThanks: "Certo, registramos que você não participou. A gravação foi apagada e essa mentoria não gera certificado.",
} as const;
