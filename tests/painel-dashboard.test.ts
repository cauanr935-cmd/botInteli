import { describe, expect, it } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { hashWaId } from "../src/lib/hash";
import { hashPassword } from "../src/mentoria/auth";
import { handlePanel, type PanelDeps } from "../src/mentoria/panel";
import { connectMatch, cancelMatchBySeq, confirmMatch } from "../src/matching/flow";

const NOW = new Date("2026-11-10T15:00:00Z");
const logger = { log: () => undefined };

async function setup(withActions = true) {
  const repo = new MemoryRepo();
  const sent: { to: string; body: string }[] = [];
  const send = async (m: { to: string; text?: { body: string }; interactive?: { body?: { text?: string } } }) => {
    sent.push({ to: m.to, body: m.text?.body ?? (m.interactive as { body: { text: string } } | undefined)?.body.text ?? "" });
    return { status: "sent" as const, wamid: null };
  };
  const people: [string, "mentor" | "mentorado", string, string[]][] = [
    ["5511900000001", "mentorado", "Ana Aluna", []],
    ["5511900000002", "mentor", "Beto Mentor", ["computacao", "matematica"]],
    ["5511900000003", "mentor", "Caio Mentor", ["design"]],
  ];
  for (const [w, role, name, cats] of people) {
    await repo.touchUser(w, NOW);
    await repo.saveRegistration(w, { waIdHash: await hashWaId(w), consentAt: NOW, termsVersion: "1", registeredAt: NOW, values: { full_name: name }, profileRole: role, ...(cats.length ? { mentorCategories: cats } : {}) });
  }
  await repo.insertDoubt("5511900000001", { waIdHash: await hashWaId("5511900000001"), text: "como funciona um rotacional?", categories: ["matematica"], at: NOW });
  const flow = () => ({ repo, send: send as never, logger, now: NOW, timezone: "America/Sao_Paulo" });
  const env = { PANEL_USER: "admin", PANEL_PASSWORD_HASH: await hashPassword("senha-forte-123"), PANEL_SESSION_SECRET: "s".repeat(40) };
  const deps: PanelDeps = {
    env, repo, bucket: undefined, now: () => NOW,
    ...(withActions ? { matching: { connect: (d, m) => connectMatch({ doubtSeq: d, mentorSeq: m }, "painel", flow()), cancel: (s) => cancelMatchBySeq(s, flow()), confirm: (p) => confirmMatch(p, flow()) } } : {}),
  };
  const res = await handlePanel(new Request("https://w.dev/painel/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "painel" }, body: JSON.stringify({ user: "admin", password: "senha-forte-123" }) }), deps);
  const cookie = res.headers.get("Set-Cookie")!.split(";")[0]!;
  const get = (path: string, c: string | null = cookie) => handlePanel(new Request(`https://w.dev${path}`, c ? { headers: { Cookie: c } } : {}), deps);
  const post = (path: string, body: unknown, headers: Record<string, string> = { "X-Requested-With": "painel" }, c: string | null = cookie) =>
    handlePanel(new Request(`https://w.dev${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers, ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(body) }), deps);
  return { repo, sent, get, post, deps };
}

describe("painel: dashboard de dúvidas, mentores por disciplina e conexões", () => {
  it("a página traz o dashboard e não usa manipuladores inline (CSP com nonce)", async () => {
    const { get } = await setup();
    const res = await get("/painel");
    const html = await res.text();
    expect(html).toContain("Dúvidas dos mentorados");
    expect(html).toContain("Mentores por disciplina");
    expect(html).toContain("Conectar a um mentor");
    expect(html).not.toMatch(/\son(click|load|error)=/i);
    expect(res.headers.get("Content-Security-Policy")).toContain("nonce-");
  });

  it("sem sessão: 401; com sessão: dúvidas, mentores com disciplina, telefones mascarados", async () => {
    const { get } = await setup();
    expect((await get("/painel/api/dashboard", null)).status).toBe(401);
    const j = (await (await get("/painel/api/dashboard")).json()) as {
      counts: { openDoubts: number; mentors: number }; doubts: { seq: number; name: string; phoneMasked: string; categories: { label: string }[] }[];
      mentors: { seq: number; name: string; categories: { key: string; label: string }[]; busy: boolean }[];
    };
    expect(j.counts).toMatchObject({ openDoubts: 1, mentors: 2 });
    expect((j.counts as unknown as { members: unknown }).members).toEqual({ mentors: 2, mentees: 1, total: 3 });
    expect(j.doubts[0]).toMatchObject({ seq: 1, name: "Ana Aluna", categories: [{ label: "Matemática" }] });
    expect(j.doubts[0]!.phoneMasked).toMatch(/^5511\*+0001$/);
    expect(j.mentors.find((m) => m.name === "Beto Mentor")!.categories.map((c) => c.label)).toEqual(["Computação", "Matemática"]);
    expect(JSON.stringify(j)).not.toContain("5511900000001"); // nenhum telefone completo
  });

  it("botão Conectar: cria o match, o bot chama o mentor e o mentor aparece como ocupado", async () => {
    const { get, post, sent, repo } = await setup();
    const r = await post("/painel/api/match", { doubtSeq: 1, mentorSeq: 2 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, matchSeq: 1 });
    expect(sent.at(-1)).toMatchObject({ to: "5511900000002" });
    expect(sent.at(-1)!.body).toMatch(/Oi, Beto!.*rotacional/s);
    expect((await repo.getConversation("5511900000002")).state).toBe("MATCH_MENTOR_ACCEPT");
    const j = (await (await get("/painel/api/dashboard")).json()) as { counts: { openDoubts: number; activeMatches: number }; mentors: { name: string; busy: boolean }[]; matches: { seq: number; mentee: string; mentor: string; status: string }[] };
    expect(j.counts).toMatchObject({ openDoubts: 0, activeMatches: 1 });
    expect(j.mentors.find((m) => m.name === "Beto Mentor")!.busy).toBe(true);
    expect(j.matches[0]).toMatchObject({ seq: 1, mentee: "Ana Aluna", mentor: "Beto Mentor", status: "aguardando_mentor" });
    // a mesma dúvida de novo: recusa com explicação
    const again = await post("/painel/api/match", { doubtSeq: 1, mentorSeq: 3 });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { message: string }).message).toMatch(/não está aberta/);
  });

  it("cancelar pelo painel reabre a dúvida", async () => {
    const { get, post, repo } = await setup();
    await post("/painel/api/match", { doubtSeq: 1, mentorSeq: 2 });
    const r = await post("/painel/api/match/cancel", { matchSeq: 1 });
    expect(r.status).toBe(200);
    expect((await repo.getMatchBySeq(1))?.status).toBe("cancelado");
    expect(((await (await get("/painel/api/dashboard")).json()) as { counts: { openDoubts: number } }).counts.openDoubts).toBe(1);
  });

  it("confirmar pelo painel grava o horário e avisa mentor e mentorado", async () => {
    const { post, repo, sent } = await setup();
    await post("/painel/api/match", { doubtSeq: 1, mentorSeq: 2 });
    sent.length = 0;
    expect((await post("/painel/api/match/confirm", { matchSeq: 1, day: "segunda", start: "20:00", end: "18:00" })).status).toBe(400);
    expect((await post("/painel/api/match/confirm", { matchSeq: 1, day: "funday", start: "18:00", end: "20:00" })).status).toBe(400);
    const r = await post("/painel/api/match/confirm", { matchSeq: 1, day: "segunda", start: "18:00", end: "20:00", location: "" });
    expect(r.status).toBe(200);
    expect(await repo.getMatchBySeq(1)).toMatchObject({ status: "confirmado", chosenDay: "segunda", chosenStart: "18:00", chosenEnd: "20:00" });
    expect(sent.map((m) => m.to).sort()).toEqual(["5511900000001", "5511900000002"]);
    expect(sent.every((m) => /Mentoria confirmada[\s\S]*18h às 20h/.test(m.body))).toBe(true);
  });

  it("proteções: sem cabeçalho anti-CSRF 400, sem sessão 401, corpo inválido 400, sem envio configurado 503", async () => {
    const a = await setup();
    expect((await a.post("/painel/api/match", { doubtSeq: 1, mentorSeq: 2 }, {})).status).toBe(400);
    expect((await a.post("/painel/api/match", { doubtSeq: 1, mentorSeq: 2 }, { "X-Requested-With": "painel" }, null)).status).toBe(401);
    expect((await a.post("/painel/api/match", { doubtSeq: "1; drop", mentorSeq: 2 })).status).toBe(400);
    expect((await a.post("/painel/api/match", { doubtSeq: -1, mentorSeq: 2 })).status).toBe(400);
    expect((await a.post("/painel/api/match/cancel", {})).status).toBe(400);
    expect(await a.repo.listOpenDoubts(10)).toHaveLength(1); // nada foi criado
    const b = await setup(false);
    expect((await b.post("/painel/api/match", { doubtSeq: 1, mentorSeq: 2 })).status).toBe(503);
  });

  it("match criado pelo painel avisa os admins do WhatsApp quando o mentor termina a grade", async () => {
    const { repo, sent } = await setup();
    const flow = { repo, send: (async (m: { to: string; text?: { body: string } }) => { sent.push({ to: m.to, body: m.text?.body ?? "" }); return { status: "sent" as const, wamid: null }; }) as never, logger, now: NOW, timezone: "America/Sao_Paulo", adminWaIds: ["5511900000099"] };
    const r = await connectMatch({ doubtSeq: 1, mentorSeq: 2 }, "painel", flow);
    expect(r.ok).toBe(true);
    const { onMentorSlotsDone } = await import("../src/matching/flow");
    const m = (await repo.getMatchBySeq(1))!;
    await onMentorSlotsDone(m, [{ day: "sexta", start: "14:00", end: "16:00" }], flow);
    expect(sent.some((s) => s.to === "5511900000099" && /o mentor mandou os horários/.test(s.body))).toBe(true);
    expect(sent.some((s) => s.to === "painel")).toBe(false);
  });
});

describe("painel aberto (PANEL_OPEN=true): sem login", () => {
  it("abre direto o dashboard, sem cookie; as ações continuam exigindo o cabeçalho anti-CSRF", async () => {
    const { deps, repo } = await setup();
    const open: PanelDeps = { ...deps, env: { PANEL_OPEN: "true" } };
    const page = await handlePanel(new Request("https://w.dev/painel"), open);
    const html = await page.text();
    expect(html).toContain("Mentores por disciplina");
    expect(html).not.toContain("Entrar");
    expect(html).not.toContain('id="out"'); // sem botão Sair
    expect((await handlePanel(new Request("https://w.dev/painel/api/dashboard"), open)).status).toBe(200);
    const post = (headers: Record<string, string>) => handlePanel(new Request("https://w.dev/painel/api/match", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ doubtSeq: 1, mentorSeq: 2 }) }), open);
    expect((await post({})).status).toBe(400);
    expect((await post({ "X-Requested-With": "painel" })).status).toBe(200);
    expect((await repo.getMatchBySeq(1))?.status).toBe("aguardando_mentor");
  });
  it("sem PANEL_OPEN e sem configuração continua 503 (nunca abre por engano)", async () => {
    const { deps } = await setup();
    expect((await handlePanel(new Request("https://w.dev/painel"), { ...deps, env: {} })).status).toBe(503);
  });
});
