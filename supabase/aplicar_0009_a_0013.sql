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


-- Novo fluxo de cadastro: turma, papel (mentor/mentorado/ambos), áreas do mentor e dúvidas dos mentorados. Requer 0001-0009.
alter table users add column if not exists class_name text;
alter table users add column if not exists profile_role text check (profile_role in ('mentor', 'mentorado', 'ambos'));
alter table users add column if not exists mentor_categories text[];

-- R6 no banco: nenhum dado de cadastro sem consentimento (agora inclui turma, papel e áreas).
alter table users drop constraint if exists users_consent_before_data;
alter table users add constraint users_consent_before_data check (
  (full_name is null and email is null and city is null and class_name is null and profile_role is null
    and mentor_categories is null and registered_at is null)
  or (consent_at is not null and terms_version is not null)
);

-- Dúvidas dos mentorados (insumo do algoritmo de match). `categories` = triagem inicial por palavras-chave.
create table if not exists doubts (
  id uuid primary key,
  wa_id_hash text not null,
  text text not null check (char_length(text) between 1 and 500),
  categories text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists doubts_user_idx on doubts (wa_id_hash, created_at);

create or replace function doubts_require_consent()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from users where wa_id_hash = new.wa_id_hash and consent_at is not null) then
    raise exception 'duvida sem consentimento' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists doubts_consent_check on doubts;
create trigger doubts_consent_check before insert on doubts
  for each row execute function doubts_require_consent();

alter table doubts enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table doubts from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table doubts from authenticated';
  end if;
end $$;


-- Horários livres (texto livre) e ajustes do menu: sem "Análise de áudio"; Contato com o WhatsApp do Cauã. Requer 0001-0010.
alter table users add column if not exists availability text check (availability is null or char_length(availability) <= 500);
alter table users add column if not exists availability_at timestamptz;

-- "Análise de áudio" não existe mais.
update services set active = false where id = 'audio';

insert into services (id, title, description, requires_audio, active, sort_order) values
  ('mentoria', 'Registrar mentoria', 'Anexe o áudio da mentoria', true, true, 5),
  ('horarios', 'Horários', 'Informe seus dias e horários livres', false, true, 20),
  ('contato', 'Contato', 'Fale com o Cauã, da Be My Mentor', false, true, 30)
on conflict (id) do update set title = excluded.title, description = excluded.description,
  requires_audio = excluded.requires_audio, active = excluded.active, sort_order = excluded.sort_order;

insert into canned_responses (key, text) values
  ('service_contato', 'Fale com o Cauã, um dos fundadores da Be My Mentor, pelo WhatsApp: 88 99289-5332 (https://wa.me/5588992895332).')
on conflict (key) do update set text = excluded.text, updated_at = now();


-- Material anexado pelo mentorado junto da dúvida (documentos que o mentor deve ver antes da mentoria). Requer 0001-0011.
create table if not exists doubt_materials (
  id uuid primary key,
  wa_id_hash text not null,
  r2_key text not null,
  mime text not null,
  filename text check (filename is null or char_length(filename) <= 200),
  bytes integer not null check (bytes > 0),
  created_at timestamptz not null default now()
);
create index if not exists doubt_materials_user_idx on doubt_materials (wa_id_hash, created_at);

-- R6: nenhum material sem consentimento.
create or replace function doubt_materials_require_consent()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from users where wa_id_hash = new.wa_id_hash and consent_at is not null) then
    raise exception 'material sem consentimento' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists doubt_materials_consent_check on doubt_materials;
create trigger doubt_materials_consent_check before insert on doubt_materials
  for each row execute function doubt_materials_require_consent();

alter table doubt_materials enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table doubt_materials from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table doubt_materials from authenticated';
  end if;
end $$;


-- Horários livres lidos pela IA: faixas estruturadas [{day, start, end}] (o texto original continua em users.availability). Requer 0011.
alter table users add column if not exists availability_slots jsonb check (availability_slots is null or jsonb_typeof(availability_slots) = 'array');


