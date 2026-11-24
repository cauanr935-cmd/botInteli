import { describe, it, expect } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { createLogger } from "../src/lib/logger";
import { recoverMissed } from "../src/webhook/recovery";
import { processEvents } from "../src/webhook/handler";
import { fetchRecentInbound } from "../src/whatsapp/evolutionClient";
import type { WebhookEvent } from "../src/whatsapp/types";

const NOW = new Date("2026-11-20T15:00:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const rec = (id: string, ageMin: number, text = "oi") => ({
  key: { remoteJid: "5511999990000@s.whatsapp.net", fromMe: false, id },
  message: { conversation: text }, messageTimestamp: sec(NOW) - ageMin * 60,
});
const logger = createLogger();

describe("recuperação de mensagens perdidas", () => {
  it("responde só o que o bot nunca viu, em ordem, e não repete na rodada seguinte", async () => {
    const repo = new MemoryRepo();
    await repo.claimMessage("JA_VISTA", NOW); // essa chegou pelo webhook
    const got: string[] = [];
    const deps = {
      repo, logger, now: () => NOW,
      onEvent: async (e: WebhookEvent) => { got.push(e.wamid); },
      fetchRecent: async () => ({ event: "messages.upsert", data: [rec("B", 20), rec("JA_VISTA", 30), rec("A", 40)] }),
    };
    expect(await recoverMissed(deps)).toBe(2);
    expect(got).toEqual(["A", "B"]);
    expect(await recoverMissed(deps)).toBe(0);
    expect(got).toEqual(["A", "B"]);
  });

  it("mensagem recém-chegada (ainda a caminho pelo webhook) espera; mensagem do bot (fromMe) é ignorada", async () => {
    const repo = new MemoryRepo();
    const got: string[] = [];
    const mine = { ...rec("MINHA", 20), key: { remoteJid: "5511999990000@s.whatsapp.net", fromMe: true, id: "MINHA" } };
    const n = await recoverMissed({
      repo, logger, now: () => NOW, onEvent: async (e) => { got.push(e.wamid); },
      fetchRecent: async () => ({ event: "messages.upsert", data: [{ ...rec("NOVA", 0) }, mine] }),
    });
    expect(n).toBe(0);
    expect(got).toEqual([]);
  });

  it("falha no meio do processamento: libera a mensagem UMA vez e a recuperação responde", async () => {
    const repo = new MemoryRepo();
    let calls = 0;
    const onEvent = async () => { calls++; if (calls === 1) throw new Error("banco fora"); };
    const ev: WebhookEvent = { wamid: "X1", from: "5511999990000", timestamp: sec(NOW) - 600, type: "text", body: "oi" } as WebhookEvent;
    await processEvents([ev], { webhookToken: "", repo, logger, onEvent, now: () => NOW });
    expect(calls).toBe(1);
    expect(await repo.unseenMessageKeys(["X1"])).toEqual(["X1"]); // liberada
    await recoverMissed({ repo, logger, now: () => NOW, onEvent, fetchRecent: async () => ({ event: "messages.upsert", data: [rec("X1", 10)] }) });
    expect(calls).toBe(2);
    // falhou de novo? não libera outra vez (nada de repetir sem fim)
    const bad = async () => { throw new Error("de novo"); };
    await processEvents([{ ...ev, wamid: "X2" }], { webhookToken: "", repo, logger, onEvent: bad, now: () => NOW });
    await processEvents([{ ...ev, wamid: "X2" }], { webhookToken: "", repo, logger, onEvent: bad, now: () => NOW });
    expect(await repo.unseenMessageKeys(["X2"])).toEqual([]);
  });

  it("fetchRecentInbound entende as formas de resposta da Evolution e nunca lança", async () => {
    const evo = { url: "https://e.example", apiKey: "k", instance: "i" };
    const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const since = sec(NOW) - 3600;
    for (const body of [{ messages: { records: [rec("A", 5)] } }, [rec("A", 5)], { messages: [rec("A", 5)] }, { records: [rec("A", 5)] }]) {
      const out = (await fetchRecentInbound(evo, since, 50, ok(body))) as { data: unknown[] };
      expect(out.data).toHaveLength(1);
    }
    const old = (await fetchRecentInbound(evo, since, 50, ok([rec("OLD", 600)]))) as { data: unknown[] };
    expect(old.data).toHaveLength(0);
    const boom = (await fetchRecentInbound(evo, since, 50, (async () => { throw new Error("rede"); }) as unknown as typeof fetch)) as { data: unknown[] };
    expect(boom.data).toEqual([]);
    const http500 = (await fetchRecentInbound(evo, since, 50, (async () => new Response("x", { status: 500 })) as unknown as typeof fetch)) as { data: unknown[] };
    expect(http500.data).toEqual([]);
  });
});
