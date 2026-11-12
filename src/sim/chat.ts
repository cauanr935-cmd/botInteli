// Canal de entrada ALTERNATIVO (simulador de chat web), usado para teste e demonstração sem WhatsApp.
// Não altera nenhuma regra do bot: monta os mesmos eventos que o webhook produziria e passa pelo mesmo
// createEventHandler (motor de conversa, cadastro, áudio -> R2 -> analisador, limites, orçamento).
// Diferenças, só nas bordas: (1) a entrada vem desta página, não do webhook da Evolution; (2) o transporte de envio é
// uma função local que captura a mensagem para exibir na tela, em vez de chamar a Evolution.
// Um único usuário de teste; o histórico fica no bucket R2 (chave chat-sim/history.json).
import { defaultSensitiveMatcher } from "../axo/sensitive";
import { loadConfig } from "../config";
import { createAgent } from "../ai/grok";
import { DeferredAudioAnalyzer, HttpAudioAnalyzer } from "../audio/analyzer";
import { R2AudioStore, resolveAudioMime } from "../audio/storage";
import { SupabaseRepo } from "../db/supabase-repo";
import { buildCertificate, type Certificate } from "./certificate";
import { hashWaId } from "../lib/hash";
import { createLogger, type Logger } from "../lib/logger";
import { ContentProvider } from "../services/provider";
import { createEventHandler } from "../webhook/events";
import { processEvents } from "../webhook/handler";
import type { MediaClient, OutboundMessage } from "../whatsapp/client";
import type { TransportResult } from "../whatsapp/evolutionClient";
import type { IncomingMessage } from "../whatsapp/types";

type Env = Record<string, unknown> & { AUDIOS?: R2Bucket };

/** Telefone fixo do usuário de teste (um só). */
export const CHAT_PHONE = "5500000000001";
const HISTORY_KEY = "chat-sim/history.json";
const MEDIA_PREFIX = "chat-sim/media/";
const MAX_HISTORY = 500;
const CERT_PREFIX = "chat-sim/certificados/";

export interface ChatUi {
  body: string;
  buttons?: { id: string; title: string }[];
  list?: { button: string; rows: { id: string; title: string; description?: string }[] };
}
export interface ChatItem {
  id: string;
  dir: "in" | "out";
  at: string;
  kind: "text" | "audio" | "reply";
  text?: string;
  ui?: ChatUi;
  mediaId?: string;
  mime?: string;
  /** Mensagem escrita pelo admin no lugar do bot. */
  by?: "admin";
}

// ---- modo admin (assumir o lugar do bot) ----
// Sistema de teste: login simples, sem preocupação forte com segurança. Os valores podem ser trocados por env.
const DEFAULT_ADMIN_USER = "Be My Mentor";
const DEFAULT_ADMIN_PASS = "Be My Mentor 321";
const PRESENCE_KEY = "chat-sim/admin-presence.json";
const PRESENCE_TTL_MS = 30_000; // admin "online" se a tela dele deu sinal de vida nos últimos 30 s
const PRESENCE_REFRESH_MS = 10_000; // limita a escrita no R2
/** Contexto para a IA: as últimas mensagens de texto (da pessoa, do bot e do admin), curtas. Sem nome nem telefone. */
export function recentLines(items: ChatItem[], max = 6): string[] {
  return items
    .map((i) => ({ who: i.dir === "in" ? "pessoa" : "atendimento", text: (i.ui?.body ?? i.text ?? "").replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text !== "")
    // Tema sensível nunca vai a provedor externo, nem como contexto de turnos seguintes.
    .filter((l) => l.who !== "pessoa" || defaultSensitiveMatcher.detect(l.text) === null)
    .slice(-max)
    .map((l) => `${l.who}: ${l.text.slice(0, 200)}`);
}

/** Existe = bot DESLIGADO (o admin respondeu no lugar dele). Ausente = bot ligado, que é o normal. */
const BOT_OFF_KEY = "chat-sim/bot-off.json";

/**
 * Devolve a conversa ao bot. Enquanto o admin escreveu no lugar dele, o estado do bot avançou sem a pessoa ver
 * as perguntas dele, e a dica única do estado pode já ter sido gasta: por isso o bot ficava em silêncio.
 * Aqui o bot recomeça do que sabe da pessoa: zera a dica; quem já concluiu o cadastro volta ao estado "concluído"
 * (a próxima mensagem é entendida pelo bot e pela IA, como na volta de quem já é cadastrado); quem ainda está
 * no cadastro continua no mesmo passo. Não envia nada (R1): só prepara o estado.
 */
export async function handBackToBot(
  supabaseUrl: string, serviceKey: string, fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const phone = encodeURIComponent(CHAT_PHONE);
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/users?wa_id=eq.${phone}&select=state,registered_at,version`, { headers: h });
  if (!res.ok) return { ok: false, error: `banco: ${res.status}` };
  const row = ((await res.json()) as { state: string; registered_at: string | null; version: number }[])[0];
  if (!row) return { ok: true }; // ainda não há conversa: nada a devolver
  const patch: Record<string, unknown> = { hint_sent_in_state: false, opted_out_at: null, version: row.version + 1 };
  if (row.registered_at) Object.assign(patch, { state: "COMPLETED", previous_state: null, last_service_id: null });
  const upd = await fetchImpl(`${supabaseUrl}/rest/v1/users?wa_id=eq.${phone}`, { method: "PATCH", headers: h, body: JSON.stringify(patch) });
  return upd.ok ? { ok: true } : { ok: false, error: `banco: ${upd.status}` };
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Token de sessão do admin: derivado do ADMIN_TOKEN e das credenciais, sem guardar estado no servidor. */
async function adminSessionToken(env: Env, adminToken: string): Promise<string> {
  const user = typeof env.CHAT_ADMIN_USER === "string" && env.CHAT_ADMIN_USER ? env.CHAT_ADMIN_USER : DEFAULT_ADMIN_USER;
  const pass = typeof env.CHAT_ADMIN_PASS === "string" && env.CHAT_ADMIN_PASS ? env.CHAT_ADMIN_PASS : DEFAULT_ADMIN_PASS;
  return sha256Hex(`${adminToken}\n${user}\n${pass}`);
}

async function credentialsOk(env: Env, user: string, pass: string): Promise<boolean> {
  const u = typeof env.CHAT_ADMIN_USER === "string" && env.CHAT_ADMIN_USER ? env.CHAT_ADMIN_USER : DEFAULT_ADMIN_USER;
  const p = typeof env.CHAT_ADMIN_PASS === "string" && env.CHAT_ADMIN_PASS ? env.CHAT_ADMIN_PASS : DEFAULT_ADMIN_PASS;
  const [a, b] = await Promise.all([sha256Hex(`${user}\n${pass}`), sha256Hex(`${u}\n${p}`)]);
  return safeEqual(a, b);
}

async function isAdminOnline(bucket: R2Bucket): Promise<boolean> {
  const obj = await bucket.get(PRESENCE_KEY);
  if (!obj) return false;
  try {
    const at = (JSON.parse(await obj.text()) as { at?: number }).at;
    return typeof at === "number" && Date.now() - at < PRESENCE_TTL_MS;
  } catch {
    return false;
  }
}

async function touchPresence(bucket: R2Bucket): Promise<void> {
  const obj = await bucket.get(PRESENCE_KEY);
  if (obj) {
    try {
      const at = (JSON.parse(await obj.text()) as { at?: number }).at;
      if (typeof at === "number" && Date.now() - at < PRESENCE_REFRESH_MS) return;
    } catch { /* regrava */ }
  }
  await bucket.put(PRESENCE_KEY, JSON.stringify({ at: Date.now() }), { httpMetadata: { contentType: "application/json" } });
}

const contentProviders = new Map<string, ContentProvider>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Transforma a mensagem (formato interno, com botões/lista) no que a tela precisa desenhar. */
export function toUi(body: Record<string, unknown>): ChatUi {
  if (body.type === "text") {
    return { body: String((body.text as { body?: unknown } | undefined)?.body ?? "") };
  }
  const i = body.interactive as
    | { type?: string; body?: { text?: string }; action?: Record<string, unknown> }
    | undefined;
  const text = String(i?.body?.text ?? "");
  if (i?.type === "button") {
    const buttons = ((i.action?.buttons as { reply: { id: string; title: string } }[] | undefined) ?? []).map((b) => b.reply);
    return { body: text, buttons };
  }
  if (i?.type === "list") {
    const sections = (i.action?.sections as { rows: { id: string; title: string; description?: string }[] }[] | undefined) ?? [];
    return { body: text, list: { button: String(i.action?.button ?? "Opções"), rows: sections.flatMap((s) => s.rows) } };
  }
  return { body: text || "[mensagem não suportada pela página de teste]" };
}

async function readHistory(bucket: R2Bucket): Promise<ChatItem[]> {
  const obj = await bucket.get(HISTORY_KEY);
  if (!obj) return [];
  try {
    const parsed = JSON.parse(await obj.text()) as ChatItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeHistory(bucket: R2Bucket, items: ChatItem[]): Promise<void> {
  await bucket.put(HISTORY_KEY, JSON.stringify(items.slice(-MAX_HISTORY)), { httpMetadata: { contentType: "application/json" } });
}

function authorized(request: Request, adminToken: string): boolean {
  const url = new URL(request.url);
  const given = request.headers.get("X-Chat-Key") ?? url.searchParams.get("key") ?? "";
  return adminToken !== "" && safeEqual(given, adminToken);
}


/** Reinício do usuário de teste. Só toca nos dados do telefone de teste (CHAT_PHONE). */
export type ResetMode = "first_contact" | "returning";

export async function resetTestUser(
  mode: ResetMode, supabaseUrl: string, serviceKey: string, bucket: R2Bucket, fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const rest = (path: string, init: RequestInit = {}) => fetchImpl(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers as Record<string, string> | undefined) } });
  const hash = await hashWaId(CHAT_PHONE);
  const phone = encodeURIComponent(CHAT_PHONE);

  if (mode === "returning") {
    const res = await rest(`users?wa_id=eq.${phone}&select=registered_at,version`);
    if (!res.ok) return { ok: false, error: `banco: ${res.status}` };
    const row = ((await res.json()) as { registered_at: string | null; version: number }[])[0];
    if (!row?.registered_at) return { ok: false, error: "ainda não há cadastro concluído: faça o cadastro primeiro" };
    // Limpa o histórico de envios (zera limites por pessoa e a "sessão") e volta ao estado concluído: o próximo "oi" pergunta a dúvida principal.
    const del = await rest(`outbound_log?wa_id_hash=eq.${hash}`, { method: "DELETE" });
    if (!del.ok) return { ok: false, error: `banco: ${del.status}` };
    const upd = await rest(`users?wa_id=eq.${phone}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "COMPLETED", previous_state: null, hint_sent_in_state: false, opted_out_at: null, last_service_id: null, version: row.version + 1 }),
    });
    return upd.ok ? { ok: true } : { ok: false, error: `banco: ${upd.status}` };
  }

  // Primeiro contato: apaga tudo do telefone de teste (cadastro, consentimento, áudios, histórico de envios).
  for (const path of [`audios?wa_id_hash=eq.${hash}`, `doubts?wa_id_hash=eq.${hash}`, `doubt_materials?wa_id_hash=eq.${hash}`, `outbound_log?wa_id_hash=eq.${hash}`, `users?wa_id=eq.${phone}`]) {
    const r = await rest(path, { method: "DELETE" });
    if (!r.ok) return { ok: false, error: `banco: ${r.status}` };
  }
  const listed = await bucket.list({ prefix: `audios/${hash}/` });
  if (listed.objects.length > 0) await bucket.delete(listed.objects.map((o) => o.key));
  const materials = await bucket.list({ prefix: `materiais/${hash}/` });
  if (materials.objects.length > 0) await bucket.delete(materials.objects.map((o) => o.key));
  return { ok: true };
}

async function isBotOff(bucket: R2Bucket): Promise<boolean> {
  return (await bucket.get(BOT_OFF_KEY)) !== null;
}

/** Liga o bot de volta: o estado dele é reajustado (handBackToBot) e o marcador de "desligado" some. */
async function turnBotOn(bucket: R2Bucket, supabaseUrl: string, serviceKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isBotOff(bucket))) return { ok: true };
  const r = await handBackToBot(supabaseUrl, serviceKey);
  await bucket.delete(BOT_OFF_KEY); // liga mesmo se o reajuste falhar: melhor um bot ligado que a pessoa sem resposta
  return r;
}

export interface ChatDeps {
  env: Env;
  logger?: Logger;
  pageHtml: string;
}

export async function handleChat(request: Request, deps: ChatDeps): Promise<Response> {
  const { env, pageHtml } = deps;
  const logger = deps.logger ?? createLogger();
  if (env.CHAT_SIM_ENABLED !== "true") return new Response("not found", { status: 404 });
  const bucket = env.AUDIOS;
  if (!bucket) return new Response("bucket R2 (AUDIOS) ausente", { status: 500 });

  let cfg;
  try {
    cfg = loadConfig(env);
  } catch (e) {
    logger.log("error", "config_invalid", { message: (e as Error).message });
    return new Response("server misconfigured", { status: 500 });
  }
  if (!authorized(request, cfg.adminToken)) return new Response("unauthorized", { status: 401 });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (request.method === "GET" && path === "/chat") {
    return new Response(pageHtml, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const isAdmin = safeEqual(request.headers.get("X-Chat-Admin") ?? "", await adminSessionToken(env, cfg.adminToken));
  if (request.method === "POST" && path === "/chat/api/login") {
    let creds: { user?: unknown; pass?: unknown } = {};
    try { creds = (await request.json()) as typeof creds; } catch { /* inválido */ }
    if (typeof creds.user !== "string" || typeof creds.pass !== "string" || !(await credentialsOk(env, creds.user, creds.pass))) {
      return json({ error: "usuário ou senha incorretos" }, 401);
    }
    return json({ token: await adminSessionToken(env, cfg.adminToken) });
  }
  if (request.method === "GET" && path === "/chat/api/history") {
    if (isAdmin) {
      await touchPresence(bucket);
      const [items, off] = await Promise.all([readHistory(bucket), isBotOff(bucket)]); // juntas: uma viagem só
      return json({ items, admin: true, botOn: !off });
    }
    return json({ items: await readHistory(bucket) });
  }
  if (request.method === "POST" && path === "/chat/api/admin/reply") {
    if (!isAdmin) return json({ error: "faça login como admin" }, 401);
    let text = "";
    try { text = String(((await request.json()) as { text?: unknown }).text ?? "").trim(); } catch { /* vazio */ }
    if (text === "" || text.length > 4000) return json({ error: "texto inválido" }, 400);
    const items = await readHistory(bucket);
    items.push({ id: `admin.${crypto.randomUUID()}`, dir: "out", at: new Date().toISOString(), kind: "text", text, by: "admin" });
    await writeHistory(bucket, items);
    return json({ ok: true });
  }
  if (request.method === "POST" && path === "/chat/api/admin/bot") {
    // Liga/desliga o bot. Desligado: ele não responde e o admin assume. Ligado de novo: volta a responder normalmente.
    if (!isAdmin) return json({ error: "faça login como admin" }, 401);
    let on: unknown;
    try { on = ((await request.json()) as { on?: unknown }).on; } catch { on = undefined; }
    if (typeof on !== "boolean") return json({ error: "campo 'on' (true/false) obrigatório" }, 400);
    if (on) {
      const r = await turnBotOn(bucket, cfg.supabaseUrl, cfg.supabaseServiceKey);
      if (!r.ok) logger.log("warn", "chat_handback_failed", { error: r.error });
    } else {
      await bucket.put(BOT_OFF_KEY, JSON.stringify({ at: Date.now() }), { httpMetadata: { contentType: "application/json" } });
    }
    return json({ ok: true, botOn: on });
  }
  if (request.method === "GET" && path === "/chat/api/admin/mentorias") {
    // Métricas: um certificado JSON por mentoria registrada. Gerado uma vez e guardado (a prova não muda depois).
    if (!isAdmin) return json({ error: "faça login como admin" }, 401);
    const repo = new SupabaseRepo(cfg.supabaseUrl, cfg.supabaseServiceKey);
    const agent = createAgent(cfg, logger);
    try {
      const rows = await repo.listMentorias({ limit: 20 });
      const items = await Promise.all(rows.map(async (row) => {
        const key = `${CERT_PREFIX}${row.id}.json`;
        const cached = await bucket.get(key);
        if (cached) { try { return JSON.parse(await cached.text()) as Certificate; } catch { /* regera */ } }
        const cert = await buildCertificate(row, { supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.supabaseServiceKey, agent });
        if (cert.mentoria.subject.source === "ia" || !agent) {
          await bucket.put(key, JSON.stringify(cert), { httpMetadata: { contentType: "application/json" } });
        }
        return cert;
      }));
      return json({ items });
    } catch (e) {
      logger.log("error", "chat_certificates_failed", { message: (e as Error).message });
      return json({ error: "não foi possível listar as mentorias" }, 502);
    }
  }
  if (request.method === "GET" && path.startsWith("/chat/api/media/")) {
    const id = path.slice("/chat/api/media/".length);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return new Response("bad id", { status: 400 });
    const obj = await bucket.get(MEDIA_PREFIX + id);
    if (!obj) return new Response("not found", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream" } });
  }
  if (request.method === "GET" && path === "/chat/api/diag") {
    // Diagnóstico: roda 3 chamadas ao banco de dentro do Worker e devolve só o texto do erro (sem segredos).
    const repo = new SupabaseRepo(cfg.supabaseUrl, cfg.supabaseServiceKey);
    const steps: Record<string, string> = {};
    const probe = `diag.${crypto.randomUUID()}`;
    const t = async (name: string, f: () => Promise<unknown>) => {
      try { await f(); steps[name] = "ok"; } catch (e) { steps[name] = e instanceof Error ? e.message : "erro"; }
    };
    await t("claimMessage", () => repo.claimMessage(probe, new Date()));
    await t("unclaimMessage", () => repo.unclaimMessage(probe));
    await t("touchUser", () => repo.touchUser(CHAT_PHONE, new Date()));
    await t("getLastUserMessageAt", () => repo.getLastUserMessageAt(CHAT_PHONE));
    return json({ steps });
  }
  if (request.method === "POST" && path === "/chat/api/reset") {
    let mode: string | undefined;
    try { mode = ((await request.json()) as { mode?: string }).mode; } catch { mode = undefined; }
    if (mode !== "first_contact" && mode !== "returning") return json({ error: "mode inválido" }, 400);
    const r = await resetTestUser(mode, cfg.supabaseUrl, cfg.supabaseServiceKey, bucket);
    if (!r.ok) return json({ error: r.error }, 409);
    await writeHistory(bucket, []);
    return json({ ok: true, mode });
  }
  if (request.method === "POST" && path === "/chat/api/clear") {
    await writeHistory(bucket, []);
    return json({ ok: true });
  }
  if (request.method !== "POST" || (path !== "/chat/api/send" && path !== "/chat/api/audio" && path !== "/chat/api/document")) {
    return new Response("not found", { status: 404 });
  }

  // Bot desligado pelo admin, mas o admin sumiu (fechou a tela sem religar): o bot volta sozinho.
  // Leitura do histórico (contexto para a IA) junto com o estado do bot: não depende de nada que vem depois.
  const [botOffNow, historyForContext] = await Promise.all([isBotOff(bucket), readHistory(bucket)]);
  let botOff = botOffNow;
  if (botOff && !isAdmin && !(await isAdminOnline(bucket))) {
    const back = await turnBotOn(bucket, cfg.supabaseUrl, cfg.supabaseServiceKey);
    if (!back.ok) logger.log("warn", "chat_handback_failed", { error: back.error });
    botOff = false;
  }

  // ---- entrada do usuário de teste -> evento idêntico ao do webhook ----
  const base = { wamid: `wamid.CHAT.${crypto.randomUUID()}`, from: CHAT_PHONE, timestamp: Math.floor(Date.now() / 1000) };
  const mine: ChatItem[] = [];
  let event: IncomingMessage;
  let audioBytes: Uint8Array | null = null;
  let audioMime = "";

  // Arquivo de áudio gravado antes (ou anexado como documento): o tipo vem do cabeçalho ou da extensão do nome.
  const uploadName = ((): string => { try { return decodeURIComponent(request.headers.get("X-Filename") ?? ""); } catch { return ""; } })();
  const declaredType = (request.headers.get("Content-Type") ?? "").trim();
  const docIsAudio = path === "/chat/api/document" && resolveAudioMime(declaredType, uploadName) !== null;

  if (path === "/chat/api/audio" || docIsAudio) {
    audioMime = resolveAudioMime(declaredType, uploadName) ?? declaredType;
    audioBytes = new Uint8Array(await request.arrayBuffer());
    if (audioBytes.length === 0) return json({ error: "áudio vazio" }, 400);
    if (audioBytes.length > cfg.maxAudioBytes * 2) return json({ error: "áudio grande demais" }, 413);
    const mediaId = crypto.randomUUID();
    await bucket.put(MEDIA_PREFIX + mediaId, audioBytes, { httpMetadata: { contentType: audioMime } });
    event = { ...base, type: "audio", mediaId, mimeType: audioMime, voice: true };
    mine.push({ id: base.wamid, dir: "in", at: new Date().toISOString(), kind: "audio", mediaId, mime: audioMime });
  } else if (path === "/chat/api/document") {
    audioMime = (request.headers.get("Content-Type") ?? "").trim();
    audioBytes = new Uint8Array(await request.arrayBuffer());
    if (audioBytes.length === 0) return json({ error: "arquivo vazio" }, 400);
    if (audioBytes.length > cfg.maxAudioBytes * 2) return json({ error: "arquivo grande demais" }, 413);
    let filename: string;
    try { filename = decodeURIComponent(request.headers.get("X-Filename") ?? ""); } catch { filename = ""; }
    const mediaId = crypto.randomUUID();
    await bucket.put(MEDIA_PREFIX + mediaId, audioBytes, { httpMetadata: { contentType: audioMime } });
    event = { ...base, type: "document", mediaId, mimeType: audioMime, ...(filename ? { filename } : {}) };
    mine.push({ id: base.wamid, dir: "in", at: new Date().toISOString(), kind: "text", text: `\u{1F4C4} ${filename || "documento"}` });
  } else {
    let input: { kind?: string; text?: string; id?: string; title?: string };
    try {
      input = (await request.json()) as typeof input;
    } catch {
      return json({ error: "json inválido" }, 400);
    }
    if (input.kind === "text" && typeof input.text === "string" && input.text.trim() !== "") {
      event = { ...base, type: "text", body: input.text };
      mine.push({ id: base.wamid, dir: "in", at: new Date().toISOString(), kind: "text", text: input.text });
    } else if ((input.kind === "button" || input.kind === "list") && typeof input.id === "string") {
      const title = String(input.title ?? input.id);
      event = input.kind === "button"
        ? { ...base, type: "button_reply", id: input.id, title }
        : { ...base, type: "list_reply", id: input.id, title };
      mine.push({ id: base.wamid, dir: "in", at: new Date().toISOString(), kind: "reply", text: title });
    } else {
      return json({ error: "entrada inválida" }, 400);
    }
  }

  // Bot desligado: a mensagem da pessoa fica no histórico para o admin ver e responder; o bot não processa nada.
  if (botOff && !isAdmin) {
    const history = await readHistory(bucket);
    history.push(...mine);
    await writeHistory(bucket, history);
    return json({ items: mine });
  }

  // ---- mesma fiação de produção, com transporte local e mídia vinda desta requisição ----
  const outbound: ChatItem[] = [];
  // Transporte local: a mensagem (formato interno, com botões/lista) vai para a tela, nunca para a Evolution.
  const transport = async (message: OutboundMessage): Promise<TransportResult> => {
    const wamid = `wamid.CHATOUT.${crypto.randomUUID()}`;
    const body: Record<string, unknown> = { ...message };
    delete body.to;
    outbound.push({ id: wamid, dir: "out", at: new Date().toISOString(), kind: "text", ui: toUi(body) });
    return { ok: true, messageId: wamid, pending: null };
  };
  const media: MediaClient = {
    getInfo: async () => ({ url: "https://chat.local/media", mimeType: audioMime, fileSize: audioBytes?.length ?? 0 }),
    download: async (_u, maxBytes) =>
      audioBytes && audioBytes.length <= maxBytes ? { ok: true, bytes: audioBytes, contentType: audioMime } : { ok: false, reason: "too_large" },
  };

  const repo = new SupabaseRepo(cfg.supabaseUrl, cfg.supabaseServiceKey);
  let content = contentProviders.get(cfg.supabaseUrl);
  if (!content) {
    content = new ContentProvider(repo, logger);
    contentProviders.set(cfg.supabaseUrl, content);
  }
  const recentContext = recentLines(historyForContext);
  const onEvent = createEventHandler(cfg, {
    repo, logger, content, transport,
    ...(recentContext.length ? { recentContext } : {}),
    ...((a) => (a ? { agent: a } : {}))(createAgent(cfg, logger)),
    audio: {
      media, store: new R2AudioStore(bucket),
      analyzer: cfg.analyzerApiUrl && cfg.analyzerApiKey
        ? new HttpAudioAnalyzer({ url: cfg.analyzerApiUrl, apiKey: cfg.analyzerApiKey, timeoutMs: cfg.analyzerTimeoutMs })
        : new DeferredAudioAnalyzer(),
    },
  });
  await processEvents([event], { webhookToken: "", repo, logger, onEvent });

  const history = await readHistory(bucket);
  history.push(...mine, ...outbound);
  await writeHistory(bucket, history);
  return json({ items: [...mine, ...outbound] });
}
