import { describe, it, expect } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { handleApi } from "../src/mentoria/api";
import { hashPassword, signSession, verifyPassword, verifySession, LOGIN_LIMITS } from "../src/mentoria/auth";
import { handlePanel } from "../src/mentoria/panel";

const SECRET = "s".repeat(40);
const KEY = "k".repeat(40);
const NOW = new Date("2026-11-10T12:00:00Z");

async function setup() {
  const repo = new MemoryRepo();
  const passHash = await hashPassword("senha-forte-123");
  const env = { PANEL_USER: "admin", PANEL_PASSWORD_HASH: passHash, PANEL_SESSION_SECRET: SECRET };
  repo.registrations.set("5511900000001", { consentAt: NOW, termsVersion: "1", registeredAt: NOW, values: { full_name: "Maria" }, waIdHash: "h1" } as never);
  repo.audios.set("11111111-1111-1111-1111-111111111111", {
    id: "11111111-1111-1111-1111-111111111111", waIdHash: "h1", r2Key: "audios/h1/a.ogg", mime: "audio/ogg", bytes: 10, serviceId: "mentoria",
    mentoria: { role: "mentor", subject: "Carreira", partner: "Ana" }, status: "done", result: null, createdAt: NOW, finishedAt: NOW,
  });
  const bucket = { get: async () => ({ body: "AUDIO" }) } as unknown as R2Bucket;
  return { repo, env, bucket, deps: { env, repo, bucket, now: () => NOW } };
}
const login = (deps: Awaited<ReturnType<typeof setup>>["deps"], user: string, password: string, headers: Record<string, string> = { "X-Requested-With": "painel" }) =>
  handlePanel(new Request("https://w.dev/painel/api/login", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ user, password }) }), deps);

describe("senha e sessão", () => {
  it("verifica a senha certa e recusa a errada ou hash corrompido", async () => {
    const h = await hashPassword("abc-123-xyz-987");
    expect(h.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("abc-123-xyz-987", h)).toBe(true);
    expect(await verifyPassword("outra", h)).toBe(false);
    expect(await verifyPassword("abc-123-xyz-987", "lixo")).toBe(false);
  });
  it("sessão válida, adulterada, expirada e de outro usuário", async () => {
    const t = await signSession(SECRET, "admin", NOW, 1000);
    expect(await verifySession(SECRET, t, "admin", NOW)).toBe(true);
    expect(await verifySession(SECRET, t + "x", "admin", NOW)).toBe(false);
    expect(await verifySession("outro".repeat(10), t, "admin", NOW)).toBe(false);
    expect(await verifySession(SECRET, t, "admin", new Date(NOW.getTime() + 2000))).toBe(false);
    expect(await verifySession(SECRET, t, "outro", NOW)).toBe(false);
    expect(await verifySession(SECRET, null, "admin", NOW)).toBe(false);
  });
});

describe("painel", () => {
  it("sem configuração: 503", async () => {
    const { repo } = await setup();
    expect((await handlePanel(new Request("https://w.dev/painel"), { env: {}, repo, bucket: undefined })).status).toBe(503);
  });
  it("página de login sem sessão; dados e áudio exigem sessão", async () => {
    const { deps } = await setup();
    const page = await handlePanel(new Request("https://w.dev/painel"), deps);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Entrar");
    expect(page.headers.get("Content-Security-Policy")).toContain("nonce-");
    expect((await handlePanel(new Request("https://w.dev/painel/api/mentorias"), deps)).status).toBe(401);
    expect((await handlePanel(new Request("https://w.dev/painel/audio/11111111-1111-1111-1111-111111111111"), deps)).status).toBe(401);
  });
  it("login correto devolve cookie; com ele lista as mentorias e toca o áudio", async () => {
    const { deps } = await setup();
    const res = await login(deps, "admin", "senha-forte-123");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/Secure/); expect(cookie).toMatch(/SameSite=Strict/);
    const c = cookie.split(";")[0]!;
    const list = await handlePanel(new Request("https://w.dev/painel/api/mentorias", { headers: { Cookie: c } }), deps);
    const body = (await list.json()) as { items: { subject: string; analysis: { status: string } }[] };
    expect(body.items[0]).toMatchObject({ subject: "Carreira", analysis: { status: "pending" } });
    expect(JSON.stringify(body)).not.toContain("h1"); // sem hash de telefone
    const audio = await handlePanel(new Request("https://w.dev/painel/audio/11111111-1111-1111-1111-111111111111", { headers: { Cookie: c } }), deps);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("Content-Type")).toBe("audio/ogg");
  });
  it("usuário ou senha errados: 401 genérico; sem o cabeçalho anti-CSRF: 400", async () => {
    const { deps } = await setup();
    expect((await login(deps, "admin", "errada")).status).toBe(401);
    expect((await login(deps, "outro", "senha-forte-123")).status).toBe(401);
    expect((await login(deps, "admin", "senha-forte-123", {})).status).toBe(400);
  });
  it("bloqueia a origem após erros repetidos, mesmo com a senha certa", async () => {
    const { deps } = await setup();
    for (let i = 0; i < LOGIN_LIMITS.perIp; i++) expect((await login(deps, "admin", "errada")).status).toBe(401);
    const blocked = await login(deps, "admin", "senha-forte-123");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
  it("falha fechada: sem controle de tentativas ninguém entra", async () => {
    const { deps, repo } = await setup();
    repo.getLoginLock = async () => { throw new Error("db fora"); };
    expect((await login(deps, "admin", "senha-forte-123")).status).toBe(503);
  });
});

describe("API de integração", () => {
  const ID = "11111111-1111-1111-1111-111111111111";
  const call = async (path: string, init: RequestInit = {}, key = KEY) => {
    const s = await setup();
    return { s, res: await handleApi(new Request(`https://w.dev${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) } }), { apiKey: KEY, repo: s.repo, bucket: s.bucket, now: () => NOW }) };
  };
  it("exige a chave", async () => {
    expect((await call("/api/v1/mentorias", {}, "errada")).res.status).toBe(401);
    const s = await setup();
    expect((await handleApi(new Request("https://w.dev/api/v1/mentorias"), { apiKey: KEY, repo: s.repo, bucket: s.bucket })).status).toBe(401);
    expect((await handleApi(new Request("https://w.dev/api/v1/mentorias"), { apiKey: "", repo: s.repo, bucket: s.bucket })).status).toBe(503);
  });
  it("lista pendentes sem expor telefone nem hash; baixa o áudio; grava o resultado; some dos pendentes", async () => {
    const s = await setup();
    const h = { Authorization: `Bearer ${KEY}` };
    const d = { apiKey: KEY, repo: s.repo, bucket: s.bucket, now: () => NOW };
    const list = await handleApi(new Request("https://w.dev/api/v1/mentorias?status=pending", { headers: h }), d);
    const j = (await list.json()) as { items: Record<string, unknown>[] };
    expect(j.items).toHaveLength(1);
    expect(j.items[0]).toMatchObject({ id: ID, subject: "Carreira", partner: "Ana", role: "mentor", analysis_pending: true, audio_url: `/api/v1/mentorias/${ID}/audio` });
    expect(JSON.stringify(j)).not.toMatch(/5511/); // nunca o telefone
    expect(j.items[0]).toMatchObject({ registrante: { pessoa_id: "h1", papel: "mentor" }, parceiro: { pessoa_id: null, confirmado_em: null } }); // só o pessoa_id (HMAC)
    const audio = await handleApi(new Request(`https://w.dev/api/v1/mentorias/${ID}/audio`, { headers: h }), d);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("Content-Type")).toBe("audio/ogg");
    const post = await handleApi(new Request(`https://w.dev/api/v1/mentorias/${ID}/result`, { method: "POST", headers: h, body: JSON.stringify({ result: { tema: "carreira", sentimento: "positivo" } }) }), d);
    expect(post.status).toBe(200);
    const after = await handleApi(new Request("https://w.dev/api/v1/mentorias?status=pending", { headers: h }), d);
    expect(((await after.json()) as { items: unknown[] }).items).toHaveLength(0);
    const one = (await (await handleApi(new Request(`https://w.dev/api/v1/mentorias/${ID}`, { headers: h }), d)).json()) as Record<string, unknown>;
    expect(one).toMatchObject({ analysis_pending: false, analysis_result: { tema: "carreira" } });
  });
  it("valida entrada: resultado vazio, JSON inválido, id inexistente, status inválido", async () => {
    const s = await setup();
    const h = { Authorization: `Bearer ${KEY}` };
    const d = { apiKey: KEY, repo: s.repo, bucket: s.bucket };
    const post = (path: string, body: string) => handleApi(new Request(`https://w.dev${path}`, { method: "POST", headers: h, body }), d);
    expect((await post(`/api/v1/mentorias/${ID}/result`, "{}")).status).toBe(400);
    expect((await post(`/api/v1/mentorias/${ID}/result`, "nao-json")).status).toBe(400);
    expect((await post("/api/v1/mentorias/22222222-2222-2222-2222-222222222222/result", '{"result":{"a":1}}')).status).toBe(404);
    expect((await handleApi(new Request("https://w.dev/api/v1/mentorias?status=xyz", { headers: h }), d)).status).toBe(400);
  });
});
