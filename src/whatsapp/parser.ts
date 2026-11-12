// Converte o webhook `messages.upsert` da Evolution v2 (Baileys) nos eventos tipados que o motor consome.
// Nunca lança: payload estranho vira lista vazia. Formatos NÃO verificados contra uma instância real
// (ver docs/PENDENCIAS_HUMANAS.md): por isso o parser é tolerante e ignora o que não reconhece.
import { resolveAudioMime } from "../audio/storage";
import type { IncomingMessage, WebhookEvent } from "./types";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}
function ts(v: unknown): number | undefined {
  // messageTimestamp: número, string ou Long serializado ({ low, high }).
  const raw = isObj(v) ? v.low : v;
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** O Baileys embrulha mensagens (temporárias, visualização única, documento com legenda): desembrulha. */
const WRAPPERS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "documentWithCaptionMessage", "editedMessage"] as const;
function unwrap(message: Obj): Obj {
  let cur = message;
  for (let i = 0; i < 4; i++) {
    const w = WRAPPERS.find((k) => isObj(cur[k]) && isObj((cur[k] as Obj).message));
    if (!w) break;
    cur = (cur[w] as Obj).message as Obj;
  }
  return cur;
}

/** Telefone (só dígitos) a partir do JID. Grupos, status e canais são ignorados (null). */
function phoneFromKey(key: Obj): string | null {
  const jid = str(key.remoteJid);
  if (!jid) return null;
  if (jid.endsWith("@s.whatsapp.net")) return jid.slice(0, jid.indexOf("@")).replace(/\D/g, "") || null;
  if (jid.endsWith("@lid")) {
    // @lid é um identificador de privacidade, não um telefone: prefere o JID alternativo com o número, se vier.
    const alt = str(key.remoteJidAlt) ?? str(key.senderPn);
    if (alt?.endsWith("@s.whatsapp.net")) return alt.slice(0, alt.indexOf("@")).replace(/\D/g, "") || null;
    return jid; // sem número: o JID completo também serve de destino na Evolution
  }
  return null;
}

function contactsFromVcards(vcards: unknown[]): { waId?: string; phone?: string }[] {
  const out: { waId?: string; phone?: string }[] = [];
  for (const v of vcards.slice(0, 5)) {
    if (typeof v !== "string") continue;
    for (const line of v.split(/\r?\n/).filter((l) => /^TEL/i.test(l)).slice(0, 3)) {
      const waId = /waid=(\d{6,20})/i.exec(line)?.[1];
      const phone = line.slice(line.lastIndexOf(":") + 1).trim();
      if (waId || phone) out.push({ ...(waId ? { waId } : {}), ...(phone ? { phone } : {}) });
    }
  }
  return out;
}

function parseMessage(key: Obj, data: Obj, m: Obj): IncomingMessage | null {
  const wamid = str(key.id);
  const from = phoneFromKey(key);
  if (!wamid || !from) return null;
  const t = ts(data.messageTimestamp);
  const base = { wamid, from, ...(t !== undefined ? { timestamp: t } : {}) };
  const rawType = str(data.messageType) ?? Object.keys(m).find((k) => k !== "messageContextInfo") ?? "unknown";
  const unsupported: IncomingMessage = { ...base, type: "unsupported", rawType };

  const conversation = str(m.conversation);
  if (conversation !== undefined) return { ...base, type: "text", body: conversation };
  if (isObj(m.extendedTextMessage)) {
    const body = str(m.extendedTextMessage.text);
    return body !== undefined ? { ...base, type: "text", body } : unsupported;
  }

  // Respostas de botão/lista nativos (quando EVOLUTION_NATIVE_INTERACTIVE=true).
  if (isObj(m.buttonsResponseMessage)) {
    const id = str(m.buttonsResponseMessage.selectedButtonId);
    return id ? { ...base, type: "button_reply", id, title: str(m.buttonsResponseMessage.selectedDisplayText) ?? "" } : unsupported;
  }
  if (isObj(m.templateButtonReplyMessage)) {
    const id = str(m.templateButtonReplyMessage.selectedId);
    return id ? { ...base, type: "button_reply", id, title: str(m.templateButtonReplyMessage.selectedDisplayText) ?? "" } : unsupported;
  }
  if (isObj(m.listResponseMessage)) {
    const r = m.listResponseMessage;
    const id = isObj(r.singleSelectReply) ? str(r.singleSelectReply.selectedRowId) : undefined;
    return id ? { ...base, type: "list_reply", id, title: str(r.title) ?? "" } : unsupported;
  }
  if (isObj(m.interactiveResponseMessage)) {
    const nf = m.interactiveResponseMessage.nativeFlowResponseMessage;
    if (isObj(nf) && typeof nf.paramsJson === "string") {
      try {
        const p = JSON.parse(nf.paramsJson) as Obj;
        const id = str(p.id) ?? str(p.selectedRowId);
        const title = str(p.title) ?? str(p.display_text) ?? "";
        if (id) return { ...base, type: nf.name === "single_select" ? "list_reply" : "button_reply", id, title };
      } catch {
        /* paramsJson inválido: cai em unsupported */
      }
    }
    return unsupported;
  }

  if (isObj(m.audioMessage)) {
    // O id da mídia é o próprio id da mensagem: o download é feito pelo cliente de mídia (evolutionClient.ts).
    const mime = str(m.audioMessage.mimetype);
    return { ...base, type: "audio", mediaId: wamid, ...(mime ? { mimeType: mime } : {}), voice: m.audioMessage.ptt === true };
  }
  if (isObj(m.documentMessage)) {
    const mime = str(m.documentMessage.mimetype);
    const filename = str(m.documentMessage.fileName);
    // Arquivo de áudio gravado antes e anexado como "Documento": vale como áudio (só é guardado; a análise é externa).
    const audioMime = resolveAudioMime(mime, filename);
    if (audioMime) return { ...base, type: "audio", mediaId: wamid, mimeType: audioMime, voice: false };
    return { ...base, type: "document", mediaId: wamid, ...(mime ? { mimeType: mime } : {}), ...(filename ? { filename } : {}) };
  }
  if (isObj(m.contactMessage) || isObj(m.contactsArrayMessage)) {
    const vcards = isObj(m.contactMessage)
      ? [m.contactMessage.vcard]
      : arr((m.contactsArrayMessage as Obj).contacts).map((c) => (isObj(c) ? c.vcard : undefined));
    const contacts = contactsFromVcards(vcards);
    return contacts.length > 0 ? { ...base, type: "contacts", contacts } : unsupported;
  }
  return unsupported; // figurinha, reação, imagem, vídeo, localização...
}

function normalizeEvent(v: unknown): string {
  return typeof v === "string" ? v.replace(/[.-]/g, "_").toUpperCase() : "";
}

/**
 * Extrai os eventos do webhook da Evolution. Só `messages.upsert` interessa; mensagens enviadas por nós
 * (`fromMe`), grupos, status e canais são ignorados (o bot só fala em conversa individual).
 */
export function parseWebhookPayload(payload: unknown): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  if (!isObj(payload) || normalizeEvent(payload.event) !== "MESSAGES_UPSERT") return events;
  for (const data of Array.isArray(payload.data) ? payload.data : [payload.data]) {
    if (!isObj(data) || !isObj(data.key) || data.key.fromMe === true || !isObj(data.message)) continue;
    try {
      const ev = parseMessage(data.key, data, unwrap(data.message));
      if (ev) events.push(ev);
    } catch {
      /* ignora mensagem malformada */
    }
  }
  return events;
}
