import type { IncomingMessage, StatusEvent, WebhookEvent } from "./types";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}
function ts(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseMessage(m: Obj): IncomingMessage | null {
  const wamid = str(m.id);
  const from = str(m.from);
  if (!wamid || !from) return null;
  const base = { wamid, from, ...(ts(m.timestamp) !== undefined ? { timestamp: ts(m.timestamp) as number } : {}) };
  const rawType = str(m.type) ?? "unknown";
  const unsupported: IncomingMessage = { ...base, type: "unsupported", rawType };

  switch (rawType) {
    case "text": {
      const body = isObj(m.text) ? str(m.text.body) : undefined;
      return body !== undefined ? { ...base, type: "text", body } : unsupported;
    }
    case "audio": {
      if (!isObj(m.audio)) return unsupported;
      const mediaId = str(m.audio.id);
      if (!mediaId) return unsupported;
      const mime = str(m.audio.mime_type);
      return { ...base, type: "audio", mediaId, ...(mime ? { mimeType: mime } : {}), voice: m.audio.voice === true };
    }
    case "interactive": {
      if (!isObj(m.interactive)) return unsupported;
      const i = m.interactive;
      const sub = str(i.type);
      if (sub === "button_reply" && isObj(i.button_reply)) {
        const id = str(i.button_reply.id);
        if (id) return { ...base, type: "button_reply", id, title: str(i.button_reply.title) ?? "" };
      } else if (sub === "list_reply" && isObj(i.list_reply)) {
        const id = str(i.list_reply.id);
        if (id) return { ...base, type: "list_reply", id, title: str(i.list_reply.title) ?? "" };
      } else if (sub === "nfm_reply" && isObj(i.nfm_reply)) {
        const rj = i.nfm_reply.response_json;
        const responseJson = typeof rj === "string" ? rj : isObj(rj) ? JSON.stringify(rj) : undefined;
        if (responseJson !== undefined) return { ...base, type: "nfm_reply", responseJson };
      }
      return unsupported;
    }
    default:
      return unsupported;
  }
}

function parseStatus(s: Obj): StatusEvent | null {
  const id = str(s.id);
  const status = str(s.status);
  if (!id || !status) return null;
  const ev: StatusEvent = { type: "status", id, status };
  const rid = str(s.recipient_id);
  if (rid) ev.recipientId = rid;
  const t = ts(s.timestamp);
  if (t !== undefined) ev.timestamp = t;
  if (isObj(s.pricing)) {
    const p = s.pricing;
    ev.pricing = {
      ...(typeof p.billable === "boolean" ? { billable: p.billable } : {}),
      ...(str(p.pricing_model) ? { pricingModel: str(p.pricing_model) as string } : {}),
      ...(str(p.type) ? { type: str(p.type) as string } : {}),
      ...(str(p.category) ? { category: str(p.category) as string } : {}),
    };
  }
  return ev;
}

/** Extrai todos os eventos do payload. Nunca lança: payload estranho vira lista vazia. */
export function parseWebhookPayload(payload: unknown): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  if (!isObj(payload)) return events;
  for (const entry of arr(payload.entry)) {
    if (!isObj(entry)) continue;
    for (const change of arr(entry.changes)) {
      if (!isObj(change) || !isObj(change.value)) continue;
      const v = change.value;
      for (const m of arr(v.messages)) {
        if (!isObj(m)) continue;
        try {
          const ev = parseMessage(m);
          if (ev) events.push(ev);
        } catch {
          /* ignora mensagem malformada */
        }
      }
      for (const s of arr(v.statuses)) {
        if (!isObj(s)) continue;
        const ev = parseStatus(s);
        if (ev) events.push(ev);
      }
    }
  }
  return events;
}
