// Certificado de metadados de uma mentoria (JSON rastreável): quem foi o mentor e o mentorado, quando ocorreu,
// o assunto (interpretado pela IA a partir da dúvida) e o áudio de origem. Nada aqui envia mensagem (R1).
// Telefone nunca entra no certificado. Os dados pessoais saem do cadastro (com consentimento, R6).
import type { IntentAgent } from "../ai/agent";
import type { MentoriaRow } from "../db/repo";

export interface CertPerson {
  name: string | null;
  email: string | null;
  class_name: string | null;
  /** "cadastro" = veio do cadastro da pessoa; "informado_na_conversa" = só o nome digitado, sem cadastro vinculado. */
  source: "cadastro" | "informado_na_conversa";
}
export interface Certificate {
  schema: "bmm.mentoria.certificado/1";
  certificate_id: string;
  mentoria: {
    occurred_at: string;
    /** O bot não pergunta a data da mentoria: vale o momento em que o áudio da mentoria foi registrado. */
    occurred_at_source: "registro_do_audio";
    subject: { title: string; source: "ia" | "informado_pela_pessoa" | "duvida" | "indisponivel" };
    doubt: string | null;
    subject_informed: string | null;
  };
  mentor: CertPerson | null;
  mentorado: CertPerson | null;
  /** Só quando o papel de quem registrou é desconhecido. */
  participants?: CertPerson[];
  audio: { id: string; mime: string; bytes: number };
  generated_at: string;
  integrity: { algorithm: "sha256"; hash: string };
}

export interface CertDeps {
  supabaseUrl: string;
  serviceKey: string;
  agent?: IntentAgent | undefined;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash do documento sem o campo `integrity`: quem receber o JSON consegue recalcular e conferir. */
export async function certificateHash(doc: Omit<Certificate, "integrity">): Promise<string> {
  return sha256Hex(JSON.stringify(doc));
}

export async function buildCertificate(row: MentoriaRow, deps: CertDeps): Promise<Certificate> {
  const f = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const h = { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` };
  const get = async <T>(path: string): Promise<T[]> => {
    try {
      const res = await f(`${deps.supabaseUrl}/rest/v1/${path}`, { headers: h });
      return res.ok ? ((await res.json()) as T[]) : [];
    } catch {
      return [];
    }
  };
  const hash = encodeURIComponent(row.waIdHash);
  const [users, doubts] = await Promise.all([
    get<{ full_name: string | null; email: string | null; class_name: string | null }>(`users?wa_id_hash=eq.${hash}&select=full_name,email,class_name&limit=1`),
    // A dúvida mais recente de quem registrou, anterior ao áudio (é dela que sai o assunto).
    get<{ text: string }>(`doubts?wa_id_hash=eq.${hash}&created_at=lte.${encodeURIComponent(row.createdAt.toISOString())}&select=text&order=created_at.desc&limit=1`),
  ]);
  const u = users[0];
  const registrant: CertPerson = { name: u?.full_name ?? row.registrant?.name ?? null, email: u?.email ?? null, class_name: u?.class_name ?? null, source: "cadastro" };
  const partner: CertPerson = { name: row.partner, email: null, class_name: null, source: "informado_na_conversa" };

  // O assunto é interpretado pela IA a partir da dúvida (ou, sem dúvida, do assunto que a pessoa informou).
  const doubt = doubts[0]?.text ?? null;
  const informed = row.subject;
  let subject: Certificate["mentoria"]["subject"] = { title: informed ?? doubt?.slice(0, 80) ?? "não informado", source: informed ? "informado_pela_pessoa" : doubt ? "duvida" : "indisponivel" };
  const input = doubt ?? informed;
  if (input && deps.agent?.summarizeSubject) {
    const title = await deps.agent.summarizeSubject(input, doubt ? informed : null).catch(() => null);
    if (title) subject = { title, source: "ia" };
  }

  const body: Omit<Certificate, "integrity"> = {
    schema: "bmm.mentoria.certificado/1",
    certificate_id: row.id,
    mentoria: { occurred_at: row.createdAt.toISOString(), occurred_at_source: "registro_do_audio", subject, doubt, subject_informed: informed },
    mentor: row.role === "mentor" ? registrant : row.role === "mentorado" ? partner : null,
    mentorado: row.role === "mentorado" ? registrant : row.role === "mentor" ? partner : null,
    ...(row.role === null ? { participants: [registrant, partner] } : {}),
    audio: { id: row.id, mime: row.mime, bytes: row.bytes },
    generated_at: (deps.now ?? (() => new Date()))().toISOString(),
  };
  return { ...body, integrity: { algorithm: "sha256", hash: await certificateHash(body) } };
}
