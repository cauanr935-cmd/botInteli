-- Aviso da decisão da equipe (curadoria): o notebook reenvia o resultado sempre que o resumo muda; o bot só avisa
-- a pessoa quando a situação dela muda para "aprovada" ou "recusada", uma vez por mudança. Idempotente.
-- Última situação já notificada, por pessoa: {"<pessoa_id>": "aprovada" | "recusada" | "aguardando_equipe"}.
alter table audios add column if not exists notified_curadoria jsonb
  check (notified_curadoria is null or jsonb_typeof(notified_curadoria) = 'object');

-- Reserva atômica do aviso: grava a nova situação só se ela ainda não foi notificada. true = quem chamou deve enviar
-- (dois reenvios simultâneos do mesmo resumo não mandam duas mensagens).
create or replace function claim_curadoria_notice(p_id uuid, p_pessoa text, p_situacao text)
returns boolean language plpgsql as $$
declare n integer;
begin
  update audios
     set notified_curadoria = jsonb_set(coalesce(notified_curadoria, '{}'::jsonb), array[p_pessoa], to_jsonb(p_situacao), true)
   where id = p_id and coalesce(notified_curadoria ->> p_pessoa, '') <> p_situacao;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Desfaz a reserva quando o envio falhou (só se ninguém a mudou depois): a próxima reenvio do resumo tenta de novo.
create or replace function release_curadoria_notice(p_id uuid, p_pessoa text, p_situacao text, p_previous text)
returns boolean language plpgsql as $$
declare n integer;
begin
  update audios
     set notified_curadoria = case when p_previous is null then notified_curadoria - p_pessoa
                                   else jsonb_set(notified_curadoria, array[p_pessoa], to_jsonb(p_previous), true) end
   where id = p_id and notified_curadoria ->> p_pessoa = p_situacao;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Pedidos de revisão humana (botão "Pedir revisão" da mensagem de recusa; LGPD art. 20). Um por mentoria e pessoa.
-- Só o hash da pessoa (nunca telefone). A equipe atende pelo notebook (mentorias decidir --forcar).
create table if not exists revisao_pedidos (
  id uuid primary key default gen_random_uuid(),
  audio_id uuid not null references audios (id) on delete cascade,
  wa_id_hash text not null,
  status text not null default 'aberta' check (status in ('aberta', 'atendida')),
  created_at timestamptz not null default now(),
  unique (audio_id, wa_id_hash)
);
create index if not exists revisao_pedidos_status_idx on revisao_pedidos (status, created_at);

alter table revisao_pedidos enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table revisao_pedidos from anon';
    execute 'revoke execute on function claim_curadoria_notice(uuid, text, text) from anon';
    execute 'revoke execute on function release_curadoria_notice(uuid, text, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table revisao_pedidos from authenticated';
    execute 'revoke execute on function claim_curadoria_notice(uuid, text, text) from authenticated';
    execute 'revoke execute on function release_curadoria_notice(uuid, text, text, text) from authenticated';
  end if;
end $$;
