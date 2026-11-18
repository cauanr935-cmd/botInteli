import { describe, expect, it } from "vitest";
import { configurePessoaIdSecret, hashWaId, hasPessoaIdSecret } from "../src/lib/hash";
import { audioKey } from "../src/audio/storage";
import { handleApi } from "../src/mentoria/api";
import { MemoryRepo } from "../src/db/memory-repo";

const TEST_SECRET = "segredo-de-teste-pessoa-id-0123456789abcdef";
const PHONE = "5511987654321";

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("pessoa_id = HMAC-SHA256(telefone, PESSOA_ID_SECRET)", () => {
  it("é estável, tem 64 hex e NÃO é o SHA-256 puro do telefone (que se reverte por força bruta)", async () => {
    const a = await hashWaId(PHONE);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashWaId(PHONE)).toBe(a);
    expect(a).not.toBe(await sha256Hex(PHONE));
    expect(await hashWaId("5511987654322")).not.toBe(a);
  });

  it("outro segredo gera outro id; o segredo antigo volta ao id original", async () => {
    const a = await hashWaId(PHONE);
    try {
      configurePessoaIdSecret("outro-segredo-com-mais-de-trinta-e-dois-caracteres");
      expect(await hashWaId(PHONE)).not.toBe(a);
    } finally {
      configurePessoaIdSecret(TEST_SECRET);
    }
    expect(await hashWaId(PHONE)).toBe(a);
  });

  it("falha fechada: sem segredo ou com segredo curto, não calcula nada", async () => {
    try {
      configurePessoaIdSecret(undefined);
      expect(hasPessoaIdSecret()).toBe(false);
      await expect(hashWaId(PHONE)).rejects.toThrow(/PESSOA_ID_SECRET/);
      configurePessoaIdSecret("curto");
      await expect(hashWaId(PHONE)).rejects.toThrow(/PESSOA_ID_SECRET/);
    } finally {
      configurePessoaIdSecret(TEST_SECRET);
    }
  });

  it("o caminho do R2 usa o pessoa_id e a pasta, nunca o telefone", async () => {
    const id = await hashWaId(PHONE);
    const at = new Date("2026-11-10T15:00:00Z");
    expect(audioKey(id, at, "America/Sao_Paulo", "u1", "audio/ogg", "informacoes")).toBe(`audios/informacoes/${id}/2026-11/u1.ogg`);
    expect(audioKey(id, at, "America/Sao_Paulo", "u1", "audio/ogg")).not.toContain(PHONE);
  });

  it("a API devolve o formato exato do contrato (seção 2), sem telefone nem wa_id", async () => {
    const A = "5511987654321", B = "5511900000002";
    const reg = await hashWaId(A), par = await hashWaId(B);
    const T = new Date("2026-11-12T15:00:00Z"), C = new Date("2026-11-12T16:00:00Z");
    const ID = "22222222-2222-2222-2222-222222222222";
    const repo = new MemoryRepo();
    repo.registrations.set(A, { consentAt: T, termsVersion: "v3", registeredAt: T, values: { full_name: "Ana Mentora" }, waIdHash: reg } as never);
    repo.registrations.set(B, { consentAt: C, termsVersion: "v3", registeredAt: C, values: { full_name: "Beto Mentorado" }, waIdHash: par } as never);
    repo.audios.set(ID, {
      id: ID, waIdHash: reg, r2Key: "audios/mentorias/x/a.m4a", mime: "audio/mp4", bytes: 41234567, serviceId: "mentoria",
      mentoria: { role: "mentor", subject: "Estruturas de dados no mercado", partner: "Beto Mentorado" }, ocorreuEm: "2026-11-12",
      partnerWaIdHash: par, partnerConfirmedAt: C, audioSha256: "ab".repeat(32), status: "done", result: null, createdAt: T, finishedAt: T,
    });
    const KEY = "k".repeat(40);
    const d = { apiKey: KEY, repo, bucket: undefined, people: repo };
    const h = { Authorization: `Bearer ${KEY}` };
    const one = await handleApi(new Request(`https://w.dev/api/v1/mentorias/${ID}`, { headers: h }), d);
    const list = await handleApi(new Request("https://w.dev/api/v1/mentorias?status=pending", { headers: h }), d);
    const expected = {
      id: ID, mime: "audio/mp4", bytes: 41234567, created_at: T.toISOString(), analysis_pending: true,
      role: "mentor", subject: "Estruturas de dados no mercado", partner: "Beto Mentorado",
      ocorreu_em: "2026-11-12", assunto: "Estruturas de dados no mercado", audio_sha256: "ab".repeat(32),
      registrante: { pessoa_id: reg, nome: "Ana Mentora", papel: "mentor", consentimento: { em: T.toISOString(), termos: "v3" }, instituicao: null },
      parceiro: { pessoa_id: par, nome: "Beto Mentorado", papel: "mentorado", consentimento: { em: C.toISOString(), termos: "v3" }, instituicao: null, confirmado_em: C.toISOString() },
      audio_url: `/api/v1/mentorias/${ID}/audio`,
    };
    const oneJson = await one.json();
    expect(oneJson).toEqual(expected);
    const listText = await list.text();
    expect((JSON.parse(listText) as { items: unknown[] }).items).toEqual([expected]);
    for (const text of [JSON.stringify(oneJson), listText]) {
      expect(text).not.toContain(A);
      expect(text).not.toContain(B);
      expect(text).not.toMatch(/wa_id|5511/);
    }
  });

  it("sem parceiro e sem cadastro: registrante/parceiro continuam no JSON, com null (nunca omitidos)", async () => {
    const reg = await hashWaId(PHONE);
    const ID = "33333333-3333-3333-3333-333333333333";
    const repo = new MemoryRepo();
    repo.audios.set(ID, {
      id: ID, waIdHash: reg, r2Key: "k", mime: "audio/ogg", bytes: 5, serviceId: "mentoria",
      mentoria: { subject: "Carreira" }, status: "done", result: null, createdAt: new Date("2026-11-10T15:00:00Z"), finishedAt: null,
    });
    const KEY = "k".repeat(40);
    const res = await handleApi(new Request(`https://w.dev/api/v1/mentorias/${ID}`, { headers: { Authorization: `Bearer ${KEY}` } }), { apiKey: KEY, repo, bucket: undefined, people: repo });
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.registrante).toEqual({ pessoa_id: reg, nome: null, papel: null, consentimento: { em: null, termos: null }, instituicao: null });
    expect(j.parceiro).toEqual({ pessoa_id: null, nome: null, papel: null, consentimento: { em: null, termos: null }, instituicao: null, confirmado_em: null });
    expect(j.ocorreu_em).toBeNull();
    expect(j.audio_sha256).toBeNull();
  });
});
