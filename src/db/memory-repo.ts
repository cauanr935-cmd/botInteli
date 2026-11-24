import { foldName } from "../mentoria/parse";
import { FIELD_KEYS } from "../registration/fields";
import type { Service } from "../services/content";
import type {
  AudioRecord, BudgetRow, ConversationFields, LoginAttemptRepo, MatchDetail, MatchPatch, MatchRow, MatchingRepo, DoubtRow, MemberCounts, MentorRow, Slot, MentoriaCompletion, MentoriaDraft, MentoriaRepo, MentoriaRow, PartnerAnswerOutcome, PendingChoiceOption, PendingConfirmation, PersonRef, RegistrationPatch, RegistrationRecord, StoredConversation, ManualLock, OutboundLogEntry, PricingUpdate, Repo, ReserveOutcome, ReviewRequest, CertificateRequest,
} from "./repo";

export interface MemoryOutboundRow extends OutboundLogEntry {
  pricingBillable?: boolean;
  pricingType?: string;
  pricingCategory?: string;
  statusUpdatedAt?: Date;
}

export class MemoryRepo implements Repo, MentoriaRepo, LoginAttemptRepo, MatchingRepo {
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
  async unseenMessageKeys(keys: readonly string[]): Promise<string[]> {
    return keys.filter((k) => !this.processed.has(k));
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
    const prev = this.conversations.get(waId);
    if (!prev || prev.state !== next.state) this.stateChangedAt.set(waId, this.clock());
    this.conversations.set(waId, { ...next, version: cur + 1 });
    return true;
  }
  // ---- Etapa 7: operação ----
  /** Relógio injetável (testes). */
  clock: () => Date = () => new Date();
  readonly stateChangedAt = new Map<string, Date>();
  pingFails = false;
  async ping(): Promise<void> {
    if (this.pingFails) throw new Error("banco fora");
  }
  async deleteProcessedBefore(before: Date): Promise<number> {
    let n = 0;
    for (const [k, t] of [...this.processed]) if (t < before) { this.processed.delete(k); n++; }
    return n;
  }
  async releaseStuckProcessing(before: Date): Promise<number> {
    let n = 0;
    for (const [id, c] of [...this.conversations]) {
      const at = this.stateChangedAt.get(id);
      if (c.state === "PROCESSING_AUDIO" && at && at < before) {
        this.conversations.set(id, {
          ...c, state: "AWAIT_AUDIO", previousState: null, hintSentInState: false, version: c.version + 1,
        });
        this.stateChangedAt.set(id, this.clock());
        n++;
      }
    }
    return n;
  }
  // ---- Etapa 4: cadastro ----
  readonly registrations = new Map<string, RegistrationRecord & { waIdHash?: string }>();
  async getRegistration(waId: string): Promise<RegistrationRecord> {
    const r = this.registrations.get(waId);
    const a = this.availabilities.get(waId);
    const base: RegistrationRecord = r
      ? { ...r, values: { ...r.values } }
      : { consentAt: null, termsVersion: null, registeredAt: null, values: {} };
    return a ? { ...base, ...(a.slots ? { availabilitySlots: [...a.slots] } : {}), availabilityAt: a.at } : base;
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
      ...((patch.profileRole ?? cur.profileRole) ? { profileRole: (patch.profileRole ?? cur.profileRole)! } : {}),
      ...((patch.mentorCategories ?? cur.mentorCategories) ? { mentorCategories: (patch.mentorCategories ?? cur.mentorCategories)! } : {}),
      ...((patch.profileAbout ?? cur.profileAbout) ? { profileAbout: (patch.profileAbout ?? cur.profileAbout)! } : {}),
    };
    // Mesma regra do CHECK do banco (R6): sem consentimento, nenhum dado de cadastro.
    if (!next.consentAt && (Object.keys(values).length > 0 || next.registeredAt || patch.profileRole || patch.mentorCategories || patch.profileAbout)) throw new Error("sem consentimento");
    this.registrations.set(waId, next);
  }
  readonly availabilities = new Map<string, { text: string; at: Date; slots?: readonly { day: string; start: string; end: string }[] }>();
  async saveAvailability(waId: string, text: string, at: Date, slots?: readonly { day: string; start: string; end: string }[]): Promise<void> {
    if (!this.registrations.has(waId) && !this.conversations.has(waId)) throw new Error("usuario inexistente");
    this.availabilities.set(waId, { text, at, ...(slots ? { slots } : {}) });
  }
  readonly materials: { id: string; waIdHash: string; r2Key: string; mime: string; bytes: number; filename?: string; at: Date }[] = [];
  async insertMaterial(_waId: string, m: { id: string; waIdHash: string; r2Key: string; mime: string; bytes: number; filename?: string; at: Date }): Promise<void> {
    const ok = [...this.registrations.values()].some((r) => r.waIdHash === m.waIdHash && r.consentAt !== null);
    if (!ok) throw new Error("sem consentimento");
    this.materials.push({ ...m });
  }
  readonly doubts: { id: string; seq: number; waId: string; status: DoubtRow["status"]; waIdHash: string; text: string; categories: string[]; at: Date }[] = [];
  async insertDoubt(waId: string, d: { waIdHash: string; text: string; categories: string[]; at: Date }): Promise<void> {
    // Mesma regra do banco (R6): sem consentimento, nada é guardado.
    const ok = [...this.registrations.values()].some((r) => r.waIdHash === d.waIdHash && r.consentAt !== null);
    if (!ok) throw new Error("sem consentimento");
    this.doubts.push({ ...d, id: crypto.randomUUID(), seq: this.doubts.length + 1, waId, status: "aberta" });
  }

  // ---- Matching manual ----
  readonly matches: MatchRow[] = [];
  private toDoubt(d: (typeof this.doubts)[number]): DoubtRow {
    return { id: d.id, seq: d.seq, waId: d.waId, text: d.text, categories: [...d.categories], status: d.status, createdAt: d.at };
  }
  async listOpenDoubts(limit: number): Promise<DoubtRow[]> {
    return this.doubts.filter((d) => d.status === "aberta").sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, limit).map((d) => this.toDoubt(d));
  }
  async getDoubtBySeq(seq: number): Promise<DoubtRow | null> {
    const d = this.doubts.find((x) => x.seq === seq);
    return d ? this.toDoubt(d) : null;
  }
  async listMatches(limit: number): Promise<MatchDetail[]> {
    return [...this.matches].reverse().slice(0, limit).map((x) => {
      const d = this.doubts.find((y) => y.id === x.doubtId);
      return { ...x, doubtSeq: d?.seq ?? 0, doubtText: d?.text ?? "", doubtCategories: d ? [...d.categories] : [] };
    });
  }
  async getFullNames(waIds: readonly string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const w of waIds) { const n = this.registrations.get(w)?.values.full_name; if (n) out[w] = n; }
    return out;
  }
  async replaceOpenDoubt(waId: string, d: { text: string; categories: string[] }): Promise<boolean> {
    const mine = this.doubts.filter((x) => x.waId === waId).sort((a, b) => b.at.getTime() - a.at.getTime() || b.seq - a.seq)[0];
    if (!mine || mine.status !== "aberta") return false;
    mine.text = d.text;
    mine.categories = [...d.categories];
    return true;
  }
  async getDoubtById(id: string): Promise<DoubtRow | null> {
    const d = this.doubts.find((x) => x.id === id);
    return d ? this.toDoubt(d) : null;
  }
  private mentorRows(): MentorRow[] {
    // O id curto é a posição na ordem de cadastro (a ordem de inserção do Map).
    const out: MentorRow[] = [];
    let seq = 0;
    for (const [waId, r] of this.registrations) {
      seq++;
      if ((r.profileRole === "mentor" || r.profileRole === "ambos") && r.registeredAt && r.consentAt) {
        out.push({ seq, waId, name: r.values.full_name ?? null, categories: [...(r.mentorCategories ?? [])], slots: [...(this.availabilities.get(waId)?.slots ?? [])] as Slot[] });
      }
    }
    return out;
  }
  async listMentors(limit: number): Promise<MentorRow[]> { return this.mentorRows().slice(0, limit); }
  async countMembers(): Promise<MemberCounts> {
    const c: MemberCounts = { mentors: 0, mentees: 0, total: 0 };
    for (const r of this.registrations.values()) {
      if (!r.registeredAt || !r.consentAt) continue;
      c.total++;
      if (r.profileRole === "mentor" || r.profileRole === "ambos") c.mentors++;
      if (r.profileRole === "mentorado" || r.profileRole === "ambos") c.mentees++;
    }
    return c;
  }
  async getMentorBySeq(seq: number): Promise<MentorRow | null> { return this.mentorRows().find((m) => m.seq === seq) ?? null; }
  async createMatch(m: { doubtId: string; mentorWaId: string; menteeWaId: string; createdBy: string; at: Date }): Promise<MatchRow | null> {
    const d = this.doubts.find((x) => x.id === m.doubtId);
    if (!d || d.status !== "aberta") return null; // check-and-set síncrono: dois admins não pegam a mesma dúvida
    d.status = "em_match";
    const row: MatchRow = {
      id: crypto.randomUUID(), seq: this.matches.length + 1, doubtId: m.doubtId, mentorWaId: m.mentorWaId, menteeWaId: m.menteeWaId,
      status: "aguardando_mentor", mentorSlots: null, chosenDay: null, chosenStart: null, chosenEnd: null, location: null, scheduledAt: null, namesSentAt: null, createdBy: m.createdBy, createdAt: m.at,
    };
    this.matches.push(row);
    return { ...row };
  }
  async getMatchBySeq(seq: number): Promise<MatchRow | null> {
    const r = this.matches.find((x) => x.seq === seq);
    return r ? { ...r } : null;
  }
  async getActiveMatchFor(waId: string): Promise<MatchRow | null> {
    const r = [...this.matches].reverse().find((x) => (x.mentorWaId === waId || x.menteeWaId === waId) && x.status !== "cancelado" && x.status !== "confirmado" && x.status !== "realizada");
    return r ? { ...r } : null;
  }
  async getConfirmedMatchFor(waId: string): Promise<MatchRow | null> {
    const r = [...this.matches].reverse().find((x) => (x.mentorWaId === waId || x.menteeWaId === waId) && x.status === "confirmado");
    return r ? { ...r } : null;
  }
  async listMatchesDueForNames(since: Date, until: Date): Promise<MatchRow[]> {
    return this.matches
      .filter((x) => x.status === "confirmado" && x.namesSentAt === null && x.scheduledAt !== null && x.scheduledAt > since && x.scheduledAt <= until)
      .map((x) => ({ ...x }));
  }
  async claimNamesSent(id: string, at: Date): Promise<boolean> {
    const r = this.matches.find((x) => x.id === id);
    if (!r || r.namesSentAt !== null) return false;
    r.namesSentAt = at;
    return true;
  }
  async releaseNamesSent(id: string): Promise<void> {
    const r = this.matches.find((x) => x.id === id);
    if (r) r.namesSentAt = null;
  }
  async updateMatch(id: string, patch: MatchPatch, _at: Date): Promise<void> {
    const r = this.matches.find((x) => x.id === id);
    if (!r) throw new Error("match inexistente");
    Object.assign(r, patch);
  }
  async cancelMatch(seq: number, _at: Date): Promise<boolean> {
    const r = this.matches.find((x) => x.seq === seq);
    if (!r || r.status === "cancelado") return false;
    r.status = "cancelado";
    const d = this.doubts.find((x) => x.id === r.doubtId);
    if (d) d.status = "aberta";
    return true;
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
  // ---- Etapa 6: áudios ----
  readonly audios = new Map<string, AudioRecord>();
  async insertAudio(rec: AudioRecord): Promise<void> {
    // Mesma regra do gatilho do banco (R6): sem consentimento, nenhum áudio.
    const ok = [...this.registrations.values()].some((r) => r.waIdHash === rec.waIdHash && r.consentAt !== null);
    if (!ok) throw new Error("sem consentimento");
    this.audios.set(rec.id, { ...rec });
  }
  async finishAudio(id: string, status: "done" | "failed", result: unknown, at: Date): Promise<void> {
    const cur = this.audios.get(id);
    if (!cur) throw new Error("audio inexistente");
    this.audios.set(id, { ...cur, status, result, finishedAt: at });
  }
  readonly sensitiveEvents: { waIdHash: string; level: "A" | "B"; channel: string; at: Date }[] = [];
  async recordSensitiveEvent(waIdHash: string, level: "A" | "B", channel: string, at: Date): Promise<void> {
    this.sensitiveEvents.push({ waIdHash, level, channel, at });
  }
  async lastSensitiveEventAt(waIdHash: string): Promise<Date | null> {
    return this.sensitiveEvents.filter((e) => e.waIdHash === waIdHash).reduce<Date | null>((m, e) => (m === null || e.at > m ? e.at : m), null);
  }

  readonly pendingChoices = new Map<string, { options: PendingChoiceOption[]; createdAt: Date }>();
  async setPendingChoices(waIdHash: string, options: PendingChoiceOption[] | null, at: Date): Promise<void> {
    if (options === null) this.pendingChoices.delete(waIdHash);
    else this.pendingChoices.set(waIdHash, { options: options.map((o) => ({ ...o })), createdAt: at });
  }
  async getPendingChoices(waIdHash: string): Promise<{ options: PendingChoiceOption[]; createdAt: Date } | null> {
    return this.pendingChoices.get(waIdHash) ?? null;
  }

  async listOutboundSince(waIdHash: string, since: Date): Promise<Date[]> {
    return this.outbound.filter((r) => r.waIdHash === waIdHash && r.reservedAt >= since).map((r) => r.reservedAt);
  }

  // ---- orçamento: mesma semântica da função SQL (sem await entre ler e escrever) ----
  async reserveSlot(phoneNumberId: string, monthKey: string, stopAt: number): Promise<ReserveOutcome> {
    const cap = Math.min(stopAt, 990); // mesmo teto da função SQL
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

  // ---- Mentorias ----
  readonly drafts = new Map<string, MentoriaDraft>();
  readonly analysis = new Map<string, { result: unknown; at: Date }>();
  async getMentoriaDraft(waId: string): Promise<MentoriaDraft> {
    return { ...(this.drafts.get(waId) ?? {}) };
  }
  async saveMentoriaDraft(waId: string, patch: Partial<MentoriaDraft> | null): Promise<void> {
    if (!this.registrations.has(waId) && !this.conversations.has(waId)) throw new Error("usuario inexistente");
    if (patch === null) { this.drafts.delete(waId); return; }
    this.drafts.set(waId, { ...(this.drafts.get(waId) ?? {}), ...patch });
  }
  private toMentoria(a: AudioRecord): MentoriaRow {
    const an = this.analysis.get(a.id);
    return {
      id: a.id, waIdHash: a.waIdHash, role: a.mentoria?.role ?? null, subject: a.mentoria?.subject ?? null,
      partner: a.mentoria?.partner ?? null, mime: a.mime, bytes: a.bytes, r2Key: a.r2Key, createdAt: a.createdAt,
      analysisResult: an?.result ?? null, analysisAt: an?.at ?? null,
      ocorreuEm: a.ocorreuEm ?? null, partnerHash: a.partnerWaIdHash ?? null,
      partnerConfirmedAt: a.partnerConfirmedAt ?? null, partnerRejectedAt: a.partnerRejectedAt ?? null,
      audioSha256: a.audioSha256 ?? null, audioDeletedAt: a.audioDeletedAt ?? null, contestedReason: a.contestedReason ?? null,
      notifiedCuradoria: a.notifiedCuradoria ?? null,
    };
  }
  async listMentorias(o: { pending?: boolean; limit: number; before?: Date }): Promise<MentoriaRow[]> {
    return [...this.audios.values()].filter((a) => a.mentoria)
      .map((a) => this.toMentoria(a))
      .filter((m) => (!o.pending || (m.analysisResult === null && m.audioDeletedAt === null && (m.ocorreuEm === null || m.partnerConfirmedAt !== null))) && (!o.before || m.createdAt < o.before))
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()).slice(0, o.limit);
  }
  async getMentoria(id: string): Promise<MentoriaRow | null> {
    const a = this.audios.get(id);
    return a?.mentoria ? this.toMentoria(a) : null;
  }
  async setAnalysisResult(id: string, result: unknown, at: Date): Promise<boolean> {
    if (!this.audios.get(id)?.mentoria) return false;
    this.analysis.set(id, { result, at });
    return true;
  }
  async claimCuradoriaNotice(id: string, pessoaId: string, situacao: string): Promise<boolean> {
    const a = this.audios.get(id);
    if (!a?.mentoria || a.notifiedCuradoria?.[pessoaId] === situacao) return false;
    this.audios.set(id, { ...a, notifiedCuradoria: { ...(a.notifiedCuradoria ?? {}), [pessoaId]: situacao } });
    return true;
  }
  async releaseCuradoriaNotice(id: string, pessoaId: string, situacao: string, previous: string | null): Promise<void> {
    const a = this.audios.get(id);
    if (!a?.notifiedCuradoria || a.notifiedCuradoria[pessoaId] !== situacao) return;
    const next = { ...a.notifiedCuradoria };
    if (previous === null) delete next[pessoaId]; else next[pessoaId] = previous;
    this.audios.set(id, { ...a, notifiedCuradoria: next });
  }
  readonly certificateRequests: CertificateRequest[] = [];
  async requestCertificate(waIdHash: string, at: Date): Promise<boolean> {
    if (this.certificateRequests.some((r) => r.waIdHash === waIdHash && r.status === "aberto")) return false;
    this.certificateRequests.push({ id: crypto.randomUUID(), waIdHash, status: "aberto", createdAt: at });
    return true;
  }
  async listCertificateRequests(o: { status?: "aberto" | "emitido"; limit: number }): Promise<CertificateRequest[]> {
    return this.certificateRequests.filter((r) => !o.status || r.status === o.status)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()).slice(0, o.limit).map((r) => ({ ...r }));
  }
  readonly reviews: ReviewRequest[] = [];
  async requestReview(audioId: string, waIdHash: string, at: Date): Promise<boolean> {
    if (!this.audios.get(audioId)?.mentoria) return false;
    if (this.reviews.some((r) => r.audioId === audioId && r.waIdHash === waIdHash)) return false;
    this.reviews.push({ id: crypto.randomUUID(), audioId, waIdHash, status: "aberta", createdAt: at });
    return true;
  }
  async listReviewRequests(o: { status?: "aberta" | "atendida"; limit: number }): Promise<ReviewRequest[]> {
    return this.reviews.filter((r) => !o.status || r.status === o.status)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()).slice(0, o.limit).map((r) => ({ ...r }));
  }
  // ---- Mentoria v2: parceiro, confirmação e limpeza ----
  private person(waId: string, r: RegistrationRecord & { waIdHash?: string }): PersonRef | null {
    if (!r.waIdHash) return null;
    return { waId, waIdHash: r.waIdHash, fullName: r.values.full_name ?? null, consentAt: r.consentAt, termsVersion: r.termsVersion };
  }
  async findPersonByWaIdHash(hash: string): Promise<PersonRef | null> {
    for (const [waId, r] of this.registrations) if (r.waIdHash === hash) return this.person(waId, r);
    return null;
  }
  async findPeopleByName(tokens: readonly string[], limit: number): Promise<PersonRef[]> {
    if (tokens.length === 0) return [];
    const out: PersonRef[] = [];
    for (const [waId, r] of this.registrations) {
      const name = r.values.full_name;
      if (!r.waIdHash || !r.consentAt || !r.termsVersion || !r.registeredAt || !name) continue;
      const folded = foldName(name);
      if (tokens.every((t) => folded.includes(t))) out.push(this.person(waId, r) as PersonRef);
    }
    return out.sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? "")).slice(0, Math.max(1, Math.min(limit, 10)));
  }
  async completeMentoria(waId: string, c: MentoriaCompletion): Promise<boolean> {
    const a = this.audios.get(c.audioId);
    const own = this.registrations.get(waId)?.waIdHash;
    if (!a || !own || a.waIdHash !== own || a.serviceId !== "mentoria") return false;
    if (c.partnerHash === own) throw new Error("parceiro nao pode ser o proprio registrante");
    this.audios.set(a.id, {
      ...a, mentoria: { role: c.role, subject: c.subject, ...(c.partnerName ? { partner: c.partnerName } : {}) },
      ocorreuEm: c.occurredOn, partnerWaIdHash: c.partnerHash,
    });
    return true;
  }
  async discardIncompleteMentoria(id: string): Promise<{ r2Key: string } | null> {
    const a = this.audios.get(id);
    if (!a || a.mentoria || a.serviceId !== "mentoria") return null;
    this.audios.delete(id);
    for (const [k, d] of this.drafts) if (d.audioId === id) this.drafts.delete(k);
    return { r2Key: a.r2Key };
  }
  async listIncompleteMentorias(before: Date): Promise<{ id: string; r2Key: string }[]> {
    return [...this.audios.values()].filter((a) => a.serviceId === "mentoria" && !a.mentoria && a.createdAt < before)
      .map((a) => ({ id: a.id, r2Key: a.r2Key }));
  }
  private awaiting(a: AudioRecord): boolean {
    return !!a.mentoria && !!a.partnerWaIdHash && !a.partnerConfirmedAt && !a.partnerRejectedAt && !a.contestedReason && !a.audioDeletedAt;
  }
  async listUnansweredMentorias(before: Date): Promise<{ id: string; r2Key: string }[]> {
    return [...this.audios.values()].filter((a) => this.awaiting(a) && a.createdAt < before).map((a) => ({ id: a.id, r2Key: a.r2Key }));
  }
  async expireMentoria(id: string, at: Date): Promise<boolean> {
    const a = this.audios.get(id);
    if (!a || !this.awaiting(a)) return false;
    this.audios.set(id, { ...a, contestedReason: "expirada", audioDeletedAt: at });
    return true;
  }
  async listPendingConfirmations(partnerHashes: readonly string[]): Promise<PendingConfirmation[]> {
    return [...this.audios.values()]
      .filter((a) => this.awaiting(a) && partnerHashes.includes(a.partnerWaIdHash as string))
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .map((a) => ({
        id: a.id,
        registrantName: [...this.registrations.values()].find((r) => r.waIdHash === a.waIdHash)?.values.full_name ?? null,
        subject: a.mentoria?.subject ?? "", occurredOn: a.ocorreuEm ?? "", createdAt: a.createdAt,
        prompted: a.partnerPromptedAt !== undefined, partnerHash: a.partnerWaIdHash as string,
      }));
  }
  async markPartnerPrompted(id: string, at: Date): Promise<void> {
    const a = this.audios.get(id);
    if (a && !a.partnerPromptedAt) this.audios.set(id, { ...a, partnerPromptedAt: at });
  }
  async answerPartner(id: string, partnerHashes: readonly string[], answer: "yes" | "no", at: Date, asHash: string): Promise<PartnerAnswerOutcome> {
    const a = this.audios.get(id);
    if (!a?.mentoria || !a.partnerWaIdHash || !partnerHashes.includes(a.partnerWaIdHash)) return "not_found";
    if (!this.awaiting(a)) return "already";
    // Mesma regra do gatilho do banco (R6): só quem consentiu responde.
    const ok = [...this.registrations.values()].some((r) => r.waIdHash === asHash && r.consentAt !== null && r.termsVersion !== null);
    if (!ok) return "no_consent";
    const base = { ...a, partnerWaIdHash: asHash };
    this.audios.set(id, answer === "yes"
      ? { ...base, partnerConfirmedAt: at }
      : { ...base, partnerRejectedAt: at, contestedReason: "recusada", audioDeletedAt: at });
    return answer === "yes" ? "confirmed" : "rejected";
  }
  readonly loginLocks = new Map<string, { failures: number; lockedUntil: Date | null }>();
  async getLoginLock(key: string): Promise<{ failures: number; lockedUntil: Date | null }> {
    return { ...(this.loginLocks.get(key) ?? { failures: 0, lockedUntil: null }) };
  }
  async recordLoginFailure(key: string, now: Date, maxFailures: number, lockMs: number): Promise<void> {
    const cur = await this.getLoginLock(key);
    const expired = cur.lockedUntil !== null && cur.lockedUntil <= now;
    const failures = (expired ? 0 : cur.failures) + 1;
    this.loginLocks.set(key, { failures, lockedUntil: failures >= maxFailures ? new Date(now.getTime() + lockMs) : null });
  }
  async clearLoginFailures(key: string): Promise<void> {
    this.loginLocks.delete(key);
  }
}
