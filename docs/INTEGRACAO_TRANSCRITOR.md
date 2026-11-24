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


## 3. `POST /api/v1/mentorias/<id>/result` com `curadoria` (aviso da decisão da equipe)

O notebook **reenvia** o `POST` sempre que o resumo muda, com um bloco novo dentro do `result`:

```json
"curadoria": {
  "status": "aguardando_equipe | aprovada | recusada | parcial",
  "participantes": [{"pessoa_id": "…", "papel": "mentor|mentorado", "situacao": "aguardando_equipe|aprovada|recusada",
                     "minutos_contabilizados": 35,
                     "conta": {"minutos_disponiveis": 70, "horas_certificadas": 0,
                               "pode_pedir_certificado": true, "minimo_horas": 1}}]
}
```

O `result` também pode vir com `status: "sem_analise"` (mentoria registrada pela equipe sem transcrição); o bot trata igual.

O que o bot faz (`src/mentoria/curadoria.ts`):

- Compara a `situacao` de cada participante com a última já avisada (`audios.notified_curadoria`). Só manda mensagem quando a situação **muda para `aprovada` ou `recusada`**, uma vez por mudança: reenviar o mesmo resumo não manda de novo.
- Acha o participante pelo `pessoa_id` (o `wa_id_hash`, HMAC do `wa_id`). `pessoa_id` desconhecido, de fora da mentoria, sem consentimento ou de quem pediu para sair: ignorado, sem erro.
- `aprovada`: "Sua mentoria de {DATA} foi aprovada pela equipe ✅ {X} min contabilizados. Você tem {H} h {M} min na conta. O certificado de horas complementares pode ser pedido a partir de {minimo_horas} h." (só texto por enquanto; o botão [Pedir certificado] entra com o item 5 do contrato).
- `recusada`: "Sua mentoria de {DATA} não foi contabilizada: ela não atendeu aos critérios de validação. Se quiser, peça revisão humana." com o botão **[Pedir revisão]**, que registra o pedido para a equipe. Vale também para a recusa automática (critérios objetivos, ex.: menos de 20 min): é o que cumpre a LGPD art. 20.
- `aguardando_equipe`: nenhuma mensagem.
- `{DATA}` = `ocorreu_em` (ou o dia de `created_at`); `{H}`/`{M}` = `minutos_disponiveis`. Nenhuma mensagem leva telefone.
- A resposta do `POST` é `200 {"ok": true}` assim que o resultado é gravado; o aviso roda depois e uma falha dele não muda a resposta (o reenvio tenta de novo).
- Os pedidos de revisão ficam em `revisao_pedidos` (um por mentoria e pessoa) e aparecem no painel; a equipe atende pelo notebook (`mentorias decidir --forcar`). Futuro: `GET /api/v1/revisoes?status=aberta`.
