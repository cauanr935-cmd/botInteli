// Painel de metadados das mentorias, protegido por login (usuário + senha).
// Rotas: GET /painel (página), POST /painel/api/login|logout, GET /painel/api/mentorias, GET /painel/audio/<id>.
import type { LoginAttemptRepo, MatchingRepo, MentoriaRepo, MentoriaRow } from "../db/repo";
import { summarizeSlots, type AvailabilitySlot } from "../ai/types";
import { maskPhone } from "../lib/logger";
import type { MatchingActions } from "../matching/actions";
import { WEEKDAYS, type Weekday } from "../ai/types";
import { CATEGORIES } from "../profile/categories";
import { hashWaId } from "../lib/hash";
import {
  COOKIE_NAME, LOGIN_LIMITS, SESSION_TTL_MS, readCookie, sessionCookie, signSession, verifyPassword, verifySession,
} from "./auth";
import type { AiOverview } from "../ai/status";
import { dashboardPage, loginPage } from "./panel-page";
import { roleOf, summarizeCuradoria } from "./curadoria";
import { resolveAudioMime } from "../audio/storage";
import type { ReprocessRequest, ReprocessResult } from "../admin/budget";
import { STAGED_PREFIX, STAGING_FOLDER } from "../admin/reprocess";

/** Teto do arquivo enviado pelo painel (limite do corpo de uma requisição no plano gratuito do Workers). */
export const MANUAL_AUDIO_MAX_BYTES = 100 * 1000 * 1000;

/** Variáveis lidas: PANEL_USER, PANEL_PASSWORD_HASH, PANEL_SESSION_SECRET (>= 32 caracteres). */
export type PanelEnv = Record<string, unknown>;
export interface PanelDeps {
  env: PanelEnv;
  repo: MentoriaRepo & LoginAttemptRepo & MatchingRepo;
  bucket: R2Bucket | undefined;
  /** Conectar/cancelar matches (precisa da config da Evolution). Sem isso, os botões respondem 503. */
  matching?: MatchingActions;
  /** Estado da chave de IA (Groq) para o painel. Sem isto, a rota responde 503. */
  aiStatus?: () => Promise<AiOverview>;
  /** Continua o fluxo de mentoria de uma pessoa com o áudio enviado pela equipe. Sem isso, a rota responde 503. */
  manualAudio?: (r: ReprocessRequest) => Promise<ReprocessResult>;
  now?: () => Date;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const SECURITY = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin",
} as const;

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...SECURITY, ...extra } });
}

function html(body: (nonce: string) => string): Response {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; media-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return new Response(body(nonce), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, ...SECURITY } });
}

export function toPublicMentoria(m: MentoriaRow) {
  return {
    id: m.id, role: m.role, subject: m.subject, partner: m.partner, mime: m.mime, bytes: m.bytes,
    createdAt: m.createdAt.toISOString(),
    registrant: m.registrant ?? null,
    occurredOn: m.ocorreuEm ?? null,
    // Só no painel: mentoria recusada ou sem resposta do parceiro nunca é listada para o notebook.
    contested: m.contestedReason ?? null,
    partnerStatus: m.ocorreuEm == null ? null : m.partnerConfirmedAt ? "confirmada" : m.contestedReason ? m.contestedReason : "aguardando",
    audioDeleted: m.audioDeletedAt != null,
    analysis: m.analysisResult === null ? { status: "pending" } : { status: "done", at: m.analysisAt?.toISOString() ?? null, result: m.analysisResult },
    // Curadoria da equipe: status e, por participante, a situação e se já foi avisado (sem pessoa_id nem telefone).
    curadoria: summarizeCuradoria(m.analysisResult, m.notifiedCuradoria),
  };
}

const labelOf = (k: string): string => CATEGORIES.find((c) => c.key === k)?.label ?? k;
const cats = (keys: readonly string[]) => keys.map((k) => ({ key: k, label: labelOf(k) }));

/** Dados do dashboard: dúvidas abertas, mentores (o painel agrupa por disciplina) e matches. Telefones sempre mascarados. */
export async function buildDashboard(repo: MatchingRepo, now: Date) {
  const [doubts, mentors, matches, members] = await Promise.all([repo.listOpenDoubts(100), repo.listMentors(200), repo.listMatches(500), repo.countMembers()]);
  const names = await repo.getFullNames([...doubts.map((d) => d.waId), ...matches.flatMap((m) => [m.mentorWaId, m.menteeWaId])]);
  const ACTIVE = new Set(["aguardando_mentor", "aguardando_mentorado", "aguardando_local", "sem_horario"]);
  const busy = new Set(matches.filter((m) => ACTIVE.has(m.status)).map((m) => m.mentorWaId));
  return {
    counts: {
      members,
      openDoubts: doubts.length, mentors: mentors.length,
      activeMatches: matches.filter((m) => ACTIVE.has(m.status)).length, confirmed: matches.filter((m) => m.status === "confirmado").length,
      completed: matches.filter((m) => m.status === "realizada").length,
    },
    doubts: doubts.map((d) => ({
      seq: d.seq, name: names[d.waId] ?? null, phoneMasked: maskPhone(d.waId), text: d.text, categories: cats(d.categories), createdAt: d.createdAt.toISOString(),
    })),
    mentors: mentors.map((m) => ({
      seq: m.seq, name: m.name, phoneMasked: maskPhone(m.waId), categories: cats(m.categories), slots: summarizeSlots(m.slots as AvailabilitySlot[]), busy: busy.has(m.waId),
    })),
    disciplines: CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
    matches: matches.map((m) => ({
      seq: m.seq, status: m.status, doubtSeq: m.doubtSeq, doubtText: m.doubtText,
      mentor: names[m.mentorWaId] ?? null, mentee: names[m.menteeWaId] ?? null,
      day: m.chosenDay, start: m.chosenStart, end: m.chosenEnd, location: m.location, createdAt: m.createdAt.toISOString(),
    })),
    generatedAt: now.toISOString(),
  };
}

export async function handlePanel(request: Request, deps: PanelDeps): Promise<Response> {
  const { env, repo } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const user = str(env.PANEL_USER);
  const passHash = str(env.PANEL_PASSWORD_HASH);
  const secret = str(env.PANEL_SESSION_SECRET);
  // PANEL_OPEN=true: painel aberto, sem login (acesso direto pelo link), a pedido do dono do projeto.
  const open = str(env.PANEL_OPEN).toLowerCase() === "true";
  if (!open && (user === "" || passHash === "" || secret.length < 32)) return new Response("painel não configurado", { status: 503 });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const authed = open || await verifySession(secret, readCookie(request.headers.get("Cookie"), COOKIE_NAME), user, now);
  // Defesa extra contra CSRF (além do SameSite=Strict): ações exigem este cabeçalho, que um formulário externo não consegue enviar.
  const xhr = request.headers.get("X-Requested-With") === "painel";

  if (request.method === "GET" && path === "/painel") {
    return html((nonce) => (authed ? dashboardPage(nonce, open) : loginPage(nonce)));
  }

  if (request.method === "POST" && path === "/painel/api/login") {
    if (!xhr) return json({ error: "requisição inválida" }, 400);
    const ipKey = `ip:${await hashWaId(request.headers.get("CF-Connecting-IP") ?? "unknown")}`;
    try {
      const [a, g] = await Promise.all([repo.getLoginLock(ipKey), repo.getLoginLock("global")]);
      const until = [a.lockedUntil, g.lockedUntil].filter((d): d is Date => d !== null && d > now).sort((x, y) => y.getTime() - x.getTime())[0];
      if (until) {
        return json({ error: "muitas tentativas; tente mais tarde" }, 429, { "Retry-After": String(Math.ceil((until.getTime() - now.getTime()) / 1000)) });
      }
    } catch {
      return json({ error: "indisponível" }, 503); // falha fechada: sem controle de tentativas, ninguém entra
    }
    let body: { user?: unknown; password?: unknown } = {};
    try {
      const raw = await request.text();
      if (raw.length > 2048) return json({ error: "requisição inválida" }, 400);
      body = JSON.parse(raw) as typeof body;
    } catch {
      return json({ error: "requisição inválida" }, 400);
    }
    const givenUser = typeof body.user === "string" ? body.user : "";
    const givenPass = typeof body.password === "string" ? body.password : "";
    // Sempre verifica a senha (mesmo com usuário errado) para o tempo de resposta não revelar qual campo errou.
    const passOk = await verifyPassword(givenPass, passHash);
    const userOk = givenUser.length === user.length && givenUser === user;
    if (!(passOk && userOk)) {
      await Promise.all([
        repo.recordLoginFailure(ipKey, now, LOGIN_LIMITS.perIp, LOGIN_LIMITS.lockMs),
        repo.recordLoginFailure("global", now, LOGIN_LIMITS.global, LOGIN_LIMITS.lockMs),
      ]).catch(() => undefined);
      return json({ error: "usuário ou senha inválidos" }, 401);
    }
    await repo.clearLoginFailures(ipKey).catch(() => undefined);
    const token = await signSession(secret, user, now);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL_MS / 1000) });
  }

  if (request.method === "POST" && path === "/painel/api/logout") {
    if (!xhr) return json({ error: "requisição inválida" }, 400);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }

  // Daqui em diante: só com sessão válida.
  if (!authed) return json({ error: "não autenticado" }, 401);

  if (request.method === "GET" && path === "/painel/api/mentorias") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const beforeRaw = url.searchParams.get("before");
    const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : undefined;
    const rows = await repo.listMentorias({ limit, ...(before ? { before } : {}) });
    return json({ items: rows.map(toPublicMentoria) });
  }

  // Pedidos de revisão humana (botão da mensagem de recusa): mentoria, data e papel de quem pediu. Sem telefone nem nome.
  if (request.method === "GET" && path === "/painel/api/revisoes") {
    const status = url.searchParams.get("status");
    if (status !== null && status !== "aberta" && status !== "atendida") return json({ error: "status inválido (aberta|atendida)" }, 400);
    const reqs = await repo.listReviewRequests({ limit: 100, ...(status ? { status } : {}) });
    const items = await Promise.all(reqs.map(async (r) => {
      const row = await repo.getMentoria(r.audioId).catch(() => null);
      return {
        id: r.id, mentoriaId: r.audioId, status: r.status, requestedAt: r.createdAt.toISOString(),
        occurredOn: row?.ocorreuEm ?? null, createdAt: row?.createdAt.toISOString() ?? null,
        role: row ? roleOf(row, r.waIdHash) : null, subject: row?.subject ?? null,
      };
    }));
    return json({ items });
  }

  // Estado da IA (Groq): chamada mínima ao provedor; mostra se a chave vale e se o limite estourou.
  if (request.method === "GET" && path === "/painel/api/ia") {
    if (!deps.aiStatus) return json({ error: "indisponível" }, 503);
    try { return json(await deps.aiStatus()); } catch { return json({ error: "falha ao verificar" }, 502); }
  }

  if (request.method === "GET" && path === "/painel/api/dashboard") {
    return json(await buildDashboard(repo, now));
  }

  // Conectar mentor e mentorado / cancelar match: ações com efeito, só com o cabeçalho anti-CSRF.
  if (request.method === "POST" && (path === "/painel/api/match" || path === "/painel/api/match/cancel" || path === "/painel/api/match/confirm")) {
    if (!xhr) return json({ error: "requisição inválida" }, 400);
    if (!deps.matching) return json({ error: "envio de mensagens não configurado" }, 503);
    let body: { doubtSeq?: unknown; mentorSeq?: unknown; matchSeq?: unknown; day?: unknown; start?: unknown; end?: unknown; location?: unknown } = {};
    try {
      const raw = await request.text();
      if (raw.length > 1024) return json({ error: "requisição inválida" }, 400);
      body = JSON.parse(raw) as typeof body;
    } catch {
      return json({ error: "requisição inválida" }, 400);
    }
    const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e9 ? v : null);
    try {
      if (path === "/painel/api/match") {
        const d = int(body.doubtSeq), m = int(body.mentorSeq);
        if (d === null || m === null) return json({ error: "dúvida e mentor inválidos" }, 400);
        const r = await deps.matching.connect(d, m);
        return json({ ok: r.ok, message: r.text, ...(r.ok ? { matchSeq: r.matchSeq } : {}) }, r.ok ? 200 : 409);
      }
      const s = int(body.matchSeq);
      if (s === null) return json({ error: "match inválido" }, 400);
      if (path === "/painel/api/match/confirm") {
        const hm = (v: unknown): string | null => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
        const [st, en] = [hm(body.start), hm(body.end)];
        const day = typeof body.day === "string" && (WEEKDAYS as readonly string[]).includes(body.day) ? (body.day as Weekday) : null;
        if (!day || !st || !en || st >= en) return json({ error: "dia e horário inválidos" }, 400);
        const loc = typeof body.location === "string" ? body.location.replace(/\s+/g, " ").trim().slice(0, 100) : "";
        const r = await deps.matching.confirm({ seq: s, day, start: st, end: en, location: loc || "A combinar com a coordenação" });
        return json({ ok: r.ok, message: r.text }, r.ok ? 200 : 409);
      }
      const r = await deps.matching.cancel(s);
      return json({ ok: r.ok, message: r.text }, r.ok ? 200 : 409);
    } catch {
      return json({ error: "falha ao executar a ação" }, 500);
    }
  }

  // Enviar o áudio de uma mentoria pela equipe (arquivo que não chegou pelo WhatsApp): o corpo é o arquivo cru, guardado em staging no R2
  // (em stream, sem carregar na memória) e depois tratado como um áudio recebido: valida, guarda, registra e avisa a pessoa.
  if (request.method === "POST" && path === "/painel/api/audio-manual") {
    if (!xhr) return json({ error: "requisição inválida" }, 400);
    if (!deps.manualAudio || !deps.bucket) return json({ error: "envio de áudio não configurado" }, 503);
    const phone = (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
    if (phone.length < 10 || phone.length > 15) return json({ error: "telefone inválido (DDI + DDD + número)" }, 400);
    const size = Number(request.headers.get("Content-Length"));
    if (!Number.isInteger(size) || size <= 0) return json({ error: "arquivo vazio ou sem tamanho" }, 400);
    if (size > MANUAL_AUDIO_MAX_BYTES) return json({ error: "arquivo acima do limite de 100 MB" }, 413);
    const mime = resolveAudioMime(request.headers.get("Content-Type") ?? undefined, url.searchParams.get("name") ?? undefined);
    if (!mime || !request.body) return json({ error: "tipo de arquivo não aceito (envie um áudio)" }, 415);
    const key = `${STAGING_FOLDER}${crypto.randomUUID()}`;
    try {
      await deps.bucket.put(key, request.body, { httpMetadata: { contentType: mime } });
    } catch {
      await deps.bucket.delete(key).catch(() => undefined);
      return json({ error: "falha ao guardar o arquivo" }, 502);
    }
    let outcome: ReprocessResult;
    try {
      outcome = await deps.manualAudio({ phone, mediaUrl: `${STAGED_PREFIX}${key}`, mimeType: mime, fileSize: size, messageId: `manual-${crypto.randomUUID()}` });
    } catch {
      outcome = "failed";
    } finally {
      await deps.bucket.delete(key).catch(() => undefined);
    }
    const status = outcome === "done" ? 200 : outcome === "unknown_contact" ? 404 : outcome === "no_consent" ? 409 : outcome === "invalid" ? 422 : 502;
    return json({ outcome }, status);
  }

  const audio = /^\/painel\/audio\/([0-9a-fA-F-]{36})$/.exec(path);
  if (request.method === "GET" && audio) {
    const row = await repo.getMentoria(audio[1] ?? "");
    const obj = row && deps.bucket ? await deps.bucket.get(row.r2Key) : null;
    if (!row || !obj) return new Response("not found", { status: 404, headers: SECURITY });
    return new Response(obj.body, { headers: { "Content-Type": row.mime, ...SECURITY } });
  }

  return new Response("not found", { status: 404, headers: SECURITY });
}
