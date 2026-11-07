import { MAX_STOP_AT } from "../config";
import { FIELD_KEYS } from "../registration/fields";
import type { Service } from "../services/content";
import type {
  BudgetRow, ConversationFields, RegistrationPatch, RegistrationRecord, StoredConversation, ManualLock, OutboundLogEntry, PricingUpdate, Repo, ReserveOutcome,
} from "./repo";

export interface MemoryOutboundRow extends OutboundLogEntry {
  pricingBillable?: boolean;
  pricingType?: string;
  pricingCategory?: string;
  statusUpdatedAt?: Date;
}

export class MemoryRepo implements Repo {
  readonly processed = new Map<string, Date>();
  readonly users = new Map<string, Date>();
  readonly budgets = new Map<string, BudgetRow & { warned: boolean; tripLogged: boolean }>();
  readonly locks = new Map<string, ManualLock>();
  readonly outbound: MemoryOutboundRow[] = [];
  readonly conversations = new Map<string, StoredConversation>();

  async claimMessage(key: string, receivedAt: Date): Promise<boolean> {
    // Síncrono dentro do método: check-and-set atômico no event loop.
    if (this.processed.has(key)) return false;
    this.processed.set(key, receivedAt);
    return true;
  }
  async unclaimMessage(key: string): Promise<void> {
    this.processed.delete(key);
  }
  async touchUser(waId: string, at: Date): Promise<void> {
    const cur = this.users.get(waId);
    if (!cur || cur < at) this.users.set(waId, at);
  }
  async getLastUserMessageAt(waId: string): Promise<Date | null> {
    return this.users.get(waId) ?? null;
  }

  // ---- Etapa 3: conversa ----
  async getConversation(waId: string): Promise<StoredConversation> {
    return (
      this.conversations.get(waId) ?? {
        state: "NEW", previousState: null, hintSentInState: false, optedOutAt: null, version: 0,
      }
    );
  }
  async saveConversation(waId: string, expectedVersion: number, next: ConversationFields): Promise<boolean> {
    // Sem await entre ler e escrever: compare-and-set atômico.
    const cur = this.conversations.get(waId)?.version ?? 0;
    if (cur !== expectedVersion) return false;
    this.conversations.set(waId, { ...next, version: cur + 1 });
    return true;
  }
  // ---- Etapa 4: cadastro ----
  readonly registrations = new Map<string, RegistrationRecord & { waIdHash?: string }>();
  async getRegistration(waId: string): Promise<RegistrationRecord> {
    const r = this.registrations.get(waId);
    return r
      ? { ...r, values: { ...r.values } }
      : { consentAt: null, termsVersion: null, registeredAt: null, values: {} };
  }
  async saveRegistration(waId: string, patch: RegistrationPatch): Promise<void> {
    if (!this.users.has(waId)) throw new Error("usuario inexistente");
    const cur = this.registrations.get(waId) ?? { consentAt: null, termsVersion: null, registeredAt: null, values: {} };
    const values = { ...cur.values };
    for (const [k, v] of Object.entries(patch.values ?? {})) if (FIELD_KEYS.includes(k)) values[k] = v;
    const next = {
      ...cur, values,
      ...(patch.waIdHash ? { waIdHash: patch.waIdHash } : {}),
      consentAt: patch.consentAt ?? cur.consentAt,
      termsVersion: patch.termsVersion ?? cur.termsVersion,
      registeredAt: patch.registeredAt ?? cur.registeredAt,
    };
    // Mesma regra do CHECK do banco (R6): sem consentimento, nenhum dado de cadastro.
    if (!next.consentAt && (Object.keys(values).length > 0 || next.registeredAt)) throw new Error("sem consentimento");
    this.registrations.set(waId, next);
  }
  // ---- Etapa 5: conteúdo ----
  /** Serviços ATIVOS (testes preenchem). */
  services: Service[] = [];
  readonly canned = new Map<string, string>();
  async listActiveServices(): Promise<Service[]> {
    return this.services.map((s) => ({ ...s }));
  }
  async listCannedResponses(): Promise<Record<string, string>> {
    return Object.fromEntries(this.canned);
  }
  async listOutboundSince(waIdHash: string, since: Date): Promise<Date[]> {
    return this.outbound.filter((r) => r.waIdHash === waIdHash && r.reservedAt >= since).map((r) => r.reservedAt);
  }

  // ---- orçamento: mesma semântica da função SQL (sem await entre ler e escrever) ----
  async reserveSlot(phoneNumberId: string, monthKey: string, stopAt: number): Promise<ReserveOutcome> {
    const cap = Math.min(stopAt, MAX_STOP_AT);
    if (!(cap >= 1)) throw new Error("stop_at invalido");
    const k = `${phoneNumberId}|${monthKey}`;
    let b = this.budgets.get(k);
    if (!b) {
      b = {
        phoneNumberId, monthKey, reservedCount: 0, stopAt: cap, tripped: false,
        tripReason: null, trippedAt: null, warned: false, tripLogged: false,
      };
      this.budgets.set(k, b);
    }
    const limit = Math.min(b.stopAt, cap);
    const locked = this.locks.get(phoneNumberId)?.locked === true;
    if (b.reservedCount < limit && !locked) {
      b.reservedCount += 1;
      b.stopAt = limit;
      if (b.reservedCount >= limit) this.trip(b);
      return { ok: true, reservedCount: b.reservedCount, stopAt: b.stopAt, tripped: b.tripped };
    }
    if (b.reservedCount >= limit) this.trip(b);
    return { ok: false, reservedCount: b.reservedCount, stopAt: b.stopAt, tripped: b.tripped };
  }
  private trip(b: BudgetRow): void {
    if (!b.tripped) {
      b.tripped = true;
      b.tripReason = "limite mensal atingido";
      b.trippedAt = new Date();
    }
  }
  async getBudget(phoneNumberId: string, monthKey: string): Promise<BudgetRow | null> {
    const b = this.budgets.get(`${phoneNumberId}|${monthKey}`);
    return b ? { ...b } : null;
  }
  async getManualLock(phoneNumberId: string): Promise<ManualLock> {
    return (
      this.locks.get(phoneNumberId) ?? {
        locked: false, reason: null, lockedAt: null, unlockedAt: null, unlockedBy: null,
      }
    );
  }
  async setManualLock(phoneNumberId: string, reason: string): Promise<void> {
    const cur = this.locks.get(phoneNumberId);
    this.locks.set(phoneNumberId, {
      locked: true, reason, lockedAt: new Date(),
      unlockedAt: cur?.unlockedAt ?? null, unlockedBy: cur?.unlockedBy ?? null,
    });
  }
  async clearManualLock(phoneNumberId: string, by: string): Promise<void> {
    const cur = this.locks.get(phoneNumberId);
    if (!cur) return;
    this.locks.set(phoneNumberId, { ...cur, locked: false, unlockedAt: new Date(), unlockedBy: by });
  }
  async claimBudgetAlert(phoneNumberId: string, monthKey: string, kind: "warn" | "trip"): Promise<boolean> {
    const b = this.budgets.get(`${phoneNumberId}|${monthKey}`);
    if (!b) return false;
    if (kind === "warn") {
      if (b.warned) return false;
      b.warned = true;
      return true;
    }
    if (b.tripLogged) return false;
    b.tripLogged = true;
    return true;
  }
  async insertOutboundLog(entry: OutboundLogEntry): Promise<void> {
    this.outbound.push({ ...entry });
  }
  async updateOutboundPricing(wamid: string, pricing: PricingUpdate, at: Date): Promise<boolean> {
    const row = this.outbound.find((r) => r.wamid === wamid);
    if (!row) return false;
    row.pricingBillable = pricing.billable;
    row.pricingType = pricing.type;
    row.pricingCategory = pricing.category;
    row.statusUpdatedAt = at;
    return true;
  }
}
