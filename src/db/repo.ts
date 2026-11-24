import type { Service } from "../services/content";

/** Acesso a dados. Implementações: memória (testes) e Supabase (produção). */
export interface Repo extends BudgetRepo, MentoriaRepo, MatchingRepo {
  /**
   * Registra a chave de idempotência (wamid) ANTES de processar.
   * Devolve true se foi inserida agora; false se já existia. Deve ser atômico.
   */
  claimMessage(key: string, receivedAt: Date): Promise<boolean>;
  /** Dentre as chaves dadas, as que o bot ainda NÃO viu (recuperação de mensagens perdidas). */
  unseenMessageKeys(keys: readonly string[]): Promise<string[]>;
  /** Libera a chave de idempotência (usado só para status cujo tratamento falhou, para a Meta poder reenviar). */
  unclaimMessage(key: string): Promise<void>;
  /** Atualiza last_user_message_at do usuário (nunca regride). */
  touchUser(waId: string, at: Date): Promise<void>;
  getLastUserMessageAt(waId: string): Promise<Date | null>;
  /** Etapa 3: estado persistido da conversa (padrão NEW quando não há registro). */
  getConversation(waId: string): Promise<StoredConversation>;
  /**
   * Compare-and-set: grava o novo estado só se a versão ainda for `expectedVersion`.
   * Devolve false se outra mensagem mudou o estado antes (evita resposta dupla em rajadas).
   */
  saveConversation(waId: string, expectedVersion: number, next: ConversationFields): Promise<boolean>;
  /** Etapa 4: situação do cadastro (nada além do estado técnico antes do aceite). */
  getRegistration(waId: string): Promise<RegistrationRecord>;
  /** Grava parte do cadastro. Lança se a pessoa não existir. */
  saveRegistration(waId: string, patch: RegistrationPatch): Promise<void>;
  /** Tema sensível: grava só o evento (nível, canal, data), nunca o texto. */
  recordSensitiveEvent(waIdHash: string, level: "A" | "B", channel: string, at: Date): Promise<void>;
  /** Instante do último evento sensível da pessoa (null = nunca). Define o modo cuidado de 1 h. */
  lastSensitiveEventAt(waIdHash: string): Promise<Date | null>;
  /**
   * Opções (botões/lista) da última mensagem interativa enviada, em texto numerado. `null` apaga.
   * Sem isto o "2" digitado pela pessoa não teria como voltar ao id da opção (canal Evolution/Baileys).
   */
  setPendingChoices(waIdHash: string, options: PendingChoiceOption[] | null, at: Date): Promise<void>;
  getPendingChoices(waIdHash: string): Promise<{ options: PendingChoiceOption[]; createdAt: Date } | null>;
  /** Instantes (reserved_at) das mensagens do bot para a pessoa desde `since`. */
  listOutboundSince(waIdHash: string, since: Date): Promise<Date[]>;
  /** Etapa 5: serviços ativos (o corte em 10 e a ordenação final são do ContentProvider). */
  listActiveServices(): Promise<Service[]>;
  /** Etapa 5: respostas prontas (chave -> texto). */
  listCannedResponses(): Promise<Record<string, string>>;
  /** Etapa 6: registra o áudio guardado (o banco recusa se a pessoa não deu consentimento, R6). */
  insertAudio(rec: AudioRecord): Promise<void>;
  /** Etapa 6: fecha o processamento do áudio (resultado fica salvo mesmo que não seja enviado). */
  finishAudio(id: string, status: "done" | "failed", result: unknown, at: Date): Promise<void>;
  /** Etapa 7: consulta leve (mantém o projeto Supabase ativo). Lança se o banco estiver fora. */
  ping(): Promise<void>;
  /** Etapa 7: apaga idempotência anterior a `before`. Devolve quantas linhas saíram. */
  deleteProcessedBefore(before: Date): Promise<number>;
  /** Etapa 7: conversas em PROCESSING_AUDIO desde antes de `before` voltam a AWAIT_AUDIO, sem enviar nada. */
  releaseStuckProcessing(before: Date): Promise<number>;
  /** Dúvida do mentorado (texto + áreas da triagem). Exige consentimento (R6). */
  /** Dias e horários livres informados pela pessoa (texto livre). Lança se a pessoa não existir. */
  saveAvailability(waId: string, text: string, at: Date, slots?: readonly { day: string; start: string; end: string }[]): Promise<void>;
  /** Material (documento) anexado junto da dúvida. Sem consentimento, lança (R6). */
  insertMaterial(waId: string, m: { id: string; waIdHash: string; r2Key: string; mime: string; bytes: number; filename?: string; at: Date }): Promise<void>;
  insertDoubt(waId: string, doubt: { waIdHash: string; text: string; categories: string[]; at: Date }): Promise<void>; // grava também o wa_id e status "aberta"
  /** Mentoria: rascunho em andamento (papel, assunto, com quem). */
  getMentoriaDraft(waId: string): Promise<MentoriaDraft>;
  /** Mescla campos no rascunho; `null` apaga o rascunho inteiro. Lança se a pessoa não existir. */
  saveMentoriaDraft(waId: string, patch: Partial<MentoriaDraft> | null): Promise<void>;
  /** Pessoa cadastrada com este hash de telefone (só quem já tem wa_id_hash gravado). */
  findPersonByWaIdHash(hash: string): Promise<PersonRef | null>;
  /** Busca por nome entre quem já se cadastrou e consentiu (todas as palavras, sem acento). Máx. `limit`. */
  findPeopleByName(tokens: readonly string[], limit: number): Promise<PersonRef[]>;
  /** Completa a mentoria cujo áudio já está guardado. Idempotente. false se o áudio não é desta pessoa. */
  completeMentoria(waId: string, c: MentoriaCompletion): Promise<boolean>;
  /** Apaga o registro de uma mentoria INCOMPLETA (devolve a chave no R2) e limpa o rascunho que a aponta. */
  discardIncompleteMentoria(id: string): Promise<{ r2Key: string } | null>;
  /** Mentorias incompletas criadas antes de `before` (fluxo abandonado). */
  listIncompleteMentorias(before: Date): Promise<{ id: string; r2Key: string }[]>;
  /** Mentorias completas sem resposta do parceiro, criadas antes de `before`. */
  listUnansweredMentorias(before: Date): Promise<{ id: string; r2Key: string }[]>;
  /** Marca como expirada (sem resposta) e registra a saída do áudio do R2. false se já foi respondida. */
  expireMentoria(id: string, at: Date): Promise<boolean>;
  /** Confirmações pendentes para quem tem algum destes hashes de telefone (as mais antigas primeiro). */
  listPendingConfirmations(partnerHashes: readonly string[]): Promise<PendingConfirmation[]>;
  /** Registra que a pergunta foi entregue ao parceiro. */
  markPartnerPrompted(id: string, at: Date): Promise<void>;
  /**
   * Registra a resposta do parceiro. "rejected" também marca a mentoria como contestada e o áudio como apagado
   * (quem chama apaga o objeto do R2 ANTES). `asHash` = wa_id_hash de quem responde (corrige a variação do 9º dígito).
   * O banco recusa se o parceiro não consentiu (R6).
   */
  answerPartner(id: string, partnerHashes: readonly string[], answer: "yes" | "no", at: Date, asHash: string): Promise<PartnerAnswerOutcome>;
}

export type MentoriaRole = "mentor" | "mentorado";
export interface MentoriaDraft {
  role?: MentoriaRole;
  subject?: string;
  partner?: string;
  /** Áudio já guardado (sem metadados ainda) que esta conversa está descrevendo. */
  audioId?: string;
  /** Data em que a mentoria aconteceu (YYYY-MM-DD). */
  occurredOn?: string;
}

/** Pessoa cadastrada (só o que o fluxo de mentoria precisa). */
export interface PersonRef {
  waId: string;
  waIdHash: string;
  fullName: string | null;
  consentAt: Date | null;
  termsVersion: string | null;
}

/** Mentoria completa esperando a resposta do parceiro. */
export interface PendingConfirmation {
  id: string;
  registrantName: string | null;
  subject: string;
  occurredOn: string;
  createdAt: Date;
  /** Pergunta já entregue ao parceiro? */
  prompted: boolean;
  partnerHash: string;
}

/** Dados que completam uma mentoria (áudio já guardado). */
export interface MentoriaCompletion {
  audioId: string;
  role: MentoriaRole;
  subject: string;
  occurredOn: string;
  partnerHash: string;
  partnerName: string | null;
}

/** Resultado da resposta do parceiro. */
export type PartnerAnswerOutcome = "confirmed" | "rejected" | "already" | "not_found" | "no_consent";

/** Mentoria guardada (um áudio + metadados informados na conversa). */
export interface MentoriaRow {
  id: string;
  waIdHash: string;
  role: MentoriaRole | null;
  subject: string | null;
  partner: string | null;
  mime: string;
  bytes: number;
  r2Key: string;
  createdAt: Date;
  /** Resultado do analisador externo; null = análise pendente. */
  analysisResult: unknown;
  analysisAt: Date | null;
  /** Dados de quem registrou (cadastro), quando existirem. */
  registrant?: { name: string | null; phoneMasked: string | null };
  /** Data em que a mentoria aconteceu (YYYY-MM-DD); nula nas mentorias anteriores à v2. */
  ocorreuEm?: string | null;
  partnerHash?: string | null;
  partnerConfirmedAt?: Date | null;
  partnerRejectedAt?: Date | null;
  audioSha256?: string | null;
  audioDeletedAt?: Date | null;
  contestedReason?: "recusada" | "expirada" | null;
  /** Última situação da curadoria já avisada, por pessoa_id (hash). Vazio/ausente = ninguém avisado. */
  notifiedCuradoria?: Record<string, string> | null;
}

/** Pedido de revisão humana (botão "Pedir revisão" da mensagem de recusa). */
export interface CertificateRequest {
  id: string;
  waIdHash: string;
  status: "aberto" | "emitido";
  createdAt: Date;
}
export interface ReviewRequest {
  id: string;
  audioId: string;
  waIdHash: string;
  status: "aberta" | "atendida";
  createdAt: Date;
}

/** Leitura e atualização das mentorias (painel e API de integração). */
export interface MentoriaRepo {
  /**
   * Lista mentorias COMPLETAS. `pending` = sem resultado, áudio ainda guardado e (se for v2) confirmada pelo parceiro:
   * só isso o notebook pode processar (R6: a voz do parceiro). Mentorias anteriores à v2 (sem `ocorreuEm`) seguem listadas.
   */
  listMentorias(o: { pending?: boolean; limit: number; before?: Date }): Promise<MentoriaRow[]>;
  getMentoria(id: string): Promise<MentoriaRow | null>;
  /** Grava o resultado da análise. false se a mentoria não existe. */
  setAnalysisResult(id: string, result: unknown, at: Date): Promise<boolean>;
  /** Reserva atômica do aviso da curadoria: grava a situação só se ainda não foi avisada. true = quem chamou deve enviar. */
  claimCuradoriaNotice(id: string, pessoaId: string, situacao: string): Promise<boolean>;
  /** Desfaz a reserva (envio falhou), só se ninguém a mudou depois. `previous` = o que estava gravado antes (null = nada). */
  releaseCuradoriaNotice(id: string, pessoaId: string, situacao: string, previous: string | null): Promise<void>;
  /** Registra o pedido de revisão. true = pedido novo; false = já existia (idempotente). */
  requestReview(audioId: string, waIdHash: string, at: Date): Promise<boolean>;
  listReviewRequests(o: { status?: "aberta" | "atendida"; limit: number }): Promise<ReviewRequest[]>;
  /** Pedido de certificado de horas. false = a pessoa já tem um pedido ABERTO (não cria outro). */
  requestCertificate(waIdHash: string, at: Date): Promise<boolean>;
  listCertificateRequests(o: { status?: "aberto" | "emitido"; limit: number }): Promise<CertificateRequest[]>;
}

/** Bloqueio de tentativas de login do painel. */
export interface LoginAttemptRepo {
  getLoginLock(key: string): Promise<{ failures: number; lockedUntil: Date | null }>;
  recordLoginFailure(key: string, now: Date, maxFailures: number, lockMs: number): Promise<void>;
  clearLoginFailures(key: string): Promise<void>;
}

export interface AudioRecord {
  id: string;
  waIdHash: string;
  r2Key: string;
  mime: string;
  bytes: number;
  serviceId: string | null;
  /** Metadados da mentoria (quando o áudio veio do fluxo de mentoria). Ausente = áudio guardado, mentoria ainda incompleta. */
  mentoria?: { role?: MentoriaRole; subject: string; partner?: string };
  ocorreuEm?: string;
  partnerWaIdHash?: string;
  partnerPromptedAt?: Date;
  partnerConfirmedAt?: Date;
  partnerRejectedAt?: Date;
  audioSha256?: string;
  audioDeletedAt?: Date;
  contestedReason?: "recusada" | "expirada";
  notifiedCuradoria?: Record<string, string>;
  status: "processing" | "done" | "failed";
  result: unknown;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface RegistrationRecord {
  consentAt: Date | null;
  termsVersion: string | null;
  registeredAt: Date | null;
  /** Campos já gravados (chave = coluna). */
  values: Record<string, string>;
  profileRole?: "mentor" | "mentorado" | "ambos";
  mentorCategories?: string[];
  /** Curiosidades escritas (alternativa ao áudio de perfil). */
  profileAbout?: string;
  /** Faixas de horário livres já gravadas (vazio/ausente = nenhuma). */
  availabilitySlots?: { day: string; start: string; end: string }[];
  availabilityAt?: Date | null;
}
export interface RegistrationPatch {
  waIdHash?: string;
  consentAt?: Date;
  termsVersion?: string;
  registeredAt?: Date;
  /** Chaves de FIELDS (outras são ignoradas). */
  values?: Record<string, string>;
  /** Papel escolhido no cadastro. */
  profileRole?: "mentor" | "mentorado" | "ambos";
  /** Áreas em que o mentor topa ajudar (chaves de CATEGORIES). */
  mentorCategories?: string[];
  /** Curiosidades escritas pela pessoa (até 1000 caracteres). */
  profileAbout?: string;
}

export interface ConversationFields {
  state: string;
  previousState: string | null;
  hintSentInState: boolean;
  optedOutAt: Date | null;
  lastServiceId?: string | null;
}
/** ---- Matching manual (mentor <-> mentorado, feito por um admin) ---- */
export type DoubtStatus = "aberta" | "em_match" | "concluida" | "cancelada";
export type MatchStatus = "aguardando_mentor" | "aguardando_mentorado" | "aguardando_local" | "confirmado" | "realizada" | "sem_horario" | "cancelado";
export interface Slot { day: string; start: string; end: string }
export interface DoubtRow {
  id: string;
  /** Id curto para o admin ("D12" = seq 12). */
  seq: number;
  waId: string;
  text: string;
  categories: string[];
  status: DoubtStatus;
  createdAt: Date;
}
export interface MemberCounts { mentors: number; mentees: number; total: number }
export interface MentorRow {
  /** Id curto para o admin ("M3" = seq 3). */
  seq: number;
  waId: string;
  name: string | null;
  categories: string[];
  slots: Slot[];
}
export interface MatchRow {
  id: string;
  seq: number;
  doubtId: string;
  mentorWaId: string;
  menteeWaId: string;
  status: MatchStatus;
  mentorSlots: Slot[] | null;
  chosenDay: string | null;
  chosenStart: string | null;
  chosenEnd: string | null;
  location: string | null;
  /** Instante marcado do início da mentoria (UTC). null = ainda não fechada. */
  scheduledAt: Date | null;
  /** Quando os nomes foram enviados aos dois (5 min antes). null = anônimos. */
  namesSentAt: Date | null;
  createdBy: string;
  createdAt: Date;
}
export type MatchPatch = Partial<Pick<MatchRow, "status" | "mentorSlots" | "chosenDay" | "chosenStart" | "chosenEnd" | "location" | "scheduledAt">>;
/** Match com a dúvida que o originou (para o painel). */
export interface MatchDetail extends MatchRow { doubtSeq: number; doubtText: string; doubtCategories: string[] }
export interface MatchingRepo {
  /**
   * Troca o texto e as áreas da dúvida MAIS RECENTE da pessoa, se ela ainda estiver 'aberta' (sem mentor conectado).
   * `false` = não há dúvida aberta para trocar.
   */
  replaceOpenDoubt(waId: string, doubt: { text: string; categories: string[] }): Promise<boolean>;
  /** Matches mais recentes primeiro, com a dúvida. */
  listMatches(limit: number): Promise<MatchDetail[]>;
  /** Nome completo por telefone (quem ainda não tem nome fica de fora). */
  getFullNames(waIds: readonly string[]): Promise<Record<string, string>>;
  /** Dúvidas com status 'aberta', mais antigas primeiro. */
  listOpenDoubts(limit: number): Promise<DoubtRow[]>;
  getDoubtBySeq(seq: number): Promise<DoubtRow | null>;
  getDoubtById(id: string): Promise<DoubtRow | null>;
  /** Mentores cadastrados (papel mentor/ambos, com consentimento), por id curto. */
  listMentors(limit: number): Promise<MentorRow[]>;
  getMentorBySeq(seq: number): Promise<MentorRow | null>;
  /** Inscritos com cadastro concluído e consentimento: mentores e mentorados (quem é "ambos" entra nos dois) e o total de pessoas (sem contar duas vezes). */
  countMembers(): Promise<MemberCounts>;
  /** Cria o match e passa a dúvida para 'em_match'. null se a dúvida não está mais 'aberta' (outro admin chegou antes). */
  createMatch(m: { doubtId: string; mentorWaId: string; menteeWaId: string; createdBy: string; at: Date }): Promise<MatchRow | null>;
  getMatchBySeq(seq: number): Promise<MatchRow | null>;
  /** Match ativo (não cancelado nem confirmado) em que a pessoa é o mentor ou o mentorado. */
  getActiveMatchFor(waId: string): Promise<MatchRow | null>;
  updateMatch(id: string, patch: MatchPatch, at: Date): Promise<void>;
  /** Último match 'confirmado' (mentoria marcada, ainda sem áudio registrado) em que a pessoa é mentor ou mentorado. */
  getConfirmedMatchFor(waId: string): Promise<MatchRow | null>;
  /** Matches confirmados com horário marcado até `until` (e depois de `since`) cujos nomes ainda não foram enviados. */
  listMatchesDueForNames(since: Date, until: Date): Promise<MatchRow[]>;
  /** Reserva atômica do envio dos nomes. true = quem chamou deve enviar. */
  claimNamesSent(id: string, at: Date): Promise<boolean>;
  /** Desfaz a reserva (envio falhou) para a próxima rodada tentar de novo. */
  releaseNamesSent(id: string): Promise<void>;
  /** Cancela o match e reabre a dúvida ('aberta'). false se já estava cancelado ou não existe. */
  cancelMatch(seq: number, at: Date): Promise<boolean>;
}

export interface PendingChoiceOption {
  id: string;
  title: string;
}

export interface StoredConversation extends ConversationFields {
  version: number;
}

/** ---- Etapa 2: orçamento (R1) ---- */
export interface ReserveOutcome {
  ok: boolean;
  reservedCount: number;
  stopAt: number;
  tripped: boolean;
}
export interface BudgetRow {
  phoneNumberId: string;
  monthKey: string;
  reservedCount: number;
  stopAt: number;
  tripped: boolean;
  tripReason: string | null;
  trippedAt: Date | null;
}
export interface ManualLock {
  locked: boolean;
  reason: string | null;
  lockedAt: Date | null;
  unlockedAt: Date | null;
  unlockedBy: string | null;
}
export interface OutboundLogEntry {
  waIdHash: string;
  messageType: string;
  wamid: string | null;
  reservedAt: Date;
  sentOk: boolean;
  errorCode: string | null;
}
export interface PricingUpdate {
  billable?: boolean;
  type?: string;
  category?: string;
}

export interface BudgetRepo {
  /** Reserva atômica de uma vaga. Lança em caso de erro (quem chama trata como recusa). */
  reserveSlot(phoneNumberId: string, monthKey: string, stopAt: number): Promise<ReserveOutcome>;
  getBudget(phoneNumberId: string, monthKey: string): Promise<BudgetRow | null>;
  getManualLock(phoneNumberId: string): Promise<ManualLock>;
  setManualLock(phoneNumberId: string, reason: string): Promise<void>;
  clearManualLock(phoneNumberId: string, by: string): Promise<void>;
  /** true só para o primeiro que marcar o alerta no mês (warn | trip). */
  claimBudgetAlert(phoneNumberId: string, monthKey: string, kind: "warn" | "trip"): Promise<boolean>;
  insertOutboundLog(entry: OutboundLogEntry): Promise<void>;
  /** Grava o pricing do status webhook; false se o wamid não existe no log. */
  updateOutboundPricing(wamid: string, pricing: PricingUpdate, at: Date): Promise<boolean>;
}
