-- Etapa 4: cadastro com consentimento LGPD (R6). Requer 0001 (users).
-- Acesso: RLS ligado e nenhuma policy => só a service key do Worker (que ignora RLS) lê e grava.
-- wa_id (telefone) fica em texto, mas protegido por RLS; os logs usam só wa_id_hash.
alter table users add column if not exists wa_id_hash text;
alter table users add column if not exists full_name text;
alter table users add column if not exists email text;
alter table users add column if not exists city text;
alter table users add column if not exists consent_at timestamptz;
alter table users add column if not exists terms_version text;
alter table users add column if not exists registered_at timestamptz;

alter table users enable row level security;

-- R6 no próprio banco: sem consentimento (data + versão do termo), nenhum dado de cadastro.
alter table users drop constraint if exists users_consent_before_data;
alter table users add constraint users_consent_before_data check (
  (full_name is null and email is null and city is null and registered_at is null)
  or (consent_at is not null and terms_version is not null)
);

create index if not exists users_wa_id_hash_idx on users (wa_id_hash);

-- Defesa extra: papéis públicos do Supabase não acessam a tabela (só roda onde os papéis existem).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table users from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table users from authenticated';
  end if;
end $$;
