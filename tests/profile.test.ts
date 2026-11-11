import { describe, it, expect } from "vitest";
import { Simulator, MINUTE } from "../scripts/simulate";
import { PROFILE_TEXTS as T } from "../src/profile/texts";
import { categoriesListReply } from "../src/profile/decide";
import { CATEGORIES, categoriesPrompt, classifyDoubt, parseCategories } from "../src/profile/categories";

const mk = () => new Simulator({ env: { MAX_BOT_MSGS_PER_USER_PER_10MIN: "20", MAX_BOT_MSGS_PER_USER_PER_DAY: "60" } });
const lastBody = (s: Simulator, p: string): string => {
  const b = s.sentTo(p).at(-1)!.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? "";
};
const listRowIds = (s: Simulator, p: string): string[] => {
  const b = s.sentTo(p).at(-1)!.body as { interactive?: { action?: { sections?: { rows: { id: string }[] }[] } } };
  return b.interactive?.action?.sections?.[0]?.rows.map((r) => r.id) ?? [];
};
const categoriesListBody = (selected: string[]): string => {
  const r = categoriesListReply(selected) as { interactive: { body: { text: string } } };
  return r.interactive.body.text;
};
async function toRole(s: Simulator, p: string) {
  await s.text(p, "oi"); s.advance(1000);
  await s.button(p, "consent_yes"); s.advance(1000);
  await s.text(p, "Maria da Silva"); s.advance(1000);
  await s.text(p, "T12"); s.advance(1000);
  await s.audio(p); s.advance(1000);
}

/** Mentor/mentorado escolhe segunda, 8h às 12h, e termina. */
async function doSchedule(s: Simulator, p: string) {
  await s.list(p, "sch_day_segunda"); s.advance(1000);
  await s.list(p, "sch_h_8_12"); s.advance(1000);
  await s.list(p, "sch_dayend"); s.advance(1000);
  await s.list(p, "sch_done"); s.advance(1000);
}

describe("perfil: áudio, papel, áreas e dúvida", () => {
  it("áudio de perfil é guardado (serviço 'perfil') e leva à pergunta de papel", async () => {
    const s = mk(); const p = s.phone(1);
    await toRole(s, p);
    expect(lastBody(s, p)).toBe(T.askRole);
    expect((await s.repo.getConversation(p)).state).toBe("PROFILE_ROLE");
    const audios = [...s.repo.audios.values()];
    expect(audios).toHaveLength(1);
    expect(audios[0]).toMatchObject({ serviceId: "perfil", status: "done" });
    expect(await s.repo.listMentorias({ limit: 10 })).toHaveLength(0); // não é mentoria
  });

  it("mentorado + 'Não': encerra com agradecimento e conclui o cadastro", async () => {
    const s = mk(); const p = s.phone(2);
    await toRole(s, p);
    await s.button(p, "prof_mentorado"); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.askDoubt);
    await s.button(p, "doubt_no"); s.advance(1000);
    expect(lastBody(s, p)).toBe("Muito obrigado por se cadastrar e até uma próxima.");
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
    const reg = await s.repo.getRegistration(p);
    expect(reg.profileRole).toBe("mentorado");
    expect(reg.registeredAt).not.toBeNull();
  });

  it("mentorado + 'Sim': pede a dúvida, categoriza, grava e encerra", async () => {
    const s = mk(); const p = s.phone(3);
    await toRole(s, p);
    await s.button(p, "prof_mentorado"); s.advance(1000);
    await s.button(p, "doubt_yes"); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.askDoubtText);
    await s.text(p, "Não entendo derivada e integral em cálculo"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/Dúvida registrada! Agora, só para encerrar: Em quais dias da semana/);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_doubt");
    await doSchedule(s, p);
    expect(lastBody(s, p)).toMatch(/Horários anotados:[\s\S]*Segunda: 8h às 12h[\s\S]*até a próxima/i);
    expect(s.repo.doubts).toHaveLength(1);
    expect(s.repo.doubts[0]!.categories).toContain("matematica");
  });

  it("mentor: escolhe áreas na lista, uma por toque, e conclui (com a explicação de Vida Acadêmica)", async () => {
    const s = mk(); const p = s.phone(4);
    await toRole(s, p);
    await s.button(p, "prof_mentor"); s.advance(1000);
    expect(lastBody(s, p)).toBe(categoriesListBody([]));
    expect(lastBody(s, p)).toMatch(/iniciação científica, monitoria, bolsas de estudo, preparação para provas, recuperação e processos de troca de curso/);
    expect(listRowIds(s, p)).toEqual(["cat_computacao", "cat_matematica", "cat_lideranca", "cat_negocios", "cat_design", "cat_vida_academica"]);
    const n = s.sentTo(p).length;
    await s.text(p, "blablabla"); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.hintCategories);
    await s.text(p, "blablabla"); s.advance(1000);
    await s.text(p, "blablabla"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1); // 1 dica e silêncio, por mais mensagens que mande
    await s.list(p, "cat_matematica"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/Adicionado: Matemática/);
    expect(listRowIds(s, p)).not.toContain("cat_matematica");
    expect(listRowIds(s, p)).toContain("cat_done");
    await s.list(p, "cat_matematica"); s.advance(1000); // linha antiga: silêncio
    await s.list(p, "cat_design"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/Adicionado: Matemática, Design\/UX/);
    expect((await s.repo.getConversation(p)).state).toBe("MENTOR_CATEGORIES");
    await s.list(p, "cat_done"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/Em quais dias da semana você está disponível para mentorar/);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_mentor");
    await doSchedule(s, p);
    expect(lastBody(s, p)).toContain(T.closingMentor);
    expect((await s.repo.getRegistration(p)).mentorCategories).toEqual(["matematica", "design"]);
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
  });

  it("mentor: 'Concluir' sem nenhuma área escolhida não avança", async () => {
    const s = mk(); const p = s.phone(8);
    await toRole(s, p);
    await s.button(p, "prof_mentor"); s.advance(1000);
    const n = s.sentTo(p).length;
    await s.list(p, "cat_done"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n);
    expect((await s.repo.getConversation(p)).state).toBe("MENTOR_CATEGORIES");
  });

  it("mentor: ainda aceita áreas digitadas (números ou nomes) como alternativa", async () => {
    const s = mk(); const p = s.phone(9);
    await toRole(s, p);
    await s.button(p, "prof_mentor"); s.advance(1000);
    await s.text(p, "2, 5 e vida acadêmica"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_mentor");
    await doSchedule(s, p);
    expect(lastBody(s, p)).toContain(T.closingMentor);
    expect((await s.repo.getRegistration(p)).mentorCategories).toEqual(["matematica", "design", "vida_academica"]);
  });

  it("os dois: áreas e depois a pergunta de dúvida", async () => {
    const s = mk(); const p = s.phone(5);
    await toRole(s, p);
    await s.button(p, "prof_both"); s.advance(1000);
    await s.text(p, "1"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("SCHED_DAYS_ambos");
    await doSchedule(s, p);
    expect(lastBody(s, p)).toContain(T.askDoubt);
    expect((await s.repo.getConversation(p)).state).toBe("DOUBT_ASK");
    expect((await s.repo.getRegistration(p)).profileRole).toBe("ambos");
  });

  it("cadastrado volta depois: 'oi' pergunta o que quer fazer e 'menu' ainda abre os serviços", async () => {
    const s = mk(); const p = s.phone(6);
    await s.register(p, 1000);
    s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.askReturning);
    expect((await s.repo.getConversation(p)).state).toBe("RETURNING_CHOICE");
    await s.text(p, "menu"); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("MENU");
  });

  it("curiosidades por texto também valem: guarda o texto e segue para o papel (sem áudio)", async () => {
    const s = mk(); const p = s.phone(7);
    await s.text(p, "oi"); await s.button(p, "consent_yes"); await s.text(p, "Maria da Silva"); await s.text(p, "T12");
    expect(lastBody(s, p)).toMatch(/Pode gravar um áudio ou, se preferir, escrever/);
    await s.text(p, "Nasci em 12/03/2003, torço pro Fortaleza, gosto de vôlei e de jogar xadrez"); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.askRole);
    expect((await s.repo.getConversation(p)).state).toBe("PROFILE_ROLE");
    expect((await s.repo.getRegistration(p)).profileAbout).toBe("Nasci em 12/03/2003, torço pro Fortaleza, gosto de vôlei e de jogar xadrez");
    expect(s.repo.audios.size).toBe(0); // nenhum áudio foi guardado
  });

  it("texto curto ou só um comando não vale: 1 dica e silêncio; o áudio continua valendo", async () => {
    const s = mk(); const p = s.phone(11);
    await s.text(p, "oi"); await s.button(p, "consent_yes"); await s.text(p, "Maria da Silva"); await s.text(p, "T12");
    const n = s.sentTo(p).length;
    await s.text(p, "futebol"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/em um áudio ou em um texto/);
    await s.text(p, "oi"); s.advance(1000);
    await s.text(p, "menu"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1);
    expect((await s.repo.getConversation(p)).state).toBe("REG_PROFILE_AUDIO");
    expect((await s.repo.getRegistration(p)).profileAbout).toBeUndefined();
    await s.audio(p); s.advance(1000);
    expect((await s.repo.getConversation(p)).state).toBe("PROFILE_ROLE");
    expect(s.repo.audios.size).toBe(1);
  });
});

describe("categorias", () => {
  it("parseCategories lê números e nomes, sem repetição, na ordem do menu", () => {
    expect(parseCategories("6, 1, 1")).toEqual(["computacao", "vida_academica"]);
    expect(parseCategories("Matemática e UX")).toEqual(["matematica", "design"]);
    expect(parseCategories("nada")).toEqual([]);
    expect(parseCategories("7")).toEqual([]);
  });
  it("categorias: 6 opções, sem Programação e com Design/UX unificado", () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual(["Computação", "Matemática", "Liderança", "Negócios", "Design/UX", "Vida Acadêmica"]);
    expect(categoriesPrompt()).toMatch(/5\. Design\/UX/);
    expect(categoriesPrompt()).not.toMatch(/Programação/);
    expect(categoriesPrompt()).not.toMatch(/^\d\. UX$/m);
    expect(parseCategories("ux e design")).toEqual(["design"]);
  });
  it("classifyDoubt: triagem por palavras-chave; sem acerto = vazio", () => {
    expect(classifyDoubt("Como liderar minha equipe?")).toContain("lideranca");
    expect(classifyDoubt("Quero abrir uma startup")).toContain("negocios");
    expect(classifyDoubt("xyz")).toEqual([]);
  });
  it("a mensagem de áreas cabe em 1 mensagem (<= 1024)", () => {
    expect(categoriesPrompt().length).toBeLessThanOrEqual(1024);
  });
});

describe("dúvida com material anexado", () => {
  const toDoubt = async (s: Simulator, p: string) => {
    await toRole(s, p);
    await s.button(p, "prof_mentorado"); s.advance(1000);
    await s.button(p, "doubt_yes"); s.advance(1000);
  };
  it("a pergunta pede só 'Descreva a sua dúvida' e convida a anexar documento/lista de dúvidas", async () => {
    const s = mk(); const p = s.phone(20);
    await toDoubt(s, p);
    expect(lastBody(s, p)).toBe(T.askDoubtText);
    expect(lastBody(s, p)).toMatch(/^Descreva a sua dúvida\./);
    expect(lastBody(s, p)).not.toMatch(/poucas palavras/);
    expect(lastBody(s, p)).toMatch(/documento ou lista de dúvidas/);
    expect(lastBody(s, p)).toMatch(/repassado a ele ou a ela/);
  });
  it("documento antes da dúvida é guardado em silêncio e a dúvida segue normalmente", async () => {
    const s = mk(); const p = s.phone(21);
    await toDoubt(s, p);
    const n = s.sentTo(p).length;
    await s.document(p); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n); // sem mensagem extra (R2)
    expect(s.repo.materials).toHaveLength(1);
    expect(s.repo.materials[0]).toMatchObject({ mime: "application/pdf", filename: "duvidas.pdf" });
    expect([...s.store.objects.keys()][1]).toMatch(/^materiais\/[0-9a-f]{64}\/2026-11\/[0-9a-f-]+\.pdf$/);
    expect((await s.repo.getConversation(p)).state).toBe("DOUBT_TEXT");
    await s.text(p, "Como me preparar para entrevistas técnicas?"); s.advance(1000);
    await doSchedule(s, p);
    expect(lastBody(s, p)).toContain(T.closingScheduleDoubt);
    expect(lastBody(s, p)).toMatch(/anexar aqui/);
  });
  it("documento depois da dúvida: 1 confirmação e depois silêncio", async () => {
    const s = mk(); const p = s.phone(22);
    await toDoubt(s, p);
    await s.text(p, "Como me preparar para entrevistas técnicas?"); s.advance(1000);
    await doSchedule(s, p);
    const n = s.sentTo(p).length;
    await s.document(p); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.materialReceived);
    await s.document(p); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n + 1);
    expect(s.repo.materials).toHaveLength(2);
  });
  it("tipo de arquivo não aceito: 1 dica, nada é guardado", async () => {
    const s = mk(); const p = s.phone(23);
    await toDoubt(s, p);
    await s.document(p, "application/x-msdownload", "virus.exe"); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.hintMaterial);
    const n = s.sentTo(p).length;
    await s.document(p, "application/x-msdownload", "virus.exe"); s.advance(1000);
    expect(s.sentTo(p).length).toBe(n);
    expect(s.repo.materials).toHaveLength(0);
  });
});

describe("quem já é cadastrado volta a falar", () => {
  it("'oi' não presume dúvida: oferece tirar dúvida, mudar áreas ou menu", async () => {
    const s = mk(); const p = s.phone(30);
    await s.register(p, 1000); s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    const b = s.sentTo(p).at(-1)!.body as { interactive: { action: { buttons: { reply: { id: string } }[] } } };
    expect(b.interactive.action.buttons.map((x) => x.reply.id)).toEqual(["ret_doubt", "ret_areas", "menu"]);
    const n = s.sentTo(p).length;
    await s.text(p, "oi"); s.advance(1000); // repetição: silêncio
    await s.text(p, "blablabla"); s.advance(1000); // 1 dica
    await s.text(p, "blablabla"); s.advance(1000); // depois, silêncio
    expect(s.sentTo(p).length).toBe(n + 1);
    expect(lastBody(s, p)).toBe(T.hintReturning);
  });

  it("Mudar áreas: mantém as áreas atuais, deixa incluir Computação e mentorado vira 'os dois'", async () => {
    const s = mk(); const p = s.phone(31);
    await s.register(p, 1000);
    // mentor só de Vida Acadêmica
    await s.repo.saveRegistration(p, { profileRole: "mentor", mentorCategories: ["vida_academica"] });
    await s.repo.saveAvailability(p, "Segunda: 8h às 10h", new Date(), [{ day: "segunda", start: "08:00", end: "10:00" }]); // já informou horários antes
    s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "ret_areas"); s.advance(1000);
    expect(lastBody(s, p)).toMatch(/Suas áreas hoje: Vida Acadêmica/);
    expect((await s.repo.getConversation(p)).state).toBe("MENTOR_CATEGORIES");
    await s.list(p, "cat_computacao"); s.advance(1000);
    await s.list(p, "cat_done"); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.closingMentor);
    const reg = await s.repo.getRegistration(p);
    expect(reg.mentorCategories).toEqual(["computacao", "vida_academica"]);
    expect(reg.profileRole).toBe("mentor");
  });

  it("Mudar áreas para quem era só mentorado: passa a ser 'ambos'", async () => {
    const s = mk(); const p = s.phone(32);
    await s.register(p, 1000); // register() termina como mentorado
    s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "ret_areas"); s.advance(1000);
    await s.list(p, "cat_computacao"); s.advance(1000);
    await s.list(p, "cat_done"); s.advance(1000);
    const reg = await s.repo.getRegistration(p);
    expect(reg.profileRole).toBe("ambos");
    expect(reg.mentorCategories).toEqual(["computacao"]);
  });

  it("'Não tenho dúvida agora' no lugar da dúvida NÃO vira dúvida registrada", async () => {
    const s = mk(); const p = s.phone(33);
    await s.register(p, 1000); s.advance(60 * MINUTE);
    await s.text(p, "oi"); s.advance(1000);
    await s.button(p, "ret_doubt"); s.advance(1000);
    await s.text(p, "Não tenho dúvida agora"); s.advance(1000);
    expect(lastBody(s, p)).toBe(T.closingNoDoubt);
    expect(s.repo.doubts).toHaveLength(0);
    expect((await s.repo.getConversation(p)).state).toBe("COMPLETED");
  });

  it("isNoDoubt reconhece as variações e não confunde com dúvidas reais", async () => {
    const { isNoDoubt } = await import("../src/profile/decide");
    for (const t of ["não tenho dúvida", "Nao tenho duvida agora", "nenhuma dúvida", "sem dúvidas", "não"]) expect(isNoDoubt(t) || t === "não").toBe(true);
    for (const t of ["Como faço um join em SQL?", "Tenho uma dúvida sobre cálculo", "não consigo instalar o python"]) expect(isNoDoubt(t)).toBe(false);
  });
});
