// Simulador ponta a ponta (Etapa 8). Sem rede: transporte falso que conta envios, banco em memória,
// R2 e analisador falsos, relógio controlável. Usa a mesma fiação de produção (route -> webhook ->
// createEventHandler -> motor -> sendGuarded). Executado pelos testes: `npm run simulate`.
import type { IntentAgent } from "../src/ai/agent";
import { MemoryRepo } from "../src/db/memory-repo";
import { route, type AppDeps } from "../src/index";
import { loadConfig, type Config } from "../src/config";
import { MockAudioAnalyzer } from "../src/audio/analyzer";
import { MemoryAudioStore } from "../src/audio/storage";
import { ContentProvider } from "../src/services/provider";
import { createEventHandler } from "../src/webhook/events";
import { TOKEN as WEBHOOK_TOKEN, upsert } from "../tests/helpers/evolution";
import { dayKey } from "../src/budget/month";
import { UNLOCK_CONFIRM } from "../src/admin/budget";
import type { Logger, LogLevel } from "../src/lib/logger";
import type { MediaClient } from "../src/whatsapp/client";
import { asTransport } from "../tests/helpers/transport";

const ADMIN_TOKEN = "sim-admin";
const INSTANCE = "simpn"; // nome da instância da Evolution (chave da trava e do contador)
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export interface SimOptions {
  start?: Date;
  env?: Record<string, string>;
  /** Agente de IA falso (testes): sem rede. */
  agent?: IntentAgent;
  /** Entrega cada webhook duas vezes (a Evolution pode reenviar). */
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
      EVOLUTION_URL: "https://evo.sim.invalid", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: INSTANCE,
      EVOLUTION_WEBHOOK_TOKEN: WEBHOOK_TOKEN, ANTI_FLOOD_MAX_PER_DAY: "950",
      SUPABASE_URL: "https://sim.invalid", SUPABASE_SERVICE_KEY: "k", ANALYZER_API_URL: "https://analyzer.invalid",
      ANALYZER_API_KEY: "k", ADMIN_TOKEN, PRIVACY_POLICY_URL: "https://example.com/privacidade", TERMS_VERSION: "sim-1",
      // O cadastro novo tem ~7 mensagens do bot: os limites por pessoa da simulação seguem a produção (wrangler.toml).
      MAX_BOT_MSGS_PER_USER_PER_10MIN: "10", MAX_BOT_MSGS_PER_USER_PER_DAY: "40",
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
      getInfo: async (id: string) => ({ url: "https://cdn.sim.invalid/a", mimeType: id.startsWith("DOC") ? "application/pdf" : "audio/ogg", fileSize: 100 }),
      download: async () => ({ ok: true, bytes: new Uint8Array(100).fill(7) }),
    };
    this.deps = {
      webhookToken: WEBHOOK_TOKEN, repo: this.repo, logger, now: () => this.now(),
      onEvent: createEventHandler(this.cfg, {
        repo: this.repo, logger, content, transport: asTransport(graph as never), now: () => this.now(),
        audio: { media, store: this.store, analyzer: this.analyzer },
        ...(o.agent ? { agent: o.agent } : {}),
      }),
      admin: {
        adminToken: ADMIN_TOKEN, repo: this.repo, logger, phoneNumberId: INSTANCE,
        stopAt: this.cfg.stopAt, timezone: this.cfg.timezone, now: () => this.now(),
      },
    };
  }

  now(): Date { return new Date(this.t); }
  advance(ms: number): void { this.t += ms; }
  setTime(d: Date): void { this.t = d.getTime(); }
  get sentCount(): number { return this.sent.length; }
  sentTo(phone: string): SentMessage[] { return this.sent.filter((m) => m.to === phone); }
  phone(i: number): string { return `5511${String(900000000 + i)}`; }
  /** Chave do dia do contador anti-flood. */
  period(): string { return dayKey(this.now(), this.cfg.timezone); }
  async reserved(): Promise<number> {
    return (await this.repo.getBudget(INSTANCE, this.period()))?.reservedCount ?? 0;
  }

  /** Envia o webhook `messages.upsert` com o token; espera o processamento (waitUntil) e guarda o status HTTP. */
  private async post(message: Record<string, unknown>, from: string, id: string): Promise<number> {
    const payload = JSON.stringify(upsert(message, { id, jid: `${from}@s.whatsapp.net`, ts: Math.floor(this.t / 1000) }));
    const times = this.duplicateAll ? 2 : 1;
    let last = 0;
    for (let i = 0; i < times; i++) {
      const req = new Request("https://bot.sim.invalid/webhook", {
        method: "POST", body: payload, headers: { "x-webhook-token": WEBHOOK_TOKEN },
      });
      const res = await route(req, { waitUntil: (p) => void this.pending.push(p) }, this.deps);
      await Promise.all(this.pending.splice(0));
      this.statuses.push(res.status);
      last = res.status;
    }
    return last;
  }

  private message(from: string, extra: Record<string, unknown>, idPrefix = "IN"): Promise<number> {
    return this.post(extra, from, `${idPrefix}${++this.seq}`);
  }
  text(from: string, body: string) { return this.message(from, { conversation: body }); }
  /** Resposta de botão (chega como buttonsResponseMessage; o motor só vê o id). */
  button(from: string, id: string) {
    return this.message(from, { buttonsResponseMessage: { selectedButtonId: id, selectedDisplayText: "x" } });
  }
  list(from: string, id: string) {
    return this.message(from, { listResponseMessage: { title: "x", singleSelectReply: { selectedRowId: id } } });
  }
  document(from: string, mime = "application/pdf", filename = "duvidas.pdf") {
    return this.message(from, { documentMessage: { mimetype: mime, fileName: filename } }, "DOC");
  }
  audio(from: string) {
    return this.message(from, { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } }, "MEDIA");
  }
  /** Contato compartilhado (anexo > Contato): cada item vira um telefone do contato. */
  contacts(from: string, phones: { wa_id?: string; phone?: string }[]) {
    const vcards = phones.map((ph) => `BEGIN:VCARD\nVERSION:3.0\nFN:Fulano\nTEL;type=CELL${ph.wa_id ? `;waid=${ph.wa_id}` : ""}:${ph.phone ?? ph.wa_id ?? ""}\nEND:VCARD`);
    return this.message(from, { contactsArrayMessage: { contacts: vcards.map((vcard) => ({ displayName: "Fulano", vcard })) } });
  }
  sticker(from: string) { return this.message(from, { stickerMessage: {} }); }
  async unlock(): Promise<number> {
    const res = await route(new Request(`https://bot.sim.invalid/admin/budget/unlock?confirm=${UNLOCK_CONFIRM}`, {
      method: "POST", headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    }), { waitUntil: () => undefined }, this.deps);
    return res.status;
  }

  /** Cadastro completo: oi -> aceite -> nome -> turma -> áudio de perfil -> papel (mentorado) -> sem dúvida agora. */
  async register(p: string, step = 0): Promise<void> {
    await this.text(p, "oi"); this.advance(step);
    await this.button(p, "consent_yes"); this.advance(step);
    await this.text(p, "Maria da Silva"); this.advance(step);
    await this.text(p, "Turma 12"); this.advance(step);
    await this.audio(p); this.advance(step);
    await this.button(p, "prof_mentorado"); this.advance(step);
    await this.button(p, "doubt_no"); this.advance(step);
  }
  async chooseAudio(p: string) { await this.list(p, "svc_audio"); }
}

export interface Metrics {
  [k: string]: number | boolean | string;
}

const allOk = (s: Simulator) => s.statuses.every((c) => c === 200);

/** S1: 400 pessoas novas enviam cadastro + áudio de apresentação, no mesmo dia (teto anti-flood de 950/dia). */
export async function runS1(): Promise<Metrics> {
  const s = new Simulator();
  const N = 400;
  const stages: ((p: string) => Promise<unknown>)[] = [
    (p) => s.text(p, "oi"), (p) => s.button(p, "consent_yes"), (p) => s.text(p, "Maria da Silva"),
    (p) => s.text(p, "Turma 12"), (p) => s.audio(p),
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
    critical: s.logs.filter((l) => l.level === "critical" && l.event === "flood_limit_reached").length,
    warn80: s.logs.filter((l) => l.event === "flood_limit_80_percent").length,
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
  s.advance(11 * MINUTE);
  await s.text(a, "menu"); s.advance(30_000);
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
      s.advance(11 * MINUTE);
      await s.text(p, "menu"); s.advance(1000);
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

/** S5: trava manual ligada no meio (ação humana/admin) -> nada sai até o unlock manual. */
export async function runS5(): Promise<Metrics> {
  const s = new Simulator();
  const people = 40;
  for (let i = 0; i < 20; i++) { await s.text(s.phone(i), "oi"); s.advance(1000); }
  const beforeSignal = s.sentCount;
  await s.repo.setManualLock(INSTANCE, "simulação: trava ligada por um humano");
  for (let i = 20; i < people; i++) { await s.text(s.phone(i), "oi"); s.advance(1000); }
  for (let i = 0; i < 20; i++) { await s.button(s.phone(i), "consent_yes"); s.advance(1000); }
  const afterSignal = s.sentCount - beforeSignal;
  const lockedWhileOpen = (await s.repo.getManualLock(INSTANCE)).locked;
  const unlockStatus = await s.unlock();
  s.advance(MINUTE);
  const preResume = s.sentCount;
  await s.text(s.phone(99), "oi");
  return {
    sendsBeforeSignal: beforeSignal, sendsAfterSignalUntilUnlock: afterSignal, lockedWhileOpen, unlockStatus,
    sendsAfterUnlock: s.sentCount - preResume, allWebhooks200: allOk(s),
  };
}

/** S6: o contador anti-flood zera à meia-noite do fuso configurado (America/Sao_Paulo = UTC-3). */
export async function runS6(): Promise<Metrics> {
  const s = new Simulator({ start: new Date("2026-11-30T20:00:00Z") });
  const stopAt = s.cfg.stopAt;
  for (let i = 0; i < stopAt; i++) await s.repo.reserveSlot(INSTANCE, "2026-11-30", stopAt);
  const p = s.phone(1);
  await s.text(p, "oi");
  const sendsDayFull = s.sentCount;
  // 02:59:30Z de 1/12 = 23:59:30 de 30/11 em São Paulo: ainda o mesmo dia
  s.setTime(new Date("2026-12-01T02:59:30Z"));
  await s.text(s.phone(2), "oi");
  const sendsLastSeconds = s.sentCount;
  // 03:00:30Z = 00:00:30 de 1/12 em São Paulo: dia novo
  s.setTime(new Date("2026-12-01T03:00:30Z"));
  await s.text(s.phone(3), "oi");
  return {
    stopAt, sendsWhileDayFull: sendsDayFull, sendsLastSecondsOfDay: sendsLastSeconds,
    sendsAfterMidnight: s.sentCount - sendsLastSeconds,
    dayFullReserved: (await s.repo.getBudget(INSTANCE, "2026-11-30"))?.reservedCount ?? -1,
    nextDayReserved: (await s.repo.getBudget(INSTANCE, "2026-12-01"))?.reservedCount ?? -1,
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
