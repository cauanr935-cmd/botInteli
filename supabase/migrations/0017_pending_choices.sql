-- Canal Evolution/Baileys: botões e listas viram texto numerado ("1) ...", "2) ...").
-- Para traduzir a resposta "2" de volta ao id da opção, guardamos as últimas opções enviadas por pessoa.
-- Só ids e títulos das opções do menu (nunca texto livre da pessoa); chave = hash do telefone.
create table if not exists pending_choices (
  wa_id_hash text primary key,
  options jsonb not null,
  created_at timestamptz not null default now()
);
alter table pending_choices enable row level security;
