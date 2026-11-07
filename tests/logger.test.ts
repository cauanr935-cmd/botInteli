import { describe, it, expect } from "vitest";
import { maskPhone, createLogger } from "../src/lib/logger";

describe("logger", () => {
  it("C0.5 mascara telefone", () => {
    expect(maskPhone("5511987651234")).toBe("5511*****1234");
    expect(maskPhone("+55 11 98765-1234")).toBe("5511*****1234");
    expect(maskPhone("1234")).toBe("****");
  });

  it("C0.5 logger emite JSON com nível", () => {
    const lines: string[] = [];
    const l = createLogger((s) => lines.push(s));
    for (const lv of ["debug", "info", "warn", "error", "critical"] as const) l.log(lv, "ev", { a: 1 });
    expect(lines.map((x) => JSON.parse(x).level)).toEqual(["debug", "info", "warn", "error", "critical"]);
  });
});
