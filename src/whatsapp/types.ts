/** Eventos tipados extraídos do payload do webhook da Meta. */
export interface MessageBase {
  /** ID da mensagem (usado para idempotência). */
  wamid: string;
  /** Telefone de quem enviou (wa_id). */
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
  /** JSON bruto (string) do formulário do Flow. */
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
  /** Tipo original informado pela Meta (sticker, reaction, image...). */
  rawType: string;
}

export interface StatusPricing {
  billable?: boolean;
  pricingModel?: string;
  type?: string;
  category?: string;
}

export interface StatusEvent {
  type: "status";
  /** wamid da mensagem enviada por nós. */
  id: string;
  status: string;
  recipientId?: string;
  timestamp?: number;
  pricing?: StatusPricing;
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

export type WebhookEvent = IncomingMessage | StatusEvent;
