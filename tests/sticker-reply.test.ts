import { describe, expect, it, vi } from "vitest";
import { Simulator } from "../scripts/simulate";
import { MemoryRepo } from "../src/db/memory-repo";
import { sendGuarded, type SendContext } from "../src/whatsapp/client";
import { createAssetStickers, isStickerTrigger, type StickerPicker } from "../src/whatsapp/stickers";
import { cleanRiff } from "../src/ai/grok";
import { hashWaId } from "../src/lib/hash";

const fixed: StickerPicker = { pick: async (c) => "U1RJQ0tFUg==" + (c === "reacao" ? "" : ":" + c) };
const none: StickerPicker = { pick: async () => null };

async function person(stickers?: StickerPicker, state = "PROFILE_ROLE") {
  const s = new Simulator(stickers ? { stickers } : {});
  const p = s.phone(7);
  await s.repo.touchUser(p, s.now());
  await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "sim-1", values: { full_name: "Ana Souza" } });
  await s.repo.saveConversation(p, 0, { state: state as never, previousState: null, hintSentInState: true, optedOutAt: state === "OPTED_OUT" ? s.now() : null });
  return { s, p };
}

describe("figurinha de volta", () => {
  it("figurinha ou imagem recebem uma figurinha, sem mudar a etapa", async () => {
    const { s, p } = await person(fixed);
    await s.sticker(p); s.advance(30_000);
    await s.image(p); s.advance(1000);
    const out = s.sentTo(p);
    expect(out).toHaveLength(2);
    expect(out[0]!.body).toMatchObject({ type: "sticker", sticker: "U1RJQ0tFUg==" });
    expect((await s.repo.getConversation(p)).state).toBe("PROFILE_ROLE");
  });

  it("rajada de figurinhas (dentro de 8 s) recebe só uma", async () => {
    const { s, p } = await person(fixed);
    await s.sticker(p); await s.sticker(p); await s.image(p); s.advance(1000);
    expect(s.sentTo(p)).toHaveLength(1);
  });

  it("sem figurinhas disponíveis, ou sem o recurso ligado, segue o silêncio", async () => {
    for (const st of [none, undefined]) {
      const { s, p } = await person(st);
      await s.sticker(p); s.advance(1000);
      expect(s.sentTo(p)).toHaveLength(0);
    }
  });

  it("quem pausou (sair) e quem espera análise de áudio não recebem; vídeo/reação também não", async () => {
    for (const st of ["OPTED_OUT", "PROCESSING_AUDIO"]) {
      const { s, p } = await person(fixed, st);
      await s.sticker(p); s.advance(1000);
      expect(s.sentTo(p), st).toHaveLength(0);
    }
    expect(isStickerTrigger("stickerMessage")).toBe(true);
    expect(isStickerTrigger("imageMessage")).toBe(true);
    for (const t of ["videoMessage", "reactionMessage", "locationMessage", "documentMessage"]) expect(isStickerTrigger(t)).toBe(false);
  });

  it("respeita o limite por pessoa (R2)", async () => {
    const s = new Simulator({ stickers: fixed, env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "1" } });
    const p = s.phone(8);
    await s.repo.touchUser(p, s.now());
    await s.repo.saveConversation(p, 0, { state: "MENU" as never, previousState: null, hintSentInState: true, optedOutAt: null });
    await s.sticker(p); s.advance(30_000);
    await s.sticker(p); s.advance(30_000);
    expect(s.sentTo(p)).toHaveLength(1);
  });
});

describe("transporte da Evolution", () => {
  it("sendSticker com { number, sticker }; sticker vazio é recusado sem chamar a Evolution", async () => {
    const repo = new MemoryRepo();
    const evo = vi.fn(async () => new Response(JSON.stringify({ key: { id: "OUT1" } }), { status: 201 }));
    const now = new Date("2026-11-10T15:00:00Z");
    repo.users.set("5511987651234", new Date(now.getTime() - 60_000));
    const ctx: SendContext = {
      repo, logger: { log: () => undefined }, phoneNumberId: "i", evolutionUrl: "https://evo.test", evolutionApiKey: "K",
      evolutionInstance: "i", stopAt: 0, timezone: "America/Sao_Paulo", fetchImpl: evo as unknown as typeof fetch, now: () => now,
    };
    expect(await sendGuarded({ to: "5511987651234", type: "sticker", sticker: "QUJD" }, ctx)).toEqual({ status: "sent", wamid: "OUT1" });
    const [url, init] = evo.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.test/message/sendSticker/i");
    expect(JSON.parse(init.body as string)).toEqual({ number: "5511987651234", sticker: "QUJD" });
    expect(await sendGuarded({ to: "5511987651234", type: "sticker", sticker: "" }, ctx)).toEqual({ status: "error", code: "unsupported_type" });
    expect(evo).toHaveBeenCalledTimes(1);
  });
});

describe("assets de figurinhas", () => {
  const files: Record<string, Uint8Array | string> = {
    "index.json": JSON.stringify(["a.webp", "../evil.png", "b.webp"]),
    "a.webp": new Uint8Array([65, 66, 67]),
    "b.webp": new Uint8Array(600_000), // grande demais: ignorada
  };
  const assets = { fetch: async (u: string) => {
    const f = files[u.slice(u.lastIndexOf("/") + 1)];
    return f === undefined ? new Response("", { status: 404 }) : new Response(f as BodyInit, { status: 200 });
  } };

  it("sorteia da lista (só nomes .webp válidos), devolve base64 e ignora arquivo grande", async () => {
    expect(await createAssetStickers(assets, () => 0).pick("reacao")).toBe("QUJD"); // índice 0 = a.webp
    expect(await createAssetStickers(assets, () => 0.99).pick("reacao")).toBeNull(); // índice 1 = b.webp (grande)
  });

  it("índice vazio, ausente ou inválido => null (sem lançar)", async () => {
    expect(await createAssetStickers({ fetch: async () => new Response("[]") }).pick("reacao")).toBeNull();
    expect(await createAssetStickers({ fetch: async () => new Response("", { status: 404 }) }).pick("reacao")).toBeNull();
    expect(await createAssetStickers({ fetch: async () => { throw new Error("x"); } }).pick("reacao")).toBeNull();
  });
});

describe("figurinha por situação", () => {
  const kinds = (s: Simulator, p: string) => s.sentTo(p).map((m) => (m.body.type === "sticker" ? String(m.body.sticker).split(":")[1] ?? "reacao" : "texto"));

  it("categoria vem do início do nome do arquivo; sem a categoria, só 'reacao' usa qualquer uma", async () => {
    const files: Record<string, string> = {
      "index.json": JSON.stringify(["abertura_a.webp", "resenha_b.webp", "solta.webp"]),
      "abertura_a.webp": "A", "resenha_b.webp": "B", "solta.webp": "C",
    };
    const assets = { fetch: async (u: string) => { const f = files[u.slice(u.lastIndexOf("/") + 1)]; return f === undefined ? new Response("", { status: 404 }) : new Response(f); } };
    const pk = createAssetStickers(assets, () => 0);
    expect(await pk.pick("abertura")).toBe(btoa("A"));
    expect(await pk.pick("resenha")).toBe(btoa("B"));
    expect(await pk.pick("despedida")).toBeNull();
    expect(["QQ==", "Qg==", "Qw=="]).toContain(await pk.pick("reacao"));
  });

  it("primeira mensagem: figurinha de abertura ANTES do texto", async () => {
    const s = new Simulator({ stickers: fixed });
    const p = s.phone(20);
    await s.text(p, "oi"); s.advance(1000);
    expect(kinds(s, p)[0]).toBe("abertura");
    expect(kinds(s, p).slice(1).every((k) => k === "texto")).toBe(true);
    expect(kinds(s, p).length).toBeGreaterThan(1);
  });

  it("fora de assunto: figurinha de resenha + aviso", async () => {
    const { s, p } = await person(fixed, "PROFILE_ROLE");
    await s.text(p, "o jogo do flamengo ontem foi uma loucura"); s.advance(1000);
    expect(kinds(s, p)[0]).toBe("resenha"); // figurinha primeiro; o aviso e a pergunta da etapa vão por último
    expect(s.sentTo(p)).toHaveLength(2);
  });

  it("fim do fluxo: despedida com figurinha; depois 'valeu' recebe 'vlw' + figurinha de despedida", async () => {
    const { s, p } = await person(fixed, "DOUBT_ASK");
    await s.text(p, "não"); s.advance(2000);
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
    expect(kinds(s, p)).toEqual(["texto", "despedida"]);
    const before = s.sentTo(p).length;
    s.advance(30_000);
    await s.text(p, "valeu!"); s.advance(1000);
    const novos = s.sentTo(p).slice(before);
    expect(novos.map((m) => m.body.type)).toEqual(["sticker", "text"]);
  });

  it("modo cuidado (tema sensível na última hora): nenhuma figurinha", async () => {
    const { s, p } = await person(fixed, "MENU");
    await s.repo.recordSensitiveEvent(await hashWaId(p), "high" as never, "whatsapp", s.now());
    s.advance(60_000);
    await s.sticker(p); s.advance(1000);
    expect(kinds(s, p).filter((k) => k !== "texto")).toHaveLength(0);
  });
});

describe("fala dinâmica pela IA (riff)", () => {
  const txt = (s: Simulator, p: string) => s.sentTo(p).map((m) => ((m.body as { text?: { body: string } }).text?.body ?? (m.body as { interactive?: { body: { text: string } } }).interactive?.body.text ?? ""));
  const agent = (riff: (q: { situation: string; text: string }) => Promise<string | null>) => ({
    classify: async () => null, answerFaq: async () => ({ kind: "off_topic" as const }), riff,
  });

  it("fora de assunto usa a fala da IA e mantém a pergunta da etapa; IA falhando cai no texto fixo", async () => {
    const seen: string[] = [];
    const a = agent(async (q) => { seen.push(q.situation); return "kkk esse papo de futebol eu deixo pro intervalo"; });
    const { s, p } = await person(undefined, "PROFILE_ROLE");
    const s2 = new Simulator({ agent: a as never });
    const p2 = s2.phone(7);
    await s2.repo.touchUser(p2, s2.now());
    await s2.repo.saveRegistration(p2, { waIdHash: await hashWaId(p2), consentAt: s2.now(), termsVersion: "x", values: { full_name: "Ana Souza" } });
    await s2.repo.saveConversation(p2, 0, { state: "PROFILE_ROLE" as never, previousState: null, hintSentInState: true, optedOutAt: null });
    await s2.text(p2, "o jogo do flamengo ontem foi uma loucura"); s2.advance(1000);
    expect(seen).toEqual(["off_topic"]);
    expect(txt(s2, p2)[0]).toMatch(/intervalo/);
    expect(txt(s2, p2)[0]).toMatch(/mentor/i); // a pergunta da etapa continua junto
    void s; void p;

    const s3 = new Simulator({ agent: agent(async () => null) as never });
    const p3 = s3.phone(7);
    await s3.repo.touchUser(p3, s3.now());
    await s3.repo.saveRegistration(p3, { waIdHash: await hashWaId(p3), consentAt: s3.now(), termsVersion: "x", values: { full_name: "Ana Souza" } });
    await s3.repo.saveConversation(p3, 0, { state: "PROFILE_ROLE" as never, previousState: null, hintSentInState: true, optedOutAt: null });
    await s3.text(p3, "o jogo do flamengo ontem foi uma loucura"); s3.advance(1000);
    expect(txt(s3, p3)[0]).not.toMatch(/intervalo/);
    expect(txt(s3, p3).length).toBeGreaterThan(0);
  });

  it("'tchau' depois do fim do fluxo é despedida (nunca 'não peguei'), mesmo com a IA classificando como fora de assunto", async () => {
    const s = new Simulator({ agent: agent(async () => "valeu demais! me chama quando precisar 🦎") as never });
    const p = s.phone(9);
    await s.repo.touchUser(p, s.now());
    await s.repo.saveRegistration(p, { waIdHash: await hashWaId(p), consentAt: s.now(), termsVersion: "x", values: { full_name: "Ana Souza" } });
    await s.repo.saveConversation(p, 0, { state: "DOUBT_ASK" as never, previousState: null, hintSentInState: true, optedOutAt: null });
    await s.text(p, "não"); s.advance(30_000);
    const before = s.sentTo(p).length;
    await s.text(p, "tchau"); s.advance(1000);
    const novos = txt(s, p).slice(before);
    expect(novos).toEqual(["valeu demais! me chama quando precisar 🦎"]); // o Axo segue usando 🦎
  });

  it("antes do aceite (LGPD) a IA não recebe o texto: não chama riff", async () => {
    let called = 0;
    const s = new Simulator({ agent: agent(async () => { called++; return "x x x x"; }) as never });
    const p = s.phone(10);
    await s.text(p, "oi"); await s.text(p, "o jogo foi uma loucura"); s.advance(1000);
    expect(called).toBe(0);
  });
});

describe("cleanRiff", () => {
  it("aceita fala curta e recusa link, número longo, vazio ou lixo", () => {
    expect(cleanRiff('{"fala":"kkk boa! mas aqui o foco é mentoria 🦎"}')).toBe("kkk boa! mas aqui o foco é mentoria 🦎");
    expect(cleanRiff('{"fala":"entra em https://x.com agora"}')).toBeNull();
    expect(cleanRiff('{"fala":"liga 11999998888"}')).toBeNull();
    expect(cleanRiff('{"fala":""}')).toBeNull();
    expect(cleanRiff("sem json")).toBeNull();
    expect(cleanRiff(null)).toBeNull();
    expect(cleanRiff(`{"fala":"${"a".repeat(300)}"}`)).toBeNull();
  });
});

describe("modo cuidado dura 1 hora", () => {
  const bodyOf = (m: { body: Record<string, unknown> }) => ((m.body as { text?: { body: string } }).text?.body ?? (m.body as { interactive?: { body: { text: string } } }).interactive?.body.text ?? "");

  it("dentro da hora: rodapé do CVV e sem figurinha; depois da hora: sem rodapé e a figurinha volta", async () => {
    const { s, p } = await person(fixed, "COMPLETED");
    await s.text(p, "quero morrer"); s.advance(10 * 60_000);
    await s.text(p, "oi"); s.advance(1000);
    expect(bodyOf(s.sentTo(p).at(-1)!)).toMatch(/CVV: 188, 24h$/);
    await s.sticker(p); s.advance(1000);
    expect(s.sentTo(p).some((m) => m.body.type === "sticker")).toBe(false);

    s.advance(61 * 60_000); // passou 1 h do tema sensível
    const before = s.sentTo(p).length;
    await s.text(p, "oi"); s.advance(30_000);
    await s.sticker(p); s.advance(1000);
    const novos = s.sentTo(p).slice(before);
    expect(novos.some((m) => /CVV: 188, 24h/.test(bodyOf(m)))).toBe(false);
    expect(novos.some((m) => m.body.type === "sticker")).toBe(true);
  });
});
