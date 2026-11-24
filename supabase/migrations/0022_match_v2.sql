-- Matching v2: o mentor aceita ou recusa antes dos horários; a mentoria tem horário MARCADO (scheduled_at, em UTC) e os
-- nomes só são enviados 5 minutos antes (names_sent_at = já enviou). Depois do áudio registrado o match vira 'realizada'.
-- Requer 0018. Idempotente.
alter table matches add column if not exists scheduled_at timestamptz;
alter table matches add column if not exists names_sent_at timestamptz;
alter table matches drop constraint if exists matches_status_check;
alter table matches add constraint matches_status_check
  check (status in ('aguardando_mentor', 'aguardando_mentorado', 'aguardando_local', 'confirmado', 'realizada', 'sem_horario', 'cancelado'));
create index if not exists matches_scheduled_idx on matches (scheduled_at) where status = 'confirmado' and names_sent_at is null;



