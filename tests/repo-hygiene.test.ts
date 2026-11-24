import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = join(__dirname, "..");
// O Baileys roda DENTRO da Evolution (VM separada), nunca no Worker: nada disso pode entrar no package.json.
const FORBIDDEN = ["baileys", "whatsapp-web.js", "venom-bot", "wppconnect"];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (["node_modules", ".git", ".wrangler", "referencias"].includes(n)) continue; // referencias: PDFs/MD de estratégia com imagens em base64
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("higiene do repositório", () => {
  it("C0.6 o Worker não embute bibliotecas de WhatsApp: o canal é a Evolution API via HTTP (R5)", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ").toLowerCase();
    for (const f of FORBIDDEN) expect(deps).not.toContain(f);
  });

  it("C0.6 .gitignore cobre segredos e artefatos", () => {
    const gi = readFileSync(join(root, ".gitignore"), "utf8");
    for (const e of [".dev.vars", ".env", ".env.*", "!.env.example", "!.dev.vars.example", "node_modules", ".wrangler"]) {
      expect(gi.split("\n")).toContain(e);
    }
  });

  it("C0.6 exemplos existem, .dev.vars real nunca é versionado (pode existir local, ignorado pelo git), e contêm todas as variáveis", () => {
    const tracked = execFileSync("git", ["ls-files", ".dev.vars", ".env"], { cwd: root, encoding: "utf8" }).trim();
    expect(tracked).toBe("");
    expect(existsSync(join(root, ".dev.vars.example"))).toBe(true);
    const ex = readFileSync(join(root, ".dev.vars.example"), "utf8");
    for (const k of ["EVOLUTION_URL","EVOLUTION_API_KEY","EVOLUTION_INSTANCE","EVOLUTION_WEBHOOK_TOKEN","EVOLUTION_NATIVE_INTERACTIVE","ANTI_FLOOD_MAX_PER_DAY","SUPABASE_URL","SUPABASE_SERVICE_KEY","ANALYZER_API_URL","ANALYZER_API_KEY","ADMIN_TOKEN","TIMEZONE","MAX_BOT_MSGS_PER_USER_PER_DAY","MAX_BOT_MSGS_PER_USER_PER_10MIN","PRIVACY_POLICY_URL","TERMS_VERSION","MAX_AUDIO_BYTES"]) {
      expect(ex).toMatch(new RegExp(`^${k}=`, "m"));
    }
  });

  it("C0.6 nenhum segredo literal no código", () => {
    const re = /(EAA[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{30,}\.|sk-[A-Za-z0-9]{20,})/;
    for (const f of walk(root).filter((p) => /\.(ts|toml|json|md|example)$/.test(p) && !p.endsWith("package-lock.json") && !/Design Conversacional|Estratégia De Mascotes/.test(p))) { // estudos de referência (imagens em base64)
      expect(readFileSync(f, "utf8"), f).not.toMatch(re);
    }
  });

  it("C0.6 wrangler.toml tem binding R2 AUDIOS e cron", () => {
    const w = readFileSync(join(root, "wrangler.toml"), "utf8");
    expect(w).toMatch(/binding = "AUDIOS"/);
    expect(w).toMatch(/crons = \[/);
  });
});
