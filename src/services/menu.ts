// Montagem do menu de serviços e das respostas por serviço (puro).
import type { Reply } from "../conversation/texts";
import { buildButtons, buildList } from "../whatsapp/builders";
import type { Content, Service } from "./content";

export const MENU_ROW_PREFIX = "svc_";
export const MENU_BUTTON_ID = "menu";

export const MENU_FALLBACKS = {
  menu: "Menu de serviços: escolha uma opção. Para parar de receber mensagens, envie *sair*.",
  menuButton: "Ver serviços",
  menuSection: "Serviços",
  menuButtonLabel: "Menu",
} as const;

/** Respostas prontas de serviços (usadas se o banco não tiver `service_<id>` em canned_responses). */
export const SERVICE_ANSWER_FALLBACKS: Record<string, string> = {
  contato: "Fale com o Cauã, um dos fundadores da Be My Mentor, pelo WhatsApp: 88 99289-5332 (https://wa.me/5588992895332).",
};

/** Menu = UMA mensagem de lista com os serviços ativos (até 10, em ordem). `intro` substitui o corpo padrão. */
export function menuReply(content: Content, intro?: string): Reply {
  return buildList(
    intro ?? content.text("menu", MENU_FALLBACKS.menu),
    content.text("menuButton", MENU_FALLBACKS.menuButton, 20),
    content.text("menuSection", MENU_FALLBACKS.menuSection, 24),
    content.services.map((s) => ({ id: `${MENU_ROW_PREFIX}${s.id}`, title: s.title, description: s.description })),
  );
}

export function findService(content: Content, rowId: string): Service | undefined {
  if (!rowId.startsWith(MENU_ROW_PREFIX)) return undefined;
  const id = rowId.slice(MENU_ROW_PREFIX.length);
  return content.services.find((s) => s.id === id);
}

/** Resposta pronta de um serviço sem áudio: 1 mensagem com o botão "Menu". */
export function serviceAnswerReply(content: Content, s: Service): Reply {
  const fallback = SERVICE_ANSWER_FALLBACKS[s.id] ?? (s.description ? `${s.title}: ${s.description}` : s.title);
  return buildButtons(content.text(`service_${s.id}`, fallback), [
    { id: MENU_BUTTON_ID, title: content.text("menuButtonLabel", MENU_FALLBACKS.menuButtonLabel, 20) },
  ]);
}
