/** Eventos tipados extraídos do payload `messages.upsert` do webhook da Evolution (os mesmos que o motor sempre consumiu). */
export interface MessageBase {
  /** ID da mensagem (usado para idempotência): `key.id` do Baileys (o antigo wamid da Meta). */
  wamid: string;
  /** Telefone de quem enviou (só dígitos, E.164 sem +). Se o WhatsApp só informar um @lid, é o JID completo. */
  from: string;
  /** Epoch em segundos, se informado. */
  timestamp?: number;
}

export interface TextEvent extends MessageBase {
  type: "text";
  body: string;
}
export interface ButtonReplyEvent extends MessageBase {
  type: "button_reply";
  id: string;
  title: string;
}
export interface ListReplyEvent extends MessageBase {
  type: "list_reply";
  id: string;
  title: string;
}
export interface NfmReplyEvent extends MessageBase {
  type: "nfm_reply";
  /** JSON bruto (string) do formulário do Flow. (Não chega pelo Baileys; tipo mantido por compatibilidade com o motor.) */
  responseJson: string;
}
export interface AudioEvent extends MessageBase {
  type: "audio";
  mediaId: string;
  mimeType?: string;
  /** true quando é nota de voz. */
  voice: boolean;
}
export interface DocumentEvent extends MessageBase {
  type: "document";
  mediaId: string;
  mimeType?: string;
  filename?: string;
}
/** Contato compartilhado: só o que identifica a pessoa no WhatsApp (nunca vai para log). */
export interface ContactsEvent extends MessageBase {
  type: "contacts";
  contacts: { waId?: string; phone?: string }[];
}
export interface UnsupportedEvent extends MessageBase {
  type: "unsupported";
  /** Tipo original informado pela Evolution/Baileys (sticker, reaction, image...). */
  rawType: string;
}

export type IncomingMessage =
  | TextEvent
  | ButtonReplyEvent
  | ListReplyEvent
  | NfmReplyEvent
  | AudioEvent
  | DocumentEvent
  | ContactsEvent
  | UnsupportedEvent;

/** Status de entrega/preço não são processados: no Baileys não há cobrança por conversa. */
export type WebhookEvent = IncomingMessage;
