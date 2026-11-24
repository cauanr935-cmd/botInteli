import { describe, expect, it } from "vitest";
import { parseMentoringWindow, zonedToUtc } from "../src/matching/time";

const w = (t: string) => parseMentoringWindow(t, "08:00", "20:00");
describe("horário real da mentoria", () => {
  it("lê intervalos escritos de vários jeitos", () => {
    expect(w("8h às 9h")).toEqual({ ok: true, start: "08:00", end: "09:00" });
    expect(w("das 8 às 8:30")).toEqual({ ok: true, start: "08:00", end: "08:30" });
    expect(w("das 8 às 8 e 20")).toEqual({ ok: true, start: "08:00", end: "08:20" });
    expect(w("8h às 8h20")).toEqual({ ok: true, start: "08:00", end: "08:20" });
    expect(w("14h30-15h30")).toEqual({ ok: true, start: "14:30", end: "15:30" });
    expect(w("de 2 a 3")).toEqual({ ok: true, start: "14:00", end: "15:00" });
  });
  it("início + duração", () => {
    expect(w("às 9h por 1 hora")).toEqual({ ok: true, start: "09:00", end: "10:00" });
    expect(w("9h, uns 40 minutos")).toEqual({ ok: true, start: "09:00", end: "09:40" });
  });
  it("mínimo de 20 minutos, dentro da faixa, em ordem", () => {
    expect(w("8h às 8h10")).toEqual({ ok: false, reason: "short" });
    expect(w("7h às 9h")).toMatchObject({ ok: false });
    expect(parseMentoringWindow("10h às 13h", "08:00", "12:00")).toEqual({ ok: false, reason: "outside" });
    expect(w("9h às 8h")).toEqual({ ok: false, reason: "order" });
    expect(w("banana")).toEqual({ ok: false, reason: "unparsed" });
  });
  it("converte data local em UTC (São Paulo = UTC-3)", () => {
    expect(zonedToUtc("2026-11-20", "08:30", "America/Sao_Paulo").toISOString()).toBe("2026-11-20T11:30:00.000Z");
  });
});
