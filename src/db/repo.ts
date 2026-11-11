import type { Service } from "../services/content";

/** Acesso a dados. Implementações: memória (testes) e Supabase (produção). */
export interface Repo extends BudgetRepo, MentoriaRepo {
  /**
   * Registra a chave de idempotência (wamid) ANTES de processar.
   * Devolve true se foi inserida agora; false se já existia. Deve ser atômico.
   */
  claimMessage(key: string, receivedAt: Date): Promise<boolean>;
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
  insertDoubt(waId: string, doubt: { waIdHash: string; text: string; categories: string[]; at: Date }): Promise<void>;
  /** Mentoria: rascunho em andamento (papel, assunto, com quem). */
  getMentoriaDraft(waId: string): Promise<MentoriaDraft>;
  /** Mescla campos no rascunho; `null` apaga o rascunho inteiro. Lança se a pessoa não existir. */
  saveMentoriaDraft(waId: string, patch: Partial<MentoriaDraft> | null): Promise<void>;
}

export type MentoriaRole = "mentor" | "mentorado";
export interface MentoriaDraft {
  role?: MentoriaRole;
  subject?: string;
  partner?: string;
}

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
}

/** Leitura e atualização das mentorias (painel e API de integração). */
export interface MentoriaRepo {
  listMentorias(o: { pending?: boolean; limit: number; before?: Date }): Promise<MentoriaRow[]>;
  getMentoria(id: string): Promise<MentoriaRow | null>;
  /** Grava o resultado da análise. false se a mentoria não existe. */
  setAnalysisResult(id: string, result: unknown, at: Date): Promise<boolean>;
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
  /** Metadados da mentoria (quando o áudio veio do fluxo de mentoria). */
  mentoria?: { role?: MentoriaRole; subject: string; partner?: string };
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
