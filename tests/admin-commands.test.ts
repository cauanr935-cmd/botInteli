import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { parseConfirmArgs } from "../src/matching/flow";
import { isAdmin, parseAdminCommand, parseAdminIds, renderDoubts, renderMentors } from "../src/matching/admin";
import { loadConfig } from "../src/config";

const body = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string } };
  return b.text?.body ?? "";
};

describe("admin do matching: autorização e leitura do comando", () => {
  it("ADMIN_WA_IDS aceita +, espaços e vírgulas; lixo é recusado", () => {
    expect(parseAdminIds("+55 11 99999-0000, 5511988887777")).toEqual(["5511999990000", "5511988887777"]);
    expect(parseAdminIds("")).toEqual([]);
    expect(parseAdminIds("abc")).toBeNull();
    expect(parseAdminIds("123")).toBeNull();
  });
  it("isAdmin vale com e sem o 9º dígito; vazio = ninguém", () => {
    expect(isAdmin("5511999990000", ["5511999990000"])).toBe(true);
    expect(isAdmin("551199990000", ["5511999990000"])).toBe(true);
    expect(isAdmin("5511999990001", ["5511999990000"])).toBe(false);
    expect(isAdmin("5511999990000", [])).toBe(false);
  });
  it("comandos: /duvidas, /mentores; outro '/x' vira ajuda; sem '/' = conversa normal", () => {
    expect(parseAdminCommand("/dúvidas")).toEqual({ kind: "duvidas" });
    expect(parseAdminCommand(" /Mentores ")).toEqual({ kind: "mentores" });
    expect(parseAdminCommand("/qualquer")).toEqual({ kind: "ajuda" });
    expect(parseAdminCommand("oi")).toBeNull();
  });
  it("config rejeita ADMIN_WA_IDS inválido", () => {
    const base = {
      EVOLUTION_URL: "https://e", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "i", EVOLUTION_WEBHOOK_TOKEN: "x".repeat(16),
      SUPABASE_URL: "https://s", SUPABASE_SERVICE_KEY: "k", ADMIN_TOKEN: "a", PRIVACY_POLICY_URL: "https://p", TERMS_VERSION: "1",
    };
    expect(loadConfig({ ...base, ADMIN_WA_IDS: "+5511999990000" }).adminWaIds).toEqual(["5511999990000"]);
    expect(() => loadConfig({ ...base, ADMIN_WA_IDS: "xx" })).toThrow(/ADMIN_WA_IDS/);
  });
  it("textos: dúvida mascara o telefone e corta o texto; lista vazia tem mensagem", () => {
    const now = new Date("2026-11-16T15:00:00Z");
    const d = { id: "i", seq: 12, waId: "5511900000001", text: "x".repeat(300), categories: ["matematica"], status: "aberta" as const, createdAt: new Date(now.getTime() - 3 * 3600_000) };
    const out = renderDoubts([{ d, name: "Ana" }], now);
    expect(out).toMatch(/\*D12\* · Ana \(5511\*+0001\) · há 3 h \[Matemática\]/);
    expect(out.length).toBeLessThan(400);
    expect(renderDoubts([], now)).toMatch(/Nenhuma/);
    expect(renderMentors([])).toMatch(/Nenhum/);
  });
});

describe("admin do matching: no WhatsApp (simulador)", () => {
  async function setup() {
    const s = new Simulator({ env: { ADMIN_WA_IDS: "+5511900000099" } });
    const admin = s.phone(99);
    const mentorado = s.phone(1);
    const mentor = s.phone(2);
    for (const [p, role, name] of [[mentorado, "mentorado", "Ana Aluna"], [mentor, "mentor", "Beto Mentor"]] as const) {
      await s.repo.touchUser(p, s.now());
      await s.repo.saveRegistration(p, {
        waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", registeredAt: s.now(), values: { full_name: name }, profileRole: role,
        ...(role === "mentor" ? { mentorCategories: ["computacao", "design"] } : {}),
      });
    }
    await s.repo.insertDoubt(mentorado, { waIdHash: await hashWaId(mentorado), text: "como funciona um rotacional?", categories: ["matematica"], at: s.now() });
    return { s, admin, mentorado, mentor };
  }

  it("admin recebe a lista de dúvidas e de mentores; o estado da conversa não muda", async () => {
    const { s, admin } = await setup();
    await s.text(admin, "/duvidas"); s.advance(1000);
    expect(body(s, admin)).toMatch(/\*D1\* · Ana Aluna .*\[Matemática\]\ncomo funciona um rotacional\?/);
    await s.text(admin, "/mentores"); s.advance(1000);
    expect(body(s, admin)).toMatch(/\*M2\* · Beto Mentor[\s\S]*Computação, Design/);
    await s.text(admin, "/ajuda"); s.advance(1000);
    expect(body(s, admin)).toMatch(/Comandos de admin/);
    expect((await s.repo.getConversation(admin)).state).toBe("NEW");
  });

  it("quem não é admin que manda /duvidas não recebe a lista (nem vaza dado)", async () => {
    const { s, mentorado } = await setup();
    await s.text(mentorado, "/duvidas"); s.advance(1000);
    const all = s.sentTo(mentorado).map((m) => JSON.stringify(m.body)).join("");
    expect(all).not.toMatch(/Dúvidas abertas|rotacional|Mentores \(/);
  });
});

describe("/confirmar: leitura dos argumentos", () => {
  it("aceita formatos naturais de dia e horário", () => {
    expect(parseConfirmArgs("5 segunda 18-20")).toMatchObject({ seq: 5, day: "segunda", start: "18:00", end: "20:00", location: "A combinar com a coordenação" });
    expect(parseConfirmArgs("#5 Segunda-feira das 18h às 20h")).toMatchObject({ seq: 5, day: "segunda", start: "18:00", end: "20:00" });
    expect(parseConfirmArgs("7 sábado 9:30 a 11 biblioteca")).toMatchObject({ seq: 7, day: "sabado", start: "09:30", end: "11:00", location: "Biblioteca" });
  });
  it("recusa formato inválido ou horário invertido", () => {
    expect(parseConfirmArgs("5 segunda")).toBeNull();
    expect(parseConfirmArgs("5 segunda 20-18")).toBeNull();
    expect(parseConfirmArgs("5 funday 18-20")).toBeNull();
  });
});

describe("/confirmar: no WhatsApp (simulador)", () => {
  it("fecha o horário, avisa mentor e mentorado e tira os dois do fluxo", async () => {
    const s = new Simulator({ env: { ADMIN_WA_IDS: "+5511900000099" } });
    const [admin, mentorado, mentor] = [s.phone(99), s.phone(1), s.phone(2)];
    for (const [p, role, name] of [[mentorado, "mentorado", "Ana Aluna"], [mentor, "mentor", "Beto Mentor"]] as const) {
      await s.repo.touchUser(p, s.now());
      await s.repo.saveRegistration(p, {
        waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", registeredAt: s.now(), values: { full_name: name }, profileRole: role,
        ...(role === "mentor" ? { mentorCategories: ["computacao"] } : {}),
      });
    }
    await s.repo.insertDoubt(mentorado, { waIdHash: await hashWaId(mentorado), text: "duvida", categories: ["computacao"], at: s.now() });
    await s.text(admin, "/match D1 M2"); s.advance(1000);
    await s.text(admin, "/confirmar 1 segunda 18-20"); s.advance(1000);
    expect(body(s, admin)).toMatch(/Match #1 confirmado[\s\S]*mentor: avisado[\s\S]*mentorado: avisado/);
    for (const p of [mentor, mentorado]) expect(body(s, p)).toMatch(/Mentoria confirmada[\s\S]*18h às 20h/);
    expect((await s.repo.getConversation(mentor)).state).toBe("COMPLETED");
    const match = await s.repo.getMatchBySeq(1);
    expect(match).toMatchObject({ status: "confirmado", chosenDay: "segunda", chosenStart: "18:00", chosenEnd: "20:00" });
    expect(match?.scheduledAt).toBeInstanceOf(Date);
    await s.text(admin, "/confirmar 99 segunda 18-20"); s.advance(1000);
    expect(body(s, admin)).toMatch(/Não achei o match #99/);
  });
});
