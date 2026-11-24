# Fluxo do áudio: estado atual, para quem adapta o analisador

Data do levantamento: 2026-11-23. Fonte: o código do Worker em `bot-whatsapp-kit` (versão no ar `22580373`).
Tudo abaixo foi lido do código; o que **não foi verificado numa execução real** está marcado com **[não verificado]**.

## 1. Visão geral

O bot **não analisa nada**. Ele recebe o áudio de uma mentoria, guarda no R2, registra os metadados no Supabase e espera o analisador **buscar** o arquivo pela API, **analisar** e **devolver** o resultado pela mesma API. O modelo é **pull**: o bot nunca chama o analisador (a menos que o analisador síncrono opcional esteja configurado, hoje não está; ver seção 9).

```
 Aluno/mentor (WhatsApp)
        │ áudio
        ▼
 Evolution API (Baileys, Docker)  ──(áudio grande: grava no S3/R2 e manda mediaUrl)──┐
        │ webhook MESSAGES_UPSERT                                                      │
        ▼                                                                              ▼
 Cloudflare Worker (bot) ───────────► R2  audios/mentorias/<pessoa_id>/<AAAA-MM>/<uuid>.<ext>
        │  registra metadados
        ▼
 Supabase (tabela audios)
        ▲                │
        │ POST result    │ GET lista / áudio
        │                ▼
 ANALISADOR (vocês) ── /api/v1/mentorias... (Bearer INTEGRATION_API_KEY)
        │
        └─ result.curadoria ──► o bot avisa os participantes no WhatsApp
```

Há ainda um painel interno (`/painel`) onde a equipe vê as mentorias e consegue **enviar manualmente** um áudio que não chegou pelo WhatsApp. Ele não faz parte do contrato do analisador.

## 2. Por onde o áudio entra

| Caminho | Limite | Como o Worker lê o arquivo | Estado |
|---|---|---|---|
| WhatsApp, áudio pequeno | `MAX_AUDIO_BYTES` = **16 MB** | Pede à Evolution em base64 (`getBase64FromMediaMessage`) e grava no R2 | Em uso |
| WhatsApp, áudio grande | `MAX_AUDIO_STREAM_BYTES` = **300 MB** | A Evolution grava o arquivo no S3 (R2, bucket `bot-whatsapp-evolution-media`) e manda `mediaUrl` no webhook; o Worker copia **em stream** para o bucket dos áudios | Configurado em 2026-11-23. **[não verificado]**: falta um áudio grande real confirmar que o webhook traz `mediaUrl` e que o host bate com `MEDIA_URL_HOSTS` |
| Painel da equipe | **100 MB** (limite do corpo da requisição) | O navegador envia o arquivo cru; o Worker guarda em `staging/` e copia em stream | Publicado em 2026-11-23, sem teste de ponta a ponta |

Os três caminhos terminam do mesmo jeito: **o arquivo vai para `audios/mentorias/...` no R2 e uma linha nasce em `audios`**. Para o analisador, a origem é indiferente.

Formatos aceitos (tipo canônico → extensão): `audio/ogg` (ogg), `audio/opus`, `audio/mpeg` (mp3), `audio/mp4` (m4a), `audio/aac`, `audio/amr`, `audio/wav`, `audio/webm`, `audio/flac`, `audio/3gpp` (3gp), `audio/aiff`, `audio/x-ms-wma`.
Vídeo `mp4`/`webm`/`3gpp` também é aceito e gravado como o áudio equivalente (`audio/mp4` etc.); **o analisador precisa ler a faixa de áudio de um `.mp4`**. Tipos fora da lista vão para a quarentena (`audios/rejeitados/...`) e **nunca** aparecem na API.

O `mime` que a API devolve é o **tipo canônico** (ex.: um `.m4a` vem como `audio/mp4`), e o `Content-Type` do download é o mesmo.

## 3. O que acontece depois que o arquivo chega

1. **Consentimento LGPD primeiro (R6).** Sem aceite dos termos, nada é baixado nem guardado.
2. O arquivo é gravado no R2 e a linha em `audios` nasce **incompleta** (sem assunto, sem parceiro).
3. O bot conduz a pessoa por perguntas curtas: **papel** (mentor/mentorado) → **assunto** → **data** → **parceiro**. Se o registrante tem uma mentoria já confirmada pelo matching do bot, papel, parceiro, assunto e data vêm do match e as perguntas são puladas.
4. Ao escolher o parceiro, a linha vira **mentoria** e o parceiro recebe uma pergunta com 2 botões para **confirmar** ou **recusar**.
5. Só a mentoria **confirmada** (ou sem data/parceiro, ver abaixo) fica disponível para o analisador.

Consequências para quem consome a API:

- Uma linha em `audios` pode existir **sem ser mentoria**: o fluxo foi interrompido. O bot **apaga** essas linhas e o arquivo depois de **24 h** (cron diário). Elas **não** aparecem em `status=pending`.
- A mentoria **sem resposta do parceiro em 7 dias** tem o arquivo apagado e fica marcada como `expirada` (só no painel).
- Se o parceiro **recusa**, o arquivo é apagado **antes** de a recusa ser gravada.
- Os áudios de **perfil** (cadastro: gostos, time, hobby) ficam em `audios/informacoes/...` e **não** são mentorias. A API **não** os lista: `listMentorias` filtra `subject IS NOT NULL`, e o áudio de perfil nunca recebe assunto. O mesmo filtro esconde os registros incompletos.

## 4. Quando uma mentoria entra na fila do analisador

`GET /api/v1/mentorias?status=pending` devolve só linhas que satisfazem **todas** estas condições (`src/db/supabase-repo.ts`, `listMentorias`):

- `analysis_result` ainda é nulo (nunca recebeu resultado);
- tem `subject` preenchido (mentoria já descrita);
- o áudio não foi apagado (`audio_deleted_at` nulo);
- **ou** não tem `ocorreu_em` (mentoria antiga, sem data), **ou** o parceiro já confirmou (`partner_confirmed_at` preenchido).

`GET /api/v1/mentorias?status=all` devolve tudo, incluindo as que já têm resultado.

O download do áudio (`/audio`) é **mais restritivo**: devolve `404 audio indisponível` se o arquivo foi apagado, **ou** se a mentoria tem `ocorreu_em` e o parceiro ainda não confirmou. É uma proteção de privacidade: a voz do parceiro só sai depois que ele confirma.

## 5. Contrato da API (`/api/v1`)

Base: `https://bot-whatsapp.bot-whatsaap-inteli.workers.dev`

**Autenticação:** `Authorization: Bearer <INTEGRATION_API_KEY>` em todas as chamadas (a chave tem no mínimo 32 caracteres e vem do administrador do bot, nunca neste documento). Sem chave válida: `401 {"error":"unauthorized"}`. API sem chave configurada: `503`.

| Método e caminho | Para quê |
|---|---|
| `GET /api/v1/mentorias?status=pending\|all&limit=1..200` | Lista (padrão `limit=50`, mais recentes primeiro). `status` fora de `pending`/`all` dá `400`. |
| `GET /api/v1/mentorias/<id>` | Uma mentoria. `id` é UUID (36 caracteres). `404` se não existe. |
| `GET /api/v1/mentorias/<id>/audio` | Os bytes do arquivo, com o `Content-Type` da mentoria. `404 audio indisponível` conforme a seção 4. |
| `POST /api/v1/mentorias/<id>/result` | Grava o resultado. Corpo: `{"result": <JSON qualquer, não nulo>}`, máximo **256 KB**. Resposta: `200 {"ok":true}`. |

Não há paginação por cursor na API (só `limit`), **não há suporte a `Range`** no download (sempre o arquivo inteiro, em stream) e **não há webhook de saída**: o analisador precisa fazer polling.

### Objeto da mentoria

```json
{
  "id": "…uuid…",
  "role": "mentor",
  "subject": "Estruturas de dados no mercado",
  "partner": "Nome do parceiro, como digitado",
  "mime": "audio/mp4",
  "bytes": 41234567,
  "created_at": "2026-11-23T18:41:55.447+00:00",
  "ocorreu_em": "2026-11-12",
  "assunto": "Estruturas de dados no mercado",
  "audio_sha256": null,
  "registrante": { "pessoa_id": "<hmac hex>", "nome": "…", "papel": "mentor",
                   "consentimento": { "em": "…ISO…", "termos": "2026-11-3" }, "instituicao": null },
  "parceiro":    { "pessoa_id": "<hmac hex>", "nome": "…", "papel": "mentorado",
                   "consentimento": { "em": "…", "termos": "…" }, "instituicao": null,
                   "confirmado_em": "…ISO ou null" },
  "audio_url": "/api/v1/mentorias/<id>/audio",
  "analysis_pending": true
}
```

Quando já há resultado, vêm também `analysis_result` (o JSON que vocês enviaram) e `analysis_at`.

Pontos de atenção:

- `ocorreu_em` é `"AAAA-MM-DD"` ou `null`. O bot **não** pergunta a data quando a mentoria vem do matching; vale o que o match tinha. Para o registro direto, a data é informada pela pessoa.
- `registrante` e `parceiro` **nunca são omitidos**; campo desconhecido vem `null`. Mentorias antigas não têm parceiro: o objeto vem todo `null`.
- `papel` do parceiro é sempre o oposto do registrante.
- `pessoa_id` é `HMAC-SHA256(telefone, PESSOA_ID_SECRET)` em hex. É um pseudônimo estável, **o mesmo em todo o sistema**; **nunca** há telefone na API. O segredo **não pode ser trocado** sem migração: se for, a mesma pessoa vira outro `pessoa_id` e o histórico de horas se perde.
- `instituicao` é sempre `null` por enquanto.
- `audio_sha256`: o campo existe na tabela e na API, mas **não achei no Worker quem o preencha**; espere `null` e não dependa dele para deduplicar.
- `bytes` e `mime` são os do arquivo **guardado**.

## 6. Devolver o resultado

`POST /api/v1/mentorias/<id>/result` aceita **qualquer JSON** em `result`; o bot só guarda. **É reenviável**: cada `POST` sobrescreve `audios.analysis_result`. Depois do primeiro `POST`, `analysis_pending` vira `false` e a mentoria **sai** de `status=pending`.

Para o bot **avisar os participantes** no WhatsApp, o `result` deve trazer o bloco `curadoria`:

```json
"curadoria": {
  "status": "aguardando_equipe | aprovada | recusada | parcial",
  "participantes": [{
    "pessoa_id": "<o mesmo da API>", "papel": "mentor|mentorado",
    "situacao": "aguardando_equipe | aprovada | recusada",
    "minutos_contabilizados": 35,
    "conta": { "minutos_disponiveis": 70, "horas_certificadas": 0,
               "pode_pedir_certificado": true, "minimo_horas": 1 }
  }]
}
```

Regras do aviso (`src/mentoria/curadoria.ts`):

- O bot compara a `situacao` de cada participante com a **última já avisada**. Só envia mensagem quando muda **para `aprovada` ou `recusada`**, uma vez por mudança. Reenviar o mesmo resumo **não duplica** o aviso.
- `aguardando_equipe` **não envia nada** (economia de mensagens).
- `pessoa_id` desconhecido, fora da mentoria, sem consentimento ou de quem pediu para sair: ignorado, sem erro.
- `recusada` leva o botão **[Pedir revisão]** (exigência da LGPD, art. 20). Os pedidos ficam em `revisao_pedidos` e aparecem no painel; a equipe atende pelo seu sistema (`mentorias decidir --forcar`).
- O `POST` responde `200 {"ok":true}` assim que o resultado é gravado. O aviso roda depois; **falha no aviso nunca vira erro** para vocês. Se uma mensagem não saiu, **reenviem o mesmo resumo** e ela é tentada de novo.
- `status: "sem_analise"` no `result` é tratado como os demais (mentoria registrada pela equipe sem transcrição).
- Um `result` sem `curadoria`, ou com bloco inválido, é gravado normalmente e não envia nada.

O contrato detalhado do bloco `curadoria` também está em `docs/INTEGRACAO_TRANSCRITOR.md`.

## 7. Tamanho, tempo e erros que o analisador deve esperar

- Arquivos de até **300 MB** pelo WhatsApp e **100 MB** pelo painel. Use download **em stream** e não carregue o arquivo inteiro em memória.
- O download não tem retomada (sem `Range`): em caso de queda, baixe de novo.
- O arquivo **pode sumir** a qualquer momento por regra de retenção (seção 3) ou por recusa do parceiro. Trate `404 audio indisponível` como "descarte, não tente de novo", não como erro transitório. O contrário vale para `5xx`.
- Códigos: `200`, `400` (parâmetro ou JSON inválido), `401`, `404`, `413` (`result` acima de 256 KB), `500 internal`, `503` (API sem chave configurada).
- Não há limite de taxa documentado na API. **[não verificado]**: o plano gratuito do Cloudflare Workers limita requisições por dia e tempo de CPU por requisição; um polling agressivo pode consumir essa cota. Sugestão: consultar a lista a cada 1 a 5 minutos.

## 8. Privacidade e LGPD que afetam a arquitetura do analisador

- O áudio é **dado pessoal** (a voz identifica). O Worker só o libera ao analisador depois do consentimento e, na mentoria, depois da confirmação do parceiro.
- O `pessoa_id` é o **único** identificador de pessoa que sai do bot. Não peça nem tente reconstruir telefone.
- O `result` é guardado como veio. **Não inclua telefone nem dado desnecessário** nele: o painel e o banco o exibem à equipe.
- Em `recusada`, a revisão humana é obrigatória por lei. Não trate a recusa automática como definitiva sem esse caminho.
- Não logue o corpo das respostas da API nem o conteúdo do áudio fora do seu ambiente controlado.

## 9. O que existe e **não** é usado hoje

- **Analisador síncrono** (`HttpAudioAnalyzer`, variáveis `ANALYZER_API_URL` e `ANALYZER_API_KEY`): se configurado, o Worker enviaria o arquivo ao analisador logo após o recebimento e responderia o resultado à pessoa na hora. **Hoje usa-se o modo diferido** (`DeferredAudioAnalyzer`): o bot responde só "áudio recebido" e segue o fluxo de perguntas. O limite de 8 s (`ANALYZER_TIMEOUT_MS`) e o fato de o Worker ter 128 MB de memória fazem este modo servir só para arquivos pequenos. Para o seu caso, **use a API de polling**.
- **Webhook de saída** para avisar o analisador de uma mentoria nova: não existe. Se for desejável, é uma mudança no Worker (um `POST` ao seu serviço quando o parceiro confirma).
- **`GET /api/v1/revisoes?status=aberta`**: citado como futuro em `docs/INTEGRACAO_TRANSCRITOR.md`; **não implementado**. Os pedidos de revisão hoje só aparecem no painel e na tabela `revisao_pedidos`.
- **`audio_sha256`** e **`instituicao`**: campos reservados, sempre `null`.

## 10. Sugestão de fluxo para o analisador

1. A cada 1 a 5 minutos: `GET /api/v1/mentorias?status=pending&limit=50`.
2. Para cada item: `GET /audio` em stream até um arquivo local; em `404`, pule.
3. Analise e **valide o critério objetivo** (por exemplo duração mínima) do seu lado.
4. `POST /result` com o resultado completo e, se já houver decisão, o bloco `curadoria`.
5. Se a decisão da equipe mudar depois, **reenvie o `POST`** com a `curadoria` atualizada (o aviso sai uma vez por mudança).
6. Guarde o `id` já processado: a lista `pending` só deixa de trazer a mentoria **depois do primeiro `POST`**.

## 11. Pendências conhecidas que podem mudar este contrato

- Confirmar com um áudio grande real pelo WhatsApp que a Evolution entrega `mediaUrl` (seção 2).
- Decidir se vale um webhook de saída para o analisador (seção 9).
- Preencher `audio_sha256` e `instituicao` (campos já reservados).
- Há 8 testes do bot falhando em `tests/faq.test.ts` por uma colisão entre a resposta "meus dados" e o módulo `src/axo/self.ts`. Não afetam a API do analisador.

## 12. Onde está cada coisa no código

| Assunto | Arquivo |
|---|---|
| API do analisador | `src/mentoria/api.ts` |
| Aviso da curadoria | `src/mentoria/curadoria.ts`, `src/mentoria/curadoria-actions.ts` |
| Pipeline do áudio | `src/audio/pipeline.ts`, `src/audio/storage.ts` |
| Formatos e chave no R2 | `src/audio/storage.ts` (`audioKey`) |
| Limpeza de arquivos | `src/mentoria/housekeeping.ts` |
| Quais mentorias são `pending` | `src/db/supabase-repo.ts` (`listMentorias`) |
| Envio manual pelo painel | `src/mentoria/panel.ts`, `src/admin/reprocess.ts` |
| Contrato anterior | `docs/INTEGRACAO_TRANSCRITOR.md` |
