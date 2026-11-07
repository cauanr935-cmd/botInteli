import type { Service } from "../services/content";

/** Acesso a dados. Implementações: memória (testes) e Supabase (produção). */
export interface Repo extends BudgetRepo {
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
}

export interface AudioRecord {
  id: string;
  waIdHash: string;
  r2Key: string;
  mime: string;
  bytes: number;
  serviceId: string | null;
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
}
export interface RegistrationPatch {
  waIdHash?: string;
  consentAt?: Date;
  termsVersion?: string;
  registeredAt?: Date;
  /** Chaves de FIELDS (outras são ignoradas). */
  values?: Record<string, string>;
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
