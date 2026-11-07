// Construtores de mensagens interativas/texto. Validam os limites da Meta e RECUSAM (lançam) acima deles.
// Este arquivo só monta o corpo: o envio é exclusivo de sendGuarded (R1).
export const LIMITS = {
  body: 1024,
  buttonTitle: 20,
  maxButtons: 3,
  listRowTitle: 24,
  listRowDescription: 72,
  listMaxRows: 10,
  listButton: 20,
  sectionTitle: 24,
  id: 200,
} as const;

export class MessageLimitError extends Error {}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new MessageLimitError(msg);
}

function checkBody(body: string): void {
  check(body.trim().length > 0, "corpo vazio");
  check(body.length <= LIMITS.body, `corpo acima de ${LIMITS.body} caracteres`);
}

export function buildText(body: string): { type: "text"; text: { body: string } } {
  checkBody(body);
  return { type: "text", text: { body } };
}

export interface ButtonSpec { id: string; title: string }

export function buildButtons(body: string, buttons: readonly ButtonSpec[]): { type: "interactive"; interactive: unknown } {
  checkBody(body);
  check(buttons.length >= 1, "botões: mínimo 1");
  check(buttons.length <= LIMITS.maxButtons, `botões: máximo ${LIMITS.maxButtons}`);
  for (const b of buttons) {
    check(b.title.length >= 1 && b.title.length <= LIMITS.buttonTitle, `título de botão acima de ${LIMITS.buttonTitle}`);
    check(b.id.length >= 1 && b.id.length <= LIMITS.id, "id de botão inválido");
  }
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
    },
  };
}

export interface RowSpec { id: string; title: string; description?: string }

export function buildList(
  body: string, buttonText: string, sectionTitle: string, rows: readonly RowSpec[],
): { type: "interactive"; interactive: unknown } {
  checkBody(body);
  check(buttonText.length >= 1 && buttonText.length <= LIMITS.listButton, `botão da lista acima de ${LIMITS.listButton}`);
  check(sectionTitle.length >= 1 && sectionTitle.length <= LIMITS.sectionTitle, `título da seção acima de ${LIMITS.sectionTitle}`);
  check(rows.length >= 1, "lista: mínimo 1 linha");
  check(rows.length <= LIMITS.listMaxRows, `lista: máximo ${LIMITS.listMaxRows} linhas`);
  for (const r of rows) {
    check(r.title.length >= 1 && r.title.length <= LIMITS.listRowTitle, `título de linha acima de ${LIMITS.listRowTitle}`);
    check((r.description ?? "").length <= LIMITS.listRowDescription, `descrição acima de ${LIMITS.listRowDescription}`);
    check(r.id.length >= 1 && r.id.length <= LIMITS.id, "id de linha inválido");
  }
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonText,
        sections: [{
          title: sectionTitle,
          rows: rows.map((r) => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) })),
        }],
      },
    },
  };
}
