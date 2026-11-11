-- Horários livres lidos pela IA: faixas estruturadas [{day, start, end}] (o texto original continua em users.availability). Requer 0011.
alter table users add column if not exists availability_slots jsonb check (availability_slots is null or jsonb_typeof(availability_slots) = 'array');
