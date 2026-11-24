// Pedido de certificado de horas: mentor e mentorado pedem por texto ("quero meu certificado"). O bot confere se a pessoa tem
// mentoria aprovada pela curadoria (e se a conta já bate o mínimo de horas, quando a curadoria informa), grava o pedido (um aberto
// por pessoa) e avisa a equipe (ADMIN_WA_IDS). Quem EMITE o certificado é o sistema da equipe, não o bot.
import { normalizeText } from "../conversation/normalize";
import type { MentoriaRow, Repo } from "../db/repo";
import { hashWaId } from "../lib/hash";
import { maskPhone, type Logger } from "../lib/logger";
import type { OutboundMessage, SendResult } from "../whatsapp/client";
import { waIdHashes } from "./confirm";
import { formatHorasMin, parseCuradoria, type CuradoriaConta } from "./curadoria";

/** "quero meu certificado", "como peço o certificado?", "preciso emitir o certificado", "certificado". */
export function wantsCertificate(raw: string): boolean {
  if (raw.length > 200) return false;
  const t = normalizeText(raw);
  if (!/\bcertificad\w*/.test(t)) return false;
  if (t === "certificado" || t === "certificados") return true;
  return /\b(quero|queria|gostaria|preciso|precisava|pedir|pedido|peco|solicitar|solicito|emitir|emite|gerar|gera|tirar|baixar|enviar|manda|mandar|me da|me passa|me envia|cade|como (eu )?(consigo|faco|peco|solicito|emito|tiro|baixo|recebo))\b/.test(t);
}

export const CERT_TEXTS = {
  none: "Você ainda não tem nenhuma mentoria registrada comigo, então ainda não dá pra pedir o certificado. Quando fizer uma mentoria, manda o áudio dela aqui. 🦎",
  waiting: "Suas mentorias ainda estão em análise pela equipe. Assim que alguma for aprovada, você já pode pedir o certificado. 🦎",
  belowMin: (have: string, min: number) =>
    `Você tem ${have} na conta e o certificado pode ser pedido a partir de ${min} h. Falta pouco, continua que chega lá! 🦎`,
  already: "Seu pedido de certificado já está com a equipe. Avisamos você quando ele sair. 🦎",
  done: "Pedido de certificado registrado! 🎉 A equipe vai emitir e te avisar quando ele sair.",
} as const;

export interface CertificateDeps {
  repo: Repo;
  logger: Logger;
  send: (message: OutboundMessage) => Promise<SendResult>;
  now: Date;
  adminWaIds: readonly string[];
}

interface Standing { rows: number; approved: number; conta: CuradoriaConta | null }

/** Mentorias da pessoa (como quem registrou ou como parceiro), quantas foram aprovadas e a conta mais recente informada. */
async function standing(repo: Repo, hashes: readonly string[]): Promise<Standing> {
  const all: MentoriaRow[] = await repo.listMentorias({ limit: 500 });
  const mine = all.filter((m) => hashes.includes(m.waIdHash) || (m.partnerHash != null && hashes.includes(m.partnerHash)));
  let approved = 0;
  let conta: CuradoriaConta | null = null;
  for (const m of mine) { // mais recentes primeiro
    const me = parseCuradoria(m.analysisResult)?.participantes.find((p) => hashes.includes(p.pessoaId));
    if (me?.situacao === "aprovada") approved++;
    if (conta === null && me?.conta) conta = me.conta;
  }
  return { rows: mine.length, approved, conta };
}

/** Texto da resposta ao pedido (e grava/avisa quando cabe). Nunca lança. */
export async function handleCertificateRequest(waId: string, deps: CertificateDeps): Promise<string> {
  const { repo, logger } = deps;
  try {
    const hashes = await waIdHashes(waId);
    const st = await standing(repo, hashes);
    if (st.rows === 0) return CERT_TEXTS.none;
    if (st.approved === 0) return CERT_TEXTS.waiting;
    // A curadoria diz se a conta já bate o mínimo; sem essa informação, uma mentoria aprovada basta para a equipe analisar.
    if (st.conta && !st.conta.podePedirCertificado) {
      const have = formatHorasMin(st.conta.minutosDisponiveis ?? 0);
      return st.conta.minimoHoras != null ? CERT_TEXTS.belowMin(have, st.conta.minimoHoras) : CERT_TEXTS.waiting;
    }
    const created = await repo.requestCertificate(await hashWaId(waId), deps.now);
    if (!created) return CERT_TEXTS.already;
    const name = (await repo.getRegistration(waId).catch(() => null))?.values.full_name ?? "uma pessoa cadastrada";
    const hours = st.conta?.minutosDisponiveis != null ? ` · ${formatHorasMin(st.conta.minutosDisponiveis)} na conta` : "";
    for (const to of deps.adminWaIds) {
      const r = await deps.send({ to, type: "text", text: { body: `Pedido de certificado: ${name} · ${st.approved} mentoria(s) aprovada(s)${hours}. Emita pelo sistema.` } });
      if (r.status !== "sent") logger.log("info", "certificate_admin_notice_not_sent", { to: maskPhone(to), status: r.status });
    }
    logger.log("info", "certificate_requested", { from: maskPhone(waId), approved: st.approved });
    return CERT_TEXTS.done;
  } catch (e) {
    // Só o texto do erro (ex.: "supabase requestCertificate falhou: 404" = tabela sem migração 0023); nunca dado da pessoa.
    logger.log("warn", "certificate_request_failed", { from: maskPhone(waId), reason: (e instanceof Error ? e.message : "unknown").slice(0, 120) });
    return "Não consegui registrar seu pedido agora. Tenta de novo daqui a pouco, por favor. 🦎";
  }
}
