-- Etapa 3: estado da conversa por pessoa (motor anti-spam, R2).
-- Requer 0001 (users) e 0002 (outbound_log).
alter table users add column if not exists state text not null default 'NEW';
alter table users add column if not exists previous_state text;
alter table users add column if not exists hint_sent_in_state boolean not null default false;
alter table users add column if not exists opted_out_at timestamptz;
-- Versão para compare-and-set: duas mensagens simultâneas não geram duas respostas.
alter table users add column if not exists version integer not null default 0;

-- Limites por pessoa consultam outbound_log por (hash, horário).
create index if not exists outbound_log_user_time_idx on outbound_log (wa_id_hash, reserved_at);
