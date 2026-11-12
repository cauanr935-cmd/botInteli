-- Temas sensíveis (specs.md): só o EVENTO (nível, canal, data). O texto da mensagem NUNCA é guardado.
create table if not exists sensitive_events (
  id bigserial primary key,
  wa_id_hash text not null,
  level text not null check (level in ('A', 'B')),
  channel text not null,
  created_at timestamptz not null default now()
);
create index if not exists sensitive_events_user_idx on sensitive_events (wa_id_hash, created_at desc);
alter table sensitive_events enable row level security;
