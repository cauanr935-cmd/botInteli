-- Etapa 5: serviços do menu e respostas prontas. Acesso só pela service key (RLS ligado, sem policy).
create table if not exists services (
  id text primary key check (id ~ '^[a-z0-9_]{1,40}$'),
  title text not null check (char_length(title) between 1 and 24),
  description text not null default '' check (char_length(description) <= 72),
  requires_audio boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0
);
create index if not exists services_active_order_idx on services (active, sort_order);

create table if not exists canned_responses (
  key text primary key,
  text text not null check (char_length(text) between 1 and 1024),
  updated_at timestamptz not null default now()
);

alter table services enable row level security;
alter table canned_responses enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table services, canned_responses from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table services, canned_responses from authenticated';
  end if;
end $$;

-- Seeds de exemplo (idempotentes).
insert into services (id, title, description, requires_audio, active, sort_order) values
  ('audio', 'Análise de áudio', 'Envie um áudio e receba a análise', true, true, 10),
  ('horarios', 'Horários', 'Dias e horários de atendimento', false, true, 20),
  ('contato', 'Contato', 'Como falar com a equipe', false, true, 30)
on conflict (id) do nothing;

insert into canned_responses (key, text) values
  ('service_horarios', 'Atendemos de segunda a sexta, das 9h às 18h.'),
  ('service_contato', 'Fale com a equipe pelo e-mail contato@exemplo.com.')
on conflict (key) do nothing;
