import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "../src/db/memory-repo";
import { sendGuarded, type OutboundMessage, type SendContext } from "../src/whatsapp/client";
import { buildButtons, buildList } from "../src/whatsapp/builders";
import { hashWaId } from "../src/lib/hash";
import type { Logger, LogLevel } from "../src/lib/logger";

const NOW = new Date("2026-11-10T15:00:00Z");
const WA = "5511987651234";
const DAY = "2026-11-10";

function setup(opts: { stopAt?: number; evoOk?: boolean; native?: boolean } = {}) {
  const repo = new MemoryRepo();
  const logs: { level: LogLevel; event: string; fields?: Record<string, unknown> }[] = [];
  const logger: Logger = { log: (level, event, fields) => { logs.push({ level, event, fields }); } };
  const evo = vi.fn(async () =>
    opts.evoOk === false
      ? new Response(JSON.stringify({ response: { message: ["falhou 5511987651234"] } }), { status: 400 })
      : new Response(JSON.stringify({ key: { id: "3EB0OUT" } }), { status: 201 }),
  );
  const ctx: SendContext = {
    repo, logger, phoneNumberId: "inst", evolutionUrl: "https://evo.test", evolutionApiKey: "KEY", evolutionInstance: "inst",
    ...(opts.native ? { evolutionNativeInteractive: true } : {}),
    stopAt: opts.stopAt ?? 0, timezone: "America/Sao_Paulo",
    fetchImpl: evo as unknown as typeof fetch, now: () => NOW,
  };
  repo.users.set(WA, new Date(NOW.getTime() - 5 * 60_000)); // a pessoa já escreveu ao bot
  return { repo, logs, evo, ctx };
}
const text = (body = "oi"): OutboundMessage => ({ to: WA, type: "text", text: { body } });
const buttons = (): OutboundMessage => ({ to: WA, ...buildButtons("Quer continuar?", [{ id: "yes", title: "Sim" }, { id: "no", title: "Não" }]) });
const list = (): OutboundMessage => ({ to: WA, ...buildList("Escolha", "Ver", "Serviços", [{ id: "s1", title: "Mentoria", description: "Áudio" }, { id: "s2", title: "Dúvidas" }]) });
const budgetOf = (repo: MemoryRepo) => [...repo.budgets.values()][0];
const call = (evo: ReturnType<typeof setup>["evo"], i = 0) => {
  const [url, init] = evo.mock.calls[i] as unknown as [string, RequestInit];
  return { url, headers: new Headers(init.headers), body: JSON.parse(init.body as string) as Record<string, unknown> };
};

describe("sendGuarded (Evolution)", () => {
  it("envio feliz: POST sendText com apikey, id vira wamid e outbound_log é gravado; sem anti-flood não reserva", async () => {
    const { repo, evo, ctx } = setup();
    expect(await sendGuarded(text(), ctx)).toEqual({ status: "sent", wamid: "3EB0OUT" });
    expect(evo).toHaveBeenCalledTimes(1);
    const c = call(evo);
    expect(c.url).toBe("https://evo.test/message/sendText/inst");
    expect(c.headers.get("apikey")).toBe("KEY");
    expect(c.body).toEqual({ number: WA, text: "oi" });
    expect(repo.budgets.size).toBe(0);
    expect(repo.outbound[0]).toMatchObject({ sentOk: true, wamid: "3EB0OUT", messageType: "text" });
    expect(repo.outbound[0]!.waIdHash).not.toContain(WA);
  });

  it("não existe janela de 24h: quem escreveu há 30 dias ainda recebe resposta", async () => {
    const { repo, evo, ctx } = setup();
    repo.users.set(WA, new Date(NOW.getTime() - 30 * 24 * 3_600_000));
    expect((await sendGuarded(text(), ctx)).status).toBe("sent");
    expect(evo).toHaveBeenCalledTimes(1);
  });

  it("anti-ban: nunca escreve para quem nunca escreveu ao bot (sem chamar a Evolution nem gastar vaga)", async () => {
    const { repo, evo, ctx } = setup({ stopAt: 100 });
    repo.users.clear();
    expect(await sendGuarded(text(), ctx)).toEqual({ status: "blocked_unknown_contact" });
    expect(evo).not.toHaveBeenCalled();
    expect(repo.budgets.size).toBe(0);
  });

  it("tipo que o Baileys não entrega (template, Flow) vira erro unsupported_type, sem chamar a Evolution", async () => {
    const { evo, ctx } = setup();
    for (const m of [
      { to: WA, type: "template", template: { name: "x" } },
      { to: WA, type: "interactive", interactive: { type: "flow", body: { text: "x" }, action: {} } },
    ] as OutboundMessage[]) {
      expect(await sendGuarded(m, ctx)).toEqual({ status: "error", code: "unsupported_type" });
    }
    expect(evo).not.toHaveBeenCalled();
  });

  it("trava manual bloqueia sem chamar a Evolution", async () => {
    const { repo, evo, ctx } = setup();
    await repo.setManualLock("inst", "teste");
    expect((await sendGuarded(text(), ctx)).status).toBe("blocked_manual_lock");
    expect(evo).not.toHaveBeenCalled();
  });

  it("fail closed: banco fora na trava, no contato ou na reserva = não envia e não lança", async () => {
    const a = setup();
    a.repo.getManualLock = async () => { throw new Error("db fora"); };
    expect(await sendGuarded(text(), a.ctx)).toEqual({ status: "error", code: "lock_lookup_failed" });
    const c = setup();
    c.repo.getLastUserMessageAt = async () => { throw new Error("db fora"); };
    expect(await sendGuarded(text(), c.ctx)).toEqual({ status: "error", code: "contact_lookup_failed" });
    expect(c.evo).not.toHaveBeenCalled();
    const b = setup({ stopAt: 100 });
    b.repo.reserveSlot = async () => { throw new Error("db fora"); };
    expect(await sendGuarded(text(), b.ctx)).toEqual({ status: "error", code: "reserve_failed" });
    expect(a.evo).not.toHaveBeenCalled();
    expect(b.evo).not.toHaveBeenCalled();
  });

  it("erro HTTP da Evolution: registra a falha, mascara números no log e devolve error", async () => {
    const { repo, logs, ctx } = setup({ evoOk: false });
    expect(await sendGuarded(text(), ctx)).toEqual({ status: "error", code: "http_400" });
    expect(repo.outbound[0]).toMatchObject({ sentOk: false, errorCode: "http_400" });
    expect(JSON.stringify(logs)).not.toContain(WA);
  });

  it("falha de rede não lança", async () => {
    const { ctx } = setup();
    ctx.fetchImpl = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await sendGuarded(text(), ctx)).toEqual({ status: "error", code: "network_error" });
  });
});

describe("limitador anti-flood (opcional, por dia)", () => {
  it("com teto 950: o 951º envio do dia é bloqueado e a Evolution não é chamada", async () => {
    const { repo, evo, ctx } = setup({ stopAt: 950 });
    repo.budgets.set(`inst|${DAY}`, {
      phoneNumberId: "inst", monthKey: DAY, reservedCount: 949, stopAt: 950,
      tripped: false, tripReason: null, trippedAt: null, warned: true, tripLogged: false,
    });
    expect((await sendGuarded(text(), ctx)).status).toBe("sent"); // 950º
    for (let i = 0; i < 20; i++) expect((await sendGuarded(text(), ctx)).status).toBe("blocked_budget");
    expect(evo).toHaveBeenCalledTimes(1);
  });

  it("concorrência: contador em 940, 100 envios simultâneos aprovam exatamente 10", async () => {
    const { repo, evo, ctx } = setup({ stopAt: 950 });
    repo.budgets.set(`inst|${DAY}`, {
      phoneNumberId: "inst", monthKey: DAY, reservedCount: 940, stopAt: 950,
      tripped: false, tripReason: null, trippedAt: null, warned: true, tripLogged: false,
    });
    const rs = await Promise.all(Array.from({ length: 100 }, () => sendGuarded(text(), ctx)));
    expect(rs.filter((r) => r.status === "sent")).toHaveLength(10);
    expect(evo).toHaveBeenCalledTimes(10);
  });

  it("dia novo libera (23:59 cheio, 00:00 livre no fuso); a trava manual atravessa a virada", async () => {
    const { repo, evo, ctx } = setup({ stopAt: 5 });
    repo.budgets.set("inst|2026-11-10", {
      phoneNumberId: "inst", monthKey: "2026-11-10", reservedCount: 5, stopAt: 5,
      tripped: true, tripReason: "x", trippedAt: new Date(), warned: true, tripLogged: true,
    });
    const at = (iso: string): SendContext => ({ ...ctx, now: () => new Date(iso) });
    expect((await sendGuarded(text(), at("2026-11-11T02:59:00Z"))).status).toBe("blocked_budget"); // 23:59 em SP
    expect(evo).not.toHaveBeenCalled();
    expect((await sendGuarded(text(), at("2026-11-11T03:00:00Z"))).status).toBe("sent"); // 00:00 em SP
    await repo.setManualLock("inst", "humano");
    expect((await sendGuarded(text(), at("2026-11-12T12:00:00Z"))).status).toBe("blocked_manual_lock");
  });

  it("envio que falha NÃO devolve a vaga (contagem conservadora)", async () => {
    const { repo, ctx } = setup({ stopAt: 100, evoOk: false });
    await sendGuarded(text(), ctx);
    expect(budgetOf(repo)!.reservedCount).toBe(1);
  });

  it("warn em 80% uma única vez; critical ao atingir o teto uma única vez", async () => {
    const { repo, logs, ctx } = setup({ stopAt: 100 });
    for (let i = 0; i < 130; i++) await sendGuarded(text(), ctx);
    expect(budgetOf(repo)!.reservedCount).toBe(100);
    expect(logs.filter((l) => l.level === "warn" && l.event === "flood_limit_80_percent")).toHaveLength(1);
    expect(logs.filter((l) => l.level === "critical" && l.event === "flood_limit_reached")).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(WA);
  });
});

describe("botões e listas", () => {
  it("padrão: botões viram UM texto numerado (1 envio) e as opções ficam guardadas", async () => {
    const { repo, evo, ctx } = setup();
    expect((await sendGuarded(buttons(), ctx)).status).toBe("sent");
    expect(evo).toHaveBeenCalledTimes(1);
    const c = call(evo);
    expect(c.url).toBe("https://evo.test/message/sendText/inst");
    expect(c.body.text).toBe("Quer continuar?\n\n1) Sim\n2) Não\n\nResponda com o número da opção.");
    const pending = await repo.getPendingChoices(await hashWaId(WA));
    expect(pending?.options).toEqual([{ id: "yes", title: "Sim" }, { id: "no", title: "Não" }]);
  });

  it("padrão: lista vira texto numerado com descrição", async () => {
    const { repo, evo, ctx } = setup();
    await sendGuarded(list(), ctx);
    expect(call(evo).body.text).toBe("Escolha\n\n1) Mentoria — Áudio\n2) Dúvidas\n\nResponda com o número da opção.");
    expect((await repo.getPendingChoices(await hashWaId(WA)))?.options.map((o) => o.id)).toEqual(["s1", "s2"]);
  });

  it("um texto comum depois do menu APAGA as opções (um '1' solto não vira a opção 1 de um menu velho)", async () => {
    const { repo, ctx } = setup();
    await sendGuarded(buttons(), ctx);
    await sendGuarded(text("Qual o seu curso?"), ctx);
    expect(await repo.getPendingChoices(await hashWaId(WA))).toBeNull();
  });

  it("envio que falha não grava opções", async () => {
    const { repo, ctx } = setup({ evoOk: false });
    await sendGuarded(buttons(), ctx);
    expect(await repo.getPendingChoices(await hashWaId(WA))).toBeNull();
  });

  it("nativo (flag): sendButtons e sendList com o corpo da Evolution, sem guardar opções", async () => {
    const a = setup({ native: true });
    await sendGuarded(buttons(), a.ctx);
    expect(call(a.evo).url).toBe("https://evo.test/message/sendButtons/inst");
    expect(call(a.evo).body).toEqual({
      number: WA, title: "Quer continuar?",
      buttons: [{ type: "reply", displayText: "Sim", id: "yes" }, { type: "reply", displayText: "Não", id: "no" }],
    });
    const b = setup({ native: true });
    await sendGuarded(list(), b.ctx);
    expect(call(b.evo).url).toBe("https://evo.test/message/sendList/inst");
    expect(call(b.evo).body).toMatchObject({
      number: WA, buttonText: "Ver", description: "Escolha",
      sections: [{ title: "Serviços", rows: [{ title: "Mentoria", description: "Áudio", rowId: "s1" }, { title: "Dúvidas", description: "", rowId: "s2" }] }],
    });
    expect(await b.repo.getPendingChoices(await hashWaId(WA))).toBeNull();
  });
});
