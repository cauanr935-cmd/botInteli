import { it, expect } from "vitest";
import { MemoryRepo } from "../../../src/db/memory-repo";
import { handleStatusEvent } from "../../../src/budget/status";
import { processEvents } from "../../../src/webhook/handler";

it("falha transitória ao ligar a trava não pode perder o sinal billable (reenvio da Meta deve religar)", async () => {
  const repo = new MemoryRepo();
  const logger = { log: () => undefined };
  const real = repo.setManualLock.bind(repo);
  let fail = true;
  repo.setManualLock = async (p, r) => { if (fail) throw new Error("db blip"); return real(p, r); };
  const ev = { type: "status", id: "w1", status: "sent", recipientId: "5511", pricing: { billable: true, type: "regular", category: "marketing" } } as never;
  const deps = { appSecret: "s", verifyToken: "v", repo, logger, onEvent: async (e: never) => { await handleStatusEvent(e, { repo, logger, phoneNumberId: "PN" }); } };
  await processEvents([ev], deps as never);
  fail = false;
  await processEvents([ev], deps as never); // Meta reenvia
  expect((await repo.getManualLock("PN")).locked).toBe(true);
});
