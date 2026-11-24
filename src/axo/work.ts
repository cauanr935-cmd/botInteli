// Guardrail de integridade (spec "Guardrails e integridade"): o aluno pede para o Axo FAZER a ponderada, o artefato ou a prova.
// O Axo explica por quê, sem bronca, e oferece o caminho certo: uma mentoria. Texto fixo, nunca vai para a IA.
import { normalizeText } from "../conversation/normalize";
import { registerOf } from "./voice";
import type { Register } from "./style";

const DO = /\b(faz|faca|fazer|resolve|resolva|resolver|escreve|escreva|escrever|gera|gere|gerar|monta|monte|termina|termine|programa|programe|me da|me passa|me manda)\b/;
const WORK = /\b(ponderada|artefato|trabalho|codigo|lista|prova|atividade|exercicio|exercicios|projeto|autoestudo|questoes)\b/;
const FOR_ME = /\b(pra mim|para mim|por mim|pronto|pronta|prontinho|completo|completa|inteiro|inteira|gabarito|a resposta|as respostas)\b/;

/** "faz minha ponderada pra mim", "me dá o gabarito da prova", "resolve essa lista pronta". */
export function asksToDoWork(raw: string): boolean {
  const t = normalizeText(raw);
  if (/\bgabarito\b/.test(t) && /\b(me da|me passa|me manda|quero|preciso)\b/.test(t)) return true;
  return DO.test(t) && WORK.test(t) && FOR_ME.test(t);
}

const REFUSAL: Record<Register, string> = {
  casual: "ponderada pronta eu não entrego, não 🦎 na review é você que precisa dominar essa lógica. mas eu te ligo a um veterano que destrava o raciocínio contigo. manda *marcar mentoria* que eu abro o pedido.",
  neutro: "Não faço a ponderada pelo aluno: na hora da review é você que precisa dominar essa lógica. Mas posso ligar você a um veterano para destravar o raciocínio. Envie *marcar mentoria* e eu abro o pedido.",
  direto: "Não faço atividades avaliativas pelo aluno. Posso conectar você a um mentor: envie *marcar mentoria*.",
};
export const workRefusal = (raw: string): string => REFUSAL[registerOf(raw)];
