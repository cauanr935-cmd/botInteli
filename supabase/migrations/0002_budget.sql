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
