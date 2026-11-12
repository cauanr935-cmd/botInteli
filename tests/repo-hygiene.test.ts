import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
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
  it("C0.6 sem dependências proibidas (R5)", () => {
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

  it("C0.6 exemplos existem, .dev.vars real não, e contêm todas as variáveis", () => {
    expect(existsSync(join(root, ".dev.vars"))).toBe(false);
    const ex = readFileSync(join(root, ".dev.vars.example"), "utf8");
    for (const k of ["WHATSAPP_TOKEN","PHONE_NUMBER_ID","APP_SECRET","VERIFY_TOKEN","GRAPH_API_VERSION","SUPABASE_URL","SUPABASE_SERVICE_KEY","ANALYZER_API_URL","ANALYZER_API_KEY","ADMIN_TOKEN","META_ACCOUNT_TIMEZONE","BUDGET_SAFETY_MARGIN","MAX_BOT_MSGS_PER_USER_PER_DAY","MAX_BOT_MSGS_PER_USER_PER_10MIN","WHATSAPP_FLOW_ID","PRIVACY_POLICY_URL","TERMS_VERSION","MAX_AUDIO_BYTES"]) {
      expect(ex).toMatch(new RegExp(`^${k}=`, "m"));
    }
  });

  it("C0.6 nenhum segredo literal no código", () => {
    const re = /(EAA[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{30,}\.|sk-[A-Za-z0-9]{20,})/;
    for (const f of walk(root).filter((p) => /\.(ts|toml|json|md|example)$/.test(p) && !p.endsWith("package-lock.json"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(re);
    }
  });

  it("C0.6 wrangler.toml tem binding R2 AUDIOS e cron", () => {
    const w = readFileSync(join(root, "wrangler.toml"), "utf8");
    expect(w).toMatch(/binding = "AUDIOS"/);
    expect(w).toMatch(/crons = \[/);
  });
});
