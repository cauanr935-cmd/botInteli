import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { handleIncomingMessage } from "../../../src/conversation/engine";
import { processAudio } from "../../../src/audio/pipeline";
import { HttpAudioAnalyzer, MockAudioAnalyzer, type AudioAnalyzer } from "../../../src/audio/analyzer";
import { MemoryAudioStore } from "../../../src/audio/storage";
import { sendGuarded, type MediaClient } from "../../../src/whatsapp/client";
import { hashWaId } from "../../../src/lib/hash";
import type { Logger } from "../../../src/lib/logger";
import type { AudioEvent } from "../../../src/whatsapp/types";

const T0 = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
let n = 0;
const audio = (): AudioEvent => ({ type: "audio", wamid: `x${++n}`, from: WA, mediaId: "M", voice: true, mimeType: "audio/ogg" });

async function setup(analyzer: AudioAnalyzer, store = new MemoryAudioStore()) {
  const logs: string[] = [];
  const logger: Logger = { log: (_l, e) => void logs.push(e) };
  const repo = new MemoryRepo();
  const graph = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `o${++n}` }] }), { status: 200 }));
  const now = () => T0;
  const send = (m: Parameters<typeof sendGuarded>[0]) =>
    sendGuarded(m, { repo, logger, phoneNumberId: "PN", whatsappToken: "t", graphApiVersion: "v21.0", stopAt: 950, timezone: "America/Sao_Paulo", fetchImpl: graph as unknown as typeof fetch, now });
  const media: MediaClient = {
    getInfo: async () => ({ url: "https://c/a", mimeType: "audio/ogg", fileSize: 10 }),
    download: async () => ({ ok: true, bytes: new Uint8Array(10).fill(1) }),
  };
  const ad = { repo, logger, send, media, store, analyzer, maxAudioBytes: 1000, maxPerDay: 50, maxPer10Min: 50, timezone: "America/Sao_Paulo", now };
  await repo.touchUser(WA, T0);
  repo.registrations.set(WA, { consentAt: T0, termsVersion: "v1", registeredAt: T0, values: {}, waIdHash: await hashWaId(WA) });
  repo.conversations.set(WA, { state: "AWAIT_AUDIO", previousState: null, hintSentInState: false, optedOutAt: null, version: 1 });
  const deps = { repo, logger, send, maxPerDay: 50, maxPer10Min: 50, now, audio: { process: (m: AudioEvent, h: boolean) => processAudio(m, h, ad) } };
  return { repo, graph, store, deps, logs };
}

describe("adversarial etapa 6", () => {
  it("5 falhas seguidas do analisador: no máximo 1 mensagem de erro e volta a AWAIT_AUDIO", async () => {
    const s = await setup(new MockAudioAnalyzer(() => { throw new Error("boom"); }));
    for (let i = 0; i < 5; i++) await handleIncomingMessage(audio(), s.deps);
    expect(s.logs).not.toContain("audio_pipeline_error");
    expect(s.graph).toHaveBeenCalledTimes(1);
    expect((await s.repo.getConversation(WA)).state).toBe("AWAIT_AUDIO");
  });
  it("R2 do R2 falhando (store.put lança): não trava em PROCESSING_AUDIO, não envia lixo", async () => {
    const store = new MemoryAudioStore();
    store.put = async () => { throw new Error("r2 down"); };
    const s = await setup(new MockAudioAnalyzer(), store);
    await handleIncomingMessage(audio(), s.deps);
    expect((await s.repo.getConversation(WA)).state).toBe("AWAIT_AUDIO");
    expect(s.graph.mock.calls.length).toBe(1);
  });
  it("chave no R2 e logs não contêm o telefone", async () => {
    const s = await setup(new MockAudioAnalyzer());
    await handleIncomingMessage(audio(), s.deps);
    for (const k of s.store.objects.keys()) expect(k).not.toContain(WA);
    expect(s.logs.join(" ")).not.toContain(WA);
  });
  it("duas entregas simultâneas de áudio: só um é processado", async () => {
    const an = new MockAudioAnalyzer(async () => { await new Promise((r) => setTimeout(r, 20)); return { text: "ok", raw: {} }; });
    const s = await setup(an);
    await Promise.all([handleIncomingMessage(audio(), s.deps), handleIncomingMessage(audio(), s.deps)]);
    expect(an.calls.length).toBe(1);
    expect(s.graph).toHaveBeenCalledTimes(1);
  });
  it("HTTP analyzer travado: 3 tentativas no máximo e termina", async () => {
    const f = vi.fn((_u: unknown, init: RequestInit) => new Promise<Response>((_r, rej) => { init.signal!.addEventListener("abort", () => rej(new Error("abort"))); }));
    const a = new HttpAudioAnalyzer({ url: "http://x", apiKey: "k", timeoutMs: 10, retries: 10, backoffMs: 1, fetchImpl: f as unknown as typeof fetch });
    await expect(a.analyze({ bytes: new Uint8Array(1), mime: "audio/ogg" })).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("disjuntor aberto/banco de reserva falhando: resultado salvo, 0 envios", async () => {
    const s = await setup(new MockAudioAnalyzer());
    s.repo.reserveSlot = async () => { throw new Error("db down"); };
    await handleIncomingMessage(audio(), s.deps).catch(() => undefined);
    expect(s.graph).not.toHaveBeenCalled();
  });
});
