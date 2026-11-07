// Montagem das mensagens do cadastro (puro). Limites da Meta: botão <= 20, lista: título <= 24, descrição <= 72, corpo <= 1024.
import type { Reply } from "../conversation/texts";
import { FIELDS } from "./fields";
import { fallbackContent, type Content } from "../services/content";
import { menuReply } from "../services/menu";
import { buildButtons } from "../whatsapp/builders";
import { CONSENT_BUTTON_ID, REG_TEXTS } from "./texts";

const FLOW_SCREEN = "CADASTRO";

/** Boas-vindas que SÃO o formulário (1 mensagem). */
export function flowWelcomeReply(flowId: string, c: Content = fallbackContent): Reply {
  return {
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: c.text("flowWelcome", REG_TEXTS.flowWelcome) },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: "cadastro",
          flow_id: flowId,
          flow_cta: c.text("flowCta", REG_TEXTS.flowCta, 20),
          flow_action: "navigate",
          flow_action_payload: { screen: FLOW_SCREEN },
        },
      },
    },
  };
}

/** Boas-vindas do fallback: termo + botão Aceito + a primeira pergunta, tudo numa mensagem. */
export function consentWelcomeReply(privacyUrl: string, c: Content = fallbackContent): Reply {
  const first = FIELDS[0]?.prompt ?? "";
  return buildButtons(
    `${c.text("consentWelcome", REG_TEXTS.consentWelcome)} ${privacyUrl}\n\n${REG_TEXTS.consentAfterLink}${first}`,
    [{ id: CONSENT_BUTTON_ID, title: c.text("consentButton", REG_TEXTS.consentButton, 20) }],
  );
}

export function fieldPromptReply(index: number): Reply {
  return { type: "text", text: { body: FIELDS[index]?.prompt ?? "" } };
}

/** Confirmação + menu de serviços (lista, vinda do banco) numa mensagem só. */
export const confirmationAndMenu = (c: Content = fallbackContent): Reply =>
  menuReply(c, c.text("registered", REG_TEXTS.registered));
export const welcomeBackMenu = (c: Content = fallbackContent): Reply =>
  menuReply(c, c.text("welcomeBack", REG_TEXTS.welcomeBack));

/** Todos os textos fixos do cadastro (varridos pelo teste de textos proibidos). */
export function allRegistrationTexts(): string[] {
  return [...Object.values(REG_TEXTS), ...FIELDS.flatMap((f) => [f.prompt, f.hint])];
}
