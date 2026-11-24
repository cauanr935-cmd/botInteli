import { describe, expect, it } from "vitest";
import { Simulator } from "../scripts/simulate";
import { hashWaId } from "../src/lib/hash";
import { isDoubtJoke, parseDoubtCorrection } from "../src/profile/correction";

const txt = (s: Simulator, p: string) => s.sentTo(p).map((m) => ((m.body as { text?: { body: string } }).text?.body ?? (m.body as { interactive?: { body: { text: string } } }).interactive?.body.text ?? ""));
async function person(state = "SCHED_DAYS_doubt", doubt = "teste zoeira sobre pizza") {
  const s = new Simulator();
  const p = s.phone(60);
  await s.repo.touchUser(p, s.now());
  await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "x", registeredAt: s.now(), values: { full_name: "Ana Souza" }, profileRole: "mentorado" });
  await s.repo.insertDoubt(p, { waIdHash: await hashWaId(p), text: doubt, categories: [], at: s.now() });
  await s.repo.saveConversation(p, 0, { state: state as never, previousState: null, hintSentInState: false, optedOutAt: null });
  return { s, p };
}

describe("lê a correção da dúvida", () => {
  it("as duas frases do relato e variações", () => {
    expect(parseDoubtCorrection("minha duvida nao era aquela, na realidade minh duvida é como calcular um versor")).toBe("como calcular um versor");
    expect(parseDoubtCorrection("so queria dizer que minha duvida nao era a primeira que falei , na verdade era, como calcular um versor")).toBe("como calcular um versor");
    expect(parseDoubtCorrection("na verdade minha dúvida é sobre derivadas de funções compostas")).toBe("sobre derivadas de funções compostas");
    expect(parseDoubtCorrection("minha dúvida é como funciona o produto vetorial")).toBe("como funciona o produto vetorial");
  });
  it("não confunde com horários, com negação nem com brincadeira", () => {
    for (const t of ["segunda e quarta de manhã", "sexta das 14h às 16h", "eu tava zoando kkkkk", "minha duvida nao era aquela", "3", "oi"]) expect(parseDoubtCorrection(t), t).toBeNull();
    for (const t of ["eu tava zoando kkkkk", "foi brincadeira", "digitei errado", "sem querer"]) expect(isDoubtJoke(t), t).toBe(true);
    expect(isDoubtJoke("segunda de manhã")).toBe(false);
  });
});

describe("imprevistos depois de registrar a dúvida (relato real)", () => {
  it("a conversa inteira: brincadeira, correção e segunda correção; a dúvida registrada acaba certa e a etapa não muda", async () => {
    const { s, p } = await person();
    await s.text(p, "eu tava zoando kkkkk"); s.advance(30_000);
    expect(s.repo.doubts[0]!.text).toMatch(/pizza/); // brincadeira não mexe na dúvida
    expect(txt(s, p).at(-1)).toMatch(/me mandar a certa que eu troco/);
    expect(txt(s, p).at(-1)).toMatch(/Em quais dias/); // a pergunta da etapa continua junto

    await s.text(p, "minha duvida nao era aquela, na realidade minh duvida é como calcular um versor"); s.advance(30_000);
    expect(s.repo.doubts).toHaveLength(1); // trocou, não duplicou
    expect(s.repo.doubts[0]!.text).toBe("como calcular um versor");
    expect(txt(s, p).at(-1)).toMatch(/troquei a dúvida.*como calcular um versor/s);
    expect(txt(s, p).at(-1)).not.toMatch(/escapou das minhas brânquias|resenha/);
    expect(txt(s, p).at(-1)).toMatch(/Em quais dias/);

    await s.text(p, "so queria dizer que minha duvida nao era a primeira que falei , na verdade era, como calcular um versor"); s.advance(30_000);
    expect(s.repo.doubts[0]!.text).toBe("como calcular um versor");
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_doubt");
  });

  it("dúvida nova sem marcador ('como calcular um versor?') também troca; horários continuam sendo horários", async () => {
    const { s, p } = await person();
    await s.text(p, "segunda de manhã"); s.advance(30_000);
    expect(s.repo.doubts[0]!.text).toMatch(/pizza/); // horário não troca a dúvida
    const { s: s2, p: p2 } = await person();
    await s2.text(p2, "como calcular um versor em cálculo vetorial?"); s2.advance(1000);
    expect(s2.repo.doubts[0]!.text).toMatch(/versor/);
  });

  it("dúvida já conectada a um mentor não é trocada: explica e oferece abrir uma nova", async () => {
    const { s, p } = await person();
    s.repo.doubts[0]!.status = "conectada" as never;
    await s.text(p, "na verdade minha dúvida é como calcular um versor"); s.advance(1000);
    expect(s.repo.doubts[0]!.text).toMatch(/pizza/);
    expect(txt(s, p).at(-1)).toMatch(/marcar mentoria/);
  });

  it("logo depois de concluir (COMPLETED) a correção também vale; sem dúvida aberta segue o fluxo normal", async () => {
    const { s, p } = await person("COMPLETED");
    await s.text(p, "na verdade minha dúvida é como calcular um versor"); s.advance(1000);
    expect(s.repo.doubts[0]!.text).toBe("como calcular um versor");
  });
});
