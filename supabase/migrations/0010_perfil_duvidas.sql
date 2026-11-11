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
