-- Corrige o nome do fundador no menu e na resposta do Contato: é "Cauan" (a migração 0011 gravou "Cauã"). Idempotente.
update services set description = 'Fale com o Cauan, da Be My Mentor' where id = 'contato';
insert into canned_responses (key, text) values
  ('service_contato', 'Fale com o Cauan, um dos fundadores da Be My Mentor (junto com o Bruno), pelo WhatsApp: 88 99289-5332 (https://wa.me/5588992895332).')
on conflict (key) do update set text = excluded.text, updated_at = now();
