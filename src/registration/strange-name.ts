// Nomes que dificilmente são nomes de pessoa (objetos, gírias, palavras de teste, personagens): o bot pergunta
// "esse é mesmo o seu nome?" antes de seguir. Se a pessoa confirmar, vale o que ela disse (ninguém é chamado de mentiroso).
import { normalizeText } from "../conversation/normalize";

/** Palavras que, aparecendo no nome, pedem confirmação. Sem acento, minúsculas. Só termos que não são sobrenome comum. */
const STRANGE_WORDS: readonly string[] = [
  // cumprimentos, gírias e respostas soltas
  "beleza", "blz", "oi", "ola", "opa", "tchau", "valeu", "vlw", "legal", "show", "top", "massa", "suave", "tranquilo", "fechou",
  "sim", "nao", "talvez", "kkk", "kkkk", "haha", "rsrs", "eita", "nossa", "uai", "boa", "bora",
  // teste e anonimato
  "teste", "test", "testando", "asdf", "qwerty", "abc", "xxx", "aaa", "nome", "anonimo", "anonymous", "ninguem", "nada", "qualquer",
  "fulano", "beltrano", "ciclano", "aleatorio", "desconhecido", "usuario", "user", "admin", "bot", "robo",
  // objetos e coisas
  "sofa", "mesa", "cadeira", "cama", "geladeira", "fogao", "porta", "janela", "tv", "televisao", "celular", "computador", "notebook",
  "mouse", "teclado", "tela", "carro", "moto", "bicicleta", "pneu", "garrafa", "copo", "prato", "faca", "garfo", "colher", "panela",
  "travesseiro", "tapete", "lampada", "chinelo", "sapato", "meia", "camisa", "bone", "oculos", "mochila", "caneta", "lapis", "caderno",
  // comidas e bichos
  "banana", "batata", "tomate", "cenoura", "pizza", "hamburguer", "lasanha", "coxinha", "pastel", "brigadeiro", "pao", "queijo", "arroz",
  "feijao", "macarrao", "cafe", "cachorro", "gato", "cavalo", "vaca", "porco", "galinha", "pato", "peixe", "macaco", "elefante", "tigre",
  "tubarao", "dinossauro", "axolote", "axolotl", "lagartixa", "jacare",
  // personagens e apelidos famosos
  "naruto", "goku", "vegeta", "batman", "superman", "pikachu", "luigi", "sonic", "shrek", "hulk", "thanos",
  "garfield", "neymar", "messi", "bolsonaro", "satanas", "diabo", "chaves", "pateta",
  // palavrões e provocações
  "bosta", "merda", "porra", "caralho", "cu", "puta", "viado", "idiota", "burro", "otario", "babaca", "trouxa", "lixo", "cocô", "coco",
  // abstratos
  "amor", "vida", "felicidade", "tristeza", "lindo", "linda", "gostoso", "gostosa", "bonito", "bonita", "princesa",
];

const STRANGE = new Set(STRANGE_WORDS.map((w) => normalizeText(w)));

/** true = o texto parece ter pouca chance de ser um nome de pessoa (vale uma confirmação). */
export function looksStrangeName(raw: string): boolean {
  const norm = normalizeText(raw);
  if (norm === "") return false;
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.some((t) => STRANGE.has(t))) return true;
  // dígitos, letra repetida ("aaaa", "kkkkk") ou sem nenhuma vogal ("sdfgh")
  if (/\d/.test(raw)) return true;
  if (raw.toLowerCase().split(/\s+/).some((t) => /(.)\1{3,}/u.test(t))) return true;
  if (tokens.some((t) => t.length >= 3 && !/[aeiouy]/.test(t))) return true;
  return false;
}

const YES_WORDS = ["sim", "s", "isso", "isso mesmo", "exato", "exatamente", "claro", "certo", "correto", "confirmo", "confirmado", "pode ser", "ok", "yes", "uhum", "aham", "sou eu", "e meu nome", "e sim", "e esse mesmo", "e esse", "meu nome mesmo", "e isso", "é isso", "isso ai", "isso aí", "verdade", "com certeza", "👍"];
const NO_WORDS = ["nao", "n", "errado", "errei", "incorreto", "nao e", "nao e meu nome", "nao e esse", "nao e isso", "negativo", "troca", "corrigir", "corrige", "no", "nope", "foi mal", "👎"];

/** Lê a resposta a "esse é mesmo o seu nome?": "sim, é meu nome", "isso mesmo", "não, errei"... null = não deu para entender. */
export function readNameAnswer(raw: string): "yes" | "no" | null {
  const t = normalizeText(raw).replace(/^(opcao|numero) /, "");
  if (t === "") return null;
  if (t === "1") return "yes";
  if (t === "2") return "no";
  const yes = YES_WORDS.map((w) => normalizeText(w));
  const no = NO_WORDS.map((w) => normalizeText(w));
  // "nao" na frente manda: "não, é esse mesmo" é raro; "não é meu nome" é comum.
  const first = t.split(" ")[0] ?? "";
  if (no.includes(t) || first === "nao" || first === "errado" || first === "errei") {
    if (/\b(e|eh) (meu nome|esse|isso)( mesmo)?$/.test(t) && first !== "nao") return "yes";
    return "no";
  }
  if (yes.includes(t) || first === "sim" || /^(isso|exato|claro|certo|correto|confirmo|sou eu|uhum|aham)\b/.test(t) || /\b(e|eh) (meu nome|esse|isso)( mesmo)?$/.test(t)) return "yes";
  return null;
}

/** Nomes de peso (crime, ódio, ditadores): o bot não registra e pede o nome de verdade. Sem acento; letras repetidas já colapsam. */
const HEAVY_WORDS: readonly string[] = [
  "ladrao", "ladra", "assaltante", "bandido", "traficante", "assassino", "assassina", "estuprador", "estupro", "pedofilo", "pedofila",
  "terrorista", "genocida", "nazista", "nazi", "hitler", "mussolini", "mussoline", "stalin", "goebbels", "himmler", "osama", "laden",
  "pinochet", "ustra", "estuprado", "psicopata", "maniaco", "serial killer", "suicida", "macaco", "preto", "nigga", "nigger",
  "viado", "bicha", "sapatao", "retardado", "mongol", "aleijado",
];
const HEAVY = new Set(HEAVY_WORDS.map((w) => normalizeText(w)));

/** true = nome malicioso ou de significado pesado. */
export function looksHeavyName(raw: string): boolean {
  const tokens = normalizeText(raw).split(" ").filter(Boolean);
  return tokens.some((t) => HEAVY.has(t)) || HEAVY.has(tokens.join(" "));
}
