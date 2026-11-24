import { describe, expect, it } from "vitest";
import { matchChoiceByWords, renderNotUnderstood } from "../src/whatsapp/choices";

const areas = [{ id: "cat_computacao", title: "Computação" }, { id: "cat_design", title: "Design/UX" }];
const dias = [{ id: "d_seg", title: "Segunda-feira" }, { id: "d_ter", title: "Terça-feira" }];

describe("escolha escrita por extenso", () => {
  it("casa sem acento e por palavra inteira", () => {
    expect(matchChoiceByWords("computacao", areas)?.id).toBe("cat_computacao");
    expect(matchChoiceByWords("segunda", dias)?.id).toBe("d_seg");
  });
  it("ambíguo ou desconhecido = null", () => {
    expect(matchChoiceByWords("feira", dias)).toBeNull();
    expect(matchChoiceByWords("banana", areas)).toBeNull();
  });
  it("mensagem de não entendi repete as opções", () => {
    expect(renderNotUnderstood(areas)).toContain("1) Computação");
  });
});

describe("linha copiada do menu", () => {
  it("'7) Terminei — Já informei todos os dias' vale a opção 7", () => {
    const opts = Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, title: `Dia ${i}` })).concat([{ id: "sch_done", title: "Terminei" }]);
    expect(matchChoiceByWords("7) Terminei — Já informei todos os dias", opts)?.id).toBe("sch_done");
  });
});
