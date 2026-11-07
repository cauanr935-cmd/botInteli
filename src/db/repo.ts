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
