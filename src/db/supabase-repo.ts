import type {
  BudgetRow, ManualLock, OutboundLogEntry, PricingUpdate, Repo, ReserveOutcome,
} from "./repo";

/** Repo sobre a API REST (PostgREST) do Supabase. */
export class SupabaseRepo implements Repo {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async claimMessage(key: string, receivedAt: Date): Promise<boolean> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/processed_messages?on_conflict=wamid`, {
      method: "POST",
      headers: this.headers({ Prefer: "resolution=ignore-duplicates,return=representation" }),
      body: JSON.stringify({ wamid: key, received_at: receivedAt.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase claimMessage falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }

  async unclaimMessage(key: string): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/processed_messages?wamid=eq.${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`supabase unclaimMessage falhou: ${res.status}`);
  }

  async touchUser(waId: string, at: Date): Promise<void> {
    // Chama função SQL que usa greatest() para nunca regredir o horário.
    const res = await this.fetchImpl(`${this.url}/rest/v1/rpc/touch_user`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ p_wa_id: waId, p_at: at.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase touchUser falhou: ${res.status}`);
  }

  async getLastUserMessageAt(waId: string): Promise<Date | null> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}&select=last_user_message_at`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getLastUserMessageAt falhou: ${res.status}`);
    const rows = (await res.json()) as { last_user_message_at: string }[];
    const r = rows[0];
    return r ? new Date(r.last_user_message_at) : null;
  }

  // ---- Etapa 2: orçamento ----
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`supabase ${fn} falhou: ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async reserveSlot(phoneNumberId: string, monthKey: string, stopAt: number): Promise<ReserveOutcome> {
    const rows = await this.rpc<
      { ok: boolean; reserved_count: number; stop_at: number; tripped: boolean }[]
    >("reserve_outbound_slot_detail", {
      p_phone_number_id: phoneNumberId, p_month_key: monthKey, p_stop_at: stopAt,
    });
    const r = Array.isArray(rows) ? rows[0] : undefined;
    if (!r || typeof r.ok !== "boolean") throw new Error("supabase reserveSlot: resposta inválida");
    return { ok: r.ok, reservedCount: r.reserved_count, stopAt: r.stop_at, tripped: r.tripped };
  }

  async getBudget(phoneNumberId: string, monthKey: string): Promise<BudgetRow | null> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/message_budget?phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&month_key=eq.${encodeURIComponent(monthKey)}&select=*`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getBudget falhou: ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    const r = rows[0];
    if (!r) return null;
    return {
      phoneNumberId, monthKey,
      reservedCount: Number(r.reserved_count), stopAt: Number(r.stop_at),
      tripped: r.tripped === true,
      tripReason: (r.trip_reason as string | null) ?? null,
      trippedAt: r.tripped_at ? new Date(r.tripped_at as string) : null,
    };
  }

  async getManualLock(phoneNumberId: string): Promise<ManualLock> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/budget_lock?phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&select=*`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getManualLock falhou: ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    const r = rows[0];
    const d = (v: unknown) => (v ? new Date(v as string) : null);
    return {
      locked: r?.locked === true,
      reason: (r?.reason as string | null) ?? null,
      lockedAt: d(r?.locked_at), unlockedAt: d(r?.unlocked_at),
      unlockedBy: (r?.unlocked_by as string | null) ?? null,
    };
  }

  async setManualLock(phoneNumberId: string, reason: string): Promise<void> {
    await this.rpc("set_manual_lock", { p_phone_number_id: phoneNumberId, p_reason: reason });
  }
  async clearManualLock(phoneNumberId: string, by: string): Promise<void> {
    await this.rpc("clear_manual_lock", { p_phone_number_id: phoneNumberId, p_by: by });
  }
  async claimBudgetAlert(phoneNumberId: string, monthKey: string, kind: "warn" | "trip"): Promise<boolean> {
    const r = await this.rpc<boolean>("claim_budget_alert", {
      p_phone_number_id: phoneNumberId, p_month_key: monthKey, p_kind: kind,
    });
    return r === true;
  }

  async insertOutboundLog(e: OutboundLogEntry): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/outbound_log`, {
      method: "POST",
      headers: this.headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        wa_id_hash: e.waIdHash, message_type: e.messageType, wamid: e.wamid,
        reserved_at: e.reservedAt.toISOString(), sent_ok: e.sentOk, error_code: e.errorCode,
      }),
    });
    if (!res.ok) throw new Error(`supabase insertOutboundLog falhou: ${res.status}`);
  }

  async updateOutboundPricing(wamid: string, p: PricingUpdate, at: Date): Promise<boolean> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/outbound_log?wamid=eq.${encodeURIComponent(wamid)}`,
      {
        method: "PATCH",
        headers: this.headers({ Prefer: "return=representation" }),
        body: JSON.stringify({
          pricing_billable: p.billable ?? null, pricing_type: p.type ?? null,
          pricing_category: p.category ?? null, status_updated_at: at.toISOString(),
        }),
      },
    );
    if (!res.ok) throw new Error(`supabase updateOutboundPricing falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }
}
