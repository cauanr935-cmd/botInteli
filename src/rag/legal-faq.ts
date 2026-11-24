// Respostas prontas e curtas sobre LGPD, uso dos dados e privacidade. Valem em QUALQUER etapa, inclusive ANTES do aceite:
// a pessoa precisa de uma base antes de aceitar. São montadas só com o que está nos Termos de Uso e na Política de
// Privacidade (o teste confere os fatos contra a página) e não usam IA nem enviam o texto dela para fora (R6).
// Cada resposta cabe junto do pedido de consentimento numa mensagem só (<= 1024).
import { normalizeText } from "../conversation/normalize";
import { CONTACT_WHATSAPP } from "../legal/page";

export interface LegalTopic {
  id: string;
  /** Padrões sobre o texto normalizado (minúsculas, sem acento, sem pontuação). */
  match: RegExp[];
  /** Se houver, a pergunta também precisa falar de dados/privacidade (evita que "vender peças" ou "prazo do MVP" caiam aqui). */
  needs?: RegExp;
  answer: string;
}

/** Contexto de dados pessoais/privacidade: verbos soltos como "vender", "guardar", "prazo" só valem junto disto. */
const DATA_CONTEXT = /\b(dados?|audios?|cadastro|privacidade|lgpd|consentimento|(minhas|meus|suas|seus|nossas|nossos) (informac\w+|mensagens?|audios?))\b/;

const contact = `pelo Contato do bot ou pelo WhatsApp ${CONTACT_WHATSAPP}`;

/** Do mais específico para o mais geral: vale a primeira que casar. */
export const LEGAL_TOPICS: readonly LegalTopic[] = [
  {
    id: "sem-aceite",
    match: [/\b(nao aceit\w*|sem aceitar|se eu nao aceitar|recus\w+ (os )?termos|nao concord\w*)\b/, /\bobrigatori\w*\b.*\b(aceit\w*|termos|consentimento)\b/],
    answer:
      "O aceite é voluntário. Sem ele não seguimos com o cadastro e nenhum dado de cadastro, áudio ou dúvida é guardado: antes do aceite só temos o número do WhatsApp de onde você escreveu, para poder responder. Se não quiser mais receber mensagens, envie *sair*.",
  },
  {
    id: "apagar",
    match: [/\b(apag\w+|exclu\w+|delet\w+|remov\w+|elimin\w+|esquec\w+)\b.*\b(dados?|cadastro|conta|audios?|informac\w+)\b/, /\b(dados?|cadastro|audios?)\b.*\b(apag\w+|exclu\w+|delet\w+|remov\w+|elimin\w+)\b/, /\bdireito (ao )?esquecimento\b/],
    answer:
      `Você pode pedir a eliminação dos seus dados quando quiser, de graça, ${contact}. Respondemos em até 15 dias. Só guardamos por mais tempo o que a lei exigir, e o livro de registro e os carimbos de tempo não podem ser alterados (por isso lá vão apenas códigos e hashes, nunca nome, telefone ou o texto da conversa).`,
  },
  {
    id: "direitos",
    match: [/\blgpd\b/, /\bdireitos?\b.*\b(titular|dados?|lei)\b/, /\b(acessar|corrigir|portabilidade|revog\w+|revogar|cancelar) (o |meu |meus |os )?(consentimento|dados?)\b/, /\b(meus )?direitos\b/, /\blei geral\b/],
    answer:
      `A LGPD (Lei 13.709/2018) protege os seus dados pessoais. Você pode, de graça e a qualquer momento: saber se tratamos seus dados, acessar, corrigir, pedir eliminação ou portabilidade, e revogar o consentimento. É só pedir ${contact}; respondemos em até 15 dias. Se não ficar satisfeito, pode reclamar à ANPD (gov.br/anpd).`,
  },
  {
    id: "compartilhamento",
    needs: DATA_CONTEXT,
    match: [/\b(compartilh\w+|vend\w+|comerciali\w+|repass\w+|terceiros?|quem (ve|tem acesso|recebe|le|ouve)|quem acessa)\b/, /\bpara quem\b.*\b(dados?|audios?|informac\w+)\b/],
    answer:
      "Não vendemos nem comercializamos os seus dados, e não os compartilhamos para outras finalidades. Quem recebe o necessário: o seu mentor ou mentorado (nome, turma, dúvida e horários), a sua instituição de ensino (só o certificado que você decidir levar a ela) e os prestadores que fazem o bot funcionar (WhatsApp/Meta, hospedagem, banco de dados e IA), sempre sob nossas instruções. Autoridades só se a lei mandar.",
  },
  {
    id: "retencao",
    needs: DATA_CONTEXT,
    match: [/\b(quanto tempo|por quanto tempo|ate quando|prazo|guard\w+|armazen\w+|retenc\w+)\b.*\b(dados?|audios?|cadastro|informac\w+|gravac\w+)?\b/],
    answer:
      "Cadastro, áudio de apresentação, dúvidas, materiais e horários: enquanto você usar o serviço e por até 12 meses depois do último contato. Áudios das mentorias, transcrições e registros de validação: até 5 anos, para a validação das horas complementares. Registros técnicos de acesso: 6 meses. Depois disso, eliminamos ou anonimizamos.",
  },
  {
    id: "ia",
    match: [/\b(inteligencia artificial|ia|chatgpt|grok|groq|robo|automatic\w+)\b.*\b(dados?|mensagens?|texto|le |leem|ve |veem)\b/, /\b(usa|usam|utiliz\w+) (a )?(ia|inteligencia artificial)\b/, /\binteligencia artificial\b/],
    answer:
      "Usamos inteligência artificial só para apoiar o atendimento: entender o que você quis dizer, ler seus horários, conferir se um nome parece real e responder perguntas sobre a Be My Mentor. Ela recebe apenas o texto da sua mensagem, sem nome nem telefone, e somente depois do seu aceite. Ela não tira dúvidas acadêmicas. Os provedores são Groq e xAI. Por isso, não escreva dados sensíveis nem de terceiros no texto livre. Temas sensíveis nunca vão para a IA. A transcrição e a análise das gravações das mentorias rodam em equipamento nosso, sem IA de terceiros.",
  },
  {
    id: "exterior",
    needs: DATA_CONTEXT,
    match: [/\b(exterior|fora do brasil|estados unidos|eua|internacional|servidores?|nuvem)\b/],
    answer:
      "Alguns prestadores (WhatsApp/Meta, Cloudflare, Supabase e os provedores de IA) podem processar dados fora do Brasil, inclusive nos Estados Unidos. Isso só acontece com o seu consentimento específico, dado ao aceitar os termos, e eles tratam os dados apenas sob nossas instruções.",
  },
  {
    id: "blockchain",
    match: [/\bblockchain\b/, /\bimutavel\b/, /\bhash\b/, /\bcarimbo\b/],
    answer:
      "Para dar confiança ao certificado de horas complementares, mantemos um livro de registro e carimbos de tempo públicos, que não podem ser alterados. Por isso lá vão somente informações pseudonimizadas (códigos e hashes), nunca nome, telefone ou o texto da transcrição.",
  },
  {
    id: "quais-dados",
    match: [/\b(quais|que|qual) (sao )?(os )?(dados?|informac\w+)\b/, /\b(o que|que dados?|quais dados?)\b.*\b(coleta\w*|pedem|pedir|armazen\w+|guard\w+|tratam|tratar|sabem)\b/, /\b(coleta\w*|coletam)\b.*\b(dados?|informac\w+)\b/],
    answer:
      "Tratamos: o número do seu WhatsApp, nome completo e turma; o áudio (ou texto) de apresentação com as curiosidades; seu papel (mentor, mentorado ou os dois) e áreas; suas dúvidas e documentos que anexar; dias e horários livres; os áudios das mentorias e suas transcrições; o texto das suas mensagens; e o registro do seu aceite. Não pedimos dados sensíveis (saúde, religião, política etc.).",
  },
  {
    id: "finalidade",
    match: [
      /\b(por ?que|porque|pra que|para que|motivo|finalidade|objetivo)\b.*\b(dados?|informac\w+|nome|numero|audios?|gravac\w+|cadastro)\b/,
      /\b(usar|usam|usa|utiliz\w+|querem|quer|precisam|preciso|pedem|pede|coleta\w*)\b.*\b(meus )?dados\b/,
      /\b(o que|como)\b.*\b(fazem|fazer|vao fazer|usam|utilizam)\b.*\b(dados|audios?|informac\w+)\b/,
    ],
    answer:
      "Usamos os seus dados só para três coisas: conectar quem tem uma dúvida a quem pode ajudar (mentorado e mentor), agendar as mentorias nos horários de cada um e validar e emitir as horas complementares na sua instituição de ensino. Eles não são vendidos nem usados para outras finalidades.",
  },
];

/** Resposta pronta sobre LGPD/dados para a pergunta, ou null se a pergunta não é sobre isso. */
export function legalAnswer(question: string): { id: string; answer: string } | null {
  const q = normalizeText(question);
  for (const t of LEGAL_TOPICS) if ((!t.needs || t.needs.test(q)) && t.match.some((re) => re.test(q))) return { id: t.id, answer: t.answer };
  return null;
}
