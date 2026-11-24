-- Novo serviço no menu: "Marcar nova mentoria" (abre o pedido de mentoria: o que precisa -> horários -> mentor). Idempotente.
insert into services (id, title, description, requires_audio, active, sort_order) values
  ('nova_mentoria', 'Marcar nova mentoria', 'Peça um mentor para te ajudar', false, true, 10)
on conflict (id) do update set title = excluded.title, description = excluded.description,
  requires_audio = excluded.requires_audio, active = excluded.active, sort_order = excluded.sort_order;
