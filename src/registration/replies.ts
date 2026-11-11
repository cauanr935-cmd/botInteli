// Montagem das mensagens do cadastro (puro). Limites da Meta: botão <= 20, lista: título <= 24, descrição <= 72, corpo <= 1024.
import type { Reply } from "../conversation/texts";
import { FIELDS } from "./fields";
import { fallbackContent, type Content } from "../services/content";
import { buildButtons } from "../whatsapp/builders";
import { CONSENT_BUTTON_ID, NAME_NO_ID, NAME_YES_ID, REG_TEXTS } from "./texts";

const FLOW_SCREEN = "CADASTRO";
const PROFILE_AUDIO_TEXT =
  "Agora, conte curiosidades sobre você: sua data de nascimento, seu esporte favorito, o time do seu coração e seus hobbies e interesses. Pode gravar um áudio ou, se preferir, escrever. Fique à vontade!";

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

/** Boas-vindas (idêntica para qualquer mensagem inicial): termo + botão Aceito, numa mensagem. */
export function consentWelcomeReply(privacyUrl: string, c: Content = fallbackContent): Reply {
  return buildButtons(
    `${c.text("consentWelcome", REG_TEXTS.consentWelcome)} ${privacyUrl}\n\n${c.text("consentAfterLink", REG_TEXTS.consentAfterLink)}`,
    [{ id: CONSENT_BUTTON_ID, title: c.text("consentButton", REG_TEXTS.consentButton, 20) }],
  );
}

/** "{name} é mesmo o seu nome?" com Sim/Não. Sem nome (retomada depois do "sair"), pergunta genérica. */
export function nameConfirmReply(name: string | null, c: Content = fallbackContent): Reply {
  const body = name
    ? c.text("nameConfirm", REG_TEXTS.nameConfirm).replace("{name}", name.slice(0, 100))
    : c.text("nameConfirmGeneric", REG_TEXTS.nameConfirmGeneric);
  return buildButtons(body.slice(0, 1024), [
    { id: NAME_YES_ID, title: c.text("nameConfirmYes", REG_TEXTS.nameConfirmYes, 20) },
    { id: NAME_NO_ID, title: c.text("nameConfirmNo", REG_TEXTS.nameConfirmNo, 20) },
  ]);
}

export function fieldPromptReply(index: number): Reply {
  return { type: "text", text: { body: FIELDS[index]?.prompt ?? "" } };
}

/** Solicita o áudio de apresentação depois que o nome foi informado. */
export const profileAudioPrompt = (): Extract<Reply, { type: "text" }> => ({
  type: "text",
  text: { body: PROFILE_AUDIO_TEXT },
});
export const registrationComplete = (): Extract<Reply, { type: "text" }> => ({
  type: "text",
  text: { body: REG_TEXTS.registered },
});

/** Todos os textos fixos do cadastro (varridos pelo teste de textos proibidos). */
export function allRegistrationTexts(): string[] {
  return [...Object.values(REG_TEXTS), ...FIELDS.flatMap((f) => [f.prompt, f.hint]), profileAudioPrompt().text.body, registrationComplete().text.body];
}
