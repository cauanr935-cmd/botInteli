import type { Repo } from "./repo";

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
}
