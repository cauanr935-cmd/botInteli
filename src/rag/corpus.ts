// RAG do bot: a base é o texto dos Termos de Uso e da Política de Privacidade (a MESMA da página pública) mais a base
// de conhecimento do programa. A busca é local, simples e sem custo (palavras-chave com peso), sem enviar nada para fora.
// PURO: sem rede, sem banco.
import { BMM_KNOWLEDGE } from "../ai/knowledge";
import { normalizeText } from "../conversation/normalize";
import { legalSections, LEGAL_INFO, type LegalInfo } from "../legal/page";

export interface Chunk {
  id: string;
  /** Termos de Uso, Política de Privacidade (inclui os direitos da LGPD) ou o programa em geral. */
  source: "termos" | "privacidade" | "programa";
  title: string;
  text: string;
}

const MAX_CHUNK = 650;

function splitLong(title: string, text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && (cur + "\n" + line).length > MAX_CHUNK) { out.push(cur); cur = line; }
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

export function buildCorpus(info: LegalInfo = LEGAL_INFO): Chunk[] {
  const chunks: Chunk[] = [];
  for (const [i, sec] of legalSections(info).entries()) {
    splitLong(sec.title, sec.text).forEach((t, j) => chunks.push({ id: `${sec.part}-${i}-${j}`, source: sec.part, title: sec.title, text: t }));
  }
  for (const [i, part] of BMM_KNOWLEDGE.split(/^## /m).filter((x) => x.trim() !== "").entries()) {
    const [title, ...rest] = part.split("\n");
    splitLong(title ?? "", rest.join("\n").trim()).forEach((t, j) => chunks.push({ id: `programa-${i}-${j}`, source: "programa", title: (title ?? "").trim(), text: t }));
  }
  return chunks;
}

const STOP = new Set(
  ("a o as os um uma uns umas de do da dos das em no na nos nas por pra para com sem e ou mas que se ao aos como quando onde qual quais " +
    "eu voce vc me meu minha seu sua seus suas te ele ela eles elas isso isto esse essa esses essas este esta estes estas nao sim ja so " +
    "mais menos muito pouco ser estar ter tem tenho vou vai posso pode poder preciso certo ok ola oi bom boa dia tarde noite obrigado obrigada " +
    "gostaria queria quero saber duvida pergunta sobre algo alguma algum fazer faco feito depois terminar terminei terei apos antes entao certo mas").split(" "),
);

/** Palavras que significam quase a mesma coisa nos textos do projeto. */
const SYN: Record<string, string[]> = {
  funciona: ["funcionamento"], funcionam: ["funcionamento"], funcionar: ["funcionamento"],
  acessar: ["acesso"], acesso: ["oferece", "usar"], entrar: ["acesso"], liberado: ["acesso"],
  dados: ["dado", "privacidade"], informacoes: ["dado"], apagar: ["eliminacao", "excluir"], excluir: ["eliminacao"], deletar: ["eliminacao"],
  lgpd: ["privacidade", "direitos"], privacidade: ["dado"], seguranca: ["seguro", "proteger"], compartilha: ["compartilhamos"], vende: ["comercializa", "vendemos"],
  gravam: ["gravacao", "audio"], gravacao: ["audio"], horas: ["complementares"], certificado: ["complementares", "blockchain"],
};

// normalizeText colapsa letras repetidas ("acesso" -> "aceso"): as chaves passam pela mesma função.
const SYN_N = new Map(Object.entries(SYN).map(([k, v]) => [normalizeText(k), v]));
/** Variações da mesma palavra que valem como a palavra inteira (não só como sinônimo fraco). */
const ALIAS = new Map<string, string>([["utilizar", "usar"], ["utilizo", "usar"], ["usando", "usar"], ["uso", "usar"], ["usa", "usar"], ["utilizacao", "usar"]]);
const stem = (t: string): string => (t.length > 5 ? t.slice(0, 5) : t);
function tokens(text: string): string[] {
  return normalizeText(text).split(" ").map((t) => ALIAS.get(t) ?? t).filter((t) => t.length > 1 && !STOP.has(t));
}
/** Radicais da pergunta com peso: 1 para as palavras escritas, 0,4 para as que só vieram de sinônimos. */
function queryStems(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tokens(text)) out.set(stem(t), 1);
  for (const t of tokens(text)) for (const sy of SYN_N.get(t) ?? []) { const k = stem(normalizeText(sy)); if (!out.has(k)) out.set(k, 0.4); }
  return out;
}
/** Frequência dos radicais do trecho; as palavras do título valem 3 vezes. */
function docTerms(c: Chunk): { tf: Map<string, number>; len: number } {
  const tf = new Map<string, number>();
  let len = 0;
  for (const t of tokens(c.text)) { const k = stem(t); tf.set(k, (tf.get(k) ?? 0) + 1); len++; }
  for (const t of tokens(c.title)) { const k = stem(t); tf.set(k, (tf.get(k) ?? 0) + 3); len += 3; }
  return { tf, len };
}

export interface Hit { chunk: Chunk; score: number }

/** Os trechos mais parecidos com a pergunta (maior pontuação primeiro). Busca BM25 sobre radicais das palavras. */
export function retrieve(question: string, corpus: readonly Chunk[], k = 3): Hit[] {
  const q = queryStems(question);
  if (q.size === 0) return [];
  const docs = corpus.map((c) => ({ c, ...docTerms(c) }));
  const n = docs.length;
  const avg = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, n);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const K1 = 1.2, B = 0.75;
  return docs
    .map((d) => {
      let score = 0;
      for (const [term, w] of q) {
        const f = d.tf.get(term);
        if (!f) continue;
        const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
        score += w * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg)));
      }
      return { chunk: d.c, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Pontuação mínima para considerar que a base realmente responde a pergunta. */
export const MIN_SCORE = 1.5;

/** A pergunta é sobre os termos, a privacidade ou a LGPD? (o link dos termos vai junto na resposta) */
export function isLegalTopic(question: string, hits: readonly Hit[]): boolean {
  const n = normalizeText(question);
  if (/\b(termo|termos|politica|privacidade|lgpd|dados?|aceit\w*|consentimento|gravad\w*|apag\w*|exclu\w*|compartilh\w*|seguranc\w*)\b/.test(n)) return true;
  const top = hits[0];
  return !!top && top.score >= MIN_SCORE && top.chunk.source !== "programa";
}

// ---- por que perguntamos isso (por etapa) ----
const WHY: [RegExp, string][] = [
  [/^(NEW|AWAIT_REGISTRATION|REG_CONSENT)$/, "Pedimos o seu consentimento porque a LGPD exige a sua autorização antes de tratarmos seus dados. Sem ele, não seguimos com o cadastro."],
  [/^REG_FIELD_full_name$/, "Pedimos o seu nome completo para identificar você, conectar mentores e mentorados e, depois, validar as horas complementares na sua instituição."],
  [/^REG_FIELD_class_name$/, "A turma ajuda a identificar você na instituição e a conectar quem está em momentos diferentes do curso, como mentor e mentorado."],
  [/^REG_NAME_CONFIRM$/, "Confirmamos o nome para ter certeza de que está certo: ele aparece nos registros usados para validar as horas complementares."],
  [/^REG_PROFILE_AUDIO$/, "As curiosidades (como time e hobbies) ajudam a combinar pessoas com afinidades, para a conversa da mentoria fluir melhor."],
  [/^PROFILE_ROLE$/, "Para saber se você quer ajudar (mentor), receber ajuda (mentorado) ou os dois, e mostrar só as opções certas para você."],
  [/^MENTOR_CATEGORIES(_BOTH)?$/, "Para conectar você com quem precisa de ajuda justamente nas áreas em que você topa ajudar."],
  [/^DOUBT_ASK$/, "Para encontrar um mentor que possa ajudar você com a sua dúvida."],
  [/^SCHED_/, "Para combinar as mentorias nos dias e horários em que você consegue participar."],
  [/^AWAIT_AUDIO$/, "O áudio da mentoria é guardado para validar e emitir as horas complementares na sua instituição."],
];
export function whyWeAsk(state: string): string | null {
  return WHY.find(([re]) => re.test(state))?.[1] ?? null;
}
export const isWhyQuestion = (text: string): boolean =>
  /\b(pra que|para que|por que|porque|pq|motivo|precisa disso|precisam disso|necesar\w*)\b/.test(normalizeText(text));
