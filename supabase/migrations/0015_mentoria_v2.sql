-- Mentoria v2 (Etapa 1): data, parceiro e confirmação dele. Requer 0001-0014.
-- A voz do parceiro está na gravação: só pode ser confirmada/contestada por quem tem consentimento (R6).

-- Rascunho em andamento (por pessoa): qual áudio guardado está sendo descrito e a data informada.
alter table users add column if not exists draft_audio_id uuid;
alter table users add column if not exists draft_ocorreu_em date;

-- Mentoria: quando aconteceu, quem é o parceiro e o que ele respondeu.
alter table audios add column if not exists ocorreu_em date;
alter table audios add column if not exists partner_wa_id_hash text;
-- Quando a pergunta de confirmação foi entregue ao parceiro (nulo = ainda pendente de entrega).
alter table audios add column if not exists partner_prompted_at timestamptz;
alter table audios add column if not exists partner_confirmed_at timestamptz;
alter table audios add column if not exists partner_rejected_at timestamptz;
-- SHA-256 dos bytes guardados (Etapa 2) e instante em que o objeto saiu do R2 (Etapa 3; também na recusa/expiração).
alter table audios add column if not exists audio_sha256 text;
alter table audios add column if not exists audio_deleted_at timestamptz;
-- Por que a mentoria não segue para o notebook: 'recusada' (parceiro disse Não) ou 'expirada' (7 dias sem resposta).
alter table audios add column if not exists contested_reason text check (contested_reason in ('recusada', 'expirada'));

alter table audios drop constraint if exists audios_partner_not_self;
alter table audios add constraint audios_partner_not_self
  check (partner_wa_id_hash is null or partner_wa_id_hash <> wa_id_hash);

create index if not exists audios_partner_pending_idx on audios (partner_wa_id_hash)
  where partner_confirmed_at is null and partner_rejected_at is null and contested_reason is null and audio_deleted_at is null;

-- R6 no banco, também para o parceiro: só quem consentiu pode confirmar ou contestar.
create or replace function audios_partner_requires_consent()
returns trigger
language plpgsql
as $$
begin
  if new.partner_confirmed_at is not null or new.partner_rejected_at is not null then
    if new.partner_wa_id_hash is null or not exists (
      select 1 from users
       where wa_id_hash = new.partner_wa_id_hash and consent_at is not null and terms_version is not null
    ) then
      raise exception 'parceiro sem consentimento' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists audios_partner_consent_check on audios;
create trigger audios_partner_consent_check before insert or update on audios
  for each row execute function audios_partner_requires_consent();

-- Busca de parceiro por nome entre quem já se cadastrou e consentiu (sem acento, todas as palavras).
create or replace function find_people_by_name(p_tokens text[], p_limit integer)
returns table (wa_id text, wa_id_hash text, full_name text)
language sql
stable
as $$
  select u.wa_id, u.wa_id_hash, u.full_name
    from users u
   where cardinality(p_tokens) >= 1
     and u.consent_at is not null and u.terms_version is not null and u.registered_at is not null
     and u.wa_id_hash is not null and u.full_name is not null
     and not exists (
       select 1 from unnest(p_tokens) t
        where position(t in translate(lower(u.full_name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) = 0
     )
   order by u.full_name
   limit greatest(1, least(p_limit, 10));
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function find_people_by_name(text[], integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function find_people_by_name(text[], integer) from authenticated';
  end if;
end $$;
