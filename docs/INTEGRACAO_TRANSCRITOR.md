# Integração com o Transcritor (notebook)

> O documento completo vive no repositório do Transcritor. Aqui fica a cópia da **seção 2**, o contrato que o bot (`src/mentoria/api.ts`) implementa.

## 2. `GET /api/v1/mentorias` e `GET /api/v1/mentorias/<id>`

```json
{
  "id": "…", "mime": "audio/mp4", "bytes": 41234567, "created_at": "…", "analysis_pending": true,
  "ocorreu_em": "2026-11-12",
  "assunto": "Estruturas de dados no mercado",
  "audio_sha256": "…",
  "registrante": {"pessoa_id": "…", "nome": "…", "papel": "mentor",
                  "consentimento": {"em": "…", "termos": "v3"}, "instituicao": null},
  "parceiro":    {"pessoa_id": "…", "nome": "…", "papel": "mentorado",
                  "consentimento": {"em": "…", "termos": "v3"}, "instituicao": null,
                  "confirmado_em": "…"}
}
```

De onde vem cada campo:

- `id`, `mime`, `bytes`, `created_at`, `analysis_pending`: os mesmos de antes. Nenhum campo existente foi removido: `role`, `subject`, `partner`, `audio_url`, `analysis_result` e `analysis_at` continuam.
- `ocorreu_em`: `audios.ocorreu_em` (data informada na Etapa 1), `"AAAA-MM-DD"` ou `null`.
- `assunto`: o assunto informado (também vai em `subject`).
- `audio_sha256`: `audios.audio_sha256` (SHA-256 dos bytes gravados no R2), ou `null`.
- `registrante`: quem enviou o arquivo (`users` pelo `wa_id_hash` do áudio).
- `parceiro`: `users` pelo `partner_wa_id_hash`.
- `pessoa_id`: o `wa_id_hash`, que é `HMAC-SHA256(wa_id, PESSOA_ID_SECRET)` em hex (um pseudônimo só, em todo o sistema). **Nunca** `wa_id` nem telefone.
- `nome`: `users.full_name`.
- `papel`: `"mentor"` ou `"mentorado"`; o do parceiro é o oposto do registrante.
- `consentimento.em` / `.termos`: `users.consent_at` (ISO 8601) e `users.terms_version`.
- `confirmado_em`: `audios.partner_confirmed_at` (só no parceiro). Só mentorias confirmadas aparecem em `status=pending`, então ele vem preenchido ali.
- `instituicao`: `null` por enquanto; entra quando o cadastro tiver o campo (item 7 do contrato).
- Campo que não existir: `null`. `registrante` e `parceiro` nunca são omitidos (mentorias anteriores à v2 não têm parceiro: o objeto vai com tudo `null`).

> O `pessoa_id` depende do `PESSOA_ID_SECRET`, que **não pode ser trocado** sem migração (ver `docs/DEPLOY.md`): o notebook soma horas e histórico de conduta por `pessoa_id`.
