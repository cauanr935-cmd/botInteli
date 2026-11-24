// Pedido de certificado: só com mentoria aprovada; um pedido aberto por pessoa; a equipe é avisada.
import { describe, expect, it } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { hashWaId } from "../src/lib/hash";
import { CERT_TEXTS, handleCertificateRequest, wantsCertificate } from "../src/mentoria/certificate-request";
import type { OutboundMessage, SendResult } from "../src/whatsapp/client";

const NOW = new Date("2026-11-18T12:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const ADMIN = "5511900000099";

const conta = (o: Record<string, unknown> = {}) => ({ minutos_disponiveis: 70, horas_certificadas: 0, pode_pedir_certificado: true, minimo_horas: 1, ...o });
const result = (situacao: string, c: unknown = conta()) => ({ status: "analisada", curadoria: { status: "aprovada", participantes: [{ pessoa_id: "", papel: "mentor", situacao, minutos_contabilizados: 35, conta: c }] } });

async function world(res: unknown | null) {
  const repo = new MemoryRepo();
  const a = "5511900000001", b = "5511900000002";
  const [ha, hb] = [await hashWaId(a), await hashWaId(b)];
  for (const [wa, h, name] of [[a, ha, "Ana"], [b, hb, "Bruno"]] as const) {
    repo.registrations.set(wa, { consentAt: NOW, termsVersion: "1", registeredAt: NOW, values: { full_name: name }, waIdHash: h } as never);
  }
  let analysis: unknown = null;
  if (res) { const r = structuredClone(res) as { curadoria: { participantes: { pessoa_id: string }[] } }; r.curadoria.participantes[0]!.pessoa_id = ha; analysis = r; }
  repo.audios.set(ID, {
    id: ID, waIdHash: ha, r2Key: "k", mime: "audio/ogg", bytes: 10, serviceId: "mentoria",
    mentoria: { role: "mentor", subject: "Carreira", partner: "Bruno" }, ocorreuEm: "2026-11-12", partnerWaIdHash: hb,
    partnerConfirmedAt: NOW, status: "done", result: null, createdAt: NOW, finishedAt: NOW,
  });
  if (analysis) await repo.setAnalysisResult(ID, analysis, NOW);
  const sent: { to: string; body: string }[] = [];
  const deps = {
    repo, logger: { log: () => undefined }, now: NOW, adminWaIds: [ADMIN],
    send: async (m: OutboundMessage): Promise<SendResult> => { sent.push({ to: m.to, body: (m as { text?: { body: string } }).text?.body ?? "" }); return { status: "sent", wamid: "w" } as SendResult; },
  };
  return { repo, deps, sent, a, b };
}

describe("wantsCertificate", () => {
  it.each(["quero meu certificado", "como eu peço o certificado?", "preciso emitir o certificado", "certificado", "Cadê meu certificado", "gostaria de solicitar o certificado"])("é pedido: %s", (t) => expect(wantsCertificate(t)).toBe(true));
  it.each(["o certificado vale como hora complementar?", "tenho dúvida de cálculo", "sim", "meu certificado de inglês"])("não é pedido: %s", (t) => expect(wantsCertificate(t)).toBe(false));
});

describe("handleCertificateRequest", () => {
  it("sem mentoria registrada", async () => {
    const w = await world(null);
    w.repo.audios.clear();
    expect(await handleCertificateRequest(w.a, w.deps)).toBe(CERT_TEXTS.none);
  });
  it("mentoria ainda sem decisão da equipe", async () => {
    const w = await world(null);
    expect(await handleCertificateRequest(w.a, w.deps)).toBe(CERT_TEXTS.waiting);
    expect(await w.repo.listCertificateRequests({ limit: 10 })).toHaveLength(0);
  });
  it("aprovada mas abaixo do mínimo de horas: informa e não grava", async () => {
    const w = await world(result("aprovada", conta({ pode_pedir_certificado: false, minimo_horas: 20, minutos_disponiveis: 90 })));
    expect(await handleCertificateRequest(w.a, w.deps)).toMatch(/1 h 30 min na conta.*a partir de 20 h/);
    expect(await w.repo.listCertificateRequests({ limit: 10 })).toHaveLength(0);
  });
  it("aprovada e elegível: grava o pedido, avisa a equipe e o segundo pedido não duplica", async () => {
    const w = await world(result("aprovada"));
    expect(await handleCertificateRequest(w.a, w.deps)).toBe(CERT_TEXTS.done);
    expect(await w.repo.listCertificateRequests({ limit: 10 })).toHaveLength(1);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({ to: ADMIN });
    expect(w.sent[0]!.body).toMatch(/Pedido de certificado: Ana · 1 mentoria\(s\) aprovada\(s\)/);
    expect(await handleCertificateRequest(w.a, w.deps)).toBe(CERT_TEXTS.already);
    expect(w.sent).toHaveLength(1);
  });
  it("o parceiro da mentoria (mentorado) também consegue pedir", async () => {
    const w = await world(result("aprovada"));
    // a aprovação do parceiro vem com o pessoa_id dele
    const res = w.repo.analysis.get(ID)!.result as { curadoria: { participantes: unknown[] } };
    res.curadoria.participantes.push({ pessoa_id: await hashWaId(w.b), papel: "mentorado", situacao: "aprovada", minutos_contabilizados: 35, conta: conta() });
    expect(await handleCertificateRequest(w.b, w.deps)).toBe(CERT_TEXTS.done);
  });
});

describe("pelo bot (motor de conversa)", () => {
  it("'quero meu certificado' de quem já se cadastrou recebe a resposta do pedido, sem cair no 'não entendi'", async () => {
    const { Simulator } = await import("../scripts/simulate");
    const s = new Simulator();
    const p = s.phone(1);
    await s.repo.touchUser(p, s.now());
    await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", registeredAt: s.now(), values: { full_name: "Ana" }, profileRole: "mentorado" });
    await s.repo.saveConversation(p, 0, { state: "COMPLETED", previousState: null, hintSentInState: false, optedOutAt: null });
    await s.text(p, "quero meu certificado"); s.advance(1000);
    expect((s.sentTo(p).at(-1)!.body as { text: { body: string } }).text.body).toBe(CERT_TEXTS.none);
  });
});
