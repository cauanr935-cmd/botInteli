-- Etapa 5 (tentativa 2): último serviço sem áudio respondido; repetir a mesma escolha = silêncio (R2).
alter table users add column if not exists last_service_id text;
