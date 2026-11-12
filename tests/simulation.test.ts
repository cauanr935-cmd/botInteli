import { describe, it, expect } from "vitest";
import { runS1, runS2, runS3, runS4, runS5, runS6, runS7 } from "../scripts/simulate";

describe("C8.1 simulação ponta a ponta (scripts/simulate.ts)", () => {
  it("C8.1 S1 teto anti-flood diário: cadastros com áudio não passam do teto; zero envios depois do corte; webhook sempre 200", async () => {
    const m = await runS1();
    expect(m.stopAt).toBe(950);
    expect(m.sends).toBeLessThanOrEqual(950);
    expect(m.reserved).toBeLessThanOrEqual(950);
    expect(m.cutReached).toBe(true);
    expect(m.sendsAfterCut).toBe(0);
    expect(m.allWebhooks200).toBe(true);
    expect(m.webhooks).toBe(2000);
    expect(m.critical).toBe(1);
    expect(m.warn80).toBe(1);
  });

  it("C8.1 S2 spam: 50 pessoas x 30 'oi' = 50 envios no total", async () => {
    const m = await runS2();
    expect(m.sends).toBe(50);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S3: cadastro, áudio de apresentação, menu explícito e uso de serviço", async () => {
    const m = await runS3();
    expect(m.newPerson).toBe(10); // 7 do cadastro + menu + serviço + resposta do áudio
    expect(m.extraAudio).toBe(0); // mentoria em andamento (falta descrevê-la): outro áudio = silêncio
    expect(m.returning).toBe(1); // "oi" no dia seguinte reapresenta a pergunta pendente; o resto é silêncio
    expect(m.audiosStored).toBe(2); // perfil + o arquivo da mentoria em andamento
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S4 reentrega: todos os webhooks em dobro não geram resposta duplicada nem áudio duplicado", async () => {
    const m = await runS4();
    expect(m.webhooksDuplicated).toBe(2 * (m.webhooksSingle as number));
    expect(m.sendsDuplicated).toBe(m.sendsSingle);
    expect(m.maxPerPersonDuplicated).toBe(10);
    expect(m.audiosDuplicated).toBe(m.audiosSingle);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S5 trava manual no meio: os envios param até o unlock manual (webhook segue 200)", async () => {
    const m = await runS5();
    expect(m.sendsBeforeSignal).toBe(20);
    expect(m.sendsAfterSignalUntilUnlock).toBe(0);
    expect(m.lockedWhileOpen).toBe(true);
    expect(m.unlockStatus).toBe(200);
    expect(m.sendsAfterUnlock).toBe(1);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S6 virada do dia: teto cheio bloqueia até 23:59 de SP; à meia-noite o contador zera", async () => {
    const m = await runS6();
    expect(m.sendsWhileDayFull).toBe(0);
    expect(m.sendsLastSecondsOfDay).toBe(0);
    expect(m.sendsAfterMidnight).toBe(1);
    expect(m.dayFullReserved).toBe(950);
    expect(m.nextDayReserved).toBe(1);
    expect(m.allWebhooks200).toBe(true);
  });

  it("C8.1 S7 rajada: 100 mensagens de uma pessoa em 1 minuto geram no máximo o limite de 10 min e nunca mais que o do dia", async () => {
    const m = await runS7();
    expect(m.sends).toBeLessThanOrEqual(m.maxPer10Min as number);
    expect(m.sends).toBeLessThanOrEqual(m.maxPerDay as number);
    expect(m.sends).toBe(m.maxPer10Min);
    expect(m.allWebhooks200).toBe(true);
  });
});
