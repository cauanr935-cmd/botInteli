// Guardrail de abertura da rede: antes da data só se cadastra; pedir mentoria só para os números liberados.
import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { closedNetworkText, isNetworkClosed, openingLabel, type NetworkGate } from "../src/conversation/network-gate";

// Números liberados (fictícios, no mesmo formato dos reais: um com 9 dígitos e outro escrito sem o 9 da frente).
const EARLY = "88999991111,85 9666-2222";
const gate: NetworkGate = { openAt: new Date("2026-11-23T00:00:00-03:00"), allow: ["88999991111", "8596662222"] };
const BEFORE = new Date("2026-11-20T12:00:00-03:00");
const AFTER = new Date("2026-11-23T00:00:00-03:00");

describe("isNetworkClosed", () => {
  it("antes da abertura: fechada para qualquer um, exceto os dois números (em qualquer forma do telefone)", () => {
    expect(isNetworkClosed(gate, "5511999990000", BEFORE)).toBe(true);
    for (const ok of ["5588999991111", "558899991111", "558596662222", "5585996662222"]) expect(isNetworkClosed(gate, ok, BEFORE), ok).toBe(false);
    expect(isNetworkClosed(gate, "5585996662223", BEFORE)).toBe(true); // um dígito diferente continua fechado
  });
  it("na abertura (segunda 00:00 de Brasília) e depois, aberta para todos; sem gate, sempre aberta", () => {
    expect(isNetworkClosed(gate, "5511999990000", AFTER)).toBe(false);
    expect(isNetworkClosed(gate, "5511999990000", new Date("2026-11-22T23:59:59-03:00"))).toBe(true);
    expect(isNetworkClosed(undefined, "5511999990000", BEFORE)).toBe(false);
  });
  it("o aviso cita a segunda-feira 23/11", () => {
    expect(openingLabel(gate.openAt, "America/Sao_Paulo")).toBe("segunda-feira (23/11)");
    expect(closedNetworkText(gate, "America/Sao_Paulo")).toMatch(/segunda-feira \(23\/11\).*ainda não dá pra pedir mentoria/s);
  });
});

const last = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};
const mk = (open = "2026-11-12T00:00:00-03:00") => new Simulator({ env: { NETWORK_OPEN_AT: open, NETWORK_EARLY_ACCESS: `${EARLY},5511900000002` } });

describe("rede fechada no bot", () => {
  it("o cadastro do mentorado conclui, mas em vez de pedir a dúvida vem o aviso; nenhuma dúvida é gravada", async () => {
    const s = mk();
    const p = s.phone(1);
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "consent_yes"); s.advance(1000);
    await s.text(p, "Maria da Silva"); s.advance(1000);
    await s.text(p, "Turma 12"); s.advance(1000);
    await s.text(p, "20"); s.advance(1000);
    await s.audio(p); s.advance(1000);
    await s.button(p, "prof_mentorado"); s.advance(1000);
    expect(last(s, p)).toMatch(/A rede da Be My Mentor abre na segunda-feira \(12\/11\)|abre na .*\(\d\d\/\d\d\)/);
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
    expect(await s.repo.listOpenDoubts(10)).toHaveLength(0);
    expect((await s.repo.getRegistration(p)).profileRole).toBe("mentorado"); // o cadastro foi salvo
  });

  it("pedir 'Marcar nova mentoria' por texto também é barrado, e a dúvida digitada depois do cadastro não é gravada", async () => {
    const s = mk();
    const p = s.phone(1);
    await s.register(p);
    s.advance(1000);
    await s.text(p, "quero marcar uma mentoria"); s.advance(1000);
    expect(last(s, p)).toMatch(/ainda não dá pra pedir mentoria/);
    await s.text(p, "preciso de ajuda com cálculo 2, derivadas parciais"); s.advance(1000);
    expect(await s.repo.listOpenDoubts(10)).toHaveLength(0);
  });

  it("número liberado pede mentoria normalmente (a dúvida é gravada)", async () => {
    const s = mk();
    const p = s.phone(2); // 5511900000002 está em NETWORK_EARLY_ACCESS
    await s.register(p);
    s.advance(1000);
    await s.text(p, "quero marcar uma mentoria"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
    await s.text(p, "preciso de ajuda com cálculo 2, derivadas parciais"); s.advance(1000);
    expect(await s.repo.listOpenDoubts(10)).toHaveLength(1);
  });

  it("depois da data de abertura todo mundo pede", async () => {
    const s = mk("2026-11-10T16:00:00Z"); // abre 1 h depois do início do simulador
    const p = s.phone(1);
    await s.register(p);
    s.advance(2 * 60 * 60 * 1000);
    await s.text(p, "quero marcar uma mentoria"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
  });

  it("mentor se cadastra normalmente na rede fechada", async () => {
    const s = mk();
    const p = s.phone(3);
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "consent_yes"); s.advance(1000);
    await s.text(p, "Beto Mentor"); s.advance(1000);
    await s.text(p, "Turma 12"); s.advance(1000);
    await s.text(p, "22"); s.advance(1000);
    await s.audio(p); s.advance(1000);
    await s.button(p, "prof_mentor"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("MENTOR_CATEGORIES");
    expect(last(s, p)).not.toMatch(/abre na/);
  });
});
