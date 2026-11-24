import { describe, it, expect } from "vitest";
import { LEGAL_INFO, LEGAL_VERSION, legalResponse, pendingFields, renderLegalPage, type LegalInfo } from "../src/legal/page";
import worker from "../src/index";
import { REG_TEXTS } from "../src/registration/texts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const filled: LegalInfo = {
  controllerName: "Be My Mentor Ltda", controllerDoc: "00.000.000/0001-00", controllerAddress: "Rua Exemplo, 1, Fortaleza/CE",
  contactEmail: "privacidade@exemplo.org", dpo: "Fulana de Tal (dpo@exemplo.org)",
};

describe("Termos de Uso e Política de Privacidade (LGPD)", () => {
  const html = renderLegalPage(filled);

  it("traz os elementos exigidos pela LGPD", () => {
    for (const t of [
      /Lei nº 13\.709\/2018/, /Controlador/, /Encarregado/, /art\. 41/, /Bases? legal|Base legal/, /Consentimento/,
      /Transferência internacional/, /art\. 33/, /Seus direitos/, /art\. 18/, /confirmação/i, /eliminação/i, /portabilidade/i,
      /revogação do consentimento/i, /15 dias/, /ANPD/, /crianças e adolescentes/i, /art\. 14/, /art\. 20/, /art\. 46/, /art\. 48/,
      /dados pessoais sensíveis/i, /Por quanto tempo guardamos/,
    ]) expect(html, String(t)).toMatch(t);
  });
  it("descreve os dados e fluxos reais do bot", () => {
    for (const t of [
      /Número de WhatsApp/, /Nome completo e turma/, /Áudio de apresentação/, /Dúvidas e documentos/, /Dias e horários livres/,
      /Áudios das mentorias/, /diarização/, /carimbos? de tempo/i, /horas complementares/i, /Groq \/ xAI/, /Cloudflare/, /Supabase/, /WhatsApp \(Meta\)/,
      /sem nome nem telefone|sem seu nome nem seu telefone/, /sair/, /88 99289-5332/, /wa\.me\/5588992895332/,
    ]) expect(html, String(t)).toMatch(t);
  });
  it("declara que o livro de registro só tem dados pseudonimizados e que a instituição só recebe o certificado", () => {
    expect(html).toMatch(/somente informações pseudonimizadas/);
    expect(html).toMatch(/só recebe o <b>certificado<\/b>/);
    expect(html).toMatch(/não são enviadas a nenhum serviço de IA de terceiros/);
  });
  it("dados do controlador preenchidos: sem aviso de rascunho e sem placeholders", () => {
    expect(pendingFields(filled)).toEqual([]);
    expect(html).not.toMatch(/RASCUNHO/);
    expect(html).not.toMatch(/\[a preencher\]/);
    expect(html).toContain("Be My Mentor Ltda");
    expect(html).toContain(`Versão ${LEGAL_VERSION}`);
  });
  it("página em fundo branco e letra preta, sem modo escuro", () => {
    expect(html).toMatch(/background:#fff;color:#000/);
    expect(html).not.toMatch(/prefers-color-scheme/);
  });
  it("não expõe achados internos do dossiê", () => {
    expect(html).not.toMatch(/Baileys|banid|botInteli|achado \d|pendente/i);
  });
  it("a página oficial já vem completa: sem rascunho e sem campos a preencher", () => {
    expect(pendingFields(LEGAL_INFO)).toEqual([]);
    const official = renderLegalPage(LEGAL_INFO);
    expect(official).not.toMatch(/RASCUNHO|a preencher/);
    for (const t of ["70.237.372/0001-11", "Rua MMDC", "bemymentoris@gmail.com", "Cauan da Rocha Martins"]) expect(official).toContain(t);
    expect(official).not.toMatch(/“nós”/);
  });
  it("escapa HTML nos campos do controlador", () => {
    const evil = renderLegalPage({ ...filled, controllerName: '<script>alert(1)</script>' });
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&lt;script&gt;");
  });
  it("página sem JavaScript, viewport móvel e idioma pt-BR", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).toMatch(/name="viewport"/);
    expect(html).toMatch(/<html lang="pt-BR">/);
  });
  it("GET /privacidade e /termos são públicos (sem chave), com cabeçalhos de segurança", async () => {
    for (const path of ["/privacidade", "/termos"]) {
      const res = await worker.fetch(new Request(`https://bot.example${path}`), {});
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
      expect(res.headers.get("Content-Security-Policy")).toMatch(/default-src 'none'/);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await res.text()).toMatch(/Política de Privacidade/);
    }
    expect(legalResponse(filled).status).toBe(200);
  });
  it("POST em /privacidade não é aceito", async () => {
    const res = await worker.fetch(new Request("https://bot.example/privacidade", { method: "POST" }), {});
    expect(res.status).not.toBe(200);
  });
  it("o consentimento cita IA, serviços fora do Brasil e a finalidade; cabe numa mensagem", () => {
    expect(REG_TEXTS.consentWelcome).toMatch(/inteligência artificial/);
    expect(REG_TEXTS.consentWelcome).toMatch(/fora do Brasil/);
    expect(REG_TEXTS.consentWelcome).toMatch(/horas complementares/);
    expect(REG_TEXTS.consentWelcome.length + REG_TEXTS.consentAfterLink.length + 80).toBeLessThan(1024);
  });
  it("a versão dos termos no wrangler.toml acompanha a da página (novo aceite quando o texto muda)", () => {
    const toml = readFileSync(join(__dirname, "..", "wrangler.toml"), "utf8");
    expect(toml).toMatch(new RegExp(`TERMS_VERSION = "${LEGAL_VERSION}"`));
  });
});

describe("o usuário consegue ver os termos", () => {
  it("/termos, /privacidade e /lgpd abrem a página pública (200, sem login)", async () => {
    for (const p of ["/termos", "/privacidade", "/lgpd"]) {
      const res = await worker.fetch(new Request(`https://w.dev${p}`), {});
      expect(res.status, p).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/Termos de Uso/);
      expect(html).toMatch(/Política de Privacidade/);
      expect(html).toMatch(/id="direitos-lgpd"/);
    }
  });
  it("o chat de teste mostra os três links para o usuário", async () => {
    const { PAGE_HTML } = await import("../src/sim/page");
    for (const href of ["/termos#termos", "/privacidade#privacidade-politica", "/lgpd#direitos-lgpd"]) expect(PAGE_HTML).toContain(`href="${href}"`);
  });
});
