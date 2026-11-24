-- Pedidos de certificado de horas (mentor e mentorado pedem pelo WhatsApp; a equipe emite pelo sistema). Um pedido ABERTO por
-- pessoa: repetir o pedido não cria outro. Só o hash da pessoa (nunca telefone). Idempotente.
create table if not exists certificado_pedidos (
  id uuid primary key default gen_random_uuid(),
  wa_id_hash text not null,
  status text not null default 'aberto' check (status in ('aberto', 'emitido')),
  created_at timestamptz not null default now()
);
create unique index if not exists certificado_pedidos_um_aberto on certificado_pedidos (wa_id_hash) where status = 'aberto';

alter table certificado_pedidos enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table certificado_pedidos from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table certificado_pedidos from authenticated';
  end if;
end $$;
