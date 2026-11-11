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
