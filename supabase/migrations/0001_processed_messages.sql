-- Etapa 1: idempotência por wamid e janela de 24h por usuário.
create table if not exists processed_messages (
  wamid text primary key,
  received_at timestamptz not null default now()
);

create table if not exists users (
  wa_id text primary key,
  last_user_message_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table processed_messages enable row level security;
alter table users enable row level security;

-- Atualiza o horário sem nunca regredir (entregas fora de ordem).
create or replace function touch_user(p_wa_id text, p_at timestamptz)
returns void
language sql
as $$
  insert into users (wa_id, last_user_message_at) values (p_wa_id, p_at)
  on conflict (wa_id) do update
    set last_user_message_at = greatest(users.last_user_message_at, excluded.last_user_message_at);
$$;
