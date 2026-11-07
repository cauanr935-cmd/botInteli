// Montagem das mensagens do cadastro (puro). Limites da Meta: botão <= 20, lista: título <= 24, descrição <= 72, corpo <= 1024.
import type { Reply } from "../conversation/texts";
import { FIELDS } from "./fields";
import { CONSENT_BUTTON_ID, PROVISIONAL_SERVICES, REG_TEXTS } from "./texts";

const FLOW_SCREEN = "CADASTRO";

/** Boas-vindas que SÃO o formulário (1 mensagem). */
export function flowWelcomeReply(flowId: string): Reply {
  return {
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: REG_TEXTS.flowWelcome },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: "cadastro",
          flow_id: flowId,
          flow_cta: REG_TEXTS.flowCta,
          flow_action: "navigate",
          flow_action_payload: { screen: FLOW_SCREEN },
        },
      },
    },
  };
}

/** Boas-vindas do fallback: termo + botão Aceito + a primeira pergunta, tudo numa mensagem. */
export function consentWelcomeReply(privacyUrl: string): Reply {
  const first = FIELDS[0]?.prompt ?? "";
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `${REG_TEXTS.consentWelcome} ${privacyUrl}\n\n${REG_TEXTS.consentAfterLink}${first}` },
      action: { buttons: [{ type: "reply", reply: { id: CONSENT_BUTTON_ID, title: REG_TEXTS.consentButton } }] },
    },
  };
}

export function fieldPromptReply(index: number): Reply {
  return { type: "text", text: { body: FIELDS[index]?.prompt ?? "" } };
}

/** Confirmação + menu de serviços (lista) numa mensagem só. */
export function menuListReply(intro: string): Reply {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: intro },
      action: {
        button: REG_TEXTS.menuButton,
        sections: [{ title: REG_TEXTS.menuSection, rows: PROVISIONAL_SERVICES.map((s) => ({ ...s })) }],
      },
    },
  };
}

export const confirmationAndMenu = (): Reply => menuListReply(REG_TEXTS.registered);
export const welcomeBackMenu = (): Reply => menuListReply(REG_TEXTS.welcomeBack);

/** Todos os textos fixos do cadastro (varridos pelo teste de textos proibidos). */
export function allRegistrationTexts(): string[] {
  return [...Object.values(REG_TEXTS), ...FIELDS.flatMap((f) => [f.prompt, f.hint])];
}
