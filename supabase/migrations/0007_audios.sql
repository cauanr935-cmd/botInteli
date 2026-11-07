-- Etapa 6: áudios recebidos. Voz é dado pessoal (R6): só entra com consentimento registrado.
create table if not exists audios (
  id uuid primary key,
  wa_id_hash text not null,
  r2_key text not null,
  mime text not null,
  bytes integer not null check (bytes > 0),
  service_id text,
  status text not null default 'processing' check (status in ('processing', 'done', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists audios_user_idx on audios (wa_id_hash, created_at);

-- R6 no banco: recusa o áudio se a pessoa não tem consentimento gravado.
create or replace function audios_require_consent()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from users where wa_id_hash = new.wa_id_hash and consent_at is not null
  ) then
    raise exception 'audio sem consentimento' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists audios_consent_check on audios;
create trigger audios_consent_check before insert on audios
  for each row execute function audios_require_consent();

alter table audios enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table audios from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table audios from authenticated';
  end if;
end $$;
