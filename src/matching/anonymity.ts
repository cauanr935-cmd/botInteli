// Anonimato do matching: mentor e mentorado NÃO sabem quem é o outro (nem o nome, nem contato, nem inicial), nem sob insistência.
// Os nomes só chegam 5 minutos antes da mentoria (reminder.ts). Esta pergunta é respondida com texto FIXO, nunca pela IA
// (a IA poderia "ajudar" demais), e a resposta nunca carrega dado do outro lado.
import { normalizeText } from "../conversation/normalize";

const ROLE = /\b(mentor(es|a|as)?|mentorad[oa]s?|aluno|aluna|parceir[oa]|colega|dele|dela|ele|ela|fulano|fulana|quem vai me ajudar|quem vou ajudar)\b/;
const IDENTITY = new RegExp([
  String.raw`\bquem (e|eh|sao|vai ser|sera|foi|que e|sera que e)\b`,
  String.raw`\bqual (e )?(o |a )?(nome|sobrenome|contato|telefone|numero|numero de telefone|whats\w*|zap\w*|turma|curso|email|e-mail|instagram|insta|linkedin|foto|idade)\b`,
  String.raw`\b(nome|sobrenome|contato|telefone|numero|whats\w*|zap\w*|email|instagram|linkedin) (d[oae]|dele|dela|completo)\b`,
  String.raw`\b(inicial|primeira letra|iniciais|apelido)\b`,
  String.raw`\b(me )?(diz|fala|manda|passa|conta|revela|informa|mostra|da)( ai| ae| a| pra mim)? (o |a |so o |so a )?(nome|sobrenome|contato|telefone|numero|whats\w*|zap\w*|email|inicial)\b`,
  String.raw`\b(descobrir|saber|ver) (quem|o nome|o contato)\b`,
].join("|"));

/** Pedidos de "pista" (inicial, sobrenome) valem sozinhos: quem insiste costuma tirar o "mentor" da frase ("só a inicial então"). */
const HINT_ONLY = /\b(inicial|iniciais|primeira letra|sobrenome)\b/;

/** A pessoa quer saber quem é o mentor/mentorado dela (nome, contato, inicial, turma...)? */
export function asksCounterpartIdentity(raw: string): boolean {
  if (raw.length > 300) return false;
  const t = normalizeText(raw);
  return HINT_ONLY.test(t) || (IDENTITY.test(t) && ROLE.test(t));
}

export const ANONYMITY_REPLY =
  "Por segurança, mentor e mentorado ficam anônimos até 5 minutos antes da mentoria. Nessa hora eu te mando o nome da pessoa, o horário e o local. Até lá não consigo passar nome, contato nem pista, nem se você insistir. 🦎";
export const NAMES_ALREADY_SENT_REPLY = "O nome da pessoa já foi enviado na mensagem de aviso que mandei antes da mentoria. Dá uma olhada lá em cima na conversa. 🦎";
