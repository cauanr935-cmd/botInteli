import { it, expect } from "vitest";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { sendGuarded } from "../../../src/whatsapp/client";
import { processEvents } from "../../../src/webhook/handler";
import { hashWaId } from "../../../src/lib/hash";

const logger = { log: () => undefined };
function ctx(repo: MemoryRepo, f: typeof fetch) {
  return { repo, logger, phoneNumberId: "PN", evolutionUrl: "https://evo.test", evolutionApiKey: "k", evolutionInstance: "inst", stopAt: 2, timezone: "America/Sao_Paulo", fetchImpl: f };
}
it("tipos que o Baileys não entrega (template em qualquer grafia, mídia) nunca chegam à Evolution", async () => {
  const repo = new MemoryRepo();
  let calls = 0; const f = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
  for (const m of [{ to: "55", type: " TEMPLATE " }, { to: "55", type: "template", template: { name: "x" } }, { to: "55", type: "image" }])
    expect(await sendGuarded(m as never, ctx(repo, f))).toEqual({ status: "error", code: "unsupported_type" });
  expect(calls).toBe(0);
});
it("falha da Evolution não devolve vaga: 2 falhas esgotam o teto diário de 2", async () => {
  const repo = new MemoryRepo(); await repo.touchUser("55", new Date());
  let calls = 0; const f = (async () => { calls++; return new Response("x", { status: 500 }); }) as typeof fetch;
  const m = { to: "55", type: "text", text: { body: "a" } };
  await sendGuarded(m, ctx(repo, f)); await sendGuarded(m, ctx(repo, f));
  expect((await sendGuarded(m, ctx(repo, f))).status).toBe("blocked_budget");
  expect(calls).toBe(2);
});
it("mensagem que falha DEPOIS de responder não é liberada (sem resposta dupla)", async () => {
  const repo = new MemoryRepo(); let n = 0;
  const ev = { type: "text", wamid: "w9", from: "55", timestamp: 1, text: "oi" } as never;
  const deps = { webhookToken: "s", repo, logger, onEvent: async () => { n++; await repo.insertOutboundLog({ waIdHash: await hashWaId("55"), messageType: "text", wamid: "o1", reservedAt: new Date(Date.now() + 1000), sentOk: true, errorCode: null }); throw new Error("x"); } };
  await processEvents([ev], deps as never); await processEvents([ev], deps as never);
  expect(n).toBe(1);
});
it("mensagem que falha SEM responder é liberada uma única vez (a recuperação responde), nunca em laço", async () => {
  const repo = new MemoryRepo(); let n = 0;
  const ev = { type: "text", wamid: "w10", from: "55", timestamp: 1, text: "oi" } as never;
  const deps = { webhookToken: "s", repo, logger, onEvent: async () => { n++; throw new Error("x"); } };
  await processEvents([ev], deps as never); await processEvents([ev], deps as never); await processEvents([ev], deps as never);
  expect(n).toBe(2);
});
