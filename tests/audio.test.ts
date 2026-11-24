import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { MemoryRepo } from "../src/db/memory-repo";
import { handleIncomingMessage } from "../src/conversation/engine";
import { ContentProvider } from "../src/services/provider";
import { processAudio, MEDIA_URL_TTL_MS } from "../src/audio/pipeline";
import { AnalyzerError, HttpAudioAnalyzer, MockAudioAnalyzer, type AudioAnalyzer } from "../src/audio/analyzer";
import { MemoryAudioStore } from "../src/audio/storage";
import { createMediaClient } from "../src/whatsapp/evolutionClient";
import { upsert } from "./helpers/evolution";
import { sendGuarded, type DownloadResult, type MediaClient, type MediaInfo } from "../src/whatsapp/client";
import { processEvents } from "../src/webhook/handler";
import { hashWaId } from "../src/lib/hash";
import type { Logger } from "../src/lib/logger";
import type { AudioEvent, IncomingMessage, WebhookEvent } from "../src/whatsapp/types";
import { asTransport } from "./helpers/transport";

const T0 = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
let seq = 0;
const audio = (extra: Partial<AudioEvent> = {}): AudioEvent => ({
  type: "audio", wamid: `a${++seq}`, from: WA, mediaId: "MEDIA1", voice: true, mimeType: "audio/ogg; codecs=opus", ...extra,
});
const text = (body: string): IncomingMessage => ({ type: "text", wamid: `a${++seq}`, from: WA, body });
const list = (id: string): IncomingMessage => ({ type: "list_reply", wamid: `a${++seq}`, from: WA, id, title: "x" });
const bytes = (n = 100) => new Uint8Array(n).fill(7);

interface Opts {
  analyzer?: AudioAnalyzer;
  info?: () => Promise<MediaInfo>;
  download?: (url: string) => Promise<DownloadResult>;
  maxAudioBytes?: number;
  maxPer10Min?: number;
  consent?: boolean;
  state?: string;
  openStream?: NonNullable<MediaClient["openStream"]>;
}

function setup(o: Opts = {}) {
  const logs: { level: string; event: string }[] = [];
  const logger: Logger = { log: (level, event) => void logs.push({ level, event }) };
  const repo = new MemoryRepo();
  let t = T0.getTime();
  let step = 0;
  const now = () => { const d = new Date(t); t += step; return d; };
  const warp = (ms: number) => { t += ms; };
  const graph = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `o${++seq}` }] }), { status: 200 }));
  const getInfo = vi.fn(o.info ?? (async () => ({ url: "https://cdn.example/a", mimeType: "audio/ogg", fileSize: 100 })));
  const download = vi.fn(o.download ?? (async () => ({ ok: true, bytes: bytes() }) as DownloadResult));
  const media: MediaClient = { getInfo, download, ...(o.openStream ? { openStream: o.openStream } : {}) };
  const store = new MemoryAudioStore();
  const analyzer = o.analyzer ?? new MockAudioAnalyzer();
  const provider = new ContentProvider(repo, logger, 60_000, () => t);
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, {
      repo, logger, phoneNumberId: "PN", evolutionUrl: "https://evo.test", evolutionApiKey: "k", evolutionInstance: "inst", stopAt: 950,
      timezone: "America/Sao_Paulo", transport: asTransport(graph as never), now,
    });
  const maxPer10Min = o.maxPer10Min ?? 50;
  const audioDeps: Parameters<typeof processAudio>[2] = {
    repo, logger, send, media, store, analyzer, content: provider, maxAudioBytes: o.maxAudioBytes ?? 16_000_000,
    maxPerDay: 50, maxPer10Min, timezone: "America/Sao_Paulo", now, uuid: () => `00000000-0000-4000-8000-00000000000${++seq % 10}`,
  };
  const deps = {
    repo, logger, send, maxPerDay: 50, maxPer10Min, now, content: provider,
    audio: { process: (m: AudioEvent, h: boolean) => processAudio(m, h, audioDeps) },
  };
  const feed = async (ev: IncomingMessage) => {
    await processEvents([ev], {
      webhookToken: "", repo, logger, now,
      onEvent: async (e: WebhookEvent) => { await handleIncomingMessage(e, deps); },
    });
  };
  const sent = () => graph.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
  const hash = hashWaId(WA);
  const ready = async () => {
    repo.services = [
      { id: "audio", title: "Análise de áudio", description: "d", requiresAudio: true, sortOrder: 1 },
      { id: "horarios", title: "Horários", description: "d", requiresAudio: false, sortOrder: 2 },
    ];
    await repo.touchUser(WA, new Date(t));
    if (o.consent !== false) {
      repo.registrations.set(WA, {
        consentAt: T0, termsVersion: "v1", registeredAt: T0, values: {}, waIdHash: await hash,
      });
    }
    repo.conversations.set(WA, {
      state: o.state ?? "AWAIT_AUDIO", previousState: null, hintSentInState: false, optedOutAt: null, version: 1,
    });
  };
  return { repo, graph, getInfo, download, store, analyzer, feed, sent, logs, ready, warp, setStep: (ms: number) => { step = ms; }, audioDeps, hash };
}

describe("C6.1 URL da mídia expira em 5 minutos", () => {
  it("C6.1 baixa dentro do mesmo processamento do evento (antes de feed resolver)", async () => {
    const s = setup();
    await s.ready();
    await s.feed(audio());
    expect(s.getInfo).toHaveBeenCalledTimes(1);
    expect(s.download).toHaveBeenCalledTimes(1);
    expect(s.download).toHaveBeenCalledWith("https://cdn.example/a", 16_000_000);
  });

  it("C6.1 relógio falso: atraso acima de 5 min é detectado e pede nova URL uma única vez", async () => {
    const s = setup({
      info: vi.fn(async () => ({ url: "https://cdn.example/a", mimeType: "audio/ogg" })) as () => Promise<MediaInfo>,
    });
    await s.ready();
    s.setStep(MEDIA_URL_TTL_MS + 1000); // cada leitura do relógio avança 5 min + 1 s
    await s.feed(audio());
    expect(s.getInfo).toHaveBeenCalledTimes(2); // original + renovada (nunca mais que uma)
    expect(s.download).toHaveBeenCalledTimes(1);
  });

  it("C6.1 URL expirada no download (403): tenta nova URL uma vez e conclui", async () => {
    let n = 0;
    const s = setup({ download: async () => (++n === 1 ? { ok: false, reason: "expired" } : { ok: true, bytes: bytes() }) });
    await s.ready();
    await s.feed(audio());
    expect(s.getInfo).toHaveBeenCalledTimes(2);
    expect(s.download).toHaveBeenCalledTimes(2);
    expect(s.sent()).toHaveLength(1);
    expect(s.repo.audios.size).toBe(1);
  });

  it("C6.1 continua expirada depois da renovação: dica única e nada de analisador", async () => {
    const s = setup({ download: async () => ({ ok: false, reason: "expired" }) });
    await s.ready();
    await s.feed(audio());
    expect(s.getInfo).toHaveBeenCalledTimes(2);
    expect(s.download).toHaveBeenCalledTimes(2);
    expect((s.analyzer as MockAudioAnalyzer).calls).toHaveLength(0);
    expect(s.sent()).toHaveLength(1);
    await s.feed(audio()); // segunda falha igual: silêncio
    expect(s.sent()).toHaveLength(1);
    expect((await s.repo.getConversation(WA)).state).toBe("AWAIT_AUDIO");
  });

  it("C6.1 cliente de mídia (Evolution): getInfo só embrulha o id; download pede base64 com apikey", async () => {
    const calls: { url: string; apikey: string | null; body: unknown }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, apikey: new Headers(init?.headers).get("apikey"), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ base64: btoa("\x01\x02\x03"), mimetype: "audio/ogg" }), { status: 201 });
    });
    const c = createMediaClient({ url: "https://evo.test", apiKey: "KEY", instance: "inst", fetchImpl: f as unknown as typeof fetch });
    const info = await c.getInfo("ID_1");
    expect(info.url).toBe("evolution-media:ID_1");
    const dl = await c.download(info.url, 10);
    expect(dl).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "audio/ogg" });
    expect(calls[0]).toMatchObject({ url: "https://evo.test/chat/getBase64FromMediaMessage/inst", apikey: "KEY", body: { message: { key: { id: "ID_1" } } } });
    await expect(c.getInfo("../x")).rejects.toThrow();
    expect(await c.download(info.url, 2)).toEqual({ ok: false, reason: "too_large" });
    expect(await c.download("https://outro.host/x", 10)).toEqual({ ok: false, reason: "error" });
  });

  it("C6.1 cliente de mídia: 404 = expirada; erro HTTP/rede/base64 ausente = error", async () => {
    const mk = (r: () => Promise<Response>) => createMediaClient({ url: "https://evo.test", apiKey: "k", instance: "inst", fetchImpl: r as unknown as typeof fetch });
    expect(await mk(async () => new Response("x", { status: 404 })).download("evolution-media:A", 10)).toEqual({ ok: false, reason: "expired" });
    expect(await mk(async () => new Response("x", { status: 500 })).download("evolution-media:A", 10)).toEqual({ ok: false, reason: "error" });
    expect(await mk(async () => { throw new Error("rede"); }).download("evolution-media:A", 10)).toEqual({ ok: false, reason: "error" });
    expect(await mk(async () => new Response("{}", { status: 201 })).download("evolution-media:A", 10)).toEqual({ ok: false, reason: "error" });
  });
});

describe("C6.2 armazenamento", () => {
  it("C6.2 salva no R2 (mock) com chave audios/mentorias/<hash>/<YYYY-MM>/<uuid>.<ext> sem o telefone", async () => {
    const s = setup();
    await s.ready();
    await s.feed(audio());
    expect(s.store.objects.size).toBe(1);
    const key = [...s.store.objects.keys()][0]!;
    expect(key).toMatch(/^audios\/mentorias\/[0-9a-f]{64}\/2026-11\/[0-9a-f-]+\.ogg$/);
    expect(key).not.toContain(WA);
    expect(key).toContain(await s.hash);
    const row = [...s.repo.audios.values()][0]!;
    // Mentoria INCOMPLETA: só o arquivo (assunto, data e parceiro vêm depois); nada de análise.
    expect(row).toMatchObject({ r2Key: key, mime: "audio/ogg", bytes: 100, status: "processing", serviceId: "mentoria", waIdHash: await s.hash });
    expect(row.mentoria).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain(WA);
  });
});

describe("C6.3 fluxo feliz", () => {
  it("C6.3 1 áudio -> 1 mensagem (pergunta do papel, com botões) e vai a MENT_ROLE", async () => {
    const s = setup();
    await s.ready();
    await s.feed(audio());
    const out = s.sent();
    expect(out).toHaveLength(1);
    expect(out[0].interactive.type).toBe("button");
    expect(out[0].interactive.action.buttons.map((b: { reply: { id: string } }) => b.reply.id)).toEqual(["ment_role_mentor", "ment_role_mentorado"]);
    expect((await s.repo.getConversation(WA)).state).toBe("MENT_ROLE");
    expect((await s.repo.getMentoriaDraft(WA)).audioId).toBe([...s.repo.audios.keys()][0]);
  });
  it("C6.3 outro áudio enquanto descreve a mentoria: silêncio (1 entrada válida = 1 resposta)", async () => {
    const s = setup();
    await s.ready();
    for (let i = 0; i < 3; i++) await s.feed(audio());
    expect(s.sent()).toHaveLength(1);
    expect(s.repo.audios.size).toBe(1);
  });
  it("C6.3 caminho completo do menu: escolher serviço (1) + áudio (1) = 2 mensagens", async () => {
    const s = setup({ state: "MENU" });
    await s.ready();
    await s.feed(list("svc_audio"));
    await s.feed(audio());
    expect(s.sent()).toHaveLength(2);
  });

  it("C6.3 R6: o analisador síncrono NÃO é chamado no áudio de mentoria (a voz do parceiro ainda não consentiu)", async () => {
    const s = setup();
    await s.ready();
    await s.feed(audio());
    expect((s.analyzer as MockAudioAnalyzer).calls).toHaveLength(0);
  });
});

describe("C6.4 analisador lento ou com erro", () => {
  it("C6.4 HTTP: 2 novas tentativas com espera crescente e depois falha", async () => {
    const sleeps: number[] = [];
    const f = vi.fn(async () => new Response("erro", { status: 503 }));
    const a = new HttpAudioAnalyzer({ url: "https://an.example", apiKey: "k", fetchImpl: f as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms) });
    await expect(a.analyze({ bytes: bytes(), mime: "audio/ogg" })).rejects.toBeInstanceOf(AnalyzerError);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("C6.4 HTTP: sucesso na 2ª tentativa devolve o resultado; 4xx não repete", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? new Response("x", { status: 500 }) : new Response(JSON.stringify({ summary: "ok!" }))));
    const a = new HttpAudioAnalyzer({ url: "https://an.example", apiKey: "k", fetchImpl: f as unknown as typeof fetch, sleep: async () => undefined });
    expect((await a.analyze({ bytes: bytes(), mime: "audio/ogg" })).text).toBe("ok!");
    const g = vi.fn(async () => new Response("no", { status: 400 }));
    const b = new HttpAudioAnalyzer({ url: "https://an.example", apiKey: "k", fetchImpl: g as unknown as typeof fetch, sleep: async () => undefined });
    await expect(b.analyze({ bytes: bytes(), mime: "audio/ogg" })).rejects.toThrow();
    expect(g).toHaveBeenCalledTimes(1);
  });

  it("C6.4 HTTP: respeita o timeout de cada tentativa (aborta a requisição lenta)", async () => {
    const f = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new Error("abort")));
    }));
    const a = new HttpAudioAnalyzer({ url: "https://an.example", apiKey: "k", timeoutMs: 20, backoffMs: 1, fetchImpl: f as unknown as typeof fetch });
    const t0 = Date.now();
    await expect(a.analyze({ bytes: bytes(), mime: "audio/ogg" })).rejects.toMatchObject({ message: "timeout" });
    expect(f).toHaveBeenCalledTimes(3);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("C6.4 falha definitiva no download: no máximo 1 mensagem de erro, mesmo com falhas seguidas", async () => {
    const s = setup({ download: async () => ({ ok: false, reason: "error" }) });
    await s.ready();
    await s.feed(audio());
    await s.feed(audio());
    await s.feed(audio());
    expect(s.sent()).toHaveLength(1);
    expect(s.sent()[0].text.body).toMatch(/de novo/);
    expect(s.repo.audios.size).toBe(0);
    expect((await s.repo.getConversation(WA)).state).toBe("AWAIT_AUDIO");
  });
  it("C6.4 a mensagem de erro conta no anti-flood (reserva) e nos limites da pessoa", async () => {
    const s = setup({ download: async () => ({ ok: false, reason: "error" }) });
    await s.ready();
    await s.feed(audio());
    expect(s.repo.outbound).toHaveLength(1);
    expect((await s.repo.getBudget("PN", "2026-11-10"))?.reservedCount).toBe(1);
  });
  it("C6.4 depois de um erro, um áudio bom volta a seguir o fluxo (pergunta do papel)", async () => {
    let n = 0;
    const s = setup({ download: async () => (++n === 1 ? { ok: false, reason: "error" } : { ok: true, bytes: bytes() }) });
    await s.ready();
    await s.feed(audio());
    await s.feed(audio());
    expect(s.sent()).toHaveLength(2);
    expect(s.sent()[1].interactive.body.text).toMatch(/mentor/);
    expect((await s.repo.getConversation(WA)).state).toBe("MENT_ROLE");
  });
  it("C6.4 limite por pessoa: sem vaga, silêncio (resultado salvo)", async () => {
    const s = setup({ maxPer10Min: 1 });
    await s.ready();
    await s.feed(audio());
    expect(s.sent()).toHaveLength(1);
    await s.feed(audio()); // já no limite: nem processa
    expect(s.sent()).toHaveLength(1);
    expect(s.repo.audios.size).toBe(1);
  });
});

describe("C6.5 sem janela de 24h", () => {
  it("C6.5 resposta sai mesmo muito tempo depois (o Baileys não tem janela): arquivo guardado e conversa avança", async () => {
    const s = setup({ download: async () => { w.warp(24 * 3600 * 1000); return { ok: true, bytes: bytes() }; } });
    const w = s;
    await s.ready();
    await s.feed(audio());
    expect(s.graph).toHaveBeenCalledTimes(1);
    expect(s.repo.audios.size).toBe(1);
    expect((await s.repo.getConversation(WA)).state).toBe("MENT_ROLE");
  });
});

describe("C6.6 tipo ou tamanho inválido", () => {
  it("C6.6 tipo não-áudio no webhook: não analisa, sem registro; guarda na quarentena (rejeitados); dica única", async () => {
    const s = setup();
    await s.ready();
    await s.feed(audio({ mimeType: "image/jpeg" }));
    await s.feed(audio({ mimeType: "image/jpeg" }));
    expect((s.analyzer as MockAudioAnalyzer).calls).toHaveLength(0);
    expect(s.sent()).toHaveLength(1);
    expect(s.repo.audios.size).toBe(0);
    expect([...s.store.objects.keys()].every((k) => k.startsWith("audios/rejeitados/"))).toBe(true);
    expect(s.store.objects.size).toBeGreaterThan(0);
  });

  it("C6.6 tamanho informado acima de MAX_AUDIO_BYTES: não baixa nem analisa; dica única", async () => {
    const s = setup({ maxAudioBytes: 50 });
    await s.ready();
    await s.feed(audio());
    await s.feed(audio());
    expect(s.download).not.toHaveBeenCalled();
    expect((s.analyzer as MockAudioAnalyzer).calls).toHaveLength(0);
    expect(s.sent()).toHaveLength(1);
  });

  it("C6.6 arquivo baixado maior que o limite (tamanho informado mentiu): não guarda nem analisa", async () => {
    const s = setup({ maxAudioBytes: 50, info: async () => ({ url: "https://cdn.example/a", mimeType: "audio/ogg" }), download: async () => ({ ok: true, bytes: bytes(80) }) });
    await s.ready();
    await s.feed(audio());
    expect(s.store.objects.size).toBe(0);
    expect((s.analyzer as MockAudioAnalyzer).calls).toHaveLength(0);
    expect(s.sent()).toHaveLength(1);
  });

  it("C6.6 mime ausente em todo lugar: inválido", async () => {
    const s = setup({ info: async () => ({ url: "https://cdn.example/a" }) });
    await s.ready();
    await s.feed(audio({ mimeType: undefined as unknown as string }));
    expect((s.analyzer as MockAudioAnalyzer).calls).toHaveLength(0);
  });
});

describe("C6.7 durante PROCESSING_AUDIO", () => {
  it("C6.7 áudio e texto em PROCESSING_AUDIO: nada processado; só a saudação recebe um aviso de que o áudio está em análise", async () => {
    const s = setup({ state: "PROCESSING_AUDIO" });
    await s.ready();
    await s.feed(audio());
    await s.feed(text("oi"));
    await s.feed(text("menu"));
    expect(s.graph).toHaveBeenCalledTimes(1); // só o "oi" ganha feedback (não fica sem saber se o bot caiu)
    expect(s.sent().at(-1).text.body).toMatch(/cuidando do seu áudio/);
    expect(s.getInfo).not.toHaveBeenCalled();
    expect(s.repo.audios.size).toBe(0);
  });

  it("C6.7 'sair' durante o processamento é honrado e a pergunta não é enviada", async () => {
    const s = setup({ download: async () => { await w.feed(text("sair")); return { ok: true, bytes: bytes() }; } });
    const w = s;
    await s.ready();
    await s.feed(audio());
    expect((await s.repo.getConversation(WA)).state).toBe("OPTED_OUT");
    expect(s.sent()).toHaveLength(1); // só a confirmação do opt-out
  });
});

describe("C6.8 áudio fora de AWAIT_AUDIO e consentimento", () => {
  for (const state of ["NEW", "AWAIT_REGISTRATION", "REG_CONSENT", "MENU", "OPTED_OUT"]) {
    it(`C6.8 áudio em ${state}: nada baixado/salvo e nenhuma mensagem de áudio`, async () => {
      const s = setup({ state, consent: state === "MENU" || state === "OPTED_OUT" });
      await s.ready();
      await s.feed(audio());
      expect(s.getInfo).not.toHaveBeenCalled();
      expect(s.download).not.toHaveBeenCalled();
      expect(s.store.objects.size).toBe(0);
      expect(s.repo.audios.size).toBe(0);
      expect(s.graph).not.toHaveBeenCalled(); // áudio nunca gera dica (só texto gera)
    });
  }

  it("C6.8 pipeline direto sem consentimento: não baixa, não guarda, não registra, não responde", async () => {
    const s = setup({ consent: false });
    await s.ready();
    s.repo.conversations.set(WA, { state: "PROCESSING_AUDIO", previousState: null, hintSentInState: false, optedOutAt: null, version: 5 });
    const out = await processAudio(audio(), false, s.audioDeps);
    expect(out).toBe("no_consent");
    expect(s.getInfo).not.toHaveBeenCalled();
    expect(s.store.objects.size).toBe(0);
    expect(s.graph).not.toHaveBeenCalled();
  });

  it("C6.8 o repositório recusa áudio sem consentimento (R6 também na camada de dados)", async () => {
    const repo = new MemoryRepo();
    await expect(
      repo.insertAudio({ id: "i", waIdHash: "h", r2Key: "k", mime: "audio/ogg", bytes: 1, serviceId: null, status: "processing", result: null, createdAt: T0, finishedAt: null }),
    ).rejects.toThrow();
  });

  it("C6.8 PGlite: gatilho recusa áudio sem consentimento e aceita com consentimento", async () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const db = new PGlite();
    for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
    const ins = (h: string) =>
      db.query("insert into audios (id, wa_id_hash, r2_key, mime, bytes) values (gen_random_uuid(), $1, 'k', 'audio/ogg', 10)", [h]);
    await db.query("insert into users (wa_id, last_user_message_at, wa_id_hash) values ('1', now(), 'h1')");
    await expect(ins("h1")).rejects.toThrow();
    await db.query("update users set consent_at = now(), terms_version = 'v1' where wa_id = '1'");
    await ins("h1");
    const r = await db.query<{ n: number }>("select count(*)::int as n from audios");
    expect(r.rows[0]!.n).toBe(1);
    await expect(ins("desconhecido")).rejects.toThrow();
  });
});

describe("arquivos de áudio gravados antes (qualquer formato comum)", () => {
  it("canonicalAudioMime/resolveAudioMime: aliases, extensão e tipos genéricos", async () => {
    const { canonicalAudioMime, resolveAudioMime, audioMimeFromFilename, audioKey } = await import("../src/audio/storage");
    expect(canonicalAudioMime("audio/x-m4a")).toBe("audio/mp4");
    expect(canonicalAudioMime("audio/mp3")).toBe("audio/mpeg");
    expect(canonicalAudioMime("audio/x-wav")).toBe("audio/wav");
    expect(canonicalAudioMime("audio/wav; codecs=1")).toBe("audio/wav");
    expect(canonicalAudioMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(canonicalAudioMime("application/ogg")).toBe("audio/ogg");
    expect(canonicalAudioMime("audio/flac")).toBe("audio/flac");
    expect(canonicalAudioMime("application/pdf")).toBeNull();
    expect(canonicalAudioMime("video/mp4")).toBe("audio/mp4"); // .mp4 vale como o áudio dele
    expect(audioMimeFromFilename("Reunião 10-11.M4A")).toBe("audio/mp4");
    expect(audioMimeFromFilename("mentoria.m4p")).toBe("audio/mp4");
    expect(resolveAudioMime("application/octet-stream", "mentoria.m4p")).toBe("audio/mp4");
    expect(audioMimeFromFilename("mentoria.exe")).toBeNull();
    // tipo ausente ou genérico: vale a extensão; tipo claramente não-áudio continua recusado
    expect(resolveAudioMime("", "gravacao.wav")).toBe("audio/wav");
    expect(resolveAudioMime("application/octet-stream", "gravacao.mp3")).toBe("audio/mpeg");
    expect(resolveAudioMime("application/pdf", "gravacao.mp3")).toBeNull();
    expect(resolveAudioMime(undefined, "semextensao")).toBeNull();
    expect(audioKey("h", new Date("2026-11-10T15:00:00Z"), "America/Sao_Paulo", "id1", "audio/x-m4a")).toBe("audios/mentorias/h/2026-11/id1.m4a");
    expect(audioKey("h", new Date("2026-11-10T15:00:00Z"), "America/Sao_Paulo", "id1", "audio/ogg", "informacoes")).toBe("audios/informacoes/h/2026-11/id1.ogg");
  });

  it("webhook: arquivo de áudio anexado como 'Documento' vira áudio; PDF continua documento", async () => {
    const { parseWebhookPayload: parseWebhook } = await import("../src/whatsapp/parser");
    const msg = (id: string, documentMessage: Record<string, string>) => parseWebhook(upsert({ documentMessage }, { id }));
    const a = msg("M1", { mimetype: "audio/x-m4a", fileName: "mentoria.m4a" });
    expect(a[0]).toMatchObject({ type: "audio", mediaId: "M1", mimeType: "audio/mp4", voice: false });
    const b = msg("M2", { mimetype: "application/octet-stream", fileName: "mentoria.wav" });
    expect(b[0]).toMatchObject({ type: "audio", mimeType: "audio/wav" });
    const c = msg("M3", { mimetype: "application/pdf", fileName: "duvidas.pdf" });
    expect(c[0]).toMatchObject({ type: "document" });
  });

  it.each([
    ["audio/wav", "wav"], ["audio/x-m4a", "m4a"], ["audio/mp3", "mp3"], ["audio/webm", "webm"], ["audio/flac", "flac"], ["audio/aac", "aac"],
  ])("mentoria aceita e guarda %s (sem análise obrigatória)", async (mime, ext) => {
    const s = setup({ info: async () => ({ url: "https://cdn.example/a", mimeType: mime, fileSize: 100 }) });
    await s.ready();
    await s.feed(audio({ mimeType: mime }));
    expect(s.store.objects.size).toBe(1);
    const [key, obj] = [...s.store.objects.entries()][0]!;
    expect(key.endsWith(`.${ext}`)).toBe(true);
    expect(obj.mime).toMatch(/^audio\//);
    expect(s.repo.audios.size).toBe(1);
  });

  it("outros tipos (imagem, PDF) continuam recusados", async () => {
    const s = setup({ info: async () => ({ url: "https://cdn.example/a", mimeType: "image/jpeg", fileSize: 100 }) });
    await s.ready();
    await s.feed(audio({ mimeType: "audio/ogg" }));
    expect(s.repo.audios.size).toBe(0); // sem registro nem avanço da conversa
    expect([...s.store.objects.keys()].every((k) => k.startsWith("audios/rejeitados/"))).toBe(true); // só a quarentena
  });

  it("mp4 (video/mp4) enviado como vídeo ou como documento é aceito igual ao ogg", async () => {
    const { parseWebhookPayload: parseWebhook } = await import("../src/whatsapp/parser");
    const v = parseWebhook(upsert({ videoMessage: { mimetype: "video/mp4" } }, { id: "V1" }));
    expect(v[0]).toMatchObject({ type: "audio", mediaId: "V1", mimeType: "audio/mp4", voice: false });
    const d = parseWebhook(upsert({ documentMessage: { mimetype: "video/mp4", fileName: "reuniao.mp4" } }, { id: "V2" }));
    expect(d[0]).toMatchObject({ type: "audio", mimeType: "audio/mp4" });
    const s = setup({ info: async () => ({ url: "https://cdn.example/a", mimeType: "video/mp4", fileSize: 100 }) });
    await s.ready();
    await s.feed(audio({ mimeType: "audio/mp4" }));
    expect(s.repo.audios.size).toBe(1);
    const [key, obj] = [...s.store.objects.entries()][0]!;
    expect(key.startsWith("audios/mentorias/") && key.endsWith(".m4a")).toBe(true);
    expect(obj.mime).toBe("audio/mp4");
  });
});

describe("arquivo grande: a Evolution grava no S3/R2 e o Worker copia em stream", () => {
  const streamOf = (n: number) => () => Promise.resolve({
    ok: true as const, size: n,
    body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(n).fill(7)); c.close(); } }),
  });

  it("64 MB (acima de MAX_AUDIO_BYTES) é guardado em mentorias/ sem usar o download em memória, e a pessoa recebe o aviso de mentoria registrada", async () => {
    const BIG = 64 * 1024 * 1024;
    const open = vi.fn(async () => ({ ok: true as const, size: BIG, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(BIG)); c.close(); } }) }));
    const s = setup({ openStream: open });
    s.audioDeps.maxAudioStreamBytes = 300_000_000;
    await s.ready();
    await s.feed(audio({ mimeType: "audio/mp4", mediaUrl: "https://midia.example/mentoria.m4p", fileSize: BIG }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(s.download).not.toHaveBeenCalled();
    const [key, obj] = [...s.store.objects.entries()][0]!;
    expect(key.startsWith("audios/mentorias/") && key.endsWith(".m4a")).toBe(true);
    expect(obj.bytes.length).toBe(BIG);
    expect(s.repo.audios.size).toBe(1);
    expect((await s.repo.getConversation(WA)).state).toBe("MENT_ROLE");
    expect(s.sent()).toHaveLength(1);
    expect(JSON.stringify(s.sent()[0])).toMatch(/mentoria já está registrada/);
  });

  it("reprocesso: a resposta de sucesso é UMA mensagem que começa com 'conseguimos processar a sua mentoria'", async () => {
    const s = setup({ openStream: streamOf(10) });
    s.audioDeps.successIntro = "Poxa, conseguimos processar a sua mentoria!";
    await s.ready();
    await s.feed(audio({ mimeType: "audio/mp4", mediaUrl: "https://midia.example/a", fileSize: 10 }));
    expect(s.sent()).toHaveLength(1);
    expect(JSON.stringify(s.sent()[0])).toMatch(/Poxa, conseguimos processar a sua mentoria!/);
    expect(JSON.stringify(s.sent()[0])).toMatch(/mentoria já está registrada/);
  });

  it("acima de MAX_AUDIO_STREAM_BYTES: não copia; resposta de arquivo inválido", async () => {
    const open = vi.fn(streamOf(10));
    const s = setup({ openStream: open });
    s.audioDeps.maxAudioStreamBytes = 5;
    await s.ready();
    await s.feed(audio({ mimeType: "audio/mp4", mediaUrl: "https://midia.example/a", fileSize: 10 }));
    expect(s.store.objects.size).toBe(0);
    expect(s.repo.audios.size).toBe(0);
    expect(s.sent()).toHaveLength(1);
  });

  it("host não liberado (openStream recusa): cai no download normal", async () => {
    const s = setup({ openStream: async () => ({ ok: false }) });
    await s.ready();
    await s.feed(audio({ mimeType: "audio/ogg", mediaUrl: "https://outro.example/a" }));
    expect(s.download).toHaveBeenCalledTimes(1);
    expect(s.repo.audios.size).toBe(1);
  });

  it("tipo recusado em arquivo grande vai para a quarentena (rejeitados)", async () => {
    const s = setup({ openStream: streamOf(20) });
    await s.ready();
    await s.feed(audio({ mimeType: "image/jpeg", mediaUrl: "https://midia.example/a" }));
    expect(s.repo.audios.size).toBe(0);
    expect([...s.store.objects.keys()].every((k) => k.startsWith("audios/rejeitados/"))).toBe(true);
  });

  it("cliente de mídia: só https e só hosts da lista; sem redirecionamento", async () => {
    const { createMediaClient } = await import("../src/whatsapp/evolutionClient");
    const f = vi.fn(async () => new Response("abc", { status: 200, headers: { "content-length": "3" } }));
    const c = createMediaClient({ url: "https://evo.test", apiKey: "k", instance: "i", fetchImpl: f as never, mediaHosts: ["midia.example"] });
    expect((await c.openStream!("https://midia.example/x")).ok).toBe(true);
    expect((await c.openStream!("http://midia.example/x")).ok).toBe(false);
    expect((await c.openStream!("https://evil.example/x")).ok).toBe(false);
    expect((await c.openStream!("https://u:p@midia.example/x")).ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("parser: mediaUrl (https) e fileLength do webhook; .m4p como documento vira áudio", async () => {
    const { parseWebhookPayload } = await import("../src/whatsapp/parser");
    const payload = (message: unknown) => ({ event: "messages.upsert", data: { key: { remoteJid: "5511999990000@s.whatsapp.net", fromMe: false, id: "BIG1" }, messageTimestamp: 1, message } });
    const e = parseWebhookPayload(payload({ documentMessage: { mimetype: "application/octet-stream", fileName: "mentoria.m4p", fileLength: "67108864", mediaUrl: "https://midia.example/BIG1" } }));
    expect(e[0]).toMatchObject({ type: "audio", mimeType: "audio/mp4", mediaUrl: "https://midia.example/BIG1", fileSize: 67108864 });
    const h = parseWebhookPayload(payload({ documentMessage: { mimetype: "application/octet-stream", fileName: "mentoria.m4p", mediaUrl: "http://inseguro/x" } }));
    expect((h[0] as { mediaUrl?: string }).mediaUrl).toBeUndefined();
  });
});
