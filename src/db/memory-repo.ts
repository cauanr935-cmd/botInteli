import { MAX_STOP_AT } from "../config";
import type {
  BudgetRow, ManualLock, OutboundLogEntry, PricingUpdate, Repo, ReserveOutcome,
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
