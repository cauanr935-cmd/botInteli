import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "src");
const CLIENT = "whatsapp/client.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Devolve os arquivos (≠ cliente) que conhecem a Graph API de envio. */
export function findViolations(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([name]) => name !== CLIENT)
    .filter(([, text]) =>
      /graph\.facebook\.com/i.test(text) ||
      /graph\.facebook/i.test(text) ||
      /["'`/]messages["'`?]/.test(text) ||
      /\/messages\b/.test(text) ||
      /\$\{[^}]*\}\/messages/.test(text),
    )
    .map(([name]) => name);
}

function loadSrc(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of walk(SRC)) out[relative(SRC, f).split("\\").join("/")] = readFileSync(f, "utf8");
  return out;
}

describe("arquitetura (R1)", () => {
  it("C2.1 só src/whatsapp/client.ts conhece graph.facebook.com e /messages", () => {
    const files = loadSrc();
    expect(Object.keys(files)).toContain(CLIENT);
    expect(findViolations(files)).toEqual([]);
  });

  it("C2.1 o cliente de fato contém a URL (o teste não passa por vazio)", () => {
    expect(loadSrc()[CLIENT]).toMatch(/graph\.facebook\.com\/.*\/messages/);
  });

  it("C2.1 o teste FALHARIA se outro arquivo chamasse a Graph API", () => {
    const files = {
      ...loadSrc(),
      "audio/sneaky.ts": 'await fetch("https://graph.facebook.com/v21.0/123/messages", {})',
    };
    expect(findViolations(files)).toEqual(["audio/sneaky.ts"]);
    const viaTemplate = { "x.ts": "fetch(`${base}/${id}/messages`)" };
    expect(findViolations(viaTemplate)).toEqual(["x.ts"]);
  });
});
