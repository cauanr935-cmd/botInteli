-- Mentorias: dados coletados antes do áudio, metadados guardados junto do áudio, resultado do analisador
-- e controle de tentativas de login do painel. Requer 0001-0008.

-- Rascunho da mentoria em andamento (uma por pessoa; limpo quando o áudio é guardado).
alter table users add column if not exists draft_role text check (draft_role in ('mentor', 'mentorado'));
alter table users add column if not exists draft_subject text;
alter table users add column if not exists draft_partner text;

-- Cada áudio de mentoria guarda os metadados informados na conversa.
alter table audios add column if not exists mentoria_role text check (mentoria_role in ('mentor', 'mentorado'));
alter table audios add column if not exists subject text;
alter table audios add column if not exists partner text;
-- Resultado devolvido pelo analisador externo (via API). Nulo = análise pendente.
alter table audios add column if not exists analysis_result jsonb;
alter table audios add column if not exists analysis_at timestamptz;

create index if not exists audios_pending_idx on audios (created_at) where analysis_result is null and subject is not null;

-- Tentativas de login do painel (bloqueio por origem). Só a service key do Worker acessa.
create table if not exists panel_login_attempts (
  key text primary key,
  failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table panel_login_attempts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table panel_login_attempts from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table panel_login_attempts from authenticated';
  end if;
end $$;

-- Serviço do menu que inicia o registro de uma mentoria.
insert into services (id, title, description, requires_audio, active, sort_order) values
  ('mentoria', 'Registrar mentoria', 'Conte o assunto e envie o áudio', true, true, 5)
on conflict (id) do nothing;
