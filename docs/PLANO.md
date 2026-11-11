# Plano de implementação — Bot de WhatsApp

Cada etapa tem **objetivo**, **tarefas** e **critérios de aceite** (C<N>.x). O verificador aprova a etapa só se **todos** os critérios forem atendidos, com teste que prove cada um, e se nenhuma regra de `CLAUDE.md` (R1–R6) for violada.

Ordem obrigatória: 0 → 8. Uma etapa só começa depois da anterior aprovada.

## Metas de economia (valem para o projeto inteiro)

Com o cadastro por formulário (WhatsApp Flow), uma pessoa nova gasta no máximo:

| Momento | Mensagens do bot |
| --- | --- |
| Boas-vindas (o formulário, com nome completo e aceite LGPD) | 1 |
| Pedido de áudio de apresentação | 1 |
| Confirmação do cadastro (sem menu de serviços) | 1 |
| Menu, instrução e resultado de um serviço com áudio (após pedido explícito) | 3 |
| **Total: cadastro + 1 serviço com áudio** | **6** |
| Cada áudio extra na mesma sessão | 1 |
| Pessoa já cadastrada voltando ("oi" → confirmação; "menu" explícito → serviço) | 4 |

Com 950 mensagens por mês (corte padrão), isso dá cerca de **158 pessoas novas com 1 serviço de áudio por mês**.

## Estados da conversa (referência para as etapas 3 a 6)

```
NEW ──(qualquer saudação)──► AWAIT_REGISTRATION ──(formulário válido)──► REG_PROFILE_AUDIO ──(áudio)──► COMPLETED
COMPLETED ──("menu" explícito)──► MENU
MENU ──(serviço sem áudio)──► resposta pronta ──► MENU
MENU ──(serviço com áudio)──► AWAIT_AUDIO ──(áudio válido)──► PROCESSING_AUDIO ──(resultado)──► AWAIT_AUDIO
AWAIT_AUDIO ──("menu" ou botão Menu)──► MENU
qualquer estado ──("sair"/"parar")──► OPTED_OUT ──("voltar")──► estado anterior
```

Sem Flow configurado (`WHATSAPP_FLOW_ID` vazio), `AWAIT_REGISTRATION` vira a sequência `REG_CONSENT` → `REG_FIELD_full_name` → `REG_PROFILE_AUDIO`.

---

## Etapa 0 — Fundação do projeto

**Objetivo:** projeto TypeScript em Cloudflare Workers, com testes, lint e configuração validada, pronto para receber as próximas etapas.

**Tarefas**
- `package.json`, TypeScript `strict`, ESLint, Vitest, configuração do Wrangler (com binding R2 `AUDIOS`, cron diário e variáveis).
- Estrutura: `src/index.ts` (handlers `fetch` e `scheduled`), `src/config.ts`, `src/whatsapp/`, `src/budget/`, `src/conversation/`, `src/registration/`, `src/services/`, `src/audio/`, `src/db/`, `src/lib/`, `tests/`, `tests/fixtures/`, `tests/adversarial/`, `supabase/migrations/`, `flows/`, `scripts/`.
- `src/config.ts`: lê e valida todas as variáveis; falha com mensagem clara se faltar obrigatória ou se o orçamento for inseguro (ver R1). `META_FREE_TIER_PER_MONTH = 1000` como constante.
- `.dev.vars.example` com: `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET`, `VERIFY_TOKEN`, `GRAPH_API_VERSION`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANALYZER_API_URL`, `ANALYZER_API_KEY`, `ADMIN_TOKEN`, `META_ACCOUNT_TIMEZONE` (padrão `America/Sao_Paulo`), `BUDGET_SAFETY_MARGIN`, `MAX_BOT_MSGS_PER_USER_PER_DAY`, `MAX_BOT_MSGS_PER_USER_PER_10MIN`, `WHATSAPP_FLOW_ID` (opcional), `PRIVACY_POLICY_URL`, `TERMS_VERSION`, `MAX_AUDIO_BYTES`.
- `.gitignore` cobrindo `.dev.vars`, `.env*` (exceto exemplos), `node_modules`, `.wrangler`.
- Script `npm run verify` (typecheck + lint + testes).
- Logger estruturado (JSON) com níveis `debug/info/warn/error/critical` e função de mascarar telefone.
- `GET /health` → 200; rota desconhecida → 404.
- Manter `docs/DECISOES.md` e `docs/PENDENCIAS_HUMANAS.md` (já existem; acrescente, não apague itens).

**Critérios de aceite**
- **C0.1** `npm ci && npm run verify` passa num clone limpo.
- **C0.2** TypeScript em modo `strict`; lint sem erros.
- **C0.3** Config inválida gera erro claro: variável obrigatória ausente; `BUDGET_SAFETY_MARGIN < 10`; margem não numérica. Testes cobrem cada caso.
- **C0.4** `META_FREE_TIER_PER_MONTH` é constante (não lida do ambiente); teste garante que mudar o env não muda o valor.
- **C0.5** Mascaramento: `5511987651234` vira algo como `5511*****1234`; teste cobre.
- **C0.6** Nenhuma dependência proibida (R5) e nenhum segredo no repositório; `.gitignore` correto.
- **C0.7** `/health` 200 e rota desconhecida 404, testados.

---

## Etapa 1 — Webhook seguro e idempotente

**Objetivo:** receber eventos da Meta com segurança, entender cada tipo e nunca processar o mesmo evento duas vezes.

**Tarefas**
- `GET /webhook`: se `hub.mode=subscribe` e `hub.verify_token` = `VERIFY_TOKEN`, responde 200 com o `hub.challenge` em texto; senão 403.
- `POST /webhook`: valida `X-Hub-Signature-256` sobre o corpo **bruto** (antes de qualquer parse), comparação em tempo constante. Inválida/ausente → 401.
- Parser tipado do payload para: `text`, `interactive` (`button_reply`, `list_reply`, `nfm_reply`), `audio` (inclui nota de voz), `statuses` (com `pricing`) e um tipo `unsupported` para o resto (figurinha, reação, imagem, vídeo, localização, contatos, desconhecidos). Um payload pode trazer vários eventos.
- Fixtures em `tests/fixtures/` com payloads no formato da documentação da Meta.
- Interface `Repo` (acesso a dados) com implementação **em memória** (testes) e **Supabase** (produção). Nesta etapa: tabela `processed_messages (wamid pk, received_at)` + migração.
- Idempotência por `wamid`: inserir antes de processar; se já existia, ignorar.
- Responder 200 rápido; o processamento roda em `ctx.waitUntil` (ou fila — decidir e registrar em DECISOES).
- Erro interno no processamento: registrado em log, resposta continua 200.
- Guardar `last_user_message_at` por usuário a cada mensagem recebida (necessário para a janela de 24h).

**Critérios de aceite**
- **C1.1** Verificação GET: token certo → 200 + challenge; token errado ou modo errado → 403.
- **C1.2** Assinatura: válida → aceita; ausente, errada ou corpo alterado após assinar → 401 e **nenhum** processamento.
- **C1.3** O mesmo payload entregue 2 vezes é processado 1 vez (inclusive em entregas simultâneas).
- **C1.4** Todos os tipos listados são reconhecidos; tipo desconhecido vira `unsupported` sem lançar erro; payload com vários eventos processa todos.
- **C1.5** Exceção no processamento → resposta 200 e log de erro.
- **C1.6** Logs não contêm telefone em claro nem texto das mensagens (teste captura os logs e confere).
- **C1.7** `last_user_message_at` atualizado a cada mensagem recebida.

---

## Etapa 2 — Disjuntor de orçamento (o coração do R1)

**Objetivo:** tornar **impossível** o bot mandar a mensagem paga. Esta é a etapa mais importante do projeto.

**Tarefas**
- Migrações:
  - `message_budget (phone_number_id, month_key, reserved_count, stop_at, tripped, trip_reason, tripped_at)`, chave primária `(phone_number_id, month_key)`.
  - `budget_lock (phone_number_id pk, locked, reason, locked_at, unlocked_at, unlocked_by)` — disjuntor **manual**.
  - `outbound_log (id, wa_id_hash, message_type, wamid, reserved_at, sent_ok, error_code, pricing_billable, pricing_type, pricing_category, status_updated_at)`.
- Função SQL **atômica** `reserve_outbound_slot(phone_number_id, month_key, stop_at)` → `boolean`: cria a linha do mês se não existir, incrementa só se `reserved_count < stop_at` e não houver trava manual, e marca `tripped` quando atingir o limite. Uma única instrução de `UPDATE ... WHERE ... RETURNING`, sem "ler e depois escrever".
- `month_key` calculado no fuso `META_ACCOUNT_TIMEZONE` (formato `YYYY-MM`), virando à meia-noite do dia 1.
- `src/whatsapp/client.ts` — **único** arquivo com a URL da Graph API — exporta `sendGuarded(message, context)`, que nesta ordem:
  1. recusa `type: "template"`;
  2. recusa se `last_user_message_at` tiver mais de 23h30;
  3. recusa se a trava manual estiver ligada;
  4. reserva a vaga (erro de banco = recusa);
  5. envia;
  6. grava `outbound_log`.
  Devolve um resultado tipado (`sent`, `blocked_budget`, `blocked_manual_lock`, `blocked_window`, `blocked_template`, `error`). Nunca lança erro para quem chama.
- Teste de **arquitetura**: falha se `graph.facebook.com` ou a rota `/messages` aparecer em qualquer arquivo de `src/` além do cliente, ou se algum arquivo usar `fetch` para a Graph API fora dele.
- Processar `statuses`: gravar `pricing` no `outbound_log`; se `billable === true`, `type === "regular"` ou `category !== "service"`, ligar a trava manual na hora, com log `critical`.
- Logs: `warn` ao cruzar 80% de `stop_at` (uma vez por mês); `critical` ao abrir o disjuntor.
- Endpoints admin (com `Authorization: Bearer ADMIN_TOKEN`):
  - `GET /admin/budget` → mês atual, `reserved_count`, `stop_at`, `tripped`, trava manual.
  - `POST /admin/budget/unlock?confirm=EU_ENTENDO_O_RISCO` → desliga só a trava manual e registra quem/quando.
- Testes da função SQL com **PGlite** (ou equivalente sem Docker; registrar a escolha).

**Critérios de aceite**
- **C2.1** Teste de arquitetura passa e falharia se outro arquivo chamasse a Graph API (o verificador vai tentar).
- **C2.2** Com `stop_at = 950`: a 950ª reserva passa, a 951ª falha; depois disso o mock da Graph API recebe **zero** chamadas de envio.
- **C2.3** Concorrência: com o contador em 940, 100 reservas simultâneas aprovam **exatamente 10**.
- **C2.4** Virada de mês no fuso: 31/out 23:59 e 01/nov 00:00 (horário de São Paulo) caem em meses diferentes; o mês novo libera envios; se a trava manual estiver ligada, ela **continua** ligada.
- **C2.5** Status com `billable: true` (e, em outro teste, `type: "regular"` e `category: "utility"`) liga a trava manual; envios seguintes bloqueados; só o endpoint admin destrava.
- **C2.6** Mensagem `template` é sempre recusada, sem reservar vaga.
- **C2.7** Usuário cuja última mensagem foi há 23h31 → não envia e não reserva vaga.
- **C2.8** Banco indisponível ou erro na reserva → não envia (fail closed).
- **C2.9** Envio que falha na Graph API **não** devolve a vaga.
- **C2.10** Com o disjuntor aberto, `POST /webhook` continua respondendo 200.
- **C2.11** Endpoints admin: sem token ou token errado → 401; unlock sem `confirm` correto → 400.
- **C2.12** Log `warn` em 80% emitido uma vez; log `critical` ao abrir o disjuntor.

---

## Etapa 3 — Motor de conversa com anti-spam (R2)

**Objetivo:** o bot só fala quando faz sentido. Repetição, mensagens fora do roteiro e rajadas não gastam mensagens.

**Tarefas**
- Máquina de estados declarativa em `src/conversation/` com os estados da referência no topo deste plano. Cada estado declara: entradas aceitas (IDs de botão/lista + textos com variações), tipos de mensagem aceitos e transições.
- Função **pura** `decide(userState, input, counters, now) → { replies, nextState }` sem I/O. No máximo **1** resposta por entrada.
- Normalizador de texto: minúsculas, remove acentos, pontuação e emoji (antes disso, mapeia emojis com significado, como 👍 = sim), colapsa letras repetidas ("oiiii" → "oi", "simmm" → "sim") e espaços.
- Dicionário de sinônimos editável em um só arquivo:
  - saudação: oi, ola, olá, opa, e ai, eae, bom dia, boa tarde, boa noite, hey, hello, inicio, começar;
  - sim: sim, s, ok, aceito, concordo, claro, pode, 👍;
  - menu: menu, voltar, inicio, opcoes;
  - sair: sair, parar, cancelar, stop.
- Regra da dica única: entrada inesperada → 1 dica (reapresenta as opções do estado) e marca `hint_sent_in_state`; próximas entradas inesperadas → silêncio. A marca zera ao mudar de estado.
- Limites por usuário com base no `outbound_log`: `MAX_BOT_MSGS_PER_USER_PER_DAY` e `MAX_BOT_MSGS_PER_USER_PER_10MIN`. Acima → silêncio (sem avisar).
- Opt-out: "sair" → 1 confirmação e estado `OPTED_OUT`; nesse estado só "voltar" é aceito (com as mesmas regras de anti-spam).
- Integração: webhook → `decide` → `sendGuarded`. Estado do usuário persistido (tabela `users` com `state`, `hint_sent_in_state`, `last_user_message_at`, `opted_out_at`).

**Critérios de aceite**
- **C3.1** Usuário novo manda "oi" 20 vezes seguidas → **exatamente 1** envio.
- **C3.2** "oi" seguido de 10 textos aleatórios → **2** envios (boas-vindas + 1 dica).
- **C3.3** Tabela de testes com **pelo menos 40 casos** de variação: "Oi", "oiii", "OLÁ!!", "ola", "Bom dia", "e aí" reconhecidos como saudação; "Sim", "sim!!", "s", "ok", "👍" como sim; textos sem relação não reconhecidos.
- **C3.4** Depois de uma entrada válida, o novo estado volta a permitir 1 dica.
- **C3.5** Limites diário e de 10 minutos respeitados mesmo com entradas válidas seguidas.
- **C3.6** Figurinha, reação, imagem, vídeo, localização e contato num estado que não os espera → 0 envios (nem dica).
- **C3.7** `decide` é pura: o arquivo não importa nada de rede, banco ou relógio global (o verificador confere os imports).
- **C3.8** Opt-out funciona e, depois dele, nada além de "voltar" gera resposta.
- **C3.9** Nenhum texto do bot é do tipo "aguarde"/"processando"/"recebi seu áudio" sozinho (teste varre os textos).

---

## Etapa 4 — Cadastro com consentimento LGPD (R6)

**Objetivo:** cadastrar a pessoa gastando o mínimo de mensagens e sem guardar nada antes do aceite.

**Tarefas**
- Cadastro coleta **nome completo** (2–100 caracteres) e aceite obrigatório (OptIn); perguntas de esporte, time, hobby, comida, cidade/estado natal, carreira e curso são respondidas em áudio.
- `flows/cadastro.json`: WhatsApp Flow **sem endpoint** (só navegação), com nome completo e componente de aceite obrigatório, com link de privacidade.
- Com `WHATSAPP_FLOW_ID` configurado: a mensagem de boas-vindas **é** o Flow; após validar e salvar nome/consentimento, pede o áudio. O áudio termina o cadastro com "Cadastro concluído.", sem abrir o menu.
- Sem `WHATSAPP_FLOW_ID` (fallback): boas-vindas com botão "Aceito" + link do termo e pergunta do nome; depois pede o áudio e confirma o cadastro, sem abrir o menu.
- O menu de serviços só aparece se a pessoa pedir explicitamente "menu" depois do cadastro.
- Tabela `users`: `wa_id_hash`, `wa_id` (cifrado ou, no mínimo, acesso restrito), dados do cadastro, `consent_at`, `terms_version`, `registered_at`. RLS ligado; só a service key do Worker acessa.
- Instruções para publicar o Flow em `docs/PENDENCIAS_HUMANAS.md`.

**Critérios de aceite**
- **C4.1** Com Flow: nome e aceite → pedido de áudio → áudio → confirmação textual, sem menu.
- **C4.2** Fallback: consentimento e nome → pedido de áudio → áudio → confirmação textual, sem menu.
- **C4.3** Dado inválido (no Flow ou no fallback) → nada inválido é salvo; dica única.
- **C4.4** Sem aceite → nada além do identificador técnico é salvo; com aceite → `consent_at` e `terms_version` gravados.
- **C4.5** Migrações aplicam limpo em PGlite; RLS habilitado nas tabelas com dados pessoais.
- **C4.6** `flows/cadastro.json` é JSON válido, tem todos os campos de `fields.ts` e o aceite obrigatório.
- **C4.7** Usuário já cadastrado que manda "oi" recebe a confirmação sem refazer cadastro; "menu" explícito abre os serviços.

---

## Etapa 5 — Menu de serviços e respostas prontas

**Objetivo:** a seleção estilo "recarga de celular" e os textos do bot vindos do banco.

**Tarefas**
- Tabelas `services (id, title, description, requires_audio, active, sort_order)` e `canned_responses (key, text, updated_at)`, com seeds de exemplo (3 serviços, pelo menos 1 com áudio e 1 sem).
- Menu = **mensagem de lista** com até 10 serviços ativos, em ordem.
- Serviço sem áudio → envia a resposta pronta dele (1 mensagem, com botão "Menu") e volta a `MENU`.
- Serviço com áudio → 1 mensagem de instrução (curta, diz para mandar o áudio) e vai para `AWAIT_AUDIO`.
- Todos os textos do bot vêm de `canned_responses`, com fallback no código se a chave faltar; cache em memória com TTL para não consultar o banco a cada mensagem.
- Construtores de mensagem (`buildList`, `buildButtons`, `buildText`) validam os limites da Meta (ver `CLAUDE.md`) e recusam textos acima deles.

**Critérios de aceite**
- **C5.1** Com mais de 10 serviços ativos, o menu mostra os 10 primeiros por `sort_order` e registra `warn`.
- **C5.2** Construtores recusam título de linha > 24, descrição > 72, título de botão > 20, corpo > 1024 e mais de 3 botões.
- **C5.3** Escolha válida na lista → 1 mensagem; escolha repetida ou inválida → regras do anti-spam.
- **C5.4** Pessoa cadastrada voltando no dia seguinte com "oi" → menu em 1 mensagem.
- **C5.5** Chave ausente em `canned_responses` usa o fallback sem quebrar.

---

## Etapa 6 — Pipeline de áudio

**Objetivo:** receber o áudio, guardar, mandar para o analisador e devolver o resultado com **1** mensagem por áudio.

**Tarefas**
- Em `AWAIT_AUDIO`, ao chegar áudio: obter a URL da mídia (`GET /{media_id}` pelo cliente da Graph API) e **baixar imediatamente** (a URL expira em 5 min), com o token.
- Validar tipo (áudio) e tamanho (`MAX_AUDIO_BYTES`, padrão 16 MB). Inválido → dica única, sem chamar o analisador.
- Salvar no R2 com chave sem telefone em claro: `audios/<wa_id_hash>/<YYYY-MM>/<uuid>.<ext>`. Registrar na tabela `audios (id, wa_id_hash, r2_key, mime, bytes, service_id, status, result, created_at, finished_at)`.
- Interface `AudioAnalyzer` em `src/audio/analyzer.ts`, com implementação HTTP genérica (`ANALYZER_API_URL`, `ANALYZER_API_KEY`) e mock para testes. Timeout configurável e até 2 novas tentativas com espera crescente. Se existir `docs/ANALISADOR.md`, siga o formato de envio e resposta descrito nele; se não existir, deixe o adaptador isolado e registre em PENDENCIAS.
- Processamento fora do caminho da resposta do webhook (`ctx.waitUntil` ou Cloudflare Queues; decidir e registrar).
- Enquanto `PROCESSING_AUDIO`: áudios ou textos novos → silêncio.
- Resultado: **1 mensagem** (texto do resultado + botão "Menu") e volta a `AWAIT_AUDIO` (o próximo áudio já é analisado sem nova instrução). Se a janela de 24h tiver fechado, **não envia** (fica salvo).
- Falha definitiva do analisador → 1 mensagem curta pedindo para reenviar (conta no orçamento e nos limites do usuário); falhas seguidas no mesmo estado seguem a regra da dica única.

**Critérios de aceite**
- **C6.1** O download acontece no mesmo processamento do evento; teste com relógio falso mostra que um atraso de mais de 5 minutos seria detectado (URL expirada → tenta obter nova URL uma vez; se falhar, dica única).
- **C6.2** Arquivo salvo no R2 (mock) com chave sem o telefone.
- **C6.3** Fluxo feliz: 1 áudio → 1 mensagem; 3 áudios seguidos (um de cada vez) → 3 mensagens.
- **C6.4** Analisador lento ou com erro: respeita timeout e novas tentativas; a pessoa recebe no máximo 1 mensagem de erro.
- **C6.5** Resultado depois de 24h da última mensagem da pessoa → não envia, salva o resultado.
- **C6.6** Tipo ou tamanho inválido → não chama o analisador; dica única.
- **C6.7** Áudio durante `PROCESSING_AUDIO` → 0 envios.
- **C6.8** Áudio fora de `AWAIT_AUDIO` → regra da dica única do estado atual; nenhum áudio é salvo sem consentimento (R6).

---

## Etapa 7 — Operação e preparação para deploy

**Objetivo:** deixar o bot pronto para o humano publicar, sem surpresas no plano gratuito.

**Tarefas**
- Handler `scheduled` (cron diário):
  - consulta leve ao Supabase (evita a pausa do plano gratuito após 7 dias sem atividade);
  - apaga `processed_messages` com mais de 7 dias;
  - registra em log o uso do mês (`reserved_count` / `stop_at`).
- `docs/DEPLOY.md`: passo a passo para criar contas (Meta for Developers, Cloudflare, Supabase), aplicar migrações, criar bucket R2, configurar secrets com `wrangler secret put`, registrar a URL do webhook na Meta, publicar o Flow, testar primeiro com o **número de teste da Meta** (até 5 destinatários) e só depois registrar o chip.
- Checklist de produção no `DEPLOY.md`: verificação da empresa, política de privacidade publicada, **não cadastrar forma de pagamento no Billing Hub** (sem forma de pagamento, a Meta não entrega mensagens além da franquia: segunda proteção, além do disjuntor), monitorar `GET /admin/budget`.
- Garantir que o build do Worker funciona (ex.: `wrangler deploy --dry-run` ou equivalente offline).

**Critérios de aceite**
- **C7.1** Handler `scheduled` testado: faz a consulta, limpa registros antigos e loga o uso.
- **C7.2** Build/dry-run do Worker passa sem credenciais reais.
- **C7.3** `DEPLOY.md` cobre todas as variáveis de `.dev.vars.example` e todos os passos de `PENDENCIAS_HUMANAS.md`.
- **C7.4** Nenhum segredo no repositório; nenhuma chamada real de rede nos testes.

---

## Etapa 8 — Simulação ponta a ponta e auditoria final

**Objetivo:** provar, com o sistema inteiro rodando contra mocks, que as regras de orçamento e anti-spam seguram em cenários realistas.

**Tarefas**
- Simulador em `scripts/simulate.ts` (e testes que o usam): Graph API falsa que conta envios, banco em memória ou PGlite, R2 e analisador falsos, relógio controlável.
- Cenários obrigatórios:
  - **S1 — Estouro de orçamento:** 300 pessoas novas fazendo cadastro + 1 áudio no mesmo mês. Total de envios ≤ `stop_at`; depois do corte, zero envios; webhook sempre 200.
  - **S2 — Spam:** 50 pessoas mandando "oi" 30 vezes cada → 50 envios no total.
  - **S3 — Economia:** pessoa nova, cadastro com Flow + 1 áudio = **4** envios; áudio extra na mesma sessão = **1**; pessoa já cadastrada voltando = **3**.
  - **S4 — Reentrega:** todos os webhooks entregues em dobro → nenhuma resposta duplicada.
  - **S5 — Sinal de cobrança:** um status com `billable: true` no meio da simulação → nenhum envio depois dele até o unlock manual.
  - **S6 — Virada do mês:** contador zera no dia 1 à meia-noite no fuso configurado.
  - **S7 — Rajada:** 1 pessoa manda 100 mensagens válidas e inválidas em 1 minuto → envios dentro dos limites por usuário.
- `docs/RELATORIO_FINAL.md`: mensagens por pessoa medidas na simulação, pessoas por mês estimadas (`stop_at` ÷ mensagens por pessoa), e uma tabela "regra → teste que comprova".

**Critérios de aceite**
- **C8.1** Os 7 cenários passam em `npm run verify`.
- **C8.2** `RELATORIO_FINAL.md` existe e os números batem com a simulação.
- **C8.3** Auditoria global do verificador: R1–R6 respeitadas em **todo** o código.
