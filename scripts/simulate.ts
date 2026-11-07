// Simulador ponta a ponta (Etapa 8). Sem rede: Graph API falsa que conta envios, banco em memória,
// R2 e analisador falsos, relógio controlável. Usa a mesma fiação de produção (route -> webhook ->
// createEventHandler -> motor -> sendGuarded). Executado pelos testes: `npm run simulate`.
import { MemoryRepo } from "../src/db/memory-repo";
import { route, type AppDeps } from "../src/index";
import { loadConfig, type Config } from "../src/config";
import { MockAudioAnalyzer } from "../src/audio/analyzer";
import { MemoryAudioStore } from "../src/audio/storage";
import { ContentProvider } from "../src/services/provider";
import { createEventHandler } from "../src/webhook/events";
import { signBody } from "../src/whatsapp/signature";
import { monthKey } from "../src/budget/month";
import { UNLOCK_CONFIRM } from "../src/admin/budget";
import type { Logger, LogLevel } from "../src/lib/logger";
import type { MediaClient } from "../src/whatsapp/client";

const APP_SECRET = "sim-secret";
const ADMIN_TOKEN = "sim-admin";
const PHONE_NUMBER_ID = "SIMPN";
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export interface SimOptions {
  start?: Date;
  /** Usa o Flow para o cadastro (padrão true). */
  flow?: boolean;
  env?: Record<string, string>;
  /** Entrega cada webhook duas vezes (a Meta reenvia). */
  duplicateAll?: boolean;
}

export interface SentMessage { to: string; body: Record<string, unknown>; at: Date }

export class Simulator {
  readonly repo = new MemoryRepo();
  readonly store = new MemoryAudioStore();
  readonly analyzer = new MockAudioAnalyzer();
  readonly logs: { level: LogLevel; event: string }[] = [];
  readonly sent: SentMessage[] = [];
  readonly statuses: number[] = [];
  readonly cfg: Config;
  private t: number;
  private seq = 0;
  private pending: Promise<unknown>[] = [];
  private readonly deps: AppDeps;
  private readonly duplicateAll: boolean;

  constructor(o: SimOptions = {}) {
    this.t = (o.start ?? new Date("2026-11-10T15:00:00Z")).getTime();
    this.duplicateAll = o.duplicateAll ?? false;
    this.cfg = loadConfig({
      WHATSAPP_TOKEN: "tok", PHONE_NUMBER_ID, APP_SECRET, VERIFY_TOKEN: "v", GRAPH_API_VERSION: "v21.0",
      SUPABASE_URL: "https://sim.invalid", SUPABASE_SERVICE_KEY: "k", ANALYZER_API_URL: "https://analyzer.invalid",
      ANALYZER_API_KEY: "k", ADMIN_TOKEN, PRIVACY_POLICY_URL: "https://example.com/privacidade", TERMS_VERSION: "sim-1",
      ...(o.flow === false ? {} : { WHATSAPP_FLOW_ID: "FLOW-SIM" }),
      ...o.env,
    });
    const logger: Logger = { log: (level, event) => void this.logs.push({ level, event }) };
    this.repo.clock = () => this.now();
    this.repo.services = [
      { id: "audio", title: "Análise de áudio", description: "Envie um áudio", requiresAudio: true, sortOrder: 1 },
      { id: "horarios", title: "Horários", description: "Nosso horário", requiresAudio: false, sortOrder: 2 },
      { id: "contato", title: "Contato", description: "Fale conosco", requiresAudio: false, sortOrder: 3 },
    ];
    const content = new ContentProvider(this.repo, logger, 60_000, () => this.t);
    const graph = async (_url: unknown, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      this.sent.push({ to: String(body.to), body, at: this.now() });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.OUT${this.sent.length}` }] }), { status: 200 });
    };
    const media: MediaClient = {
      getInfo: async () => ({ url: "https://cdn.sim.invalid/a", mimeType: "audio/ogg", fileSize: 100 }),
      download: async () => ({ ok: true, bytes: new Uint8Array(100).fill(7) }),
    };
    this.deps = {
      appSecret: APP_SECRET, verifyToken: "v", repo: this.repo, logger, now: () => this.now(),
      onEvent: createEventHandler(this.cfg, {
        repo: this.repo, logger, content, fetchImpl: graph as unknown as typeof fetch, now: () => this.now(),
        audio: { media, store: this.store, analyzer: this.analyzer },
      }),
      admin: {
        adminToken: ADMIN_TOKEN, repo: this.repo, logger, phoneNumberId: PHONE_NUMBER_ID,
        stopAt: this.cfg.stopAt, timezone: this.cfg.metaAccountTimezone, now: () => this.now(),
      },
    };
  }

  now(): Date { return new Date(this.t); }
  advance(ms: number): void { this.t += ms; }
  setTime(d: Date): void { this.t = d.getTime(); }
  get sentCount(): number { return this.sent.length; }
  sentTo(phone: string): SentMessage[] { return this.sent.filter((m) => m.to === phone); }
  phone(i: number): string { return `5511${String(900000000 + i)}`; }
  month(): string { return monthKey(this.now(), this.cfg.metaAccountTimezone); }
  async reserved(): Promise<number> {
    return (await this.repo.getBudget(PHONE_NUMBER_ID, this.month()))?.reservedCount ?? 0;
  }

  /** Envia o webhook assinado; espera o processamento (waitUntil) e guarda o status HTTP. */
  private async post(value: Record<string, unknown>): Promise<number> {
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "WABA", changes: [{ field: "messages", value: {
        messaging_product: "whatsapp", metadata: { phone_number_id: PHONE_NUMBER_ID }, ...value } }] }],
    });
    const times = this.duplicateAll ? 2 : 1;
    let last = 0;
    for (let i = 0; i < times; i++) {
      const req = new Request("https://bot.sim.invalid/webhook", {
        method: "POST", body: payload, headers: { "X-Hub-Signature-256": await signBody(payload, APP_SECRET) },
      });
      const res = await route(req, { waitUntil: (p) => void this.pending.push(p) }, this.deps);
      await Promise.all(this.pending.splice(0));
      this.statuses.push(res.status);
      last = res.status;
    }
    return last;
  }

  private message(from: string, extra: Record<string, unknown>): Promise<number> {
    return this.post({
      contacts: [{ profile: { name: "Pessoa" }, wa_id: from }],
      messages: [{ from, id: `wamid.IN${++this.seq}`, timestamp: String(Math.floor(this.t / 1000)), ...extra }],
    });
  }
  text(from: string, body: string) { return this.message(from, { type: "text", text: { body } }); }
  button(from: string, id: string) {
    return this.message(from, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } });
  }
  list(from: string, id: string) {
    return this.message(from, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: "x" } } });
  }
  form(from: string) {
    const json = JSON.stringify({ flow_token: "t", full_name: "Maria da Silva", email: `${from}@exemplo.com`, city: "Recife", consent: true });
    return this.message(from, { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: json } } });
  }
  audio(from: string) {
    return this.message(from, { type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg; codecs=opus", voice: true } });
  }
  sticker(from: string) { return this.message(from, { type: "sticker", sticker: { id: "S1", mime_type: "image/webp" } }); }
  /** Status webhook de uma mensagem nossa, com pricing. */
  status(wamid: string, pricing: Record<string, unknown>) {
    return this.post({ statuses: [{ id: wamid, status: "sent", recipient_id: "x", timestamp: String(Math.floor(this.t / 1000)), pricing }] });
  }
  async unlock(): Promise<number> {
    const res = await route(new Request(`https://bot.sim.invalid/admin/budget/unlock?confirm=${UNLOCK_CONFIRM}`, {
      method: "POST", headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    }), { waitUntil: () => undefined }, this.deps);
    return res.status;
  }

  /** Cadastro completo (oi -> Flow/consentimento -> escolha do serviço de áudio). Não manda o áudio. */
  async register(p: string, step = 0): Promise<void> {
    await this.text(p, "oi"); this.advance(step);
    if (this.cfg.whatsappFlowId) { await this.form(p); this.advance(step); }
    else {
      await this.button(p, "consent_yes"); this.advance(step);
      await this.text(p, "Maria da Silva"); this.advance(step);
      await this.text(p, `${p}@exemplo.com`); this.advance(step);
      await this.text(p, "Recife"); this.advance(step);
    }
  }
  async chooseAudio(p: string) { await this.list(p, "svc_audio"); }
}

export interface Metrics {
  [k: string]: number | boolean | string;
}

const allOk = (s: Simulator) => s.statuses.every((c) => c === 200);

/** S1: 300 pessoas novas, cadastro + 1 áudio, no mesmo mês. */
export async function runS1(): Promise<Metrics> {
  const s = new Simulator();
  const N = 300;
  const stages: ((p: string) => Promise<unknown>)[] = [
    (p) => s.text(p, "oi"), (p) => s.form(p), (p) => s.chooseAudio(p), (p) => s.audio(p),
  ];
  let cutAt = -1;
  let afterCut = 0;
  for (const stage of stages) {
    for (let i = 0; i < N; i++) {
      await stage(s.phone(i));
      s.advance(1000);
      const r = await s.reserved();
      if (cutAt < 0 && r >= s.cfg.stopAt) cutAt = s.sentCount;
      if (cutAt >= 0) afterCut = s.sentCount - cutAt;
    }
  }
  return {
    people: N, stopAt: s.cfg.stopAt, sends: s.sentCount, reserved: await s.reserved(),
    sendsAfterCut: afterCut, cutReached: cutAt >= 0, allWebhooks200: allOk(s), webhooks: s.statuses.length,
    critical: s.logs.filter((l) => l.level === "critical" && l.event === "budget_circuit_open").length,
    warn80: s.logs.filter((l) => l.event === "budget_80_percent").length,
  };
}

/** S2: 50 pessoas mandando "oi" 30 vezes. */
export async function runS2(): Promise<Metrics> {
  const s = new Simulator();
  for (let k = 0; k < 30; k++) {
    for (let i = 0; i < 50; i++) { await s.text(s.phone(i), "oi"); s.advance(1000); }
    s.advance(MINUTE);
  }
  return { people: 50, messagesEach: 30, sends: s.sentCount, allWebhooks200: allOk(s) };
}

/** S3: mensagens por pessoa (nova; áudio extra; pessoa cadastrada voltando). */
export async function runS3(): Promise<Metrics> {
  const s = new Simulator();
  const a = s.phone(1);
  await s.register(a, 30_000);
  await s.chooseAudio(a); s.advance(30_000);
  await s.audio(a);
  const newPerson = s.sentTo(a).length;
  s.advance(11 * MINUTE); // sai da janela de 10 min (mesma sessão: bem menos de 6 h)
  const before = s.sentTo(a).length;
  await s.audio(a);
  const extraAudio = s.sentTo(a).length - before;
  // volta no dia seguinte (nova sessão, janela reaberta pela própria mensagem dela)
  s.advance(8 * HOUR);
  const base = s.sentTo(a).length;
  await s.text(a, "oi"); s.advance(30_000);
  await s.chooseAudio(a); s.advance(30_000);
  await s.audio(a);
  const returning = s.sentTo(a).length - base;
  return { newPerson, extraAudio, returning, audiosStored: s.store.objects.size, allWebhooks200: allOk(s) };
}

/** S4: todos os webhooks em dobro -> mesma quantidade de envios que a entrega única. */
export async function runS4(): Promise<Metrics> {
  const run = async (dup: boolean) => {
    const s = new Simulator({ duplicateAll: dup });
    for (let i = 0; i < 20; i++) {
      const p = s.phone(i);
      await s.register(p, 1000);
      await s.chooseAudio(p); s.advance(1000);
      await s.audio(p); s.advance(1000);
    }
    const perPerson = new Map<string, number>();
    for (const m of s.sent) perPerson.set(m.to, (perPerson.get(m.to) ?? 0) + 1);
    return { sends: s.sentCount, max: Math.max(...perPerson.values()), webhooks: s.statuses.length, ok: allOk(s), audios: s.repo.audios.size };
  };
  const single = await run(false);
  const dup = await run(true);
  return {
    sendsSingle: single.sends, sendsDuplicated: dup.sends, webhooksDuplicated: dup.webhooks, webhooksSingle: single.webhooks,
    maxPerPersonDuplicated: dup.max, audiosSingle: single.audios, audiosDuplicated: dup.audios, allWebhooks200: single.ok && dup.ok,
  };
}

/** S5: status com billable:true no meio -> nada sai até o unlock manual. */
export async function runS5(): Promise<Metrics> {
  const s = new Simulator();
  const people = 40;
  for (let i = 0; i < 20; i++) { await s.text(s.phone(i), "oi"); s.advance(1000); }
  const beforeSignal = s.sentCount;
  await s.status(`wamid.OUT1`, { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" });
  for (let i = 20; i < people; i++) { await s.text(s.phone(i), "oi"); s.advance(1000); }
  for (let i = 0; i < 20; i++) { await s.form(s.phone(i)); s.advance(1000); }
  const afterSignal = s.sentCount - beforeSignal;
  const lockedWhileOpen = (await s.repo.getManualLock(PHONE_NUMBER_ID)).locked;
  const unlockStatus = await s.unlock();
  s.advance(MINUTE);
  const preResume = s.sentCount;
  await s.text(s.phone(99), "oi");
  return {
    sendsBeforeSignal: beforeSignal, sendsAfterSignalUntilUnlock: afterSignal, lockedWhileOpen, unlockStatus,
    sendsAfterUnlock: s.sentCount - preResume, allWebhooks200: allOk(s),
    critical: s.logs.filter((l) => l.level === "critical").length,
  };
}

/** S6: contador zera à meia-noite do dia 1 no fuso configurado (America/Sao_Paulo = UTC-3). */
export async function runS6(): Promise<Metrics> {
  const s = new Simulator({ start: new Date("2026-11-30T20:00:00Z") });
  const stopAt = s.cfg.stopAt;
  for (let i = 0; i < stopAt; i++) await s.repo.reserveSlot(PHONE_NUMBER_ID, "2026-11", stopAt);
  const p = s.phone(1);
  await s.text(p, "oi");
  const sendsNovFull = s.sentCount;
  // 02:59:30Z de 1/12 = 23:59:30 de 30/11 em São Paulo: ainda novembro
  s.setTime(new Date("2026-12-01T02:59:30Z"));
  await s.text(s.phone(2), "oi");
  const sendsLastSecondsNov = s.sentCount;
  // 03:00:30Z = 00:00:30 de 1/12 em São Paulo: dezembro
  s.setTime(new Date("2026-12-01T03:00:30Z"));
  await s.text(s.phone(3), "oi");
  return {
    stopAt, sendsWhileNovemberFull: sendsNovFull, sendsLastSecondsNovember: sendsLastSecondsNov,
    sendsAfterMidnight: s.sentCount - sendsLastSecondsNov,
    novemberReserved: (await s.repo.getBudget(PHONE_NUMBER_ID, "2026-11"))?.reservedCount ?? -1,
    decemberReserved: (await s.repo.getBudget(PHONE_NUMBER_ID, "2026-12"))?.reservedCount ?? -1,
    allWebhooks200: allOk(s),
  };
}

/** S7: uma pessoa manda 100 mensagens (válidas e inválidas) em 1 minuto. */
export async function runS7(): Promise<Metrics> {
  const s = new Simulator();
  const p = s.phone(7);
  await s.register(p, 1000);
  s.advance(11 * MINUTE); // zera a janela de 10 min do cadastro
  const base = s.sentTo(p).length;
  const inputs: (() => Promise<unknown>)[] = [
    () => s.text(p, "menu"), () => s.list(p, "svc_horarios"), () => s.text(p, "banana"), () => s.list(p, "svc_contato"),
    () => s.text(p, "oiii!!"), () => s.sticker(p), () => s.text(p, "MENU"), () => s.list(p, "svc_audio"),
    () => s.audio(p), () => s.button(p, "menu"),
  ];
  for (let i = 0; i < 100; i++) { await inputs[i % inputs.length]!(); s.advance(600); }
  return { messages: 100, sends: s.sentTo(p).length - base, allWebhooks200: allOk(s), maxPer10Min: s.cfg.maxBotMsgsPerUserPer10Min, maxPerDay: s.cfg.maxBotMsgsPerUserPerDay };
}

export async function runAll(): Promise<Record<string, Metrics>> {
  return { S1: await runS1(), S2: await runS2(), S3: await runS3(), S4: await runS4(), S5: await runS5(), S6: await runS6(), S7: await runS7() };
}
