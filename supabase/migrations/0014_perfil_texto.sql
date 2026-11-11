-- Curiosidades do perfil também por texto (para quem prefere escrever a gravar áudio). Requer 0001-0013.
alter table users add column if not exists profile_about text check (profile_about is null or char_length(profile_about) <= 1000);

-- R6 no banco: nenhum dado de cadastro sem consentimento (agora inclui as curiosidades em texto).
alter table users drop constraint if exists users_consent_before_data;
alter table users add constraint users_consent_before_data check (
  (full_name is null and email is null and city is null and class_name is null and profile_role is null
    and mentor_categories is null and profile_about is null and registered_at is null)
  or (consent_at is not null and terms_version is not null)
);
