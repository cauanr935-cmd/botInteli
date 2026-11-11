# Bot WhatsApp + Chat Web — documentação técnica

> Estado em 2026-11-10. Este documento descreve o sistema como está implementado no código, não como foi planejado.
> Regras de projeto e decisões: `CLAUDE.md`, `docs/PLANO.md`, `docs/DECISOES.md`.

## 1. Visão geral

Um bot de atendimento que:

1. Faz o **cadastro** da pessoa, com consentimento LGPD, e grava no banco.
2. Mostra um **menu de serviços** (lista interativa).
3. Responde com **respostas prontas** guardadas no banco.
4. Recebe **áudios**, guarda no R2 e os encaminha a uma **API externa de análise**. O bot não analisa nada: só encaminha e devolve o resultado.

O bot tem **dois canais de entrada** que usam o **mesmo motor de conversa**, sem nenhuma regra duplicada:

| Canal | Quando usar | Entrada | Saída |
|---|---|---|---|
| **WhatsApp (Cloud API da Meta)** | Produção. Depende de o webhook estar liberado/configurado na Meta. | `POST /webhook` (assinado) | `POST graph.facebook.com/.../messages` |
| **Chat web (simulador)** | Teste e demonstração enquanto a Meta não libera. Sem cadastro de usuário. | Página `/chat` e `/chat/api/*` | Capturada e desenhada na própria página |

```
                  ┌────────────── Cloudflare Worker (bot-whatsapp) ──────────────┐
  WhatsApp ──►    │  POST /webhook ──► verifica assinatura ─┐                    │
  (Meta)          │                                          ▼                    │
                  │                                  processEvents()              │
  Navegador ──►   │  /chat, /chat/api/* ──► monta o mesmo ──►  (idempotência,    │ ──► Supabase (Postgres)
  (página web)    │  evento do webhook                          touchUser)        │ ──► R2 (áudios + histórico do chat)
                  │                                                 ▼             │ ──► API externa de áudio
                  │                                       createEventHandler()    │
                  │                                   motor de conversa (decide)  │
                  │                                                 ▼             │
                  │                                         sendGuarded()  ───────┼──► Graph API da Meta  (canal WhatsApp)
                  │                                                 └─────────────┼──► função local → tela (canal chat web)
                  └───────────────────────────────────────────────────────────────┘
```

A única diferença entre os canais está nas bordas: de onde vem o evento e para onde vai a mensagem de saída. Para o chat web, `sendGuarded` recebe uma função `fetch` local no lugar da Graph API. Por isso todas as travas continuam valendo (janela de 24h, limites por pessoa, orçamento mensal).

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (strict), ESM |
| Runtime | Cloudflare Workers (`compatibility_date 2025-01-01`, `nodejs_compat`) |
| Agendador | Cron Trigger do Workers (`0 6 * * *`, 06:00 UTC) |
| Armazenamento de arquivos | Cloudflare R2, bucket `bot-whatsapp-audios` (binding `AUDIOS`) |
| Banco | Supabase (Postgres) via REST (PostgREST), sem biblioteca cliente |
| Mensageria | WhatsApp Cloud API oficial da Meta (Graph API `v21.0`, versão vinda de env) |
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
    handler.ts             GET (verificação) e POST (assinatura, parse, idempotência) do webhook
    events.ts              Fiação: status → trava de orçamento; mensagem → motor → sendGuarded
  whatsapp/
    client.ts              ÚNICO arquivo que conhece a Graph API; sendGuarded; cliente de mídia
    parser.ts, types.ts    Payload da Meta → eventos tipados
    builders.ts            Monta texto, botões e lista respeitando os limites da Meta
    signature.ts           HMAC-SHA256 do corpo bruto (X-Hub-Signature-256)
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

1. **Entrada.** O evento chega pelo webhook (assinado) ou pelo chat web.
2. **Idempotência.** `processed_messages` guarda o `wamid`. O mesmo ID recebido duas vezes é ignorado, porque a Meta reenvia webhooks.
3. **Atualização do usuário.** `touch_user` grava a hora da última mensagem da pessoa. É isso que abre a janela de 23h30 para responder.
4. **Motor.** `decide()` é uma função pura: dado o estado, a mensagem e os contadores, devolve as respostas e o próximo estado. `engine.ts` aplica o resultado com controle de concorrência por versão (compare-and-swap em `users.version`).
5. **Envio.** Toda mensagem de saída passa por `sendGuarded` (seção 6).
6. **Resposta HTTP.** O webhook responde **200** sempre que a assinatura é válida, mesmo com o disjuntor aberto. Se devolvesse erro, a Meta reenviaria e poderia desativar o webhook.

### 4.1 Estados da conversa

| Estado | Significado | Sai quando |
|---|---|---|
| `NEW` | Pessoa nova | Envia uma saudação ("oi", "olá"...) → `AWAIT_REGISTRATION` |
| `AWAIT_REGISTRATION` / `REG_*` | Cadastro (Flow ou perguntas) | Concluiu → `MENU` |
| `MENU` | Menu de serviços | Escolhe um serviço da lista |
| `AWAIT_AUDIO` | Serviço que exige áudio | Envia áudio → `PROCESSING_AUDIO` |
| `PROCESSING_AUDIO` | Analisando | Pipeline termina → `AWAIT_AUDIO` |
| `COMPLETED` | Fluxo concluído | "menu" → `MENU` |
| `OPTED_OUT` | Pediu para sair | "voltar" retoma de onde parou |

Comandos reconhecidos em texto (com variações de maiúscula, acento, letras repetidas e pontuação): saudação (`oi`), `menu`/`voltar`/`início`, `sair`/`parar`/`cancelar`/`stop`, `sim`/`aceito`, `não`.

### 4.2 Regras anti-spam (R2)

- Só responde a entrada **esperada no estado atual**. Entrada inesperada gera **no máximo 1 dica por estado**; depois, silêncio.
- Repetição não gera resposta ("oi" depois das boas-vindas = silêncio).
- Uma entrada válida = **no máximo uma resposta**. Nada de "aguarde" ou "recebi seu áudio" como mensagem separada.
- Limites por pessoa: `MAX_BOT_MSGS_PER_USER_PER_DAY` (12) e `MAX_BOT_MSGS_PER_USER_PER_10MIN` (4). Acima disso, silêncio.
- Figurinha, reação, imagem, vídeo, localização e contato são silêncio.

### 4.3 Cadastro

Campos definidos em `src/registration/fields.ts` (hoje só `full_name`; é o único lugar para trocar ou acrescentar campos, junto da migração e do Flow). Dois modos:

- **Com WhatsApp Flow** (`WHATSAPP_FLOW_ID` definido): o formulário chega como `nfm_reply`.
- **Sem Flow** (modo atual): botão **Aceito** (consentimento) seguido de uma pergunta por campo.

Nenhum dado de cadastro nem áudio é guardado antes do consentimento (`consent_at`, `terms_version`); um trigger no banco (`audios_require_consent`) reforça isso.

### 4.4 Pipeline de áudio

```
áudio recebido → confere consentimento → valida tipo (ogg, opus, mp3, m4a, aac, amr)
  → baixa a mídia (URL da Meta vale 5 min; renova 1 vez se expirar)
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
| `message_budget` | Contador mensal por número (`reserved_count`, `stop_at`, `tripped`) |
| `budget_lock` | Disjuntor manual |
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

Limites da Meta que o código valida e recusa exceder: lista até 10 linhas (título ≤ 24, descrição ≤ 72), até 3 botões (título ≤ 20), corpo ≤ 1024 caracteres.

## 6. Orçamento e segurança de custo (R1)

A Meta dá 1.000 conversas de serviço grátis por número e mês. O sistema **nunca** chega perto da cobrança:

- `META_FREE_TIER_PER_MONTH = 1000` é constante no código.
- `STOP_AT = 1000 - BUDGET_SAFETY_MARGIN` (margem padrão 50, mínima 10 → corte em 950).
- `sendGuarded` é a **única** função que envia e vive no **único** arquivo que conhece a Graph API (um teste de arquitetura reprova qualquer violação). Antes de enviar:
  1. Recusa `template` (não são grátis).
  2. Só envia se a última mensagem da pessoa tem menos de **23h30**.
  3. Respeita a trava manual (falha fechada).
  4. **Reserva atômica** de uma vaga no contador (`reserve_outbound_slot_detail`); sem vaga, não envia. A vaga não é devolvida se o envio falhar.
- Ao atingir `STOP_AT`, o disjuntor abre: nada sai até virar o mês (fuso `META_ACCOUNT_TIMEZONE`). Log `warn` a 80% e `critical` ao abrir.
- Status webhook com `billable: true`, `type: "regular"` ou `category` ≠ `"service"` abre a **trava manual** na hora. Só um humano fecha (endpoint admin).
- Se o banco estiver fora, **não envia**.

## 7. API do Worker

URL de produção: `https://bot-whatsapp.bot-whatsaap-inteli.workers.dev`

| Rota | Método | Auth | Descrição |
|---|---|---|---|
| `/health` | GET | — | Retorna `ok` |
| `/webhook` | GET | `hub.verify_token` | Verificação da Meta; devolve `hub.challenge` (200) ou 403 |
| `/webhook` | POST | `X-Hub-Signature-256` | Eventos da Meta; 401 se a assinatura for inválida; 200 caso contrário |
| `/admin/budget` | GET | `Authorization: Bearer ADMIN_TOKEN` | Mês, contador, `stop_at`, disjuntor e trava manual |
| `/admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO` | POST | Bearer `ADMIN_TOKEN` | Fecha a trava manual (cabeçalho opcional `X-Admin-User`) |
| `/chat?key=ADMIN_TOKEN` | GET | `key` | Página do chat web |
| `/chat/api/*` | vários | `X-Chat-Key: ADMIN_TOKEN` ou `?key=` | API do chat (seção 8) |

Qualquer outro caminho: 404. Método errado em `/webhook`: 405.

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

- Não há assinatura nem webhook da Meta: a entrada é autenticada pela chave.
- O envio para a Meta é substituído por uma função local; nenhuma mensagem real sai. Mesmo assim, cada resposta **consome uma vaga** do contador mensal e entra no `outbound_log`.
- O Flow de cadastro não é renderizado; o cadastro usa o modo sem Flow (botão **Aceito** + pergunta).
- Reiniciar o cadastro do zero exige apagar o usuário `5500000000001` em `users` no Supabase.

## 9. Integração com o WhatsApp (Meta)

1. **Webhook**: no painel da Meta (WhatsApp > Configuração > Webhook):
   - URL de callback: `https://bot-whatsapp.bot-whatsaap-inteli.workers.dev/webhook`
   - Token de verificação: o mesmo valor do secret `VERIFY_TOKEN`
   - Depois de verificar, assine o campo `messages`.
2. **Credenciais** no Worker: `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET` (secrets).
3. **Número de teste** da Meta: envia para até 5 números cadastrados; use-o antes de qualquer número real.
4. **Opcional**: o MCP "WhatsApp Business Tools" da Meta (`https://mcp.facebook.com/whatsapp_business_tools`) configura o webhook por ferramentas do agente (`whatsapp_biz_configure_webhooks`, `whatsapp_biz_subscribe_webhook`). Está em beta e exige login OAuth e acesso de administrador ao negócio.

Verificação rápida do webhook (deve devolver `200` e o número enviado):

```bash
curl -i "https://bot-whatsapp.bot-whatsaap-inteli.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=SEU_VERIFY_TOKEN&hub.challenge=12345"
```

## 10. Configuração

Variáveis obrigatórias (o Worker recusa processar `/webhook` e `/admin` se faltar alguma):

| Variável | Onde | Descrição |
|---|---|---|
| `WHATSAPP_TOKEN` | secret | Token da Cloud API |
| `PHONE_NUMBER_ID` | secret | ID do número comercial |
| `APP_SECRET` | secret | Valida a assinatura do webhook |
| `VERIFY_TOKEN` | secret | Verificação do webhook |
| `SUPABASE_URL` | secret | **Só a base**: `https://<ref>.supabase.co` (sem `/rest/v1/`) |
| `SUPABASE_SERVICE_KEY` | secret | Chave de serviço do Supabase |
| `ADMIN_TOKEN` | secret | Endpoints `/admin/*` e o chat web |
| `PRIVACY_POLICY_URL` | secret | Citada no termo de consentimento |
| `GRAPH_API_VERSION`, `TERMS_VERSION` | `[vars]` | Versão da Graph API; versão do termo |

Opcionais: `ANALYZER_API_URL` + `ANALYZER_API_KEY` (devem ser configuradas juntas), `WHATSAPP_FLOW_ID`, `META_ACCOUNT_TIMEZONE` (`America/Sao_Paulo`), `BUDGET_SAFETY_MARGIN` (50), `MAX_BOT_MSGS_PER_USER_PER_DAY` (12), `MAX_BOT_MSGS_PER_USER_PER_10MIN` (4), `MAX_AUDIO_BYTES` (16000000), `ANALYZER_TIMEOUT_MS` (8000), `CHAT_SIM_ENABLED`.

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

Cron diário (06:00 UTC): nunca envia mensagem. Mantém o banco ativo (`ping`), apaga `processed_messages` com mais de 7 dias, libera conversas presas em `PROCESSING_AUDIO` há mais de 10 min e registra o uso do mês.

Logs são JSON estruturado, com telefone mascarado (`5511*****1234`) e **sem** conteúdo de mensagem nem dados de cadastro.

## 12. Segurança e LGPD

- Assinatura do webhook: HMAC-SHA256 do corpo **bruto** com comparação em tempo constante; inválida → 401 e nada é processado.
- Admin e chat web exigem `ADMIN_TOKEN`. A URL do chat contém a chave: não a compartilhe.
- Telefones aparecem só mascarados nos logs e em hash no R2 e em `outbound_log`.
- Nenhum cadastro nem áudio antes do consentimento explícito; os áudios são dado pessoal (a voz identifica a pessoa), então defina uma política de retenção no bucket.
- Só a API oficial da Meta. Bibliotecas não oficiais (Baileys, whatsapp-web.js etc.) são proibidas.

## 13. Testes

`npm run verify` roda tudo sem rede real (Graph API, Supabase, R2 e analisador são mockados ou em memória). Destaques:

- `tests/architecture.test.ts`: só `whatsapp/client.ts` pode conhecer a Graph API.
- `tests/adversarial/etapa-*`: casos de abuso por etapa.
- `tests/simulation.test.ts` + `scripts/simulate.ts`: cenários ponta a ponta (400 pessoas no mês, repetição, limites por pessoa, virada de mês, billable → trava).
- `tests/chat-sim.test.ts`: acesso ao chat web e conversão das mensagens do bot para a tela.

Observação: o teste de higiene (`tests/repo-hygiene.test.ts`, C0.6) falha enquanto existir um `.dev.vars` real no diretório; ele já falhava antes do chat web.

## 14. Estado atual e pendências

- **Canal WhatsApp:** o Worker valida o webhook corretamente (`GET /webhook` devolve o challenge). A configuração do webhook no painel da Meta e a liberação da API estavam pendentes.
- **Chat web:** funcionando em produção; o fluxo inicial (boas-vindas → consentimento) foi verificado.
- **Analisador de áudio:** `ANALYZER_API_URL` e `ANALYZER_API_KEY` ainda não estão configurados; o áudio só avança o estado. O formato do contrato está isolado em `src/audio/analyzer.ts`.
- **`PRIVACY_POLICY_URL`** aponta para um valor provisório; troque pela política real.
- **Flow de cadastro** (`WHATSAPP_FLOW_ID`): não configurado.
- **Vários usuários no chat web:** hoje há um único usuário de teste, por decisão consciente.

## 15. Problemas já encontrados e como diagnosticar

| Sintoma | Causa | Como confirmar / corrigir |
|---|---|---|
| Meta: "Não foi possível validar o URL de callback" | URL sem `/webhook`, token com espaço, ou secret ausente (config inválida → 500) | `curl` da seção 9; `wrangler secret list`; `wrangler tail` procurando `config_invalid` |
| Bot não responde, log `event_failed` | Falha ao falar com o Supabase | Chame `GET /chat/api/diag`: cada passo mostra `ok` ou o status do erro |
| `diag` com `401` | `SUPABASE_SERVICE_KEY` de produção diferente da correta | Reenvie com `wrangler secret put` |
| Supabase `PGRST125` / `PGRST205` | `SUPABASE_URL` com `/rest/v1/` no final / tabelas inexistentes | Use só a base da URL; rode `supabase/schema_completo.sql` |
| `/chat` devolve 404 | `CHAT_SIM_ENABLED` não é `"true"` | Ajuste em `wrangler.toml` e faça deploy |
| `/chat` devolve 401 | Chave ausente ou diferente do `ADMIN_TOKEN` | Use `?key=<ADMIN_TOKEN>` |
| Chat responde "áudio inválido" | Navegador gravou `webm` | Use Firefox/`ogg` ou anexe um arquivo `mp3`/`ogg` |
