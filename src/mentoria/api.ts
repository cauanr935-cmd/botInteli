// API de integração (/api/v1) para o sistema externo de análise de áudio.
// Autenticação: Authorization: Bearer <INTEGRATION_API_KEY>. Não expõe telefone nem hash de telefone.
//   GET  /api/v1/mentorias?status=pending&limit=50   lista (pendentes = sem resultado de análise)
//   GET  /api/v1/mentorias/<id>                      uma mentoria
//   GET  /api/v1/mentorias/<id>/audio                bytes do áudio (Content-Type = tipo do áudio)
//   POST /api/v1/mentorias/<id>/result               {"result": <qualquer JSON>}  grava o resultado
import type { MentoriaRepo, MentoriaRow } from "../db/repo";
import { constantTimeEqual } from "./auth";

export interface ApiDeps {
  apiKey: string;
  repo: MentoriaRepo;
  bucket: R2Bucket | undefined;
  now?: () => Date;
}

const MAX_RESULT_BYTES = 256 * 1024;
const enc = new TextEncoder();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function toApiMentoria(m: MentoriaRow) {
  return {
    id: m.id, role: m.role, subject: m.subject, partner: m.partner, mime: m.mime, bytes: m.bytes,
    created_at: m.createdAt.toISOString(),
    audio_url: `/api/v1/mentorias/${m.id}/audio`,
    analysis_pending: m.analysisResult === null,
    ...(m.analysisResult === null ? {} : { analysis_result: m.analysisResult, analysis_at: m.analysisAt?.toISOString() ?? null }),
  };
}

export async function handleApi(request: Request, deps: ApiDeps): Promise<Response> {
  if (deps.apiKey.length < 32) return json({ error: "api não configurada" }, 503);
  const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
  if (!m || !constantTimeEqual(enc.encode(m[1] ?? ""), enc.encode(deps.apiKey))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const now = (deps.now ?? (() => new Date()))();

  try {
    if (request.method === "GET" && path === "/api/v1/mentorias") {
      const status = url.searchParams.get("status");
      if (status !== null && status !== "pending" && status !== "all") return json({ error: "status inválido (pending|all)" }, 400);
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
      const rows = await deps.repo.listMentorias({ limit, ...(status === "pending" ? { pending: true } : {}) });
      return json({ items: rows.map(toApiMentoria) });
    }

    const one = /^\/api\/v1\/mentorias\/([0-9a-fA-F-]{36})(\/audio|\/result)?$/.exec(path);
    if (one) {
      const id = one[1] ?? "";
      const row = await deps.repo.getMentoria(id);
      if (!row) return json({ error: "not found" }, 404);

      if (request.method === "GET" && !one[2]) return json(toApiMentoria(row));

      if (request.method === "GET" && one[2] === "/audio") {
        const obj = deps.bucket ? await deps.bucket.get(row.r2Key) : null;
        if (!obj) return json({ error: "audio indisponível" }, 404);
        return new Response(obj.body, { headers: { "Content-Type": row.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }

      if (request.method === "POST" && one[2] === "/result") {
        const raw = await request.text();
        if (raw.length > MAX_RESULT_BYTES) return json({ error: "resultado grande demais" }, 413);
        let body: { result?: unknown };
        try { body = JSON.parse(raw) as { result?: unknown }; } catch { return json({ error: "json inválido" }, 400); }
        if (body === null || typeof body !== "object" || body.result === undefined || body.result === null) {
          return json({ error: "campo 'result' obrigatório" }, 400);
        }
        const ok = await deps.repo.setAnalysisResult(id, body.result, now);
        return ok ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
    }
    return json({ error: "not found" }, 404);
  } catch {
    return json({ error: "internal" }, 500);
  }
}
