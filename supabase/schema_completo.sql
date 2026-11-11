-- ===== supabase/migrations/0001_processed_messages.sql =====
-- Etapa 1: idempotência por wamid e janela de 24h por usuário.
create table if not exists processed_messages (
  wamid text primary key,
  received_at timestamptz not null default now()
);

create table if not exists users (
  wa_id text primary key,
  last_user_message_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table processed_messages enable row level security;
alter table users enable row level security;

-- Atualiza o horário sem nunca regredir (entregas fora de ordem).
create or replace function touch_user(p_wa_id text, p_at timestamptz)
returns void
language sql
as $$
  insert into users (wa_id, last_user_message_at) values (p_wa_id, p_at)
  on conflict (wa_id) do update
    set last_user_message_at = greatest(users.last_user_message_at, excluded.last_user_message_at);
$$;

-- ===== supabase/migrations/0002_budget.sql =====
-- Etapa 2: disjuntor de orçamento (R1).
create table if not exists message_budget (
  phone_number_id text not null,
  month_key text not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  stop_at integer not null check (stop_at between 1 and 990),
  tripped boolean not null default false,
  trip_reason text,
  tripped_at timestamptz,
  warn_logged_at timestamptz,
  trip_logged_at timestamptz,
  primary key (phone_number_id, month_key)
);

-- Disjuntor MANUAL: independe do mês; só um humano desliga (endpoint admin).
create table if not exists budget_lock (
  phone_number_id text primary key,
  locked boolean not null default false,
  reason text,
  locked_at timestamptz,
  unlocked_at timestamptz,
  unlocked_by text
);

create table if not exists outbound_log (
  id uuid primary key default gen_random_uuid(),
  wa_id_hash text not null,
  message_type text not null,
  wamid text,
  reserved_at timestamptz not null default now(),
  sent_ok boolean not null default false,
  error_code text,
  pricing_billable boolean,
  pricing_type text,
  pricing_category text,
  status_updated_at timestamptz
);
create index if not exists outbound_log_wamid_idx on outbound_log (wamid);

alter table message_budget enable row level security;
alter table budget_lock enable row level security;
alter table outbound_log enable row level security;

-- Reserva ATÔMICA. Uma única instrução UPDATE ... WHERE ... RETURNING decide:
-- só incrementa se reserved_count < corte e não há trava manual.
-- O corte nunca passa de 990 (R1), mesmo que o chamador peça mais.
create or replace function reserve_outbound_slot_detail(
  p_phone_number_id text, p_month_key text, p_stop_at integer
) returns table (ok boolean, reserved_count integer, stop_at integer, tripped boolean)
language plpgsql
as $$
declare
  v_cap integer := least(p_stop_at, 990);
  v_count integer;
begin
  if v_cap is null or v_cap < 1 then
    raise exception 'stop_at invalido';
  end if;
  insert into message_budget as b (phone_number_id, month_key, reserved_count, stop_at)
  values (p_phone_number_id, p_month_key, 0, v_cap)
  on conflict (phone_number_id, month_key) do nothing;

  update message_budget as b
     set reserved_count = b.reserved_count + 1,
         stop_at = least(b.stop_at, v_cap),
         tripped = b.tripped or (b.reserved_count + 1 >= least(b.stop_at, v_cap)),
         trip_reason = case when b.reserved_count + 1 >= least(b.stop_at, v_cap)
                            then coalesce(b.trip_reason, 'limite mensal atingido') else b.trip_reason end,
         tripped_at = case when b.reserved_count + 1 >= least(b.stop_at, v_cap)
                           then coalesce(b.tripped_at, now()) else b.tripped_at end
   where b.phone_number_id = p_phone_number_id
     and b.month_key = p_month_key
     and b.reserved_count < least(b.stop_at, v_cap)
     and not exists (select 1 from budget_lock l where l.phone_number_id = p_phone_number_id and l.locked)
  returning b.reserved_count into v_count;

  if v_count is not null then
    return query select true, m.reserved_count, m.stop_at, m.tripped
      from message_budget m where m.phone_number_id = p_phone_number_id and m.month_key = p_month_key;
  else
    -- Sem vaga: garante o estado "aberto" se o contador já está no corte.
    update message_budget as b
       set tripped = true,
           trip_reason = coalesce(b.trip_reason, 'limite mensal atingido'),
           tripped_at = coalesce(b.tripped_at, now())
     where b.phone_number_id = p_phone_number_id and b.month_key = p_month_key
       and b.reserved_count >= least(b.stop_at, v_cap) and not b.tripped;
    return query select false, m.reserved_count, m.stop_at, m.tripped
      from message_budget m where m.phone_number_id = p_phone_number_id and m.month_key = p_month_key;
  end if;
end;
$$;

create or replace function reserve_outbound_slot(
  p_phone_number_id text, p_month_key text, p_stop_at integer
) returns boolean
language sql
as $$
  select d.ok from reserve_outbound_slot_detail(p_phone_number_id, p_month_key, p_stop_at) d;
$$;

create or replace function set_manual_lock(p_phone_number_id text, p_reason text)
returns void language sql as $$
  insert into budget_lock (phone_number_id, locked, reason, locked_at)
  values (p_phone_number_id, true, p_reason, now())
  on conflict (phone_number_id) do update
    set locked = true, reason = excluded.reason, locked_at = now();
$$;

create or replace function clear_manual_lock(p_phone_number_id text, p_by text)
returns void language sql as $$
  update budget_lock set locked = false, unlocked_at = now(), unlocked_by = p_by
   where phone_number_id = p_phone_number_id;
$$;

-- Alertas "uma vez por mês": devolve true só para quem conseguiu marcar.
create or replace function claim_budget_alert(p_phone_number_id text, p_month_key text, p_kind text)
returns boolean language plpgsql as $$
declare v_n integer;
begin
  if p_kind = 'warn' then
    update message_budget set warn_logged_at = now()
     where phone_number_id = p_phone_number_id and month_key = p_month_key and warn_logged_at is null;
  elsif p_kind = 'trip' then
    update message_budget set trip_logged_at = now()
     where phone_number_id = p_phone_number_id and month_key = p_month_key and trip_logged_at is null;
  else
    raise exception 'kind invalido';
  end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ===== supabase/migrations/0003_conversation.sql =====
-- Etapa 3: estado da conversa por pessoa (motor anti-spam, R2).
-- Requer 0001 (users) e 0002 (outbound_log).
alter table users add column if not exists state text not null default 'NEW';
alter table users add column if not exists previous_state text;
alter table users add column if not exists hint_sent_in_state boolean not null default false;
alter table users add column if not exists opted_out_at timestamptz;
-- Versão para compare-and-set: duas mensagens simultâneas não geram duas respostas.
alter table users add column if not exists version integer not null default 0;

-- Limites por pessoa consultam outbound_log por (hash, horário).
create index if not exists outbound_log_user_time_idx on outbound_log (wa_id_hash, reserved_at);

-- ===== supabase/migrations/0004_registration.sql =====
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

-- ===== supabase/migrations/0005_services.sql =====
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

-- ===== supabase/migrations/0006_last_service.sql =====
-- Etapa 5 (tentativa 2): último serviço sem áudio respondido; repetir a mesma escolha = silêncio (R2).
alter table users add column if not exists last_service_id text;

-- ===== supabase/migrations/0007_audios.sql =====
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

-- ===== supabase/migrations/0008_housekeeping.sql =====
-- Etapa 7: rotinas do cron diário.
-- Requer 0001 (processed_messages, users) e 0003 (state).

-- Quando o estado mudou pela última vez (detecta conversa presa em PROCESSING_AUDIO).
alter table users add column if not exists state_changed_at timestamptz not null default now();

create or replace function users_track_state_change()
returns trigger
language plpgsql
as $$
begin
  if new.state is distinct from old.state then
    new.state_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists users_state_change on users;
create trigger users_state_change before update on users
  for each row execute function users_track_state_change();

create index if not exists processed_messages_received_idx on processed_messages (received_at);

-- Se o Worker morreu no meio do processamento do áudio, a pessoa volta a AWAIT_AUDIO.
-- Não envia nada (R1/R2): só destrava o estado. Devolve quantas conversas foram liberadas.
create or replace function release_stuck_processing(p_before timestamptz)
returns integer
language sql
as $$
  with fixed as (
    update users
       set state = 'AWAIT_AUDIO', previous_state = null, hint_sent_in_state = false, version = version + 1
     where state = 'PROCESSING_AUDIO' and state_changed_at < p_before
    returning 1
  )
  select count(*)::integer from fixed;
$$;

-- ===== supabase/migrations/0009_mentorias.sql =====
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

