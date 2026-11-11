import { maskPhone } from "../lib/logger";
import { FIELD_KEYS } from "../registration/fields";
import type { Service } from "../services/content";
import type {
  AudioRecord,
  BudgetRow, ConversationFields, LoginAttemptRepo, MentoriaDraft, MentoriaRepo, MentoriaRow, RegistrationPatch, RegistrationRecord, StoredConversation, ManualLock, OutboundLogEntry, PricingUpdate, Repo, ReserveOutcome,
} from "./repo";

/** Repo sobre a API REST (PostgREST) do Supabase. */
export class SupabaseRepo implements Repo, MentoriaRepo, LoginAttemptRepo {
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

  // ---- Etapa 3: conversa ----
  async getConversation(waId: string): Promise<StoredConversation> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}&select=state,previous_state,hint_sent_in_state,opted_out_at,last_service_id,version`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getConversation falhou: ${res.status}`);
    const r = ((await res.json()) as Record<string, unknown>[])[0];
    if (!r) return { state: "NEW", previousState: null, hintSentInState: false, optedOutAt: null, version: 0 };
    return {
      state: String(r.state),
      previousState: (r.previous_state as string | null) ?? null,
      hintSentInState: r.hint_sent_in_state === true,
      optedOutAt: r.opted_out_at ? new Date(r.opted_out_at as string) : null,
      lastServiceId: (r.last_service_id as string | null) ?? null,
      version: Number(r.version),
    };
  }

  async saveConversation(waId: string, expectedVersion: number, n: ConversationFields): Promise<boolean> {
    // PATCH condicionado à versão: só uma de duas mensagens simultâneas vence.
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}&version=eq.${expectedVersion}`,
      {
        method: "PATCH",
        headers: this.headers({ Prefer: "return=representation" }),
        body: JSON.stringify({
          state: n.state, previous_state: n.previousState, hint_sent_in_state: n.hintSentInState,
          last_service_id: n.lastServiceId ?? null,
          opted_out_at: n.optedOutAt ? n.optedOutAt.toISOString() : null, version: expectedVersion + 1,
        }),
      },
    );
    if (!res.ok) throw new Error(`supabase saveConversation falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }

  // ---- Etapa 4: cadastro ----
  async getRegistration(waId: string): Promise<RegistrationRecord> {
    const cols = ["consent_at", "terms_version", "registered_at", "profile_role", "mentor_categories", "profile_about", "availability_slots", "availability_at", ...FIELD_KEYS].join(",");
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}&select=${cols}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getRegistration falhou: ${res.status}`);
    const r = ((await res.json()) as Record<string, unknown>[])[0];
    const d = (v: unknown) => (v ? new Date(v as string) : null);
    const values: Record<string, string> = {};
    for (const k of FIELD_KEYS) if (typeof r?.[k] === "string") values[k] = r[k] as string;
    return {
      consentAt: d(r?.consent_at), termsVersion: (r?.terms_version as string | null) ?? null,
      registeredAt: d(r?.registered_at), values,
      ...(r?.profile_role === "mentor" || r?.profile_role === "mentorado" || r?.profile_role === "ambos" ? { profileRole: r.profile_role } : {}),
      ...(Array.isArray(r?.mentor_categories) ? { mentorCategories: r.mentor_categories as string[] } : {}),
      ...(typeof r?.profile_about === "string" ? { profileAbout: r.profile_about } : {}),
      ...(Array.isArray(r?.availability_slots) ? { availabilitySlots: r.availability_slots as { day: string; start: string; end: string }[] } : {}),
      availabilityAt: d(r?.availability_at),
    };
  }

  async saveRegistration(waId: string, p: RegistrationPatch): Promise<void> {
    const body: Record<string, unknown> = {};
    if (p.waIdHash) body.wa_id_hash = p.waIdHash;
    if (p.consentAt) body.consent_at = p.consentAt.toISOString();
    if (p.termsVersion) body.terms_version = p.termsVersion;
    if (p.registeredAt) body.registered_at = p.registeredAt.toISOString();
    for (const [k, v] of Object.entries(p.values ?? {})) if (FIELD_KEYS.includes(k)) body[k] = v;
    if (p.profileRole) body.profile_role = p.profileRole;
    if (p.mentorCategories) body.mentor_categories = p.mentorCategories;
    if (p.profileAbout) body.profile_about = p.profileAbout;
    const res = await this.fetchImpl(`${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}`, {
      method: "PATCH",
      headers: this.headers({ Prefer: "return=representation" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`supabase saveRegistration falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("supabase saveRegistration: usuario inexistente");
  }

  async saveAvailability(waId: string, text: string, at: Date, slots?: readonly { day: string; start: string; end: string }[]): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}`, {
      method: "PATCH",
      headers: { ...this.headers(), Prefer: "return=representation" },
      body: JSON.stringify({ availability: text, availability_slots: slots ?? null, availability_at: at.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase saveAvailability falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("supabase saveAvailability: usuario inexistente");
  }

  async insertMaterial(_waId: string, m: { id: string; waIdHash: string; r2Key: string; mime: string; bytes: number; filename?: string; at: Date }): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/doubt_materials`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        id: m.id, wa_id_hash: m.waIdHash, r2_key: m.r2Key, mime: m.mime, bytes: m.bytes,
        ...(m.filename ? { filename: m.filename } : {}), created_at: m.at.toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`supabase insertMaterial falhou: ${res.status}`);
  }

  async insertDoubt(_waId: string, d: { waIdHash: string; text: string; categories: string[]; at: Date }): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/doubts`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ id: crypto.randomUUID(), wa_id_hash: d.waIdHash, text: d.text, categories: d.categories, created_at: d.at.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase insertDoubt falhou: ${res.status}`);
  }

  async listOutboundSince(waIdHash: string, since: Date): Promise<Date[]> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/outbound_log?wa_id_hash=eq.${encodeURIComponent(waIdHash)}&reserved_at=gte.${encodeURIComponent(since.toISOString())}&select=reserved_at&limit=1000`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase listOutboundSince falhou: ${res.status}`);
    return ((await res.json()) as { reserved_at: string }[]).map((r) => new Date(r.reserved_at));
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

  async listActiveServices(): Promise<Service[]> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/services?active=eq.true&order=sort_order.asc&select=id,title,description,requires_audio,sort_order&limit=100`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase listActiveServices falhou: ${res.status}`);
    const rows = (await res.json()) as {
      id: string; title: string; description: string | null; requires_audio: boolean; sort_order: number;
    }[];
    return rows.map((r) => ({
      id: r.id, title: r.title, description: r.description ?? "",
      requiresAudio: r.requires_audio === true, sortOrder: r.sort_order,
    }));
  }

  async listCannedResponses(): Promise<Record<string, string>> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/canned_responses?select=key,text&limit=500`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`supabase listCannedResponses falhou: ${res.status}`);
    const rows = (await res.json()) as { key: string; text: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.text]));
  }

  // ---- Etapa 6: áudios ----
  async insertAudio(rec: AudioRecord): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/audios`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        id: rec.id, wa_id_hash: rec.waIdHash, r2_key: rec.r2Key, mime: rec.mime, bytes: rec.bytes,
        service_id: rec.serviceId, status: rec.status, result: rec.result,
        ...(rec.mentoria ? { subject: rec.mentoria.subject, ...(rec.mentoria.role ? { mentoria_role: rec.mentoria.role } : {}), ...(rec.mentoria.partner ? { partner: rec.mentoria.partner } : {}) } : {}),
        created_at: rec.createdAt.toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`supabase insertAudio falhou: ${res.status}`);
  }

  async finishAudio(id: string, status: "done" | "failed", result: unknown, at: Date): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/audios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ status, result, finished_at: at.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase finishAudio falhou: ${res.status}`);
  }

  // ---- Etapa 7: operação ----
  async ping(): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/users?select=wa_id&limit=1`, { headers: this.headers() });
    if (!res.ok) throw new Error(`supabase ping falhou: ${res.status}`);
  }

  async deleteProcessedBefore(before: Date): Promise<number> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/processed_messages?received_at=lt.${encodeURIComponent(before.toISOString())}`,
      { method: "DELETE", headers: this.headers({ Prefer: "return=representation" }) },
    );
    if (!res.ok) throw new Error(`supabase deleteProcessedBefore falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) ? rows.length : 0;
  }

  async releaseStuckProcessing(before: Date): Promise<number> {
    const n = await this.rpc<number | null>("release_stuck_processing", { p_before: before.toISOString() });
    return typeof n === "number" ? n : 0;
  }

  // ---- Mentorias ----
  async getMentoriaDraft(waId: string): Promise<MentoriaDraft> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}&select=draft_role,draft_subject,draft_partner`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getMentoriaDraft falhou: ${res.status}`);
    const r = ((await res.json()) as Record<string, string | null>[])[0];
    const d: MentoriaDraft = {};
    if (r?.draft_role === "mentor" || r?.draft_role === "mentorado") d.role = r.draft_role;
    if (r?.draft_subject) d.subject = r.draft_subject;
    if (r?.draft_partner) d.partner = r.draft_partner;
    return d;
  }

  async saveMentoriaDraft(waId: string, patch: Partial<MentoriaDraft> | null): Promise<void> {
    const body = patch === null
      ? { draft_role: null, draft_subject: null, draft_partner: null }
      : {
          ...(patch.role !== undefined ? { draft_role: patch.role } : {}),
          ...(patch.subject !== undefined ? { draft_subject: patch.subject } : {}),
          ...(patch.partner !== undefined ? { draft_partner: patch.partner } : {}),
        };
    if (Object.keys(body).length === 0) return;
    const res = await this.fetchImpl(`${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}`, {
      method: "PATCH",
      headers: this.headers({ Prefer: "return=representation" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`supabase saveMentoriaDraft falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("supabase saveMentoriaDraft: usuario inexistente");
  }

  private toMentoria(r: Record<string, unknown>): MentoriaRow {
    return {
      id: String(r.id), waIdHash: String(r.wa_id_hash),
      role: r.mentoria_role === "mentor" || r.mentoria_role === "mentorado" ? r.mentoria_role : null,
      subject: (r.subject as string | null) ?? null, partner: (r.partner as string | null) ?? null,
      mime: String(r.mime), bytes: Number(r.bytes), r2Key: String(r.r2_key),
      createdAt: new Date(String(r.created_at)),
      analysisResult: r.analysis_result ?? null,
      analysisAt: r.analysis_at ? new Date(String(r.analysis_at)) : null,
    };
  }

  async listMentorias(o: { pending?: boolean; limit: number; before?: Date }): Promise<MentoriaRow[]> {
    const q = [
      "select=id,wa_id_hash,mentoria_role,subject,partner,mime,bytes,r2_key,created_at,analysis_result,analysis_at",
      "subject=not.is.null", "order=created_at.desc", `limit=${Math.max(1, Math.min(200, o.limit))}`,
      ...(o.pending ? ["analysis_result=is.null"] : []),
      ...(o.before ? [`created_at=lt.${encodeURIComponent(o.before.toISOString())}`] : []),
    ].join("&");
    const res = await this.fetchImpl(`${this.url}/rest/v1/audios?${q}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`supabase listMentorias falhou: ${res.status}`);
    const rows = ((await res.json()) as Record<string, unknown>[]).map((r) => this.toMentoria(r));
    // Quem registrou: nome e telefone mascarado (cadastro), buscados por hash.
    const hashes = [...new Set(rows.map((r) => r.waIdHash))];
    if (hashes.length > 0) {
      const ur = await this.fetchImpl(
        `${this.url}/rest/v1/users?wa_id_hash=in.(${hashes.map(encodeURIComponent).join(",")})&select=wa_id_hash,wa_id,full_name`,
        { headers: this.headers() },
      );
      if (ur.ok) {
        const users = (await ur.json()) as { wa_id_hash: string; wa_id: string; full_name: string | null }[];
        const byHash = new Map(users.map((u) => [u.wa_id_hash, u]));
        for (const r of rows) {
          const u = byHash.get(r.waIdHash);
          if (u) r.registrant = { name: u.full_name, phoneMasked: maskPhone(u.wa_id) };
        }
      }
    }
    return rows;
  }

  async getMentoria(id: string): Promise<MentoriaRow | null> {
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/audios?id=eq.${id}&subject=not.is.null&select=id,wa_id_hash,mentoria_role,subject,partner,mime,bytes,r2_key,created_at,analysis_result,analysis_at`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getMentoria falhou: ${res.status}`);
    const r = ((await res.json()) as Record<string, unknown>[])[0];
    return r ? this.toMentoria(r) : null;
  }

  async setAnalysisResult(id: string, result: unknown, at: Date): Promise<boolean> {
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return false;
    const res = await this.fetchImpl(`${this.url}/rest/v1/audios?id=eq.${id}&subject=not.is.null`, {
      method: "PATCH",
      headers: this.headers({ Prefer: "return=representation" }),
      body: JSON.stringify({ analysis_result: result, analysis_at: at.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase setAnalysisResult falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }

  // ---- Login do painel ----
  async getLoginLock(key: string): Promise<{ failures: number; lockedUntil: Date | null }> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/panel_login_attempts?key=eq.${encodeURIComponent(key)}&select=failures,locked_until`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getLoginLock falhou: ${res.status}`);
    const r = ((await res.json()) as { failures: number; locked_until: string | null }[])[0];
    return { failures: r?.failures ?? 0, lockedUntil: r?.locked_until ? new Date(r.locked_until) : null };
  }

  async recordLoginFailure(key: string, now: Date, maxFailures: number, lockMs: number): Promise<void> {
    const cur = await this.getLoginLock(key);
    const expired = cur.lockedUntil !== null && cur.lockedUntil <= now;
    const failures = (expired ? 0 : cur.failures) + 1;
    const lockedUntil = failures >= maxFailures ? new Date(now.getTime() + lockMs) : null;
    const res = await this.fetchImpl(`${this.url}/rest/v1/panel_login_attempts?on_conflict=key`, {
      method: "POST",
      headers: this.headers({ Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({ key, failures, locked_until: lockedUntil ? lockedUntil.toISOString() : null, updated_at: now.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase recordLoginFailure falhou: ${res.status}`);
  }

  async clearLoginFailures(key: string): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/panel_login_attempts?key=eq.${encodeURIComponent(key)}`, {
      method: "DELETE", headers: this.headers(),
    });
    if (!res.ok) throw new Error(`supabase clearLoginFailures falhou: ${res.status}`);
  }
}
