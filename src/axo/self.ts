// Perguntas da pessoa sobre ELA MESMA ("qual meu nome?", "qual minha mentoria?") e sobre o Axo ("quem é você?").
// Regras (R3/R6):
//   - Dado pessoal só vem do número que está escrevendo (a busca é sempre por `msg.from`): nunca há consulta por nome/telefone
//     citado no texto. Pergunta sobre OUTRA pessoa ou sobre "todos" recebe uma recusa fixa.
//   - Só depois do aceite (LGPD). Antes, o Axo diz que ainda não tem dado nenhum.
//   - O nome do parceiro de mentoria só aparece depois que o bot já o enviou (namesSentAt); antes disso vale o anonimato.
//   - Texto fixo, sem IA: o dado da pessoa não sai para provedor nenhum.
import { normalizeText } from "../conversation/normalize";

export type SelfKind = "who_are_you" | "my_name" | "my_class" | "my_mentoria" | "my_data" | "others_data";

const WHO_ARE_YOU = [
  /\bquem (e|eh) (voce|vc|tu|o axo|o axolote)\b/,
  /\bquem (voce|vc|tu) (e|eh)\b/,
  /\b(voce|vc|tu) (e|eh) quem\b/,
  /\bo que (voce|vc|tu) (e|eh)\b/,
  /\bo que (e|eh) (voce|vc|o axo)\b/,
  /\bqual (e )?(o )?(seu|teu) nome\b/,
  /\bcomo (voce |vc |tu )?(se chama|te chamo|e seu nome)\b/,
  /\b(se apresenta|apresente se|apresenta voce|fala (sobre|de) voce|fale (sobre|de) voce|me fala de voce|conta (sobre|de) voce|fala de ti)\b/,
  /\bvoce (e|eh) (um )?(bot|robo|ia|humano|pessoa|gente)\b/,
];
const MY_NAME = [/\bqual (e )?(o )?meu nome\b/, /\bcomo (eu )?me chamo\b/, /\bquem (sou|so) eu\b/, /\b(voce|vc) (sabe|lembra|conhece) (o )?meu nome\b/, /\bmeu nome (e|eh) o que\b/];
const MY_CLASS = [/\bqual (e )?(a )?minha turma\b/, /\bminha turma (e|eh) qual\b/];
const MY_MENTORIA = [
  /\b(qual|quais|quando|onde|que dia|que horas?|a que horas?|que hora)\b.{0,30}\b(minha|minhas|meu)\b.{0,20}\b(mentoria|mentorias|horario|encontro|agendamento)\b/,
  /\b(minha|minhas) (mentoria|mentorias)\b.{0,25}\b(quando|onde|que dia|que horas?|marcada|agendada|confirmada)\b/,
  /\b(tenho|tem) (alguma |uma )?(mentoria|mentorias)\b.{0,15}\b(marcada|agendada|confirmada|pra mim|comigo|hoje|amanha|essa semana)\b/,
  /\b(qual|quando|onde|que horas?|a que horas?)\b.{0,12}\b(e|eh)\b.{0,6}\b(minha|a minha)\b.{0,12}\b(mentoria|mentorias)\b/,
  /\b(minha|minhas) (mentoria|mentorias)\b.{0,6}\b(qual|quando|onde)\b/,
  /\b(que|qual) (mentoria|mentorias) (eu )?tenho\b/,
];
const MY_DATA = [/\b(quais|qual|que) (sao )?(os )?(meus )?dados (meus|que (voce|vc) tem)\b/, /\bquais (sao )?(os )?meus dados\b/, /\bo que (voce|vc) (sabe|tem|guardou|guarda) (sobre|de|a respeito de) mim\b/, /\bmeu cadastro\b/, /\bmeus dados\b/];
const OTHERS = [
  /\b(todos|todas|outros|outras|outra pessoa|outro aluno|outra aluna|qualquer (um|pessoa|aluno))\b.{0,30}\b(dados|nomes?|telefones?|numeros?|mentorias?|cadastros?|turmas?)\b/,
  /\b(dados|nomes?|telefones?|numeros?|cadastros?|turmas?|mentorias?)\b.{0,15}\b(de|dos|das) (todos|todas|outros|outras|alunos|usuarios|pessoas)\b/,
  /\b(lista|listar|todos os) (de )?(alunos|usuarios|cadastrados|mentores|mentorados)\b/,
  /\b(qual|quais) (e |eh |sao )?(o |a |os |as )?(nome|telefone|numero|cadastro|dados|turma|mentoria|horario)s? (d[oae]|dos|das)\b/,
];

/** Classifica a pergunta sobre si mesmo/sobre o Axo. `null` = não é desse tipo. */
export function selfKind(raw: string): SelfKind | null {
  if (raw.length > 200) return null;
  const t = normalizeText(raw);
  if (OTHERS.some((r) => r.test(t)) && !/\bmeu(s)? (nome|dados|cadastro)\b|\bminha (turma|mentoria)\b/.test(t)) return "others_data";
  if (MY_NAME.some((r) => r.test(t))) return "my_name";
  if (MY_CLASS.some((r) => r.test(t))) return "my_class";
  if (MY_MENTORIA.some((r) => r.test(t))) return "my_mentoria";
  if (MY_DATA.some((r) => r.test(t))) return "my_data";
  if (WHO_ARE_YOU.some((r) => r.test(t))) return "who_are_you";
  return null;
}

/** O que o Axo sabe sobre quem está escrevendo (montado pelo motor SÓ com o número dessa pessoa). */
export interface SelfData {
  /** Aceitou os Termos (LGPD). Sem isso, nada pessoal é dito. */
  consented: boolean;
  fullName?: string | undefined;
  className?: string | undefined;
  mentoria?: {
    role: "mentor" | "mentorado";
    status: string;
    /** Instante marcado (UTC); null = ainda sem horário fechado. */
    scheduledAt: Date | null;
    location: string | null;
    /** Só preenchido depois que o bot já mandou os nomes (anonimato). */
    partnerName?: string | undefined;
  } | null | undefined;
  timezone: string;
}

export const WHO_ARE_YOU_REPLY =
  "Eu sou o Axolote, mas pode me chamar de Axo 🦎 Sou o mascote da Be My Mentor, a rede de mentoria entre alunos do Inteli, e sim, sou um bot. Funciono como um colega veterano: você me conta sua dúvida e eu ligo você a outro aluno que pode ajudar, de preferência presencialmente no campus. Aqui tudo se regenera, até ponderada atrasada. Posso te dizer o que tenho de você (nome, turma, mentoria marcada), mas nunca falo de dado de outras pessoas.";

export const OTHERS_REPLY =
  "Só falo do que é seu: seu nome, sua turma e a sua mentoria marcada. Dado de outras pessoas ficam com elas, nem se você pedir com jeitinho 🦎";

const NO_CONSENT = "Ainda não tenho nenhum dado seu guardado: ele só entra depois que você aceita os Termos no cadastro. Termina o cadastro e eu te conto tudo que tenho de você. 🦎";

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function whenText(d: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday") || WEEKDAYS[d.getUTCDay()]!;
  return `${wd}, ${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

function mentoriaText(d: SelfData): string {
  const m = d.mentoria;
  if (!m) return "Não vejo nenhuma mentoria marcada para você agora. Se quiser marcar uma, é só me dizer que você tem uma dúvida. 🦎";
  const papel = m.role === "mentor" ? "como mentor" : "como mentorado";
  if (m.scheduledAt) {
    const where = m.location ? `\n📍 ${m.location}` : "";
    const who = m.partnerName ? `\nCom: ${m.partnerName}` : "\nO nome da outra pessoa chega 5 minutos antes (por segurança, ficam anônimos até lá).";
    return `Sua mentoria está marcada: ${whenText(m.scheduledAt, d.timezone)}, ${papel}.${where}${who} 🦎`;
  }
  return `Você tem uma mentoria em andamento ${papel}, mas o horário ainda não foi fechado. Assim que fechar eu te aviso por aqui. 🦎`;
}

/** Resposta fixa. Nunca devolve dado de outra pessoa nem de quem não aceitou os Termos. */
export function selfAnswer(kind: SelfKind, d: SelfData | null): string {
  if (kind === "who_are_you") return WHO_ARE_YOU_REPLY;
  if (kind === "others_data") return OTHERS_REPLY;
  if (!d || !d.consented) return NO_CONSENT;
  switch (kind) {
    case "my_name":
      return d.fullName ? `Seu nome aqui no cadastro é ${d.fullName}. 🦎` : "Ainda não tenho seu nome guardado. Ele entra quando você termina o cadastro. 🦎";
    case "my_class":
      return d.className ? `Sua turma no cadastro é ${d.className}. 🦎` : "Ainda não tenho sua turma guardada. Ela entra quando você termina o cadastro. 🦎";
    case "my_mentoria":
      return mentoriaText(d);
    default: {
      const lines = [
        `Nome: ${d.fullName ?? "ainda não informado"}`,
        `Turma: ${d.className ?? "ainda não informada"}`,
        mentoriaText(d),
      ];
      return `Isso é o que eu tenho de você:\n${lines.join("\n")}`;
    }
  }
}
