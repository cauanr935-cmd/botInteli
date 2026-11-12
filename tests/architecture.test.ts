import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "src");
/** O ÚNICO arquivo de borda que conhece a Evolution API (isolamento de borda, antes era a Graph API). */
const CLIENT = "whatsapp/evolutionClient.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Devolve os arquivos (≠ cliente) que conhecem os endpoints da Evolution ou a Graph API antiga. */
export function findViolations(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([name]) => name !== CLIENT)
    .filter(([, text]) =>
      /graph\.facebook/i.test(text) ||
      /\/message\/send(Text|Buttons|List|Media|Whatsapp\w*)\b/i.test(text) ||
      /getBase64FromMediaMessage/.test(text) ||
      /["'`]\/?message\/send/i.test(text) ||
      /\/message\/\$\{/.test(text) ||
      /\/chat\/\$\{[^}]*\}|\/chat\/getBase64/i.test(text),
    )
    .map(([name]) => name);
}

function loadSrc(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of walk(SRC)) out[relative(SRC, f).split("\\").join("/")] = readFileSync(f, "utf8");
  return out;
}

describe("arquitetura (isolamento de borda do canal WhatsApp)", () => {
  it("C2.1 só src/whatsapp/evolutionClient.ts conhece a Evolution API (e nada conhece a Graph API)", () => {
    const files = loadSrc();
    expect(Object.keys(files)).toContain(CLIENT);
    expect(findViolations(files)).toEqual([]);
  });

  it("C2.1 o cliente de fato contém os endpoints (o teste não passa por vazio)", () => {
    const text = loadSrc()[CLIENT]!;
    expect(text).toMatch(/\/message\/\$\{p\.path\}\//);
    expect(text).toMatch(/sendText|sendButtons|sendList/);
    expect(text).toMatch(/getBase64FromMediaMessage/);
  });

  it("C2.1 o teste FALHARIA se outro arquivo chamasse a Evolution ou a Graph API", () => {
    const files = {
      ...loadSrc(),
      "audio/sneaky.ts": 'await fetch("https://evo.x/message/sendText/inst", {})',
      "audio/sneaky2.ts": 'await fetch("https://graph.facebook.com/v21.0/123/messages", {})',
      "audio/sneaky3.ts": "fetch(`${base}/chat/getBase64FromMediaMessage/${i}`)",
    };
    expect(findViolations(files).sort()).toEqual(["audio/sneaky.ts", "audio/sneaky2.ts", "audio/sneaky3.ts"]);
    expect(findViolations({ "x.ts": "fetch(`${base}/message/${path}/${i}`)" })).toEqual(["x.ts"]);
  });

  it("sendGuarded é o único ponto de saída: só client.ts chama o transporte da Evolution", () => {
    const users = Object.entries(loadSrc())
      .filter(([, t]) => /\bsendViaEvolution\b/.test(t))
      .map(([n]) => n)
      .sort();
    expect(users).toEqual(["whatsapp/client.ts", "whatsapp/evolutionClient.ts"]);
  });
});
