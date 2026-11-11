// Painel de metadados das mentorias, protegido por login (usuário + senha).
// Rotas: GET /painel (página), POST /painel/api/login|logout, GET /painel/api/mentorias, GET /painel/audio/<id>.
import type { LoginAttemptRepo, MentoriaRepo, MentoriaRow } from "../db/repo";
import { hashWaId } from "../lib/hash";
import {
  COOKIE_NAME, LOGIN_LIMITS, SESSION_TTL_MS, readCookie, sessionCookie, signSession, verifyPassword, verifySession,
} from "./auth";
import { dashboardPage, loginPage } from "./panel-page";

/** Variáveis lidas: PANEL_USER, PANEL_PASSWORD_HASH, PANEL_SESSION_SECRET (>= 32 caracteres). */
export type PanelEnv = Record<string, unknown>;
export interface PanelDeps {
  env: PanelEnv;
  repo: MentoriaRepo & LoginAttemptRepo;
  bucket: R2Bucket | undefined;
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
    analysis: m.analysisResult === null ? { status: "pending" } : { status: "done", at: m.analysisAt?.toISOString() ?? null, result: m.analysisResult },
  };
}

export async function handlePanel(request: Request, deps: PanelDeps): Promise<Response> {
  const { env, repo } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const user = str(env.PANEL_USER);
  const passHash = str(env.PANEL_PASSWORD_HASH);
  const secret = str(env.PANEL_SESSION_SECRET);
  if (user === "" || passHash === "" || secret.length < 32) return new Response("painel não configurado", { status: 503 });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const authed = await verifySession(secret, readCookie(request.headers.get("Cookie"), COOKIE_NAME), user, now);
  // Defesa extra contra CSRF (além do SameSite=Strict): ações exigem este cabeçalho, que um formulário externo não consegue enviar.
  const xhr = request.headers.get("X-Requested-With") === "painel";

  if (request.method === "GET" && path === "/painel") {
    return html((nonce) => (authed ? dashboardPage(nonce) : loginPage(nonce)));
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

  const audio = /^\/painel\/audio\/([0-9a-fA-F-]{36})$/.exec(path);
  if (request.method === "GET" && audio) {
    const row = await repo.getMentoria(audio[1] ?? "");
    const obj = row && deps.bucket ? await deps.bucket.get(row.r2Key) : null;
    if (!row || !obj) return new Response("not found", { status: 404, headers: SECURITY });
    return new Response(obj.body, { headers: { "Content-Type": row.mime, ...SECURITY } });
  }

  return new Response("not found", { status: 404, headers: SECURITY });
}
