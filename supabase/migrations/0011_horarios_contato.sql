-- Horários livres (texto livre) e ajustes do menu: sem "Análise de áudio"; Contato com o WhatsApp do Cauã. Requer 0001-0010.
alter table users add column if not exists availability text check (availability is null or char_length(availability) <= 500);
alter table users add column if not exists availability_at timestamptz;

-- "Análise de áudio" não existe mais.
update services set active = false where id = 'audio';

insert into services (id, title, description, requires_audio, active, sort_order) values
  ('mentoria', 'Registrar mentoria', 'Anexe o áudio da mentoria', true, true, 5),
  ('horarios', 'Horários', 'Informe seus dias e horários livres', false, true, 20),
  ('contato', 'Contato', 'Fale com o Cauã, da Be My Mentor', false, true, 30)
on conflict (id) do update set title = excluded.title, description = excluded.description,
  requires_audio = excluded.requires_audio, active = excluded.active, sort_order = excluded.sort_order;

insert into canned_responses (key, text) values
  ('service_contato', 'Fale com o Cauã, um dos fundadores da Be My Mentor, pelo WhatsApp: 88 99289-5332 (https://wa.me/5588992895332).')
on conflict (key) do update set text = excluded.text, updated_at = now();
