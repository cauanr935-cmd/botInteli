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
