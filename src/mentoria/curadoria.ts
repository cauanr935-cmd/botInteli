// Aviso da decisão da equipe (curadoria). O notebook REENVIA o POST /result sempre que o resumo muda, com um bloco
// `curadoria` dentro do result (contrato: docs/INTEGRACAO_TRANSCRITOR.md). Aqui:
//  - parseCuradoria: lê o bloco de forma tolerante (nunca lança);
//  - notifyCuradoria: avisa cada participante QUANDO a situação dele muda para "aprovada" ou "recusada", uma vez por
//    mudança (reserva atômica no banco); "aguardando_equipe" não gera mensagem (R2);
//  - handleReviewRequest: botão [Pedir revisão] da recusa (LGPD art. 20): registra o pedido para a equipe.
// Todo envio passa pelo `send` (sendGuarded): R1/R2 valem como em qualquer outra mensagem. Nenhuma mensagem leva telefone.
import { limited } from "../conversation/machine";
import type { MentoriaRow, Repo } from "../db/repo";
import { maskPhone, type Logger } from "../lib/logger";
import { buildButtons } from "../whatsapp/builders";
import type { OutboundMessage, SendResult } from "../whatsapp/client";
import type { ButtonReplyEvent } from "../whatsapp/types";
import { countersFor, waIdHashes } from "./confirm";
import { formatDateBr } from "./parse";
import { MENTORIA_TEXTS as T, REVIEW_PREFIX } from "./texts";

export type Situacao = "aguardando_equipe" | "aprovada" | "recusada";
const SITUACOES: readonly string[] = ["aguardando_equipe", "aprovada", "recusada"];
const STATUS_CURADORIA: readonly string[] = ["aguardando_equipe", "aprovada", "recusada", "parcial"];
const UUID = /^[0-9a-fA-F-]{36}$/;

export interface CuradoriaConta {
  minutosDisponiveis: number | null;
  horasCertificadas: number | null;
  podePedirCertificado: boolean;
  minimoHoras: number | null;
}
export interface CuradoriaParticipante {
  pessoaId: string;
  papel: "mentor" | "mentorado" | null;
  situacao: Situacao;
  minutosContabilizados: number | null;
  conta: CuradoriaConta | null;
}
export interface Curadoria {
  status: string;
  participantes: CuradoriaParticipante[];
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Lê `result.curadoria` (também aceita o bloco no próprio result do status "sem_analise"). Inválido/ausente = null. */
export function parseCuradoria(result: unknown): Curadoria | null {
  if (!isObj(result) || !isObj(result.curadoria)) return null;
  const c = result.curadoria;
  if (typeof c.status !== "string" || !STATUS_CURADORIA.includes(c.status) || !Array.isArray(c.participantes)) return null;
  const participantes: CuradoriaParticipante[] = [];
  for (const raw of c.participantes) {
    if (!isObj(raw) || typeof raw.pessoa_id !== "string" || raw.pessoa_id === "" || typeof raw.situacao !== "string" || !SITUACOES.includes(raw.situacao)) continue;
    const conta = isObj(raw.conta)
      ? {
          minutosDisponiveis: num(raw.conta.minutos_disponiveis), horasCertificadas: num(raw.conta.horas_certificadas),
          podePedirCertificado: raw.conta.pode_pedir_certificado === true, minimoHoras: num(raw.conta.minimo_horas),
        }
      : null;
    participantes.push({
      pessoaId: raw.pessoa_id,
      papel: raw.papel === "mentor" || raw.papel === "mentorado" ? raw.papel : null,
      situacao: raw.situacao as Situacao,
      minutosContabilizados: num(raw.minutos_contabilizados),
      conta,
    });
  }
  return { status: c.status, participantes };
}

/** Resumo para o painel: status e, por participante, a situação e se já foi avisado (sem pessoa_id, sem telefone). */
export function summarizeCuradoria(result: unknown, notified: Record<string, string> | null | undefined) {
  const c = parseCuradoria(result);
  if (!c) return null;
  return {
    status: c.status,
    participantes: c.participantes.map((p) => ({
      papel: p.papel, situacao: p.situacao,
      // "Avisado" só vale para decisões (aprovada/recusada); aguardando_equipe não gera aviso.
      avisado: p.situacao !== "aguardando_equipe" && notified?.[p.pessoaId] === p.situacao,
    })),
  };
}

/** {H} h {M} min a partir de minutos. */
export const formatHorasMin = (minutos: number): string => `${Math.floor(minutos / 60)} h ${Math.round(minutos % 60)} min`;

/** {DATA}: `ocorreu_em` (AAAA-MM-DD) ou, sem ela, o dia de `created_at` no fuso do bot. */
export function mentoriaDate(m: Pick<MentoriaRow, "ocorreuEm" | "createdAt">, timezone: string): string {
  if (m.ocorreuEm) return formatDateBr(m.ocorreuEm);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric" }).format(m.createdAt);
}

export function approvedText(date: string, p: CuradoriaParticipante): string {
  const parts = [`Sua mentoria de ${date} foi aprovada pela equipe ✅`];
  if (p.minutosContabilizados !== null) parts.push(`${Math.round(p.minutosContabilizados)} min contabilizados.`);
  if (p.conta?.minutosDisponiveis != null) parts.push(`Você tem ${formatHorasMin(p.conta.minutosDisponiveis)} na conta.`);
  if (p.conta?.minimoHoras != null) parts.push(`O certificado de horas complementares pode ser pedido a partir de ${p.conta.minimoHoras} h.`);
  return parts.join(" ");
}

export function refusedReply(date: string, audioId: string) {
  return buildButtons(
    `Sua mentoria de ${date} não foi contabilizada: ela não atendeu aos critérios de validação. Se quiser, peça revisão humana.`,
    [{ id: `${REVIEW_PREFIX}${audioId}`, title: T.reviewButton }],
  );
}

export interface CuradoriaDeps {
  repo: Repo;
  logger: Logger;
  send: (message: OutboundMessage) => Promise<SendResult>;
  maxPerDay: number;
  maxPer10Min: number;
  timezone: string;
  now: () => Date;
}

/**
 * Compara a situação de cada participante com a última já avisada e envia só as mudanças para aprovada/recusada.
 * Nunca lança (o resultado já está salvo; o aviso é "melhor esforço" e é tentado de novo no próximo reenvio).
 * Devolve quantas mensagens saíram.
 */
export async function notifyCuradoria(mentoriaId: string, result: unknown, deps: CuradoriaDeps): Promise<number> {
  let sent = 0;
  try {
    const cur = parseCuradoria(result);
    if (!cur) return 0;
    const row = await deps.repo.getMentoria(mentoriaId);
    if (!row) return 0;
    const date = mentoriaDate(row, deps.timezone);
    for (const p of cur.participantes) {
      if (p.situacao !== "aprovada" && p.situacao !== "recusada") continue; // aguardando_equipe: nada
      try {
        // Só quem participa desta mentoria (quem registrou ou o parceiro): um pessoa_id estranho não recebe nada.
        if (p.pessoaId !== row.waIdHash && p.pessoaId !== row.partnerHash) continue;
        const known = (await deps.repo.getMentoria(mentoriaId))?.notifiedCuradoria ?? null;
        if (known?.[p.pessoaId] === p.situacao) continue; // reenvio igual: já avisada
        const person = await deps.repo.findPersonByWaIdHash(p.pessoaId);
        if (!person?.consentAt || !person.termsVersion) continue; // R6: sem cadastro/consentimento, nada
        if ((await deps.repo.getConversation(person.waId)).state === "OPTED_OUT") continue;
        if (limited(await countersFor(person.waId, { ...deps }))) continue; // R2: sem vaga; o próximo reenvio tenta de novo
        if (!(await deps.repo.claimCuradoriaNotice(mentoriaId, p.pessoaId, p.situacao))) continue; // outra execução já avisou
        const reply = p.situacao === "aprovada"
          ? ({ type: "text", text: { body: approvedText(date, p) } } as const)
          : refusedReply(date, mentoriaId);
        const r = await deps.send({ to: person.waId, ...reply });
        if (r.status === "sent") {
          sent++;
        } else {
          deps.logger.log("info", "curadoria_not_sent", { to: maskPhone(person.waId), status: r.status });
          await deps.repo.releaseCuradoriaNotice(mentoriaId, p.pessoaId, p.situacao, known?.[p.pessoaId] ?? null);
        }
      } catch {
        deps.logger.log("warn", "curadoria_notify_failed");
        await deps.repo.releaseCuradoriaNotice(mentoriaId, p.pessoaId, p.situacao, null).catch(() => undefined);
      }
    }
  } catch {
    deps.logger.log("warn", "curadoria_failed");
  }
  return sent;
}

/** Toque em [Pedir revisão]. Devolve true se tratou (mesmo sem responder). Pedido repetido = silêncio (R2). */
export async function handleReviewRequest(
  msg: ButtonReplyEvent, counters: Parameters<typeof limited>[0], deps: Pick<CuradoriaDeps, "repo" | "logger" | "send" | "now">,
): Promise<boolean> {
  if (!msg.id.startsWith(REVIEW_PREFIX)) return false;
  const id = msg.id.slice(REVIEW_PREFIX.length);
  if (!UUID.test(id)) return true;
  const reg = await deps.repo.getRegistration(msg.from);
  if (!reg.consentAt || !reg.termsVersion) return true; // R6
  const row = await deps.repo.getMentoria(id);
  if (!row) return true;
  // Só quem participou da mentoria, e só se a recusa dele foi mesmo avisada.
  const hashes = await waIdHashes(msg.from);
  const mine = hashes.find((h) => h === row.waIdHash || h === row.partnerHash);
  if (!mine || row.notifiedCuradoria?.[mine] !== "recusada") return true;
  const created = await deps.repo.requestReview(id, mine, deps.now());
  if (!created) return true;
  deps.logger.log("info", "curadoria_review_requested", { from: maskPhone(msg.from) });
  if ((await deps.repo.getConversation(msg.from)).state === "OPTED_OUT" || limited(counters)) return true;
  const r = await deps.send({ to: msg.from, type: "text", text: { body: T.reviewRecorded } });
  if (r.status !== "sent") deps.logger.log("info", "curadoria_review_reply_not_sent", { from: maskPhone(msg.from), status: r.status });
  return true;
}

/** Papel (de quem pediu) numa mentoria: o do registrante, ou o oposto se foi o parceiro. */
export function roleOf(row: Pick<MentoriaRow, "waIdHash" | "role">, waIdHash: string): "mentor" | "mentorado" | null {
  if (row.role === null) return null;
  return row.waIdHash === waIdHash ? row.role : row.role === "mentor" ? "mentorado" : "mentor";
}
