// Textos do fluxo de mentoria (português). Cada um é UMA mensagem útil (R2): nada de "aguarde" nem "recebi".
export const MENTORIA_SERVICE_ID = "mentoria";
export const ROLE_MENTOR_ID = "ment_role_mentor";
export const ROLE_MENTORADO_ID = "ment_role_mentorado";
export const DATE_TODAY_ID = "ment_date_today";
export const DATE_YESTERDAY_ID = "ment_date_yesterday";
export const DATE_OTHER_ID = "ment_date_other";
/** Escolha do parceiro: `ment_pt:<hash do telefone>`; "outra pessoa" volta a perguntar. */
export const PARTNER_PICK_PREFIX = "ment_pt:";
export const PARTNER_OTHER_ID = "ment_pt_other";
/** Resposta do parceiro: `ment_ok:<id da mentoria>` / `ment_no:<id da mentoria>`. */
export const CONFIRM_YES_PREFIX = "ment_ok:";
export const CONFIRM_NO_PREFIX = "ment_no:";

export const MENTORIA_TEXTS = {
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
  hintRole: "Toque em *Fui mentor* ou *Fui mentorado* na mensagem acima, ou envie *menu* para cancelar.",
  hintSubject: "Não consegui usar esse assunto. Escreva uma frase curta (de 3 a 200 caracteres) ou envie *menu* para cancelar.",
  hintDate: "Não entendi a data. Toque em um botão acima ou escreva, por exemplo, *05/11/2026*.",
  hintDateFuture: "A data não pode ser no futuro. Toque em um botão acima ou escreva a data em que a mentoria aconteceu.",
  hintDateOld: "Essa data é muito antiga (limite de 1 ano). Confira e envie a data certa, por exemplo *05/11/2026*.",
  hintPartner:
    "Não encontrei essa pessoa. Envie o *contato* dela (clipe > Contato) ou o *número com DDD*. Para cancelar, envie *menu*.",
  hintPartnerMany: "Há mais de uma pessoa com esse nome. Envie o *contato* dela (clipe > Contato) ou o *número com DDD*.",
  hintPartnerSelf: "Esse é o seu próprio contato. Envie o contato ou o número de quem foi o seu parceiro na mentoria.",
  pickOne: "Encontrei esta pessoa. Foi com ela a mentoria?",
  pickMany: "Encontrei estas pessoas. Com quem foi a mentoria?",
  pickOther: "Outra pessoa",
  savedRegistered: (name: string) =>
    `Mentoria registrada! Pedimos a confirmação de ${name}. Quando a pessoa confirmar, a mentoria segue para análise. Para registrar outra, envie outro arquivo ou toque em Menu.`,
  savedUnregistered:
    "Mentoria registrada! Essa pessoa ainda não tem cadastro: peça para ela enviar *oi* para este número e concluir o cadastro. A confirmação dela vem depois. Para registrar outra, envie outro arquivo ou toque em Menu.",
  confirmYes: "Sim",
  confirmNo: "Não",
  confirmAsk: (name: string, date: string, subject: string) =>
    `Você participou de uma mentoria com ${name} em ${date}, sobre ${subject}?`,
  confirmedThanks: "Obrigado! Sua participação foi confirmada.",
  rejectedThanks: "Certo, registramos que você não participou. A gravação foi apagada e essa mentoria não gera certificado.",
} as const;
