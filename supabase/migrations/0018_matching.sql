-- Matching manual mentorado <-> mentor (feito por um admin pelo WhatsApp). Requer 0001-0017.
-- Mentores continuam sendo `users` (profile_role mentor/ambos); a view mentors_view só os expõe com id curto.

-- Dúvidas: dono em texto (para o bot escrever ao mentorado), status e id curto legível ("D12").
alter table doubts add column if not exists wa_id text;
alter table doubts add column if not exists status text not null default 'aberta';
alter table doubts add column if not exists seq bigint generated always as identity;
alter table doubts drop constraint if exists doubts_status_check;
alter table doubts add constraint doubts_status_check check (status in ('aberta', 'em_match', 'concluida', 'cancelada'));
create unique index if not exists doubts_seq_idx on doubts (seq);
create index if not exists doubts_status_idx on doubts (status, created_at);

-- Id curto do mentor ("M3") para o comando /match.
alter table users add column if not exists seq bigint generated always as identity;
create unique index if not exists users_seq_idx on users (seq);

create or replace view mentors_view as
  select seq, wa_id, wa_id_hash, full_name, mentor_categories, availability_slots, availability_at
  from users
  where profile_role in ('mentor', 'ambos') and registered_at is not null and consent_at is not null;

-- Matches: um por dúvida. `status` guarda o andamento do fluxo automático.
create table if not exists matches (
  id uuid primary key,
  seq bigint generated always as identity,
  doubt_id uuid not null references doubts (id),
  mentor_wa_id text not null,
  mentee_wa_id text not null,
  status text not null default 'aguardando_mentor'
    check (status in ('aguardando_mentor', 'aguardando_mentorado', 'aguardando_local', 'confirmado', 'sem_horario', 'cancelado')),
  mentor_slots jsonb check (mentor_slots is null or jsonb_typeof(mentor_slots) = 'array'),
  chosen_day text,
  chosen_start text,
  chosen_end text,
  location text check (location is null or char_length(location) between 1 and 200),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists matches_seq_idx on matches (seq);
create index if not exists matches_mentor_idx on matches (mentor_wa_id, status);
create index if not exists matches_mentee_idx on matches (mentee_wa_id, status);
-- Só um match ativo por dúvida.
create unique index if not exists matches_one_active_per_doubt on matches (doubt_id) where status <> 'cancelado';

alter table matches enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table matches from anon';
    execute 'revoke all on mentors_view from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table matches from authenticated';
    execute 'revoke all on mentors_view from authenticated';
  end if;
end $$;
