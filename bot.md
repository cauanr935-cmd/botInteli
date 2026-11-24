# Bot WhatsApp + Chat Web — documentação técnica

> Atualizado em 2026-11-23. O canal WhatsApp usa a Evolution API/Baileys (migrado da Cloud API da Meta em 2026-11-12) e o bot hoje é o **Axo**, assistente da rede de mentoria **Be My Mentor** (cadastro, perfil, dúvidas, match mentor↔mentorado, registro e validação de mentorias, certificado). Este documento descreve o sistema como está implementado no código, não como foi planejado.
> **Para entender a lógica de ponta a ponta (e montar o vídeo/animação), vá direto às seções 17 (árvore de decisão), 18 (roteiro de animação) e 19 (glossário de estados).**
> Regras de projeto e decisões: `CLAUDE.md`, `docs/PLANO.md`, `docs/DECISOES.md`.

## 1. Visão geral

Um bot de atendimento que:

1. Faz o **cadastro** da pessoa, com consentimento LGPD, e grava no banco.
2. Pergunta o **papel** (mentor, mentorado ou os dois), as **áreas** em que o mentor topa ajudar, a **dúvida** do mentorado e os **dias e horários** livres.
3. Mostra um **menu de serviços** (lista interativa) e responde com **respostas prontas** guardadas no banco.
4. **Conecta** mentor e mentorado (a equipe cria o match; o bot negocia horário e local com os dois, mantendo-os anônimos até 5 min antes).
5. Recebe o **áudio da mentoria**, guarda no R2 e o encaminha ao analisador/curadoria. O bot não analisa nada: só encaminha e devolve o resultado (aprovada ou recusada).
6. Atende pedidos de **certificado** e responde dúvidas sobre o programa e a LGPD (FAQ), com uma IA que só **escolhe uma opção** ou reescreve falas curtas, nunca decide sozinha.

O bot tem **dois canais de entrada** que usam o **mesmo motor de conversa**, sem nenhuma regra duplicada:

| Canal | Quando usar | Entrada | Saída |
|---|---|---|---|
| **WhatsApp (Evolution API, modo Baileys)** | Produção. Depende da Evolution rodando na VM e da instância conectada pelo QR Code. | `POST /webhook` (header `x-webhook-token`) | `POST {EVOLUTION_URL}/message/sendText/{instância}` |
| **Chat web (simulador)** | Teste e demonstração sem WhatsApp. Sem cadastro de usuário. | Página `/chat` e `/chat/api/*` | Capturada e desenhada na própria página |

```
                  ┌────────────── Cloudflare Worker (bot-whatsapp) ──────────────┐
  WhatsApp ──►    │  POST /webhook ──► confere x-webhook-token ─┐                │
  (celular)       │                                              ▼                │
     ▲            │                                      processEvents()          │
     │ QR Code    │  Navegador ──► /chat, /chat/api/* ──► (idempotência key.id,   │ ──► Supabase (Postgres)
  Evolution API   │  (página web)  monta o mesmo evento   touchUser, "2"→opção)  │ ──► R2 (áudios + histórico do chat)
  (Baileys, VM    │                                                ▼              │ ──► API externa de áudio
   Oracle/Docker) │                                      createEventHandler()     │
     ▲            │                                  motor de conversa (decide)   │
     │            │                                                ▼              │
     └────────────┼──────────────────────────── sendGuarded() ────────────────────┤
   sendText etc.  │            └─► evolutionClient (canal WhatsApp)               │
                  │            └─► função local → tela   (canal chat web)         │
                  └───────────────────────────────────────────────────────────────┘
```

A única diferença entre os canais está nas bordas: de onde vem o evento e para onde vai a mensagem de saída. Para o chat web, `sendGuarded` recebe um **transporte** local no lugar da Evolution. Por isso as travas continuam valendo (trava manual, contato conhecido, limites por pessoa, anti-flood).

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (strict), ESM |
| Runtime | Cloudflare Workers (`compatibility_date 2025-01-01`, `nodejs_compat`) |
| Agendador | Cron Triggers do Workers: `0 6 * * *` (limpeza diária, não envia) e `* * * * *` (nomes 5 min antes das mentorias, `src/matching/reminder.ts`) |
| Armazenamento de arquivos | Cloudflare R2, bucket `bot-whatsapp-audios` (binding `AUDIOS`) |
| Banco | Supabase (Postgres) via REST (PostgREST), sem biblioteca cliente |
| Mensageria | **Evolution API v2 (integração Baileys / WhatsApp Web)**, em Docker numa VM Oracle Cloud; o Worker só fala HTTP com ela (`src/whatsapp/evolutionClient.ts`) |
| Análise de áudio | API externa HTTP (adaptador genérico em `src/audio/analyzer.ts`) |
| Testes | Vitest; PGlite (Postgres em WASM) para SQL; tudo mockado, sem rede real |
| Ferramentas | Wrangler 4, ESLint, `tsc --noEmit` |

Dependências de produção: nenhuma. Tudo é dev dependency.

## 3. Estrutura do código

```
src/
  index.ts                 Entrada do Worker: roteia /health, /webhook, /admin/*, /chat*; cron
  config.ts                Lê e valida variáveis de ambiente (recusa subir se inválidas)
  webhook/
    handler.ts             POST do webhook: token, parse, idempotência (key.id), "2" → opção do menu
    events.ts              Fiação: mensagem → motor → sendGuarded
  whatsapp/
    client.ts              sendGuarded (único ponto de saída: travas, anti-flood, log) e contratos de mídia
    evolutionClient.ts     ÚNICO arquivo que conhece a Evolution API (envio, tradução, download de mídia)
    choices.ts             Botões/listas ⇄ texto numerado (funções puras)
    parser.ts, types.ts    Payload `messages.upsert` da Evolution → eventos tipados
    builders.ts            Monta texto, botões e lista (formato interno, também usado pelo chat web)
    signature.ts           Token compartilhado do webhook (comparação em tempo constante)
  conversation/
    machine.ts             Máquina de estados declarativa + decide() PURA (sem I/O)
    engine.ts              Aplica decide(): lê/grava estado, limites, envia
    synonyms.ts, normalize.ts, texts.ts   Intenções (oi, menu, sair...) e textos em português
  registration/            Cadastro: campos, validação, respostas
  services/                Menu e conteúdo (serviços e respostas prontas vêm do banco, com fallback)
  audio/                   Pipeline (baixa → R2 → analisador → resposta), analisador, storage
  budget/, admin/          Contador mensal, disjuntor, endpoints admin
  ops/scheduled.ts         Rotinas do cron
  db/                      Interface Repo + SupabaseRepo (produção) + MemoryRepo (testes)
  sim/                     Chat web: chat.ts (API) e page.ts (página HTML)
supabase/migrations/       0001–0008 (SQL). schema_completo.sql = todas juntas, para colar no SQL Editor
tests/                     Unitários, adversariais por etapa, simulador ponta a ponta
scripts/simulate.ts        Simulador sem rede (400 pessoas, repetição, limites, virada de mês)
```

## 4. Como uma mensagem é processada

1. **Entrada.** O evento chega pelo webhook (com o token da Evolution) ou pelo chat web.
2. **Idempotência.** `processed_messages` guarda o `key.id` do Baileys (o antigo `wamid`). O mesmo ID recebido duas vezes é ignorado, porque a Evolution pode reenviar eventos.
3. **Atualização do usuário e resposta numérica.** `touch_user` grava a hora da última mensagem da pessoa. Também é o que marca a pessoa como "contato conhecido": o bot só escreve a quem já escreveu a ele (não há janela de 24h no Baileys).
4. **Motor.** `decide()` é uma função pura: dado o estado, a mensagem e os contadores, devolve as respostas e o próximo estado. `engine.ts` aplica o resultado com controle de concorrência por versão (compare-and-swap em `users.version`).
5. **Envio.** Toda mensagem de saída passa por `sendGuarded` (seção 6).
6. **Resposta HTTP.** O webhook responde **200** sempre que o token é válido, mesmo com a trava ou o teto abertos. Se devolvesse erro, a Evolution reenfileiraria os eventos.

### 4.1 Estados da conversa

| Estado | Significado | Sai quando |
|---|---|---|
| `NEW` | Pessoa nova | Envia uma saudação ("oi", "olá"...) → `AWAIT_REGISTRATION` |
| `AWAIT_REGISTRATION` / `REG_*` | Cadastro (Flow ou perguntas) | Concluiu → `MENU` |
| `MENU` | Menu de serviços | Escolhe um serviço da lista |
| `AWAIT_AUDIO` | Serviço que exige áudio | Envia áudio → `PROCESSING_AUDIO` |
| `PROCESSING_AUDIO` | Analisando | Pipeline termina → `AWAIT_AUDIO` |
| `COMPLETED` | Fluxo concluído | "menu" → `MENU`; "oi" → `RETURNING_CHOICE` |
| `OPTED_OUT` | Pediu para sair | "voltar" retoma de onde parou |

Há muitos outros estados (perfil, horários, match, registro de mentoria, retirada de área). Todos estão listados com o significado na **seção 19**.

Comandos reconhecidos em texto (com variações de maiúscula, acento, letras repetidas e pontuação): saudação (`oi`), `menu`/`voltar`/`início`, `sair`/`parar`/`cancelar`/`stop`, `sim`/`aceito`, `não`.

### 4.2 Regras anti-spam (R2)

- Só responde a entrada **esperada no estado atual**. Entrada inesperada gera **no máximo 1 dica por estado**; depois o Axo manda avisos curtos e descontraídos de "fora de assunto", e a **última vaga é sempre a despedida**; só então o silêncio (sem surpresa).
- Repetição não gera resposta ("oi" depois das boas-vindas = silêncio).
- Uma entrada válida = **no máximo uma resposta**. Nada de "aguarde" ou "recebi seu áudio" como mensagem separada.
- Limites por pessoa: `MAX_BOT_MSGS_PER_USER_PER_DAY` (padrão 200) e `MAX_BOT_MSGS_PER_USER_PER_10MIN` (padrão 30). Acima disso, silêncio.
- Saudação ("oi", "tá por aí?") nunca fica sem retorno: o bot confirma que está vivo e repete a pergunta da etapa.
- Reação, vídeo, localização e contato são silêncio. Figurinhas têm regras próprias (abertura, resenha, despedida, reação).

### 4.3 Cadastro

Campos definidos em `src/registration/fields.ts` (hoje só `full_name`; é o único lugar para trocar ou acrescentar campos, junto da migração e do Flow). Dois modos:

- **Com WhatsApp Flow** (`WHATSAPP_FLOW_ID` definido): o formulário chega como `nfm_reply`.
- **Sem Flow** (modo atual): botão **Aceito** (consentimento) seguido de uma pergunta por campo.

Nenhum dado de cadastro nem áudio é guardado antes do consentimento (`consent_at`, `terms_version`); um trigger no banco (`audios_require_consent`) reforça isso.

### 4.4 Pipeline de áudio

```
áudio recebido → confere consentimento → valida tipo (ogg, opus, mp3, m4a, aac, amr)
  → baixa a mídia (Evolution: `getBase64FromMediaMessage`, sem URL temporária)
  → grava no R2: audios/<hash do telefone>/<AAAA-MM>/<uuid>.<ext>
  → registra em `audios` → POST na API de análise → resposta única com botão "Menu"
```

Contrato do analisador (adaptador `HttpAudioAnalyzer`):

- `POST ANALYZER_API_URL`
- Cabeçalhos: `Authorization: Bearer ANALYZER_API_KEY` e `Content-Type: <mime do áudio>`
- Corpo: os bytes do áudio
- Resposta: texto ou JSON. O texto mostrado vem do primeiro campo string entre `text`, `result`, `summary`, `message`, `analysis`; se nenhum existir, o JSON compacto.
- Timeout por tentativa: `ANALYZER_TIMEOUT_MS` (padrão 8000), com novas tentativas e espera crescente.

Se `ANALYZER_API_URL`/`ANALYZER_API_KEY` não estiverem configurados, o pipeline fica desativado e o áudio só muda o estado da conversa.

## 5. Dados

### 5.1 Supabase (Postgres)

| Tabela | Função |
|---|---|
| `processed_messages` | Idempotência (`wamid`); limpeza após 7 dias pelo cron |
| `users` | Telefone, estado, versão, última mensagem, dados de cadastro, consentimento |
| `message_budget` | Contador anti-flood **por dia** da instância (`reserved_count`, `stop_at`, `tripped`; colunas legadas `phone_number_id`/`month_key`) |
| `budget_lock` | Trava manual |
| `pending_choices` | Opções do último menu enviado como texto numerado, por hash do telefone (ver seção 9) |
| `outbound_log` | Registro de cada envio (telefone só em hash) |
| `services` | Itens do menu (id, título, descrição, `requires_audio`, ordem, ativo) |
| `canned_responses` | Textos prontos (chave → texto) |
| `audios` | Metadados e resultado das análises |

Funções SQL: `touch_user`, `reserve_outbound_slot_detail`, `set_manual_lock`, `clear_manual_lock`, `claim_budget_alert`, `release_stuck_processing`. RLS ligado; o bot acessa com a **service key** (nunca expor no cliente).

Para criar o banco do zero: cole `supabase/schema_completo.sql` no SQL Editor do Supabase (ou aplique `supabase/migrations/*.sql` em ordem).

### 5.2 R2

- Áudios recebidos: `audios/...` (canal WhatsApp e, se o analisador estiver ativo, também o chat web).
- Chat web: `chat-sim/history.json` (histórico, máx. 500 itens) e `chat-sim/media/<id>` (áudios enviados pela página).

### 5.3 Conteúdo editável sem deploy

O menu e os textos vêm do banco, com cache e fallback no código:

```sql
-- novo serviço sem áudio, com resposta pronta
insert into services (id, title, description, requires_audio, active, sort_order)
values ('precos', 'Preços', 'Veja nossos preços', false, true, 40);
insert into canned_responses (key, text) values ('service_precos', 'Nossos preços: ...');
```

Limites de mensagens interativas (herdados da Meta, mantidos nos builders porque o chat web renderiza o mesmo formato) que o código valida e recusa exceder: lista até 10 linhas (título ≤ 24, descrição ≤ 72), até 3 botões (título ≤ 20), corpo ≤ 1024 caracteres.

## 6. Anti-flood e proteção do número (R1)

No canal oficial da Meta existia franquia de 1.000 conversas grátis, janela de 24h e status `billable`. **No Baileys nada disso existe.** A semântica de "custo Meta" foi substituída por **proteção anti-ban/anti-flood**; a infraestrutura (reserva atômica, contador, trava manual, `outbound_log`, endpoints admin) foi mantida e reaproveitada.

`sendGuarded` continua sendo a **única** função que envia (`src/whatsapp/client.ts`); o transporte HTTP vive no **único** arquivo que conhece a Evolution (`src/whatsapp/evolutionClient.ts`; um teste de arquitetura reprova qualquer violação). Antes de enviar:

1. Recusa o que o canal não entrega (`template`, Flow): erro `unsupported_type`, sem gastar vaga.
2. Respeita a **trava manual** (falha fechada).
3. **Nunca escreve para quem nunca escreveu ao bot** (`blocked_unknown_contact`): mensagem fria a desconhecido é o maior gatilho de banimento. Não é a antiga janela de 24h: vale para qualquer pessoa que já tenha falado com o bot, em qualquer época.
4. **Limitador anti-flood opcional**: `ANTI_FLOOD_MAX_PER_DAY` (0 = desligado, máximo 990). Reserva atômica de uma vaga no contador **do dia** (fuso `TIMEZONE`); sem vaga, não envia. A vaga não é devolvida se o envio falhar.
5. Envia; grava `outbound_log`.

- Log `warn` a 80% do teto e `critical` ao atingi-lo; o contador zera à meia-noite do fuso. Se o banco estiver fora, **não envia**.
- A trava manual é ligada por um humano (ex.: direto no banco) e só fecha pelo endpoint admin. **Não existe mais gatilho automático por `billable`**: status de entrega/preço da Evolution são ignorados.
- O webhook continua respondendo **200** com a trava ou o teto abertos: "quebrar" = parar de enviar, não derrubar o endpoint.

## 7. API do Worker

URL de produção: `https://bot-whatsapp.bot-whatsaap-inteli.workers.dev`

| Rota | Método | Auth | Descrição |
|---|---|---|---|
| `/health` | GET | — | Retorna `ok` |
| `/webhook` | POST | `x-webhook-token` (ou `Authorization: Bearer`) | Eventos da Evolution (`messages.upsert`); 401 se o token for inválido; 200 caso contrário |
| `/admin/budget` | GET | `Authorization: Bearer ADMIN_TOKEN` | Dia (`period`), contador, `stop_at`, se o limitador está ligado, disjuntor e trava manual |
| `/admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO` | POST | Bearer `ADMIN_TOKEN` | Fecha a trava manual (cabeçalho opcional `X-Admin-User`) |
| `/chat?key=ADMIN_TOKEN` | GET | `key` | Página do chat web |
| `/chat/api/*` | vários | `X-Chat-Key: ADMIN_TOKEN` ou `?key=` | API do chat (seção 8) |

Qualquer outro caminho: 404. Método diferente de POST em `/webhook`: 405 (não há mais handshake `GET` da Meta).

## 8. Chat web (simulador)

Ligado por `CHAT_SIM_ENABLED = "true"` (em `wrangler.toml`; ausente ou diferente disso → 404). Acesso: `https://.../chat?key=<ADMIN_TOKEN>`. Não há cadastro de usuário. Existe **um único usuário de teste**, telefone `5500000000001`, e o estado dele fica no Supabase como o de qualquer pessoa.

### 8.1 Como integrar um front-end próprio

A página é só um cliente. Qualquer front-end pode usar a mesma API, com o cabeçalho `X-Chat-Key`.

**Enviar texto, botão ou item de lista**

```http
POST /chat/api/send
X-Chat-Key: <ADMIN_TOKEN>
Content-Type: application/json

{"kind":"text","text":"oi"}
{"kind":"button","id":"consent_yes","title":"Aceito"}
{"kind":"list","id":"svc_audio","title":"Análise de áudio"}
```

Resposta (200): as mensagens novas, a da pessoa e as do bot, já na ordem.

```json
{"items":[
  {"id":"wamid.CHAT...","dir":"in","at":"2026-11-10T15:30:18Z","kind":"text","text":"oi"},
  {"id":"wamid.CHATOUT...","dir":"out","at":"...","kind":"text",
   "ui":{"body":"Olá! ...","buttons":[{"id":"consent_yes","title":"Aceito"}]}}
]}
```

O campo `ui` de uma resposta do bot é um destes formatos:

- `{ "body": "texto" }`
- `{ "body": "texto", "buttons": [{ "id", "title" }] }` (até 3)
- `{ "body": "texto", "list": { "button": "Ver serviços", "rows": [{ "id", "title", "description?" }] } }`

Para responder a um botão, mande `kind:"button"` com o `id` dele. Para um item de lista, `kind:"list"` com o `id` da linha. Esses `id` são os mesmos que a Meta usaria.

**Enviar áudio**

```http
POST /chat/api/audio
X-Chat-Key: <ADMIN_TOKEN>
Content-Type: audio/ogg        (o tipo do áudio vai no Content-Type)

<bytes do áudio>
```

Tipos aceitos pelo bot: `audio/ogg`, `audio/opus`, `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/amr`. O Chrome grava `webm` por padrão, que o bot recusa (responde "áudio inválido"); a página prefere `ogg` e `mp4` quando o navegador suporta.

**Outras rotas**

| Rota | Descrição |
|---|---|
| `GET /chat/api/history` | `{ "items": [...] }` com todo o histórico salvo |
| `GET /chat/api/media/<id>` | Áudio enviado (o `mediaId` vem no item de histórico) |
| `POST /chat/api/clear` | Apaga só o histórico visual (não zera o estado da conversa no banco) |
| `GET /chat/api/diag` | Diagnóstico: testa 4 chamadas ao Supabase de dentro do Worker e devolve `ok` ou o texto do erro (sem segredos) |

Cada requisição de envio é **síncrona**: só responde quando o bot terminou (inclui o tempo da análise de áudio).

### 8.2 Diferenças em relação ao WhatsApp real

- Não há webhook: a entrada é autenticada pela chave.
- O envio para a Evolution é substituído por um transporte local; nenhuma mensagem real sai. Mesmo assim, cada resposta passa pelas travas e entra no `outbound_log` (e consome vaga do anti-flood, se ligado).
- O chat web continua recebendo botões e listas **de verdade** (a tela os desenha); só o WhatsApp usa o texto numerado.
- Reiniciar o cadastro do zero exige apagar o usuário `5500000000001` em `users` no Supabase.

## 9. Integração com a Evolution API

Passo a passo de instalação em `docs/DEPLOY.md` (seção 5). Resumo:

1. **Evolution v2** em Docker na VM Oracle, **versão fixada**, atrás de HTTPS. Instância `WHATSAPP-BAILEYS` conectada pelo QR Code ao **chip dedicado**.
2. **Webhook da instância** → `POST https://<worker>/webhook`, evento `MESSAGES_UPSERT`, com o header `x-webhook-token: <EVOLUTION_WEBHOOK_TOKEN>`. A Evolution não assina o corpo: o segredo compartilhado é a autenticação (comparação em tempo constante).
3. **Entrada** (`src/whatsapp/parser.ts`): o `messages.upsert` vira os mesmos eventos de sempre (texto, resposta de botão/lista, áudio, documento, contato, não suportado). `key.id` é o id da mensagem (idempotência, no lugar do `wamid`); `fromMe`, grupos, status e canais são ignorados. O telefone vem do `remoteJid` (`@s.whatsapp.net`); para `@lid` usa o JID alternativo com número, se vier, ou o JID completo.
4. **Saída** (`src/whatsapp/evolutionClient.ts`), header `apikey` em tudo:

| Tipo do motor | Chamada |
|---|---|
| texto | `POST /message/sendText/{instância}` `{ number, text }` |
| botões / lista (padrão) | **texto numerado** em `sendText` (1 mensagem): `1) Sim  2) Não  Responda com o número da opção.` |
| botões / lista (`EVOLUTION_NATIVE_INTERACTIVE=true`) | `POST /message/sendButtons` e `sendList` |

   O Baileys tem suporte instável a botões e listas (issues abertas de mensagens com 201 que nunca chegam), por isso o padrão é o fallback. Para a resposta "2" voltar ao `id` da opção, o bot guarda as opções enviadas em `pending_choices` (por hash do telefone, validade de 12 h). Qualquer texto comum enviado depois **apaga** as opções (um "1" solto não vira a opção 1 de um menu velho). A resposta é aceita como número (`2`, `2)`, `opção 2`) ou o título exato.
5. **Mídia** (`createMediaClient`): sem URL temporária; o download é `POST /chat/getBase64FromMediaMessage/{instância}`. O pipeline de áudio e o R2 não mudaram.
6. **Flows** (`nfm_reply`) não existem no Baileys: o cadastro usa sempre o modo por perguntas.

**Pontos não verificados contra uma instância real** (documentação da Evolution ambígua; validar na sua versão): corpo do `sendText` (`text` x `textMessage.text`), formato exato de `sendButtons`/`sendList`, campos do `messages.upsert`, resposta do `getBase64FromMediaMessage` e comportamento de `@lid`. Veja `docs/PENDENCIAS_HUMANAS.md`.

## 10. Configuração

Variáveis obrigatórias (o Worker recusa processar `/webhook` e `/admin` se faltar alguma):

| Variável | Onde | Descrição |
|---|---|---|
| `EVOLUTION_URL` | var/secret | URL https da Evolution (sem barra final; `http://` só para localhost) |
| `EVOLUTION_API_KEY` | secret | Chave da Evolution (header `apikey`) |
| `EVOLUTION_INSTANCE` | var/secret | Nome da instância (também a chave da trava e do contador) |
| `EVOLUTION_WEBHOOK_TOKEN` | secret | Segredo (16+ caracteres) enviado pela Evolution no header `x-webhook-token` |
| `SUPABASE_URL` | secret | **Só a base**: `https://<ref>.supabase.co` (sem `/rest/v1/`) |
| `SUPABASE_SERVICE_KEY` | secret | Chave de serviço do Supabase |
| `ADMIN_TOKEN` | secret | Endpoints `/admin/*` e o chat web |
| `PRIVACY_POLICY_URL` | secret | Citada no termo de consentimento |
| `TERMS_VERSION` | `[vars]` | Versão do termo |

Opcionais: `ANALYZER_API_URL` + `ANALYZER_API_KEY` (devem ser configuradas juntas), `EVOLUTION_NATIVE_INTERACTIVE` (`false`), `ANTI_FLOOD_MAX_PER_DAY` (0 = desligado, máx. 990), `TIMEZONE` (`America/Sao_Paulo`; `META_ACCOUNT_TIMEZONE` ainda vale como alias), `MAX_BOT_MSGS_PER_USER_PER_DAY` (200), `MAX_BOT_MSGS_PER_USER_PER_10MIN` (30), `MAX_AUDIO_BYTES` (16000000), `ANALYZER_TIMEOUT_MS` (8000), `CHAT_SIM_ENABLED`.

**Obsoletas (não são mais lidas nem exigidas):** `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET`, `VERIFY_TOKEN`, `GRAPH_API_VERSION`, `BUDGET_SAFETY_MARGIN`, `WHATSAPP_FLOW_ID`.

Segredos entram com `npx wrangler secret put NOME` e **nunca** vão para o código ou o git. Localmente ficam em `.dev.vars` (modelo: `.dev.vars.example`). Para enviar um secret a partir do `.dev.vars` sem colar:

```bash
grep '^NOME=' .dev.vars | cut -d= -f2- | tr -d '\r\n' | npx wrangler secret put NOME
```

## 11. Deploy e operação

```bash
npm install
npm run verify          # typecheck + lint + todos os testes
npx wrangler deploy     # publica o Worker (e o cron)
npx wrangler tail --format json   # logs em tempo real
npx wrangler secret list          # confere quais secrets existem
```

Cron diário (06:00 UTC): nunca envia mensagem. Mantém o banco ativo (`ping`), apaga `processed_messages` com mais de 7 dias, libera conversas presas em `PROCESSING_AUDIO` há mais de 10 min e registra o uso do dia do limitador anti-flood.

Logs são JSON estruturado, com telefone mascarado (`5511*****1234`) e **sem** conteúdo de mensagem nem dados de cadastro.

## 12. Segurança e LGPD

- Autenticação do webhook: segredo compartilhado (`EVOLUTION_WEBHOOK_TOKEN`) em header, comparação em tempo constante; ausente ou inválido → 401 e nada é processado. O corpo do webhook traz a `apikey` da Evolution: nunca o registre em log (o código não registra corpos).
- Admin e chat web exigem `ADMIN_TOKEN`. A URL do chat contém a chave: não a compartilhe.
- Telefones aparecem só mascarados nos logs e em hash no R2 e em `outbound_log`.
- Nenhum cadastro nem áudio antes do consentimento explícito; os áudios são dado pessoal (a voz identifica a pessoa), então defina uma política de retenção no bucket.
- **Canal não oficial (Baileys).** Usar o WhatsApp Web por QR Code **viola os Termos de Serviço do WhatsApp** e pode levar ao **banimento do número**. Política de uso para reduzir o risco: chip dedicado e aquecido; o bot só responde a quem escreveu primeiro; nunca envia mensagem em massa nem para desconhecidos; 1 resposta por entrada; limites por pessoa (R2); limitador anti-flood diário e trava manual. O Worker **não** embute nenhuma biblioteca de WhatsApp (o Baileys roda dentro da Evolution, na VM). Não há contrato nem suporte: a instância pode cair e exigir novo QR Code.

## 13. Testes

`npm run verify` roda tudo sem rede real (Evolution, Supabase, R2 e analisador são mockados ou em memória). Destaques:

- `tests/architecture.test.ts`: só `whatsapp/evolutionClient.ts` pode conhecer a Evolution API.
- `tests/adversarial/etapa-*`: casos de abuso por etapa.
- `tests/simulation.test.ts` + `scripts/simulate.ts`: cenários ponta a ponta (400 pessoas no dia, repetição, limites por pessoa, virada do dia, trava manual).
- `tests/chat-sim.test.ts`: acesso ao chat web e conversão das mensagens do bot para a tela.

O teste de higiene (`tests/repo-hygiene.test.ts`, C0.6) só exige que `.dev.vars` não esteja versionado (ele pode existir local).

## 14. Estado atual e pendências

- **Canal WhatsApp:** migrado para a Evolution API (Baileys). O código está pronto e testado com mocks; **falta** subir a Evolution na VM, conectar o chip e validar os formatos não documentados (seção 9 e `docs/PENDENCIAS_HUMANAS.md`).
- **Chat web:** funcionando em produção; o fluxo inicial (boas-vindas → consentimento) foi verificado.
- **Analisador de áudio:** `ANALYZER_API_URL` e `ANALYZER_API_KEY` ainda não estão configurados; o áudio só avança o estado. O formato do contrato está isolado em `src/audio/analyzer.ts`.
- **`PRIVACY_POLICY_URL`** aponta para um valor provisório; troque pela política real.
- **Vários usuários no chat web:** hoje há um único usuário de teste, por decisão consciente.

## 15. Problemas já encontrados e como diagnosticar

| Sintoma | Causa | Como confirmar / corrigir |
|---|---|---|
| Evolution recebe 401 do webhook | `x-webhook-token` ausente/diferente de `EVOLUTION_WEBHOOK_TOKEN` | `GET /webhook/find/<instância>` na Evolution; `wrangler tail` procurando `invalid_webhook_token` |
| `config_invalid` / webhook 500 | Variável `EVOLUTION_*` ausente ou inválida | `wrangler secret list`; `wrangler tail` |
| Bot não responde e a Evolution mostra a instância desconectada | O WhatsApp derrubou a sessão (ou o número foi banido) | Reconecte pelo QR Code; se for banimento, use outro chip e revise o volume (`ANTI_FLOOD_MAX_PER_DAY`) |
| Pessoa responde "2" e o bot não entende | Opções expiradas (12 h) ou apagadas por outra mensagem | Esperado: o bot reapresenta o menu quando a pessoa digitar `menu` |
| Bot não responde, log `event_failed` | Falha ao falar com o Supabase | Chame `GET /chat/api/diag`: cada passo mostra `ok` ou o status do erro |
| `diag` com `401` | `SUPABASE_SERVICE_KEY` de produção diferente da correta | Reenvie com `wrangler secret put` |
| Supabase `PGRST125` / `PGRST205` | `SUPABASE_URL` com `/rest/v1/` no final / tabelas inexistentes | Use só a base da URL; rode `supabase/schema_completo.sql` |
| `/chat` devolve 404 | `CHAT_SIM_ENABLED` não é `"true"` | Ajuste em `wrangler.toml` e faça deploy |
| `/chat` devolve 401 | Chave ausente ou diferente do `ADMIN_TOKEN` | Use `?key=<ADMIN_TOKEN>` |
| Chat responde "áudio inválido" | Navegador gravou `webm` | Use Firefox/`ogg` ou anexe um arquivo `mp3`/`ogg` |

## 16. Matching: mentor, mentorado e registro da mentoria (v2)

1. **Aceite:** o admin cria o match (`/match D12 M3` ou painel); o mentor recebe a dúvida e responde *sim/não* (`MATCH_MENTOR_ACCEPT`). Não = match cancelado e a dúvida volta para a lista.
2. **Horários:** mentor informa dias e horários livres (guardados no match). O mentorado escolhe uma faixa e diz de que horas a que horas vai a mentoria (média 1 h, **mínimo 20 min**, dentro da faixa), depois o local. A faixa livre (ex.: 8h–20h) é só disponibilidade.
3. **Anonimato:** mentor e mentorado não sabem quem é o outro. Qualquer pergunta sobre nome/contato/inicial recebe texto fixo. O **nome chega 5 minutos antes** da mentoria (cron por minuto).
4. **Registro:** quem tem mentoria confirmada manda só o áudio; papel, parceiro, assunto e data vêm do match (não pergunta contato nem assunto). Áudio **antes** do horário: o bot pergunta se já fizeram (sim = registra, não = ignora e apaga).
5. **Certificado:** "quero meu certificado" grava um pedido (`certificado_pedidos`) se há mentoria aprovada e avisa a equipe; quem emite é o sistema da equipe.
6. **Critérios da sessão:** a mensagem "Mentoria confirmada!" (a mesma que traz data, horário e local) já inclui, para o mentor e para o mentorado, os critérios para a sessão valer como Atividade Complementar (cadastro completo, gravação inteira sem cortes, os dois falando, mínimo de 20 min, orientação com objetivo e sem palestra/papo/estágio/TCC, sem ofensa nem fraude), com uma linha específica de cada papel. Código: `criteriaText` em `src/matching/decide.ts`.
7. **Retirar área:** quem já é cadastrado e escreve algo como "quero retirar uma matéria" abre a lista das próprias áreas e escolhe qual sai (ou já diz o nome e sai direto). Não existe botão no menu para isso; a última área não pode ser retirada. Estado `REMOVE_CATEGORIES`, código em `src/profile/decide.ts`.

## 17. Árvore de decisão (como o bot "pensa")

### 17.1 O funil de toda mensagem (de cima para baixo; o primeiro que "pega" responde)

```
Chegou uma mensagem
 │
 ├─ 1. Token do webhook inválido? ───────────────► 401, nada é processado
 ├─ 2. Mensagem já vista (mesmo key.id)? ────────► ignora (idempotência)
 ├─ 3. É do próprio bot, de grupo ou status? ────► ignora
 ├─ 4. Pessoa estava com a trava manual / sem contato prévio? ► não envia (R1)
 │
 ├─ 5. Disse "sair/parar"? ──────────────────────► OPTED_OUT (só "voltar" reativa)
 ├─ 6. Tocou em Sim/Não de confirmação de mentoria ou [Pedir revisão]? ► trata e termina
 ├─ 7. Tem confirmação de mentoria pendente? ────► pergunta ao parceiro
 ├─ 8. Pergunta "quem é meu mentor?" ────────────► texto FIXO de anonimato (sem IA)
 ├─ 9. Pede certificado (e já aceitou os termos)? ► confere e avisa a equipe
 ├─10. Pergunta sobre o programa / termos / LGPD? ► responde 1 vez e repete a pergunta da etapa
 │      assunto sem relação? ─────────────────────► "fora de assunto" (ver 17.8)
 │
 └─11. Máquina de estados (a pessoa está em ONDE da jornada?)
        cadastro → perfil → horários → menu → match → mentoria → ...
        Entrada esperada → avança e responde (no máximo 1 mensagem)
        Entrada inesperada → 1 dica por estado, depois "fora de assunto", depois silêncio
```

Antes de qualquer envio, `sendGuarded` ainda confere: trava manual, **só escreve a quem já escreveu**, limites por pessoa (200/dia, 30/10 min) e anti-flood diário. Falhou qualquer um = não envia.

### 17.2 Jornada completa (visão de cima)

```
oi ─► CADASTRO ─► PERFIL ─► (mentor) HORÁRIOS ─► COMPLETED ─► MENU
                    │                                          │
                    ├─ mentorado: DÚVIDA ─► HORÁRIOS ─► COMPLETED
                    │
   equipe cria MATCH (mentor ↔ dúvida) ─► mentor ACEITA ─► mentor manda HORÁRIOS
        ─► mentorado ESCOLHE horário, duração e LOCAL ─► "Mentoria confirmada! + critérios"
        ─► 5 min antes: chegam os NOMES ─► a mentoria acontece (gravada)
        ─► áudio enviado ─► REGISTRO ─► parceiro CONFIRMA ─► curadoria
        ─► "aprovada" ou "recusada" (com [Pedir revisão]) ─► CERTIFICADO
```

### 17.3 Cadastro (estados NEW → REG_*)

| Passo | O bot pergunta | Resposta esperada | Se não entender |
|---|---|---|---|
| `NEW` | (pessoa escreve "oi") | saudação | 1 dica |
| `REG_CONSENT` | Termos + LGPD, botão **Aceito** | "1", "aceito", "sim" | 1 dica; **nada é guardado sem aceite** |
| `REG_FIELD_full_name` | Nome completo | nome real (a IA ajuda a desconfiar de apelidos) | dica; nome estranho/uma palavra → `REG_NAME_CONFIRM` ("é esse mesmo?") |
| `REG_FIELD_class_name` | Turma (T27, T26...) | texto com número | dica |
| `REG_AGE` | Idade/nascimento | número ou data válida (limite de idade) | dica |
| `REG_PROFILE_AUDIO` | Um áudio contando curiosidades (ou texto de 10 a 1000 caracteres) | áudio ou texto | dica |
| Quem **já é cadastrado** e escreve "oi" | vai direto a `RETURNING_CHOICE` | | |

### 17.4 Perfil: papel, áreas, dúvida e horários

```
PROFILE_ROLE  "mentor, mentorado ou os dois?"  (1, 2, 3 ou botão)
   │
   ├─ Mentorado ─► DOUBT_ASK "tem uma dúvida agora?"
   │                  ├─ Não ─► COMPLETED ("Parabéns, cadastro finalizado")
   │                  └─ Sim ─► DOUBT_TEXT "descreva a dúvida" (pode anexar documento)
   │                              ─► SCHED_* "dias e horários" ─► COMPLETED
   │
   ├─ Mentor ─► MENTOR_CATEGORIES  lista de áreas (Computação, Matemática, Liderança,
   │             Negócios, Design/UX, Vida Acadêmica); uma por toque ou várias de uma vez
   │             ─► "Concluir" ─► SCHED_* (dias e horários) ─► COMPLETED
   │
   └─ Os dois ─► MENTOR_CATEGORIES_BOTH ─► horários ─► DOUBT_ASK ─► ... ─► COMPLETED
```

- **Horários** (`SCHED_DAYS_*` / `SCHED_HOURS_*`): lista de dias → lista de faixas do dia → "Concluir" → volta aos dias → "Terminei". Também aceita texto livre ("segunda e quarta de manhã"): as regras leem primeiro e a IA só entra se as regras não acharem nada.
- **Quem volta depois** (`RETURNING_CHOICE`): três opções, **Tirar dúvida**, **Mudar áreas**, **Menu**.
- **Retirar uma área** (`REMOVE_CATEGORIES`): só começa se a pessoa **escrever** algo como "quero retirar uma matéria". Não existe botão. Lista as áreas atuais, a pessoa escolhe e o bot confirma em 1 mensagem. A última área não sai.
- **Correção da dúvida:** "na verdade minha dúvida é..." troca a dúvida registrada enquanto estiver aberta; "tava brincando" é aceito.

### 17.5 Menu de serviços (estado `MENU`)

| Item | O que acontece |
|---|---|
| **Registrar mentoria** | exige áudio → `AWAIT_AUDIO` (ver 17.7) |
| **Marcar nova mentoria** | abre o registro de dúvida (`DOUBT_TEXT`) |
| **Horários** | a pessoa atualiza os dias e horários livres |
| **Contato** | resposta pronta com o contato do fundador |

Os itens e respostas vêm do banco (tabelas `services` e `canned_responses`) com fallback no código. Escolher o mesmo item de novo = silêncio.

### 17.6 O match (mentor ↔ mentorado)

```
Equipe cria o match (/match D12 M3 ou painel)
 └─► MATCH_MENTOR_ACCEPT  mentor vê a dúvida: "Você aceita?"
        ├─ Não ─► match cancelado; a dúvida volta para a lista
        └─ Sim ─► mentor informa dias/horários livres (SCHED_* do match)
                  └─► MATCH_MENTEE_PICK  mentorado recebe a lista de horários
                         ├─ "Nenhum desses" ─► mentor é chamado de novo para outra grade
                         └─ escolhe ─► MATCH_MENTEE_TIME "de que horas a que horas?"
                               (mínimo 20 min, dentro da faixa livre do mentor)
                               └─► MATCH_MENTEE_PLACE "onde?" (texto livre)
                                     └─► "Mentoria confirmada! 🎉" para os DOIS,
                                         com a lista de CRITÉRIOS da sessão
```

- **Anonimato:** nenhum dos dois sabe quem é o outro. Qualquer pergunta sobre nome/contato recebe um texto fixo. O cron de 1 minuto manda os **nomes 5 minutos antes** do horário.
- **Match cancelado** pela equipe: os dois são soltos e recebem um aviso curto.

### 17.7 Registro e validação da mentoria

```
Menu "Registrar mentoria" (ou o áudio direto, se há mentoria confirmada)
 └─► AWAIT_AUDIO  "envie o áudio"
       └─► áudio recebido ─► consentimento ok? ─► tipo válido? ─► guarda no R2 ─► registra
             │
             ├─ Mentoria veio de um match: papel, parceiro, assunto e data já são conhecidos
             │     ├─ áudio chegou ANTES do horário ─► MENT_EARLY_CONFIRM "já fizeram?"
             │     │        Sim = segue; Não = ignora e apaga o áudio
             │     └─► "Mentoria registrada!"
             │
             └─ Sem match: MENT_ROLE (fui mentor/mentorado) ─► MENT_SUBJECT (assunto)
                   ─► MENT_DATE / MENT_DATE_TEXT (hoje, ontem, outra) ─► MENT_PARTNER (contato, número ou nome)
                   ─► "Mentoria registrada!"

 └─► O parceiro recebe "Você participou de uma mentoria com X em D?"  [Sim] [Não]
        ├─ Sim ─► segue para a análise
        └─ Não ─► gravação apagada, não gera certificado
 └─► Curadoria (equipe + analisador no notebook) decide:
        ├─ aprovada ─► aviso ✅ para o participante
        └─ recusada ─► aviso com [Pedir revisão] (revisão humana, LGPD art. 20)
 └─► "Quero meu certificado" ─► confere mentorias aprovadas ─► grava o pedido e avisa a equipe
```

**Troca de assunto no meio do registro** (`SWITCH_DOUBT`): se a pessoa estava mandando a mentoria e diz "quero tirar uma dúvida", o bot pergunta "Você vai registrar a mentoria agora?". Sim = volta de onde parou; Não = apaga o rascunho e o áudio incompleto e começa a dúvida.

**Como o analisador decide uma sessão** (resumo; detalhe no documento de critérios): status **Recomendada** (todos os critérios verificáveis atendem), **Revisão humana** (dúvida ou sinal de risco) ou **Recusada** (um critério bloqueante falha, ex.: gravação repetida, sem fala real, um dos dois ausente por mais de 5 min, abaixo do mínimo). Na dúvida, nunca aprova sozinho.

### 17.8 Quando o bot NÃO responde (ou responde curto)

```
Entrada inesperada no estado atual
 ├─ 1ª vez ─► UMA dica que repete as opções ("Digite 1, 2 ou 3")
 ├─ depois ─► aviso curto de "aqui não é lugar de resenha…" (tom de estudante; a IA reescreve,
 │            com texto fixo de reserva se a IA falhar ou vier link/número)
 ├─ última vaga ─► despedida ("vou ficar na minha…")
 └─ depois ─► silêncio até chegar uma entrada válida
```

Silêncio também para: repetição da mesma escolha de menu, reação/vídeo/localização/contato, qualquer coisa acima dos limites por pessoa, trava manual ligada ou anti-flood no teto. **Saudação** é exceção: sempre recebe retorno ("tô aqui") e a pergunta pendente. **Modo cuidado:** depois de um tema sensível, por 1 hora não vai figurinha nem brincadeira.

### 17.9 O papel da IA (e o que ela NÃO faz)

| Faz | Não faz |
|---|---|
| Escolhe **uma opção** de uma lista fechada quando o bot não entende | Escrever mensagem livre ou prometer algo |
| Lê dias/horários escritos em linguagem natural (só se as regras falharam) | Marcar, cancelar ou salvar algo (quem confirma é o sistema) |
| Diz se um nome parece real ou apelido | Receber dados antes do aceite LGPD |
| Reescreve avisos curtos (fora de assunto, retomada, "vlw") | Citar nome, horário ou local de pessoas |
| Provedores gratuitos e com limite diário; se estourar, vale o texto fixo | Revelar quem é o mentor/mentorado (texto fixo, sem IA) |

### 17.10 Proteção do número (R1) e privacidade (R3, R6)

- **Só escreve a quem escreveu primeiro.** Sem mensagem fria.
- **Trava manual** (só um humano liga e fecha) e **anti-flood** diário opcional.
- O endpoint do webhook responde **200** mesmo com tudo travado: "quebrar" = parar de enviar.
- Nada é guardado antes do **aceite** dos termos; telefones aparecem mascarados nos logs e em hash no armazenamento; o áudio é apagado do servidor do bot quando o notebook confirma o recebimento.

## 18. Roteiro sugerido para o vídeo em animação

Sugestão de duração: 2 a 3 minutos, personagem-guia o **Axo** (axolote), mostrando a tela do WhatsApp à esquerda e os "bastidores" à direita (o funil da seção 17.1 se acendendo).

| # | Cena | O que mostrar na tela | Mensagem principal |
|---|---|---|---|
| 1 | Abertura | Estudante trava num módulo; o Axo aparece | "Ninguém se regenera sozinho" |
| 2 | Primeiro "oi" | Mensagem chega; o funil (17.1) acende de cima para baixo | O bot decide quem pode falar e o que fazer |
| 3 | Consentimento | Botão **Aceito**; cadeado nos dados | Nada é guardado antes do aceite (LGPD) |
| 4 | Cadastro | Nome, turma, idade, áudio de curiosidades | Quatro perguntas, uma por vez |
| 5 | Papel | Três caminhos: mentor, mentorado, os dois | A árvore se divide (17.4) |
| 6 | Áreas e dúvida | Lista de áreas / balão com a dúvida | Mentor escolhe áreas; mentorado conta o problema |
| 7 | Horários | Calendário se preenchendo por listas | Disponibilidade dos dois |
| 8 | O match | Equipe liga mentor e dúvida; mentor aceita | O bot negocia, a equipe conecta |
| 9 | Anonimato | Dois avatares com "?" no rosto | Nomes só chegam 5 min antes |
| 10 | Confirmação + critérios | Cartão "Mentoria confirmada!" e a lista de critérios | O que mentor e mentorado precisam cumprir |
| 11 | A mentoria | Os dois conversando, gravando | Conversa inteira, os dois falam, mínimo 20 min |
| 12 | Registro | Áudio sobe; parceiro responde Sim/Não | Dupla confirmação |
| 13 | Curadoria | Selo: ✅ aprovada ou ❌ recusada (+ Pedir revisão) | Na dúvida, um humano decide |
| 14 | Certificado | Pedido de certificado | Horas de Atividade Complementar |
| 15 | Cuidados | Axo calado quando não é a hora; cadeado do anti-ban | Responde só quando faz sentido (17.8) |
| 16 | Encerramento | Logo Be My Mentor | "Quer ajudar? Quer ser ajudado? Manda um oi." |

Dica de produção: use **uma cor por jornada** (cadastro, perfil, match, registro, curadoria) para a árvore da seção 17.2 ficar legível quando aparecer em pedaços.

## 19. Glossário de estados

| Estado | Significado |
|---|---|
| `NEW` | Pessoa nova, ainda não disse "oi" |
| `AWAIT_REGISTRATION`, `REG_CONSENT` | Aguardando o aceite dos termos |
| `REG_FIELD_full_name`, `REG_NAME_CONFIRM` | Nome completo e confirmação de nome estranho |
| `REG_FIELD_class_name`, `REG_AGE` | Turma e idade |
| `REG_PROFILE_AUDIO` | Áudio (ou texto) de apresentação |
| `PROFILE_ROLE` | Mentor, mentorado ou os dois |
| `MENTOR_CATEGORIES`, `MENTOR_CATEGORIES_BOTH` | Escolha das áreas (só mentor / mentor e mentorado) |
| `REMOVE_CATEGORIES` | Escolha da área a retirar (só abre se a pessoa pedir por texto) |
| `DOUBT_ASK`, `DOUBT_TEXT` | "Tem uma dúvida?" e a descrição dela |
| `SCHED_DAYS_*`, `SCHED_HOURS_*`, `SCHED_CONFIRM_*` | Dias e horários em listas (mentor, mentorado ou match) |
| `AVAILABILITY_TEXT` | Horários digitados em texto livre |
| `RETURNING_CHOICE` | Cadastrado que voltou: dúvida, mudar áreas ou menu |
| `MENU` | Menu de serviços |
| `AWAIT_AUDIO`, `PROCESSING_AUDIO` | Esperando o áudio da mentoria / processando |
| `MENT_ROLE`, `MENT_SUBJECT`, `MENT_DATE`, `MENT_DATE_TEXT`, `MENT_PARTNER` | Registro manual da mentoria (papel, assunto, data, parceiro) |
| `MENT_EARLY_CONFIRM` | Áudio chegou antes do horário: "já fizeram?" |
| `SWITCH_DOUBT` | "Você vai registrar a mentoria agora?" |
| `MATCH_MENTOR_ACCEPT` | Mentor decide se aceita a mentoria |
| `MATCH_MENTEE_PICK`, `MATCH_MENTEE_TIME`, `MATCH_MENTEE_PLACE` | Mentorado escolhe horário, duração e local |
| `COMPLETED` | Fluxo concluído; "oi" ou "menu" reabre |
| `OPTED_OUT` | Pediu para sair; só "voltar" reativa |
