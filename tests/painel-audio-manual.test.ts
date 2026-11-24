import { describe, expect, it } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { handlePanel, MANUAL_AUDIO_MAX_BYTES, type PanelDeps } from "../src/mentoria/panel";
import type { ReprocessRequest, ReprocessResult } from "../src/admin/budget";
import { stagedMediaClient, STAGING_FOLDER } from "../src/admin/reprocess";
import { dashboardPage } from "../src/mentoria/panel-page";

const URL_ = "https://w.dev/painel/api/audio-manual";

function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = {
    async put(key: string, body: ReadableStream | Uint8Array, o?: { httpMetadata?: { contentType?: string } }) {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, ...(o?.httpMetadata?.contentType ? { contentType: o.httpMetadata.contentType } : {}) });
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: new Response(o.bytes).body, size: o.bytes.length } : null;
    },
    async delete(key: string) { objects.delete(key); },
  };
  return { objects, bucket: bucket as unknown as R2Bucket };
}

function setup(outcome: ReprocessResult = "done", withManual = true) {
  const { objects, bucket } = fakeBucket();
  const calls: (ReprocessRequest & { stagedHadObject: boolean })[] = [];
  const deps: PanelDeps = {
    env: { PANEL_OPEN: "true" }, repo: new MemoryRepo(), bucket,
    ...(withManual
      ? { manualAudio: async (r) => { calls.push({ ...r, stagedHadObject: objects.has(r.mediaUrl.slice("staged:".length)) }); return outcome; } }
      : {}),
  };
  // Num navegador o Content-Length vem sozinho; no teste (Request em memória) é declarado à mão.
  const send = (query: string, init: { headers?: Record<string, string>; body?: Uint8Array; xhr?: boolean } = {}) => {
    const body = init.body ?? new Uint8Array([1, 2, 3, 4]);
    return handlePanel(new Request(`${URL_}${query}`, {
      method: "POST",
      headers: { ...(init.xhr === false ? {} : { "X-Requested-With": "painel" }), "Content-Type": "audio/mpeg", "Content-Length": String(body.length), ...init.headers },
      body,
    }), deps);
  };
  return { objects, calls, send, deps };
}

describe("painel: enviar o áudio de uma mentoria", () => {
  it("guarda em staging, trata como áudio recebido e apaga o staging", async () => {
    const t = setup("done");
    const r = await t.send("?phone=+55%20(11)%2099999-0000&name=aula.mp3");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ outcome: "done" });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ phone: "5511999990000", mimeType: "audio/mpeg", fileSize: 4, stagedHadObject: true });
    expect(t.calls[0]!.mediaUrl.startsWith(`staged:${STAGING_FOLDER}`)).toBe(true);
    expect(t.calls[0]!.messageId).toMatch(/^manual-[\w-]+$/);
    expect(t.objects.size).toBe(0);
  });

  it("tipo genérico (octet-stream) usa a extensão do nome; tipo que não é áudio é recusado", async () => {
    const t = setup();
    const ok = await t.send("?phone=5511999990000&name=reuniao.m4a", { headers: { "Content-Type": "application/octet-stream" } });
    expect(ok.status).toBe(200);
    expect(t.calls[0]!.mimeType).toMatch(/^audio\//);
    const bad = await t.send("?phone=5511999990000&name=doc.pdf", { headers: { "Content-Type": "application/pdf" } });
    expect(bad.status).toBe(415);
    expect(t.calls).toHaveLength(1);
  });

  it("exige o cabeçalho anti-CSRF, telefone válido, corpo não vazio e respeita o teto", async () => {
    const t = setup();
    expect((await t.send("?phone=5511999990000", { xhr: false })).status).toBe(400);
    expect((await t.send("?phone=123")).status).toBe(400);
    expect((await t.send("?phone=5511999990000", { body: new Uint8Array(0) })).status).toBe(400);
    expect((await t.send("?phone=5511999990000", { headers: { "Content-Length": String(MANUAL_AUDIO_MAX_BYTES + 1) } })).status).toBe(413);
    expect(t.calls).toHaveLength(0);
    expect(t.objects.size).toBe(0);
  });

  it("sem a ação configurada responde 503; sem login responde 401", async () => {
    expect((await setup("done", false).send("?phone=5511999990000")).status).toBe(503);
    const t = setup();
    const closed = { ...t.deps, env: { PANEL_USER: "a", PANEL_PASSWORD_HASH: "x", PANEL_SESSION_SECRET: "s".repeat(40) } };
    const r = await handlePanel(new Request(`${URL_}?phone=5511999990000`, { method: "POST", headers: { "X-Requested-With": "painel", "Content-Type": "audio/mpeg" }, body: new Uint8Array([1]) }), closed);
    expect(r.status).toBe(401);
  });

  it.each([
    ["unknown_contact", 404], ["no_consent", 409], ["invalid", 422], ["failed", 502],
  ] as const)("resultado %s vira HTTP %i e o staging é apagado", async (outcome, status) => {
    const t = setup(outcome);
    const r = await t.send("?phone=5511999990000");
    expect(r.status).toBe(status);
    expect(((await r.json()) as { outcome: string }).outcome).toBe(outcome);
    expect(t.objects.size).toBe(0);
  });

  it("se a ação lançar erro, responde 502 e apaga o staging", async () => {
    const t = setup();
    t.deps.manualAudio = async () => { throw new Error("boom"); };
    const r = await t.send("?phone=5511999990000");
    expect(r.status).toBe(502);
    expect(t.objects.size).toBe(0);
  });

  it("a página traz o formulário com confirmação antes de enviar", () => {
    const html = dashboardPage("n0nce", true);
    expect(html).toContain('id="up-file"');
    expect(html).toContain("Confirmar envio");
    expect(html).toContain("/painel/api/audio-manual");
  });
});

describe("cliente de mídia de staging", () => {
  it("abre só objetos da pasta de staging e repassa o resto ao cliente base", async () => {
    const { objects, bucket } = fakeBucket();
    objects.set(`${STAGING_FOLDER}x`, { bytes: new Uint8Array([9, 9, 9]) });
    objects.set("audios/mentorias/outra-pessoa.mp3", { bytes: new Uint8Array([1]) });
    const base = { getInfo: async () => ({ url: "", mimeType: "audio/mpeg" }), download: async () => ({ ok: false as const, reason: "error" as const }) };
    const c = stagedMediaClient(bucket, base);
    const ok = await c.openStream!(`staged:${STAGING_FOLDER}x`);
    expect(ok).toMatchObject({ ok: true, size: 3 });
    expect(await c.openStream!("staged:audios/mentorias/outra-pessoa.mp3")).toEqual({ ok: false });
    expect(await c.openStream!(`staged:${STAGING_FOLDER}nao-existe`)).toEqual({ ok: false });
    expect(await c.openStream!("https://x.dev/a.mp3")).toEqual({ ok: false });
  });
});
