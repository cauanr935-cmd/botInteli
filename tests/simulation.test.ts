import { describe, it, expect } from "vitest";
import { runS1, runS2, runS3, runS4, runS5, runS6, runS7 } from "../scripts/simulate";

describe("C8.1 simulação ponta a ponta (scripts/simulate.ts)", () => {
  it("C8.1 S1 estouro de orçamento: 300 pessoas novas (cadastro + áudio) não passam de stop_at; zero envios depois do corte; webhook sempre 200", async () => {
    const m = await runS1();
    expect(m.stopAt).toBe(950);
    expect(m.sends).toBeLessThanOrEqual(950);
    expect(m.reserved).toBeLessThanOrEqual(950);
    expect(m.cutReached).toBe(true);
    expect(m.sendsAfterCut).toBe(0);
    expect(m.allWebhooks200).toBe(true);
    expect(m.webhooks).toBe(1200);
    expect(m.critical).toBe(1);
    expect(m.warn80).toBe(1);
  });

  it("C8.1 S2 spam: 50 pessoas x 30 'oi' = 50 envios no total", async () => {
    const m = await runS2();
    expect(m.sends).toBe(50);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S3 economia: pessoa nova com Flow + áudio = 4; áudio extra = 1; cadastrada voltando = 3", async () => {
    const m = await runS3();
    expect(m.newPerson).toBe(4);
    expect(m.extraAudio).toBe(1);
    expect(m.returning).toBe(3);
    expect(m.audiosStored).toBe(3);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S4 reentrega: todos os webhooks em dobro não geram resposta duplicada nem áudio duplicado", async () => {
    const m = await runS4();
    expect(m.webhooksDuplicated).toBe(2 * (m.webhooksSingle as number));
    expect(m.sendsDuplicated).toBe(m.sendsSingle);
    expect(m.maxPerPersonDuplicated).toBe(4);
    expect(m.audiosDuplicated).toBe(m.audiosSingle);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S5 sinal de cobrança: billable:true no meio trava os envios até o unlock manual", async () => {
    const m = await runS5();
    expect(m.sendsBeforeSignal).toBe(20);
    expect(m.sendsAfterSignalUntilUnlock).toBe(0);
    expect(m.lockedWhileOpen).toBe(true);
    expect(m.unlockStatus).toBe(200);
    expect(m.sendsAfterUnlock).toBe(1);
    expect(m.critical).toBeGreaterThanOrEqual(1);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S6 virada do mês: novembro cheio bloqueia até 23:59 de SP; à meia-noite do dia 1 o contador zera", async () => {
    const m = await runS6();
    expect(m.sendsWhileNovemberFull).toBe(0);
    expect(m.sendsLastSecondsNovember).toBe(0);
    expect(m.sendsAfterMidnight).toBe(1);
    expect(m.novemberReserved).toBe(950);
    expect(m.decemberReserved).toBe(1);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S7 rajada: 100 mensagens de uma pessoa em 1 minuto geram no máximo 4 envios (10 min) e nunca mais que 12 (dia)", async () => {
    const m = await runS7();
    expect(m.sends).toBeLessThanOrEqual(m.maxPer10Min as number);
    expect(m.sends).toBeLessThanOrEqual(m.maxPerDay as number);
    expect(m.sends).toBe(4);
    expect(m.allWebhooks200).toBe(true);
  });
});
