// Pergunta sobre o próprio bot / a mentoria / o Be My Mentor feita NO MEIO do registro da dúvida.
// Não é a dúvida acadêmica da pessoa: o Axo responde (voz dele) e devolve a pergunta da etapa, sem gravar nada como dúvida.
import { normalizeText } from "../conversation/normalize";

const ATTACH = [/\banex\w*/, /\b(mandar|enviar|subir|juntar|colocar|anexar) (um |o |a |meu |minha |esse |essa )?(documento|arquivo|pdf|material|print|foto|lista)/];
const HOW_TO_WRITE = [
  /\bo que (eu )?(devo|posso|preciso|tenho que|tenho de) (falar|escrever|dizer|mandar|enviar|informar)\b/,
  /\bcomo (eu )?(devo |posso )?(escrev\w+|descrev\w+|explic\w+) (a |minha |essa )?duvida\b/,
  /\b(para|pra) (voce|vc|o axo|ele|o bot) (me )?(entender|compreender)\b/,
  /\b(voce|vc|o axo|o bot) (vai |consegue |pode )?(entender|compreender)\b.*\bduvida\b/,
];
const PLATFORM = /\b(be my mentor|bmm|plataforma|axo|voce|vc|bot|cadastro|mentorias?|mentor(es|a|as)?|inteli)\b/;
const PLATFORM_Q = /\b(como (funciona|vai ser|e|sao)|quem (vai|e|sao|pode)|quanto tempo|quando (vou|vai|sai|acontece)|vou (receber|ter|ser)|o que (e|sao|voce|vc|faz)|para que serve|pra que serve|e (de graca|gratis|pago)|custa|presencial|online)\b/;

export type MetaKind = "attach" | "how_to_write" | "platform";

/** Classifica a pergunta; `null` = não é sobre o bot/plataforma (pode ser a dúvida de verdade). */
export function metaKind(raw: string): MetaKind | null {
  const t = normalizeText(raw);
  if (!raw.includes("?") && t.split(" ").length < 4) return null;
  if (ATTACH.some((r) => r.test(t))) return "attach";
  if (HOW_TO_WRITE.some((r) => r.test(t))) return "how_to_write";
  if (PLATFORM.test(t) && PLATFORM_Q.test(t)) return "platform";
  return null;
}

const ATTACH_ANSWER =
  "Pode sim! Anexa o documento aqui mesmo (PDF, Word, Excel, PowerPoint, texto ou CSV) e ele vai pro seu mentor ver antes da mentoria.";
const HOW_ANSWER =
  "Escreve do jeito que você falaria com um colega: matéria ou módulo, o que travou e, se tiver, o prazo. Tipo: \"ponderada de banco de dados do módulo 2, não entendi joins, entrega amanhã\". Não precisa estar perfeito, o mentor se vira.";

/** Resposta pronta (sem IA). `null` = deixa o FAQ geral (termos, programa) responder. */
export function metaAnswer(raw: string): string | null {
  switch (metaKind(raw)) {
    case "attach": return `${ATTACH_ANSWER} ${HOW_ANSWER}`;
    case "how_to_write": return HOW_ANSWER;
    default: return null;
  }
}
