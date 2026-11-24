import { describe, expect, it } from "vitest";
import { hashWaId } from "../src/lib/hash";
import { MemoryRepo } from "../src/db/memory-repo";
import { SupabaseRepo } from "../src/db/supabase-repo";

const NOW = new Date("2026-11-16T15:00:00Z");

async function person(repo: MemoryRepo, waId: string, role: "mentor" | "mentorado", name: string) {
  await repo.touchUser(waId, NOW);
  await repo.saveRegistration(waId, {
    waIdHash: await hashWaId(waId), consentAt: NOW, termsVersion: "v1", registeredAt: NOW, values: { full_name: name }, profileRole: role,
    ...(role === "mentor" ? { mentorCategories: ["computacao"] } : {}),
  });
}

describe("matching: repositório em memória", () => {
  it("dúvida nasce 'aberta' com o wa_id e aparece na lista; só mentores aparecem em listMentors", async () => {
    const r = new MemoryRepo();
    await person(r, "5511900000001", "mentorado", "Ana Aluna");
    await person(r, "5511900000002", "mentor", "Beto Mentor");
    await r.insertDoubt("5511900000001", { waIdHash: await hashWaId("5511900000001"), text: "como funciona um rotacional?", categories: ["matematica"], at: NOW });
    const open = await r.listOpenDoubts(10);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ seq: 1, waId: "5511900000001", status: "aberta" });
    const mentors = await r.listMentors(10);
    expect(mentors.map((m) => m.name)).toEqual(["Beto Mentor"]);
    expect((await r.getMentorBySeq(mentors[0]!.seq))?.waId).toBe("5511900000002");
  });

  it("createMatch reserva a dúvida: o segundo admin não pega a mesma; cancelar reabre", async () => {
    const r = new MemoryRepo();
    await person(r, "5511900000001", "mentorado", "Ana Aluna");
    await person(r, "5511900000002", "mentor", "Beto Mentor");
    await r.insertDoubt("5511900000001", { waIdHash: await hashWaId("5511900000001"), text: "dúvida", categories: [], at: NOW });
    const d = (await r.getDoubtBySeq(1))!;
    const args = { doubtId: d.id, mentorWaId: "5511900000002", menteeWaId: d.waId, createdBy: "5511999999999", at: NOW };
    const [a, b] = await Promise.all([r.createMatch(args), r.createMatch(args)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await r.listOpenDoubts(10)).toHaveLength(0);
    const m = (await r.getActiveMatchFor("5511900000002"))!;
    expect(m).toMatchObject({ status: "aguardando_mentor", menteeWaId: "5511900000001" });
    expect((await r.getActiveMatchFor("5511900000001"))?.id).toBe(m.id);
    await r.updateMatch(m.id, { status: "aguardando_mentorado", mentorSlots: [{ day: "sex", start: "14:00", end: "16:00" }] }, NOW);
    expect((await r.getMatchBySeq(m.seq))?.mentorSlots).toHaveLength(1);
    expect(await r.cancelMatch(m.seq, NOW)).toBe(true);
    expect(await r.cancelMatch(m.seq, NOW)).toBe(false);
    expect(await r.listOpenDoubts(10)).toHaveLength(1); // reaberta
    expect(await r.getActiveMatchFor("5511900000002")).toBeNull();
  });
});

describe("matching: SupabaseRepo (fetch simulado)", () => {
  it("insertDoubt envia wa_id e status; createMatch desfaz a reserva se o insert do match falha", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("/doubts?id=eq.") && method === "PATCH" && calls.filter((c) => c.method === "PATCH").length === 1) return new Response(JSON.stringify([{ id: "x" }]), { status: 200 });
      if (url.endsWith("/rest/v1/matches")) return new Response("boom", { status: 500 });
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    const r = new SupabaseRepo("https://x.supabase.co", "k", fetchImpl);
    await r.insertDoubt("5511900000001", { waIdHash: "h", text: "t", categories: [], at: NOW });
    expect(calls[0]!.body).toMatchObject({ wa_id: "5511900000001", status: "aberta" });
    const id = "11111111-1111-1111-1111-111111111111";
    await expect(r.createMatch({ doubtId: id, mentorWaId: "a", menteeWaId: "b", createdBy: "c", at: NOW })).rejects.toThrow(/createMatch/);
    const last = calls.at(-1)!;
    expect(last).toMatchObject({ method: "PATCH", body: { status: "aberta" } }); // dúvida devolvida
    expect(await r.createMatch({ doubtId: "nao-uuid", mentorWaId: "a", menteeWaId: "b", createdBy: "c", at: NOW })).toBeNull();
  });
});
