import { hashWaId } from "../lib/hash";
import { maskPhone } from "../lib/logger";
import { FIELD_KEYS } from "../registration/fields";
import type { Service } from "../services/content";
import type {
  AudioRecord,
  BudgetRow, ConversationFields, LoginAttemptRepo, MatchDetail, MatchPatch, MatchRow, MatchingRepo, DoubtRow, MemberCounts, MentorRow, Slot, MentoriaCompletion, MentoriaDraft, MentoriaRepo, MentoriaRow, PartnerAnswerOutcome, PendingChoiceOption, PendingConfirmation, PersonRef, RegistrationPatch, RegistrationRecord, StoredConversation, ManualLock, OutboundLogEntry, PricingUpdate, Repo, ReserveOutcome, ReviewRequest, CertificateRequest,
} from "./repo";

const MENTORIA_COLS = "id,wa_id_hash,mentoria_role,subject,partner,mime,bytes,r2_key,created_at,analysis_result,analysis_at,ocorreu_em,partner_wa_id_hash,partner_confirmed_at,partner_rejected_at,audio_sha256,audio_deleted_at,contested_reason,notified_curadoria";
const UUID = /^[0-9a-fA-F-]{36}$/;

/** Repo sobre a API REST (PostgREST) do Supabase. */
export class SupabaseRepo implements Repo, MentoriaRepo, LoginAttemptRepo, MatchingRepo {
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

  async unseenMessageKeys(keys: readonly string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const list = keys.map((k) => `"${k.replace(/["\\]/g, "")}"`).join(",");
    const res = await this.fetchImpl(`${this.url}/rest/v1/processed_messages?select=wamid&wamid=in.(${encodeURIComponent(list)})`, { headers: this.headers() });
    if (!res.ok) throw new Error(`supabase unseenMessageKeys falhou: ${res.status}`);
    const seen = new Set(((await res.json()) as { wamid: string }[]).map((r) => r.wamid));
    return keys.filter((k) => !seen.has(k));
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

  async insertDoubt(waId: string, d: { waIdHash: string; text: string; categories: string[]; at: Date }): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/doubts`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ id: crypto.randomUUID(), wa_id_hash: d.waIdHash, wa_id: waId, status: "aberta", text: d.text, categories: d.categories, created_at: d.at.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase insertDoubt falhou: ${res.status}`);
  }

  // ---- Matching manual ----
  private async rest<T>(path: string, init: RequestInit = {}, what = "matching"): Promise<T> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/${path}`, { ...init, headers: this.headers((init.headers as Record<string, string> | undefined) ?? {}) });
    if (!res.ok) throw new Error(`supabase ${what} falhou: ${res.status}`);
    return (await res.json()) as T;
  }
  private static doubt(r: Record<string, unknown>): DoubtRow {
    return {
      id: String(r.id), seq: Number(r.seq), waId: String(r.wa_id ?? ""), text: String(r.text),
      categories: Array.isArray(r.categories) ? (r.categories as string[]) : [], status: r.status as DoubtRow["status"], createdAt: new Date(String(r.created_at)),
    };
  }
  private static mentor(r: Record<string, unknown>): MentorRow {
    return {
      seq: Number(r.seq), waId: String(r.wa_id), name: typeof r.full_name === "string" ? r.full_name : null,
      categories: Array.isArray(r.mentor_categories) ? (r.mentor_categories as string[]) : [], slots: Array.isArray(r.availability_slots) ? (r.availability_slots as Slot[]) : [],
    };
  }
  private static match(r: Record<string, unknown>): MatchRow {
    const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
    return {
      id: String(r.id), seq: Number(r.seq), doubtId: String(r.doubt_id), mentorWaId: String(r.mentor_wa_id), menteeWaId: String(r.mentee_wa_id),
      status: r.status as MatchRow["status"], mentorSlots: Array.isArray(r.mentor_slots) ? (r.mentor_slots as Slot[]) : null,
      chosenDay: s(r.chosen_day), chosenStart: s(r.chosen_start), chosenEnd: s(r.chosen_end), location: s(r.location),
      scheduledAt: typeof r.scheduled_at === "string" ? new Date(r.scheduled_at) : null,
      namesSentAt: typeof r.names_sent_at === "string" ? new Date(r.names_sent_at) : null,
      createdBy: String(r.created_by), createdAt: new Date(String(r.created_at)),
    };
  }
  async listOpenDoubts(limit: number): Promise<DoubtRow[]> {
    const rows = await this.rest<Record<string, unknown>[]>(`doubts?status=eq.aberta&wa_id=not.is.null&order=created_at.asc&limit=${Math.max(1, Math.floor(limit))}`, {}, "listOpenDoubts");
    return rows.map(SupabaseRepo.doubt);
  }
  async getDoubtBySeq(seq: number): Promise<DoubtRow | null> {
    const rows = await this.rest<Record<string, unknown>[]>(`doubts?seq=eq.${Math.floor(seq)}&limit=1`, {}, "getDoubtBySeq");
    return rows[0] ? SupabaseRepo.doubt(rows[0]) : null;
  }
  async listMatches(limit: number): Promise<MatchDetail[]> {
    const rows = await this.rest<Record<string, unknown>[]>(`matches?select=*,doubts(seq,text,categories)&order=created_at.desc&limit=${Math.max(1, Math.floor(limit))}`, {}, "listMatches");
    return rows.map((r) => {
      const d = (r.doubts ?? {}) as Record<string, unknown>;
      return { ...SupabaseRepo.match(r), doubtSeq: Number(d.seq ?? 0), doubtText: String(d.text ?? ""), doubtCategories: Array.isArray(d.categories) ? (d.categories as string[]) : [] };
    });
  }
  async getFullNames(waIds: readonly string[]): Promise<Record<string, string>> {
    const ids = [...new Set(waIds)].filter((w) => /^\d{6,20}$/.test(w));
    if (ids.length === 0) return {};
    const rows = await this.rest<Record<string, unknown>[]>(`users?wa_id=in.(${ids.join(",")})&select=wa_id,full_name`, {}, "getFullNames");
    const out: Record<string, string> = {};
    for (const r of rows) if (typeof r.full_name === "string") out[String(r.wa_id)] = r.full_name;
    return out;
  }
  async replaceOpenDoubt(waId: string, d: { text: string; categories: string[] }): Promise<boolean> {
    const last = await this.rest<{ id: string; status: string }[]>(`doubts?wa_id=eq.${encodeURIComponent(waId)}&order=created_at.desc&limit=1&select=id,status`, {}, "replaceOpenDoubt");
    const row = last[0];
    if (!row || row.status !== "aberta" || !UUID.test(row.id)) return false;
    // O filtro status=aberta no PATCH evita trocar uma dúvida que acabou de ser conectada a um mentor.
    const done = await this.rest<{ id: string }[]>(`doubts?id=eq.${row.id}&status=eq.aberta`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ text: d.text, categories: d.categories }),
    }, "replaceOpenDoubt");
    return done.length > 0;
  }
  async getDoubtById(id: string): Promise<DoubtRow | null> {
    if (!UUID.test(id)) return null;
    const rows = await this.rest<Record<string, unknown>[]>(`doubts?id=eq.${id}&limit=1`, {}, "getDoubtById");
    return rows[0] ? SupabaseRepo.doubt(rows[0]) : null;
  }
  async listMentors(limit: number): Promise<MentorRow[]> {
    const rows = await this.rest<Record<string, unknown>[]>(`mentors_view?order=seq.asc&limit=${Math.max(1, Math.floor(limit))}`, {}, "listMentors");
    return rows.map(SupabaseRepo.mentor);
  }
  async countMembers(): Promise<MemberCounts> {
    const rows = await this.rest<{ profile_role: string | null }[]>(
      "users?select=profile_role&registered_at=not.is.null&consent_at=not.is.null&limit=100000", {}, "countMembers");
    const c: MemberCounts = { mentors: 0, mentees: 0, total: rows.length };
    for (const r of rows) {
      if (r.profile_role === "mentor" || r.profile_role === "ambos") c.mentors++;
      if (r.profile_role === "mentorado" || r.profile_role === "ambos") c.mentees++;
    }
    return c;
  }
  async getMentorBySeq(seq: number): Promise<MentorRow | null> {
    const rows = await this.rest<Record<string, unknown>[]>(`mentors_view?seq=eq.${Math.floor(seq)}&limit=1`, {}, "getMentorBySeq");
    return rows[0] ? SupabaseRepo.mentor(rows[0]) : null;
  }
  async createMatch(m: { doubtId: string; mentorWaId: string; menteeWaId: string; createdBy: string; at: Date }): Promise<MatchRow | null> {
    if (!UUID.test(m.doubtId)) return null;
    // 1) Reserva a dúvida (só vira 'em_match' se ainda estiver 'aberta': dois admins não pegam a mesma).
    const taken = await this.rest<unknown[]>(`doubts?id=eq.${m.doubtId}&status=eq.aberta`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "em_match" }),
    }, "createMatch(reserva)");
    if (taken.length === 0) return null;
    try {
      const rows = await this.rest<Record<string, unknown>[]>("matches", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ id: crypto.randomUUID(), doubt_id: m.doubtId, mentor_wa_id: m.mentorWaId, mentee_wa_id: m.menteeWaId, created_by: m.createdBy, created_at: m.at.toISOString(), updated_at: m.at.toISOString() }),
      }, "createMatch");
      return rows[0] ? SupabaseRepo.match(rows[0]) : null;
    } catch (e) {
      // Não deixa a dúvida presa em 'em_match' sem match.
      await this.rest(`doubts?id=eq.${m.doubtId}`, { method: "PATCH", body: JSON.stringify({ status: "aberta" }) }, "createMatch(desfaz)").catch(() => undefined);
      throw e;
    }
  }
  async getMatchBySeq(seq: number): Promise<MatchRow | null> {
    const rows = await this.rest<Record<string, unknown>[]>(`matches?seq=eq.${Math.floor(seq)}&limit=1`, {}, "getMatchBySeq");
    return rows[0] ? SupabaseRepo.match(rows[0]) : null;
  }
  async getActiveMatchFor(waId: string): Promise<MatchRow | null> {
    const w = encodeURIComponent(waId);
    const rows = await this.rest<Record<string, unknown>[]>(
      `matches?or=(mentor_wa_id.eq.${w},mentee_wa_id.eq.${w})&status=not.in.(cancelado,confirmado,realizada)&order=created_at.desc&limit=1`, {}, "getActiveMatchFor");
    return rows[0] ? SupabaseRepo.match(rows[0]) : null;
  }
  async getConfirmedMatchFor(waId: string): Promise<MatchRow | null> {
    const w = encodeURIComponent(waId);
    const rows = await this.rest<Record<string, unknown>[]>(
      `matches?or=(mentor_wa_id.eq.${w},mentee_wa_id.eq.${w})&status=eq.confirmado&order=scheduled_at.desc.nullslast,created_at.desc&limit=1`, {}, "getConfirmedMatchFor");
    return rows[0] ? SupabaseRepo.match(rows[0]) : null;
  }
  async listMatchesDueForNames(since: Date, until: Date): Promise<MatchRow[]> {
    const rows = await this.rest<Record<string, unknown>[]>(
      `matches?status=eq.confirmado&names_sent_at=is.null&scheduled_at=gt.${encodeURIComponent(since.toISOString())}&scheduled_at=lte.${encodeURIComponent(until.toISOString())}&order=scheduled_at.asc&limit=50`, {}, "listMatchesDueForNames");
    return rows.map(SupabaseRepo.match);
  }
  async claimNamesSent(id: string, at: Date): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await this.rest<Record<string, unknown>[]>(`matches?id=eq.${id}&names_sent_at=is.null`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ names_sent_at: at.toISOString() }),
    }, "claimNamesSent");
    return rows.length > 0;
  }
  async releaseNamesSent(id: string): Promise<void> {
    if (!UUID.test(id)) return;
    await this.rest(`matches?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ names_sent_at: null }) }, "releaseNamesSent");
  }
  async updateMatch(id: string, patch: MatchPatch, at: Date): Promise<void> {
    if (!UUID.test(id)) throw new Error("id de match inválido");
    const body: Record<string, unknown> = { updated_at: at.toISOString() };
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.mentorSlots !== undefined) body.mentor_slots = patch.mentorSlots;
    if (patch.chosenDay !== undefined) body.chosen_day = patch.chosenDay;
    if (patch.chosenStart !== undefined) body.chosen_start = patch.chosenStart;
    if (patch.chosenEnd !== undefined) body.chosen_end = patch.chosenEnd;
    if (patch.location !== undefined) body.location = patch.location;
    if (patch.scheduledAt !== undefined) body.scheduled_at = patch.scheduledAt ? patch.scheduledAt.toISOString() : null;
    await this.rest(`matches?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) }, "updateMatch");
  }
  async cancelMatch(seq: number, at: Date): Promise<boolean> {
    const rows = await this.rest<Record<string, unknown>[]>(`matches?seq=eq.${Math.floor(seq)}&status=neq.cancelado`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "cancelado", updated_at: at.toISOString() }),
    }, "cancelMatch");
    const row = rows[0];
    if (!row) return false;
    await this.rest(`doubts?id=eq.${String(row.doubt_id)}`, { method: "PATCH", body: JSON.stringify({ status: "aberta" }) }, "cancelMatch(reabre)");
    return true;
  }

  async setPendingChoices(waIdHash: string, options: PendingChoiceOption[] | null, at: Date): Promise<void> {
    const res = options === null
      ? await this.fetchImpl(`${this.url}/rest/v1/pending_choices?wa_id_hash=eq.${encodeURIComponent(waIdHash)}`, {
          method: "DELETE", headers: this.headers(),
        })
      : await this.fetchImpl(`${this.url}/rest/v1/pending_choices?on_conflict=wa_id_hash`, {
          method: "POST",
          headers: this.headers({ Prefer: "resolution=merge-duplicates" }),
          body: JSON.stringify({ wa_id_hash: waIdHash, options, created_at: at.toISOString() }),
        });
    if (!res.ok) throw new Error(`supabase setPendingChoices falhou: ${res.status}`);
  }
  async getPendingChoices(waIdHash: string): Promise<{ options: PendingChoiceOption[]; createdAt: Date } | null> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/pending_choices?wa_id_hash=eq.${encodeURIComponent(waIdHash)}&select=options,created_at&limit=1`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getPendingChoices falhou: ${res.status}`);
    const r = ((await res.json()) as { options: PendingChoiceOption[]; created_at: string }[])[0];
    return r ? { options: r.options, createdAt: new Date(r.created_at) } : null;
  }

  async recordSensitiveEvent(waIdHash: string, level: "A" | "B", channel: string, at: Date): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/sensitive_events`, {
      method: "POST", headers: this.headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ wa_id_hash: waIdHash, level, channel, created_at: at.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase recordSensitiveEvent falhou: ${res.status}`);
  }
  async lastSensitiveEventAt(waIdHash: string): Promise<Date | null> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/sensitive_events?wa_id_hash=eq.${encodeURIComponent(waIdHash)}&select=created_at&order=created_at.desc&limit=1`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase lastSensitiveEventAt falhou: ${res.status}`);
    const rows = (await res.json()) as { created_at: string }[];
    return rows[0] ? new Date(rows[0].created_at) : null;
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
      `${this.url}/rest/v1/users?wa_id=eq.${encodeURIComponent(waId)}&select=draft_role,draft_subject,draft_partner,draft_audio_id,draft_ocorreu_em`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`supabase getMentoriaDraft falhou: ${res.status}`);
    const r = ((await res.json()) as Record<string, string | null>[])[0];
    const d: MentoriaDraft = {};
    if (r?.draft_role === "mentor" || r?.draft_role === "mentorado") d.role = r.draft_role;
    if (r?.draft_subject) d.subject = r.draft_subject;
    if (r?.draft_partner) d.partner = r.draft_partner;
    if (r?.draft_audio_id) d.audioId = r.draft_audio_id;
    if (r?.draft_ocorreu_em) d.occurredOn = r.draft_ocorreu_em;
    return d;
  }

  async saveMentoriaDraft(waId: string, patch: Partial<MentoriaDraft> | null): Promise<void> {
    const body = patch === null
      ? { draft_role: null, draft_subject: null, draft_partner: null, draft_audio_id: null, draft_ocorreu_em: null }
      : {
          ...(patch.role !== undefined ? { draft_role: patch.role } : {}),
          ...(patch.subject !== undefined ? { draft_subject: patch.subject } : {}),
          ...(patch.partner !== undefined ? { draft_partner: patch.partner } : {}),
          ...(patch.audioId !== undefined ? { draft_audio_id: patch.audioId } : {}),
          ...(patch.occurredOn !== undefined ? { draft_ocorreu_em: patch.occurredOn } : {}),
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
      ocorreuEm: typeof r.ocorreu_em === "string" ? r.ocorreu_em : null,
      partnerHash: typeof r.partner_wa_id_hash === "string" ? r.partner_wa_id_hash : null,
      partnerConfirmedAt: r.partner_confirmed_at ? new Date(String(r.partner_confirmed_at)) : null,
      partnerRejectedAt: r.partner_rejected_at ? new Date(String(r.partner_rejected_at)) : null,
      audioSha256: typeof r.audio_sha256 === "string" ? r.audio_sha256 : null,
      audioDeletedAt: r.audio_deleted_at ? new Date(String(r.audio_deleted_at)) : null,
      contestedReason: r.contested_reason === "recusada" || r.contested_reason === "expirada" ? r.contested_reason : null,
      notifiedCuradoria: r.notified_curadoria && typeof r.notified_curadoria === "object" && !Array.isArray(r.notified_curadoria)
        ? (r.notified_curadoria as Record<string, string>) : null,
    };
  }

  async listMentorias(o: { pending?: boolean; limit: number; before?: Date }): Promise<MentoriaRow[]> {
    const q = [
      `select=${MENTORIA_COLS}`,
      "subject=not.is.null", "order=created_at.desc", `limit=${Math.max(1, Math.min(200, o.limit))}`,
      ...(o.pending ? ["analysis_result=is.null", "audio_deleted_at=is.null", "or=(ocorreu_em.is.null,partner_confirmed_at.not.is.null)"] : []),
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
      `${this.url}/rest/v1/audios?id=eq.${id}&subject=not.is.null&select=${MENTORIA_COLS}`,
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

  async claimCuradoriaNotice(id: string, pessoaId: string, situacao: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    return (await this.rpc<boolean | null>("claim_curadoria_notice", { p_id: id, p_pessoa: pessoaId, p_situacao: situacao })) === true;
  }
  async releaseCuradoriaNotice(id: string, pessoaId: string, situacao: string, previous: string | null): Promise<void> {
    if (!UUID.test(id)) return;
    await this.rpc("release_curadoria_notice", { p_id: id, p_pessoa: pessoaId, p_situacao: situacao, p_previous: previous });
  }
  async requestReview(audioId: string, waIdHash: string, at: Date): Promise<boolean> {
    if (!UUID.test(audioId) || !/^[0-9a-f]{64}$/.test(waIdHash)) return false;
    const res = await this.fetchImpl(`${this.url}/rest/v1/revisao_pedidos?on_conflict=audio_id,wa_id_hash`, {
      method: "POST",
      headers: this.headers({ Prefer: "resolution=ignore-duplicates,return=representation" }),
      body: JSON.stringify({ audio_id: audioId, wa_id_hash: waIdHash, created_at: at.toISOString() }),
    });
    if (!res.ok) throw new Error(`supabase requestReview falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }
  async listReviewRequests(o: { status?: "aberta" | "atendida"; limit: number }): Promise<ReviewRequest[]> {
    const rows = await this.getJson<Record<string, unknown>[]>(
      `revisao_pedidos?select=id,audio_id,wa_id_hash,status,created_at${o.status ? `&status=eq.${o.status}` : ""}&order=created_at.desc&limit=${Math.min(200, Math.max(1, o.limit))}`,
      "listReviewRequests");
    return rows.map((r) => ({
      id: String(r.id), audioId: String(r.audio_id), waIdHash: String(r.wa_id_hash),
      status: r.status === "atendida" ? "atendida" : "aberta", createdAt: new Date(String(r.created_at)),
    }));
  }
  async requestCertificate(waIdHash: string, at: Date): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(waIdHash)) return false;
    const res = await this.fetchImpl(`${this.url}/rest/v1/certificado_pedidos`, {
      method: "POST", headers: this.headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ wa_id_hash: waIdHash, created_at: at.toISOString() }),
    });
    if (res.status === 409) return false; // índice único: já existe um pedido aberto desta pessoa
    if (!res.ok) throw new Error(`supabase requestCertificate falhou: ${res.status}`);
    return true;
  }
  async listCertificateRequests(o: { status?: "aberto" | "emitido"; limit: number }): Promise<CertificateRequest[]> {
    const rows = await this.getJson<Record<string, unknown>[]>(
      `certificado_pedidos?select=id,wa_id_hash,status,created_at${o.status ? `&status=eq.${o.status}` : ""}&order=created_at.desc&limit=${Math.min(200, Math.max(1, o.limit))}`,
      "listCertificateRequests");
    return rows.map((r) => ({ id: String(r.id), waIdHash: String(r.wa_id_hash), status: r.status === "emitido" ? "emitido" : "aberto", createdAt: new Date(String(r.created_at)) }));
  }
  // ---- Mentoria v2: parceiro, confirmação e limpeza ----
  private async getJson<T>(path: string, what: string): Promise<T> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/${path}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`supabase ${what} falhou: ${res.status}`);
    return (await res.json()) as T;
  }
  private async patchRows(path: string, body: unknown, what: string): Promise<number> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/${path}`, {
      method: "PATCH", headers: this.headers({ Prefer: "return=representation" }), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`supabase ${what} falhou: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) ? rows.length : 0;
  }
  private toPerson(r: Record<string, unknown>): PersonRef {
    return {
      waId: String(r.wa_id), waIdHash: String(r.wa_id_hash), fullName: (r.full_name as string | null) ?? null,
      consentAt: r.consent_at ? new Date(String(r.consent_at)) : null, termsVersion: (r.terms_version as string | null) ?? null,
    };
  }
  async findPersonByWaIdHash(hash: string): Promise<PersonRef | null> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const rows = await this.getJson<Record<string, unknown>[]>(
      `users?wa_id_hash=eq.${hash}&select=wa_id,wa_id_hash,full_name,consent_at,terms_version&limit=1`, "findPersonByWaIdHash");
    return rows[0] ? this.toPerson(rows[0]) : null;
  }
  async findPeopleByName(tokens: readonly string[], limit: number): Promise<PersonRef[]> {
    if (tokens.length === 0) return [];
    const rows = await this.rpc<Record<string, unknown>[] | null>("find_people_by_name", { p_tokens: [...tokens], p_limit: limit });
    return (rows ?? []).map((r) => this.toPerson({ ...r, consent_at: new Date(0).toISOString(), terms_version: "-" }));
  }
  async completeMentoria(waId: string, c: MentoriaCompletion): Promise<boolean> {
    if (!UUID.test(c.audioId)) return false;
    const own = await hashWaId(waId);
    const n = await this.patchRows(`audios?id=eq.${c.audioId}&wa_id_hash=eq.${own}&service_id=eq.mentoria`, {
      mentoria_role: c.role, subject: c.subject, ocorreu_em: c.occurredOn, partner_wa_id_hash: c.partnerHash,
      partner: c.partnerName,
    }, "completeMentoria");
    return n > 0;
  }
  async discardIncompleteMentoria(id: string): Promise<{ r2Key: string } | null> {
    if (!UUID.test(id)) return null;
    const rows = await this.getJson<{ r2_key: string }[]>(`audios?id=eq.${id}&service_id=eq.mentoria&subject=is.null&select=r2_key`, "discardIncompleteMentoria");
    const r = rows[0];
    if (!r) return null;
    const del = await this.fetchImpl(`${this.url}/rest/v1/audios?id=eq.${id}&subject=is.null`, { method: "DELETE", headers: this.headers() });
    if (!del.ok) throw new Error(`supabase discardIncompleteMentoria falhou: ${del.status}`);
    await this.patchRows(`users?draft_audio_id=eq.${id}`, {
      draft_role: null, draft_subject: null, draft_partner: null, draft_audio_id: null, draft_ocorreu_em: null,
    }, "discardIncompleteMentoria/draft");
    return { r2Key: r.r2_key };
  }
  async listIncompleteMentorias(before: Date): Promise<{ id: string; r2Key: string }[]> {
    const rows = await this.getJson<{ id: string; r2_key: string }[]>(
      `audios?service_id=eq.mentoria&subject=is.null&created_at=lt.${encodeURIComponent(before.toISOString())}&select=id,r2_key&limit=200`, "listIncompleteMentorias");
    return rows.map((r) => ({ id: r.id, r2Key: r.r2_key }));
  }
  private static readonly AWAITING =
    "service_id=eq.mentoria&subject=not.is.null&ocorreu_em=not.is.null&partner_wa_id_hash=not.is.null&partner_confirmed_at=is.null&partner_rejected_at=is.null&contested_reason=is.null&audio_deleted_at=is.null";
  async listUnansweredMentorias(before: Date): Promise<{ id: string; r2Key: string }[]> {
    const rows = await this.getJson<{ id: string; r2_key: string }[]>(
      `audios?${SupabaseRepo.AWAITING}&created_at=lt.${encodeURIComponent(before.toISOString())}&select=id,r2_key&limit=200`, "listUnansweredMentorias");
    return rows.map((r) => ({ id: r.id, r2Key: r.r2_key }));
  }
  async expireMentoria(id: string, at: Date): Promise<boolean> {
    if (!UUID.test(id)) return false;
    return (await this.patchRows(`audios?id=eq.${id}&${SupabaseRepo.AWAITING}`, { contested_reason: "expirada", audio_deleted_at: at.toISOString() }, "expireMentoria")) > 0;
  }
  async listPendingConfirmations(partnerHashes: readonly string[]): Promise<PendingConfirmation[]> {
    const hashes = partnerHashes.filter((h) => /^[0-9a-f]{64}$/.test(h));
    if (hashes.length === 0) return [];
    const rows = await this.getJson<Record<string, unknown>[]>(
      `audios?${SupabaseRepo.AWAITING}&partner_wa_id_hash=in.(${hashes.join(",")})&order=created_at.asc&limit=20&select=id,wa_id_hash,subject,ocorreu_em,created_at,partner_prompted_at,partner_wa_id_hash`,
      "listPendingConfirmations");
    if (rows.length === 0) return [];
    const owners = [...new Set(rows.map((r) => String(r.wa_id_hash)))];
    const users = await this.getJson<{ wa_id_hash: string; full_name: string | null }[]>(
      `users?wa_id_hash=in.(${owners.join(",")})&select=wa_id_hash,full_name`, "listPendingConfirmations/users").catch(() => []);
    const names = new Map(users.map((u) => [u.wa_id_hash, u.full_name]));
    return rows.map((r) => ({
      id: String(r.id), registrantName: names.get(String(r.wa_id_hash)) ?? null, subject: String(r.subject),
      occurredOn: String(r.ocorreu_em), createdAt: new Date(String(r.created_at)),
      prompted: r.partner_prompted_at !== null && r.partner_prompted_at !== undefined, partnerHash: String(r.partner_wa_id_hash),
    }));
  }
  async markPartnerPrompted(id: string, at: Date): Promise<void> {
    if (!UUID.test(id)) return;
    await this.patchRows(`audios?id=eq.${id}&partner_prompted_at=is.null`, { partner_prompted_at: at.toISOString() }, "markPartnerPrompted");
  }
  async answerPartner(id: string, partnerHashes: readonly string[], answer: "yes" | "no", at: Date, asHash: string): Promise<PartnerAnswerOutcome> {
    if (!UUID.test(id)) return "not_found";
    const cur = (await this.getJson<Record<string, unknown>[]>(
      `audios?id=eq.${id}&subject=not.is.null&select=partner_wa_id_hash,partner_confirmed_at,partner_rejected_at,contested_reason,audio_deleted_at`, "answerPartner"))[0];
    if (!cur || typeof cur.partner_wa_id_hash !== "string" || !partnerHashes.includes(cur.partner_wa_id_hash)) return "not_found";
    if (cur.partner_confirmed_at || cur.partner_rejected_at || cur.contested_reason || cur.audio_deleted_at) return "already";
    const body = answer === "yes"
      ? { partner_wa_id_hash: asHash, partner_confirmed_at: at.toISOString() }
      : { partner_wa_id_hash: asHash, partner_rejected_at: at.toISOString(), contested_reason: "recusada", audio_deleted_at: at.toISOString() };
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/audios?id=eq.${id}&partner_confirmed_at=is.null&partner_rejected_at=is.null&contested_reason=is.null&audio_deleted_at=is.null`,
      { method: "PATCH", headers: this.headers({ Prefer: "return=representation" }), body: JSON.stringify(body) });
    if (!res.ok) {
      // O gatilho do banco (R6) recusa quem não consentiu: check_violation (23514).
      if ((await res.text().catch(() => "")).includes("23514")) return "no_consent";
      throw new Error(`supabase answerPartner falhou: ${res.status}`);
    }
    const rows = (await res.json()) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) return "already";
    return answer === "yes" ? "confirmed" : "rejected";
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
