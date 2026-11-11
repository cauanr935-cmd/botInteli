# Decisões

Decisões tomadas pelos agentes sem consultar o humano. Formato: data · etapa · decisão · motivo.

| Data | Etapa | Decisão | Motivo |
| --- | --- | --- | --- |
| (inicial) | — | Corte de orçamento padrão em 950 mensagens/mês (margem de 50 sobre as 1.000 grátis) | Folga para mensagens em trânsito e diferenças de contagem entre nós e a Meta |
| (inicial) | — | Templates proibidos | Templates nunca entram na franquia gratuita |
| (inicial) | — | Campos do cadastro provisórios: nome, e-mail, cidade (substituídos em 2026-11-09) | Histórico; ver a decisão atual sobre cadastro por áudio |
| 2026-11-07 | 0 | Cron diário `0 6 * * *` (UTC, 03h em Brasília) | Horário de baixo tráfego; a virada do mês da Meta é tratada por data no fuso da conta, não pelo cron |
| 2026-11-07 | 0 | `GRAPH_API_VERSION` padrão `v21.0` no wrangler.toml e no exemplo | Versão estável conhecida; o humano pode atualizar via env sem mexer no código |
| 2026-11-07 | 0 | Config obrigatória: todas as variáveis do plano exceto `WHATSAPP_FLOW_ID`, `META_ACCOUNT_TIMEZONE`, margem e limites (têm padrão) | Falhar cedo com mensagem clara; `loadConfig` lista todos os problemas de uma vez |
| 2026-11-07 | 0 | Sem Hono/framework: roteador manual em `src/index.ts` | Poucas rotas; menos dependências |
| 2026-11-07 | 0 | Dependências: typescript, vitest, eslint + typescript-eslint, wrangler, @cloudflare/workers-types, @electric-sql/pglite (só devDependencies) | Stack do CLAUDE.md; versões atuais instaladas pelo npm |
| 2026-11-07 | 0 | Margem de segurança máxima de 500 (STOP_AT >= 500); acima disso a config é recusada | Margem >= 1000 geraria STOP_AT <= 0 e disjuntor/SQL inválidos (relatório tentativa 1) |
| 2026-11-07 | 1 | Processamento do webhook via `ctx.waitUntil` (sem fila) | Resposta 200 rápida sem custo extra; como respondemos sempre 200, não há retentativa da Meta, então fila não traria ganho agora |
| 2026-11-07 | 1 | Idempotência: chave = wamid para mensagens e `status:<id>:<status>` para status webhooks; inserção atômica (`on_conflict ignore-duplicates` no Supabase; check-and-set na memória) antes de processar | Meta reenvia webhooks; status de uma mesma mensagem (sent/delivered/read) são eventos distintos |
| 2026-11-07 | 1 | `users(wa_id, last_user_message_at)` + função SQL `touch_user` com `greatest()`; horário = timestamp da mensagem limitado ao momento do recebimento | Nunca regride com entregas fora de ordem; timestamp futuro não estende a janela de 24h (conservador) |
| 2026-11-07 | 1 | Erro no processamento de um evento não impede os demais (try/catch por evento); sem retentativa | Webhook sempre devolve 200 (R1); logs só com tipo e telefone mascarado |
| 2026-11-07 | 1 | Config inválida em `/webhook` devolve 500 e loga erro; `/health` independe de config | Sem APP_SECRET não dá para validar assinatura; falha explícita é preferível a aceitar sem validar |
| 2026-11-07 | 1 | Hook `onEvent` em `WebhookDeps` para o motor de conversa (Etapa 3) e status/orçamento (Etapa 2) | Interface pronta sem adiantar etapas |
| 2026-11-07 | 2 | SQL testado com PGlite (`tests/budget-sql.test.ts` carrega `0002_budget.sql`); concorrência real do Postgres é garantida pelo UPDATE único, PGlite serializa as chamadas | Sem Docker; a atomicidade vem da instrução, não do teste |
| 2026-11-07 | 2 | `reserve_outbound_slot` (boolean, conforme o plano) é um wrapper de `reserve_outbound_slot_detail`, que também devolve contador/tripped; o app usa a `_detail` | Evita uma segunda ida ao banco só para decidir os logs de 80% e de disjuntor aberto |
| 2026-11-07 | 2 | O SQL limita o corte a 990 (`least(p_stop_at, 990)`) e o `stop_at` guardado nunca sobe | Defesa em profundidade: mesmo com bug de config, o banco não passa de 990 |
| 2026-11-07 | 2 | Alertas "uma vez por mês" via `claim_budget_alert` (colunas `warn_logged_at`/`trip_logged_at` em `message_budget`, além das do plano) | Atômico e sem estado em memória do Worker (que é efêmero) |
| 2026-11-07 | 2 | Status com `pricing` presente liga a trava se `billable === true`, `type === "regular"` ou `category !== "service"` (categoria ausente também liga) | Fail closed; a Meta sempre envia category quando envia pricing |
| 2026-11-07 | 2 | Trava manual é por `phone_number_id` e independe do mês; unlock só desliga a trava (não zera o contador do mês). `unlocked_by` vem do header opcional `X-Admin-User` (padrão `admin`) | Token único não identifica pessoa; unlock não pode reabrir orçamento esgotado |
| 2026-11-07 | 2 | `wa_id_hash` = SHA-256 do telefone; `outbound_log` é gravado após o envio (falha ao gravar só gera log de erro) | R3: sem telefone em claro; o resultado do envio não depende do log |
| 2026-11-07 | 2 | Janela de 23h30 lê `users.last_user_message_at` dentro do `sendGuarded`; sem registro = recusa | Quem chama não pode errar o horário |
| 2026-11-07 | 2 | Se o tratamento de um evento `status` falhar, `processEvents` faz `unclaimMessage` da chave de idempotência (só para status, não para mensagens) | Ligar a trava é idempotente; sem isso, o reenvio da Meta seria descartado e o sinal billable perdido. Mensagens não são liberadas para não gerar resposta dupla |
| 2026-11-07 | 3 | Máquina de estados em tabela (`STATES` em `machine.ts`); `decide(user, input, counters, now)` devolve `{replies, nextState, outcome}`; `nextState` é um objeto (estado, estado anterior, dica enviada, `optedOutAt`) | Pura e testável; Etapas 4 a 6 só acrescentam transições à tabela |
| 2026-11-07 | 3 | Só texto não reconhecido gera dica; botão/lista/áudio/formulário/mídia fora do estado esperado = silêncio total | R2: economiza mensagens; C3.6 |
| 2026-11-07 | 3 | Saudação em `AWAIT_REGISTRATION` é ignorada em silêncio (não gasta a dica); em MENU/AWAIT_AUDIO "oi" cai na regra da dica única, que já reapresenta o menu | C3.1 exige 1 envio para 20 "oi"; pessoa já cadastrada que volta ainda recebe o menu uma vez |
| 2026-11-07 | 3 | Letras repetidas colapsam sempre para uma ("hello" vira "helo"); o dicionário passa pela mesma função | Reconhece "oiii"/"simmm" com regra simples e consistente |
| 2026-11-07 | 3 | Intenção `resume` (voltar, retomar, reativar) separada de `menu`, válida só em OPTED_OUT; `no` acrescentada (para a recusa de consentimento da Etapa 4) | "voltar" é sinônimo de menu no plano, mas em OPTED_OUT precisa ser o único aceito |
| 2026-11-07 | 3 | Limite estourado: silêncio e o estado NÃO avança (exceto opt-out, sempre honrado com confirmação muda); contagem vem de `outbound_log` (24h móveis e 10 min) | A pessoa pode repetir a entrada válida depois; pedido de parar nunca pode ser ignorado |
| 2026-11-07 | 3 | Estado persistido em colunas de `users` (migração 0003) com `version` e compare-and-set (`saveConversation`); rajadas simultâneas reavaliam até 4 vezes e, se persistir disputa, ficam em silêncio | Duas mensagens simultâneas não geram duas respostas; fail silent |
| 2026-11-07 | 3 | Estado é gravado antes do envio; se `sendGuarded` recusar, o estado já avançou | Conservador: nunca reenvia por tentativa repetida |
| 2026-11-07 | 3 | Textos provisórios (boas-vindas sem formulário, menu sem serviços); `AWAIT_REGISTRATION` aceita qualquer `nfm_reply` e `AWAIT_AUDIO` leva a `PROCESSING_AUDIO` sem resposta | Validação do formulário, menu real e pipeline de áudio são das Etapas 4, 5 e 6 |
| 2026-11-07 | 3 | `hashWaId` movido para `src/lib/hash.ts` (usado pelo cliente e pelo motor) | Evitar duplicar o hash; o cliente continua sendo o único arquivo com a URL da Graph |
| 2026-11-07 | 4 | Campos do cadastro provisórios (nome completo, e-mail, cidade) em `src/registration/fields.ts`; trocar exige editar também `flows/cadastro.json` e uma migração (o teste C4.6 confere fields.ts x Flow) | Equipe ainda não definiu os campos definitivos |
| 2026-11-09 | 4 | Cadastro coleta nome completo e aceite no Flow/fallback, depois solicita áudio de apresentação com perguntas pessoais; confirma "Cadastro concluído." sem abrir a lista de serviços. O menu fica disponível mediante pedido explícito "menu". | Solicitação da equipe; manter o consentimento LGPD e preservar acesso posterior aos serviços |
| 2026-11-07 | 4 | Flow JSON versão `6.2`, uma tela terminal `CADASTRO`, sem endpoint (`complete` com payload). OptIn aponta para URL de exemplo que o humano troca pelo `PRIVACY_POLICY_URL` ao publicar | Flow JSON é estático (não lê env); versão a confirmar no editor da Meta (PENDENCIAS_HUMANAS) |
| 2026-11-07 | 4 | Lógica do cadastro em `src/registration/decide.ts` (pura), chamada pelo motor antes de `decide`; devolve null para o que não é cadastro. Sem `deps.registration` o motor mantém o comportamento provisório da Etapa 3 | `machine.ts` continua pura e os testes das Etapas 3 não mudam |
| 2026-11-07 | 4 | Fallback sem Flow: a mensagem de boas-vindas traz termo + botão "Aceito" + a pergunta do 1º campo; tocar "Aceito" (ou "sim") grava o consentimento e muda de estado SEM resposta | Atende C4.2 (1 + nº de campos mensagens) e economiza 1 mensagem; consentimento continua explícito (botão/"sim") antes de qualquer dado |
| 2026-11-07 | 4 | Dados parciais do fallback são gravados campo a campo depois do aceite; `registered_at` só no último. Nada é gravado antes do aceite | Worker não guarda memória entre mensagens; consentimento já existe |
| 2026-11-07 | 4 | Banco: CHECK `users_consent_before_data` (dados de cadastro exigem `consent_at` e `terms_version`); RLS ligado sem policies; `anon`/`authenticated` sem acesso; `wa_id` continua em texto (protegido por RLS) | R6 também no banco; cifrar `wa_id` é desproporcional porque ele é a chave de busca do webhook |
| 2026-11-07 | 4 | Valores que são palavras de comando ("oi", "sim", "menu") são recusados como nome/cidade | Evita gravar uma saudação repetida como dado |
| 2026-11-07 | 4 | Menu pós-cadastro é uma lista com serviço provisório (`PROVISIONAL_SERVICES`); a Etapa 5 troca pela lista do banco | Etapa 5 não foi iniciada |
| 2026-11-07 | 4 | Efeito de gravação roda antes do compare-and-set do estado; se falhar, lança e a mensagem não é respondida | Gravações são idempotentes; evita estado "MENU" sem cadastro salvo |
| 2026-11-07 | 4 | Teste antigo "C3.4 fluxo completo" passou a usar o motor sem `registration` (inalterado); o fluxo com validação é testado em `tests/registration.test.ts` | Mantém os testes da Etapa 3 sem enfraquecer |
| 2026-11-07 | 4 | `testTimeout`/`hookTimeout` do Vitest = 60 s | Com mais arquivos usando PGlite em paralelo, o WASM estourava os 5 s padrão (testes de Etapas 1 e 2 falhavam só por tempo) |

## 2026-11-07 — Etapa 5 (menu de serviços e respostas prontas)

- **Conteúdo injetado em `decide`**: `decide(user, input, counters, now, content)` continua pura; o motor carrega o conteúdo (`ContentProvider`, cache TTL 60 s por isolate, em `src/services/provider.ts`) e o passa por parâmetro. Respostas da máquina viraram funções `(content) => Reply`. Banco fora/vazio: usa o último conteúdo conhecido ou `DEFAULT_SERVICES` (mesmo conteúdo do seed), com `warn`. Motivo: nunca ficar sem menu e não consultar o banco a cada mensagem.
- **Chaves de `canned_responses`**: mesmas chaves de `TEXTS`/`REG_TEXTS` (ex.: `hintMenu`, `registered`, `welcomeBack`, `menu`, `menuButton`) e `service_<id>` para a resposta de cada serviço sem áudio (fallback: "título: descrição"). Texto vazio, acima do limite (1024; 20 para títulos de botão) ou chave inexistente → fallback do código.
- **Corte em 10**: `prepareServices` ordena por `sort_order`, descarta linhas que violam limites da Meta (com `warn service_invalid_skipped`) e corta em 10 com `warn menu_truncated`. O banco também tem CHECKs (título ≤ 24, descrição ≤ 72, texto ≤ 1024).
- **Construtores** (`src/whatsapp/builders.ts`: `buildText`, `buildButtons`, `buildList`) lançam `MessageLimitError`. Texto simples também limitado a 1024 (conservador, como pede o plano). Só montam o corpo; envio segue exclusivo de `sendGuarded`.
- **"oi" de quem volta (C5.4)**: em `MENU`/`AWAIT_AUDIO`, saudação com última mensagem do bot há mais de 6 h (ou nenhuma nas últimas 24 h) reabre o menu em 1 mensagem (`SESSION_IDLE_MS`, em `machine.ts`). Antes disso, "oi" segue as regras normais (dica única/silêncio). `Counters.lastBotMsgAt` é opcional; ausente = nunca sessão antiga (testes antigos intactos).
- **Texto "menu" e botão Menu** em `MENU` mostram a lista de novo (1 mensagem). Linha de lista desconhecida/inativa → silêncio.
- **Escolha repetida de serviço sem áudio (revisto na tentativa 2)**: `users.last_service_id` (migração 0006) guarda o último serviço sem áudio respondido; a mesma linha de novo = silêncio (R2). Zera ao mudar de estado ou reabrir o menu (texto "menu", botão Menu, "oi" de sessão antiga). Outro serviço responde normalmente. `UserState.lastServiceId` é opcional.
- **Teste da Etapa 3 ajustado (C3.7)**: a lista de imports permitidos dos arquivos puros de `src/conversation` passou a aceitar `../services/content`, `../services/menu` e `../whatsapp/builders` (também puros, sem I/O/relógio). O resto do teste (sem fetch/Date.now/etc.) não mudou.
- Removido `PROVISIONAL_SERVICES` (Etapa 4) e `menuSection`/`menuButton` de `REG_TEXTS` (agora em `MENU_FALLBACKS`).

- **C3.7 ampliado (tentativa 2)**: a varredura de pureza (sem fetch/Date.now/process/console/crypto, imports restritos) agora cobre também `services/content.ts`, `services/menu.ts` e `whatsapp/builders.ts`; imports extras aceitos: `../lib/logger` (tipo), `../conversation/texts` (tipo).

## 2026-11-07 — Etapa 6 (pipeline de áudio)

- **Processamento fora da resposta do webhook**: usa o `ctx.waitUntil` que já envolve `processEvents` (o webhook responde 200 antes). O áudio é baixado e analisado dentro desse mesmo processamento (exigência C6.1: a URL da mídia vale 5 min). Cloudflare Queues foi descartado por ora: exige plano/binding extra e atrasaria o download. Limite conhecido: `waitUntil` tem cerca de 30 s; por isso o timeout padrão do analisador é 8 s (`ANALYZER_TIMEOUT_MS`, novo, mín. 100) e o pior caso é 3 tentativas + esperas de 500 ms e 1 s.
- **Mídia no cliente da Graph**: `GET /{media_id}` e o download ficam em `src/whatsapp/client.ts` (`createMediaClient`), único arquivo que conhece `graph.facebook.com` (teste C2.1 continua valendo). `media_id` só aceita `[A-Za-z0-9_-]` e a URL de download precisa ser `https`.
- **Renovação da URL**: se o relógio indica que passaram 4,5 min (5 min menos 30 s de folga) entre obter e baixar, ou o download volta 401/403/404/410, pede uma nova URL **uma única vez**; falhando de novo, vira falha com dica única.
- **Tipos aceitos**: `audio/ogg`, `opus`, `mpeg`, `mp4`, `aac`, `amr` (parâmetros como `; codecs=opus` são ignorados). Tipo vindo do webhook inválido é recusado antes de qualquer chamada de rede. Tamanho: `file_size` da Graph, `Content-Length` e bytes reais, todos contra `MAX_AUDIO_BYTES`.
- **Dica única para falhas**: tipo/tamanho inválido e falha do analisador/download usam a mesma regra e o mesmo flag `hint_sent_in_state` da dica genérica de `AWAIT_AUDIO` (no máximo 1 mensagem de aviso por estado). A transição para `PROCESSING_AUDIO` zera o flag, então o motor passa o valor anterior (`hintAlreadySent`) ao pipeline, que o restaura ao voltar para `AWAIT_AUDIO`. Sucesso zera o flag.
- **Limites**: o áudio com a pessoa já no limite (10 min/dia) nem é processado (estado não avança, como na Etapa 3), pois o resultado não poderia ser entregue. O limite é conferido de novo antes de enviar o resultado/erro; sem vaga, silêncio e o resultado fica salvo.
- **Pessoa saiu durante o processamento** (`sair`): estado `OPTED_OUT` é preservado, resultado salvo, nada enviado.
- **Tabela `audios`** (migração 0007): colunas do plano; `status` em `processing|done|failed`; sem coluna "entregue". Gatilho `audios_require_consent` recusa linha sem `consent_at` do dono (R6 no banco); `MemoryRepo` tem a mesma regra. O pipeline também checa o consentimento antes de baixar.
- **`service_id`**: o estado não guarda qual serviço de áudio foi escolhido; grava-se o primeiro serviço ativo com `requires_audio` (ou null). Revisar se houver mais de um serviço com áudio.
- **Adaptador HTTP genérico** (não existe `docs/ANALISADOR.md`): `POST ANALYZER_API_URL` com corpo = bytes do áudio, `Content-Type` = mime, `Authorization: Bearer ANALYZER_API_KEY`. Texto do resultado vem de `text|result|summary|message|analysis` (string) ou o JSON compacto; cortado em 1024 caracteres. Retenta (até 2 vezes, 500 ms e 1 s) em rede, timeout, 5xx, 429 e 408; 4xx não repete.
- **Sem R2 (`AUDIOS`) configurado**: `index.ts` registra erro `r2_binding_missing` e o motor mantém o comportamento da Etapa 3 (áudio só muda o estado). Deploy deve garantir o binding (já está no `wrangler.toml`).
- **Machine**: a transição de áudio em `AWAIT_AUDIO` passou a respeitar os limites por pessoa (resultado `limited`).

## 2026-11-07 — Etapa 7 (operação e deploy)

- **Cron diário** (`src/ops/scheduled.ts`): quatro tarefas independentes (uma falhar não impede as outras): `ping` (SELECT de 1 linha em `users`, evita a pausa do plano gratuito), apagar `processed_messages` com mais de 7 dias, destravar conversas presas e logar `cron_budget_usage` (mês, `reserved_count`, `stop_at`, `tripped`). O cron **nunca envia mensagem** (R1) e não faz reserva.
- **Conversa presa em `PROCESSING_AUDIO`** (observação do verificador da Etapa 6): se o Worker morrer no meio do pipeline, o cron devolve a pessoa a `AWAIT_AUDIO` (flag de dica zerado, `version+1`) quando o estado não muda há mais de 10 minutos (`STUCK_PROCESSING_MS`). Silencioso: sem aviso à pessoa (custaria mensagem); ela simplesmente pode mandar outro áudio. Como o cron é diário, a espera real é de até ~24 h; aceitável porque o caso é raro e a pessoa fica em silêncio, não gasta mensagens. Para isso a migração `0008_housekeeping.sql` adiciona `users.state_changed_at` (gatilho atualiza quando `state` muda) e a função `release_stuck_processing(p_before)`. `MemoryRepo` tem relógio injetável (`clock`) para o mesmo comportamento.
- **Novos métodos do `Repo`**: `ping`, `deleteProcessedBefore`, `releaseStuckProcessing`.
- **Build offline**: `npm run build` = `wrangler deploy --dry-run --outdir dist` (não precisa de credenciais). O teste C7.2 roda o mesmo comando com `CLOUDFLARE_API_TOKEN` removido do ambiente.
- **Cron em UTC** (`0 6 * * *`): sem impacto no orçamento; a virada do mês continua no fuso da conta Meta.

## 2026-11-07 — Etapa 8 (simulação e auditoria)

- **Fiação extraída para `src/webhook/events.ts` (`createEventHandler`)**: o `onEvent` que estava inline em `src/index.ts` virou função com portas injetáveis (fetch, relógio, mídia, R2, analisador). Comportamento de produção igual; o simulador usa exatamente a mesma fiação em vez de uma cópia. Único efeito colateral: o log `r2_binding_missing` sai uma vez por requisição de webhook (antes, por evento).
- **Simulador em `scripts/simulate.ts`**, incluído no `tsconfig`. Roda pelos testes (`npm run simulate` = `vitest run tests/simulation.test.ts`); não há `tsx` no projeto e evitamos nova dependência.
- **S6 pré-carrega novembro** com 950 reservas via `reserveSlot` (e não com tráfego), para isolar a virada do mês; S1 cobre o corte com tráfego real.
- **S3 "voltando"**: nova sessão = "oi" 8 h depois (acima de `SESSION_IDLE_MS` de 6 h). O "áudio extra" é enviado 11 min depois, para sair da janela de 10 min por pessoa.

## 2026-11-10 — Modo admin no chat de teste (assumir o lugar do bot)

- **Escopo**: só o simulador web (`/chat`). Nada muda no webhook da Meta nem em `sendGuarded`; a mensagem do admin não passa pela Graph API. Se um dia o admin responder pelo WhatsApp real, a mensagem **tem** de passar por `sendGuarded` (R1).
- **Login**: ícone de usuário no canto superior direito abre um pop-up discreto. Credenciais de teste pedidas pelo humano: usuário `Be My Mentor`, senha `Be My Mentor 321`, com padrão no código e troca possível por `CHAT_ADMIN_USER` / `CHAT_ADMIN_PASS`. Exceção consciente a R3 ("sem segredo no código"): sistema de teste, a pedido explícito. Trocar antes de qualquer uso real. O token de sessão é um SHA-256 de `ADMIN_TOKEN` + credenciais (sem estado no servidor), guardado em `sessionStorage`.
- **Retenção (2 s)**: o admin usa o modo sobretudo para marcar mentorias e escrever o que o bot não escreveria, não para corrigi-lo; por isso a espera é de `ADMIN_HOLD_MS` = 2000 ms e, sem clique em "Responder eu", a resposta sai como programada. Com o admin online (sinal de vida na tela dos últimos 30 s), a resposta do bot é gravada como `pending` e só o admin a vê. "Enviar" libera; "Responder eu" (ou digitar no campo) descarta a retida e publica a mensagem do admin. Sem admin online, a retida é liberada sozinha na próxima leitura (a pessoa nunca fica sem resposta).
- **Limitação**: o estado da conversa já avançou como se o bot tivesse respondido; se o admin escrever outra coisa, o próximo passo do bot continua do ponto em que o motor estava.
- **Polling**: a tela consulta o histórico a cada 3 s (só se visível); a escrita de presença no R2 é limitada a 1 a cada 10 s.

## 2026-11-10 — Devolver a conversa ao bot depois do admin

- **Causa do silêncio**: quando o admin escrevia no lugar do bot, a resposta do bot era descartada, mas o estado dele já tinha avançado e a dica única do estado (R2) podia estar gasta. A conversa livre do admin não casa com o que o bot espera, então ele ficava mudo.
- **Devolução** (`handBackToBot`): ao clicar em **Sair**, ou quando o admin some (sem sinal há 30 s) e a pessoa escreve de novo, o servidor zera `hint_sent_in_state` e, para quem já concluiu o cadastro, volta o estado a `COMPLETED` (a próxima mensagem é entendida pelo bot e pela IA, como na volta de cadastrado). Quem está no meio do cadastro continua no mesmo passo. Não envia nada (R1). Marcador `chat-sim/admin-takeover.json` no R2 garante que isso só roda se o admin realmente escreveu.
- **Limite conhecido**: a IA (Grok) continua só classificando a mensagem atual; o contexto vem do estado e do cadastro no banco, não do texto das últimas mensagens.
- **Contexto para a IA (autorizado pelo humano em 2026-11-10)**: no chat de teste, o Grok recebe também as últimas 6 mensagens de texto (`conversa_recente`, até 200 caracteres cada, rotuladas "pessoa" / "atendimento"), incluindo as escritas pelo admin; ele continua só **escolhendo** entre opções fechadas. Sem nome nem telefone, e só nos estados em que a IA já era consultada (após o consentimento). **No webhook real da Meta o contexto não existe**, porque o texto das conversas não é guardado (R3/R6); para ter contexto lá seria preciso guardar mensagens, decisão separada.

## 2026-11-10 — Bot liga/desliga e certificado JSON da mentoria

- **Substitui a retenção de 2 s**: o modo admin é usado sobretudo para marcar mentorias com mentores e para métricas, e o bot **continua respondendo** com o admin logado. A retenção (`ADMIN_HOLD_MS`, "Responder eu", "Enviar") foi removida.
- **Desativar/ativar bot** (pop-up do ícone de usuário): desligado = a mensagem da pessoa só entra no histórico e o bot não processa nada (nem áudio), e o admin responde. Ligar de novo (ou **Sair**) chama `handBackToBot` (zera a dica; cadastrado volta a `COMPLETED`). Se o admin sumir por mais de 30 s com o bot desligado, ele religa sozinho quando a pessoa escrever. Marcador `chat-sim/bot-off.json` no R2.
- **Certificado** (`src/sim/certificate.ts`, `schema: bmm.mentoria.certificado/1`): `certificate_id`, mentor e mentorado (nome, e-mail e turma do cadastro de quem registrou; do outro lado só o nome digitado na conversa, `source: informado_na_conversa`), data/hora, dúvida, **assunto interpretado pelo Grok** (`summarizeSubject`, até 8 palavras; sem IA vale o assunto informado), dados do áudio e `integrity.sha256` do documento (recalculável). Sem telefone.
- **Data da mentoria**: o bot não pergunta quando a mentoria aconteceu; vale o momento do registro do áudio (`occurred_at_source: registro_do_audio`). Perguntar a data custaria mensagem (R2) e muda o fluxo: decisão pendente do humano.
- **Quem é quem**: o papel vem de `audios.mentoria_role` (de quem registrou). A dúvida usada é a mais recente de quem registrou, anterior ao áudio. Se quem registrou foi o mentor, a dúvida do mentorado não é encontrada (ele só é citado pelo nome digitado); nesse caso o assunto vem do que o mentor informou.
- **Guarda**: certificados com assunto da IA são gravados em `chat-sim/certificados/<id>.json` (não mudam depois). Painel: admin → "Mentorias (JSON)" (20 mais recentes).

## 2026-11-10 — Dias e horários escolhidos em listas (mentor e mentorado)

- **Fluxo** (`src/schedule/decide.ts`, decisão pura): lista de **dias** (segunda a domingo, um por toque) -> lista de **horários** do dia escolhido (um ou mais, das 8h às 20h) -> **Concluir** -> volta aos dias -> **Terminei**. Estados `SCHED_DAYS_<fluxo>` e `SCHED_HOURS_<fluxo>_<dia>` (o dia vem no nome do estado; as faixas escolhidas ficam em `users.availability_slots`, já existente, sem migração nova).
- **Quem passa por ele**: mentor (depois das áreas, antes de encerrar o cadastro), "os dois" (horários e depois a pergunta de dúvida) e mentorado (logo depois da dúvida: "Dúvida registrada! Agora, só para encerrar: em quais dias..."). Mentor que só muda as áreas e já tem horários **não** é perguntado de novo; quem informou horários há menos de 2 h (ex.: "os dois" que acabou de dar os horários) também não.
- **Linhas da lista**: 6 blocos de 2 h + "Manhã", "Tarde" e "Dia todo" + "Concluir <dia>" = 10 (o máximo da Meta). Horas já escolhidas somem; blocos vizinhos viram uma faixa só (8h-10h + 10h-12h = 8h-12h).
- **Custo em mensagens (R2)**: cada toque = 1 resposta (a próxima lista). Um mentor com 3 dias e 1 bloco por dia gasta ~10 mensagens. O limite por pessoa por dia vale (padrão 12 no código, 40 no `wrangler.toml`); com o padrão, um cadastro completo pode chegar nele. Atalhos para economizar: "Dia todo", "Manhã" e "Tarde".
- **Recomeço**: entrar no fluxo vindo de fora limpa as faixas antigas (`saveAvailability("", [])`), para horários velhos não se misturarem com os novos.
- **Serviço "Horários" do menu** continua com texto livre lido pela IA (`AVAILABILITY_TEXT`), gravando no mesmo formato. Trocar por listas é uma decisão pendente do humano.
- **Anexos durante o fluxo**: documento enviado enquanto escolhe dias/horários é ignorado em silêncio; o convite para anexar vem na mensagem final e vale a partir daí.

## 2026-11-10 — Curiosidades por texto ou áudio

- **Etapa "curiosidades"** (`REG_PROFILE_AUDIO`: data de nascimento, esporte, time, hobbies): além do áudio, agora aceita **texto**, para quem não quer falar. Texto válido = de 10 a 1000 caracteres, com letras e que não seja só um comando ("oi", "menu"). Texto inválido recebe **1 dica** e depois silêncio (R2); o áudio continua valendo como antes.
- **Onde fica**: o texto vai para `users.profile_about` (migração `0014_perfil_texto.sql`, que também atualiza o CHECK de consentimento: R6 no banco, nenhuma curiosidade sem consentimento; o `MemoryRepo` tem a mesma regra). Nada vai para log. O áudio segue indo para o R2 / tabela `audios`.
- **Sem custo extra**: a resposta ao texto é a mesma pergunta de papel que já vinha depois do áudio (1 mensagem). O texto não passa pela API externa de análise de áudio.
- **Aplicar a migração**: rodar `0014_perfil_texto.sql` no Supabase antes do deploy; sem ela, gravar o texto falha (a conversa fica em silêncio, sem erro para a pessoa).

## 2026-11-10 — Áudios gravados antes (qualquer formato comum)

- **Problema**: só eram aceitos ogg, opus, mp3, m4a, aac e amr com esses nomes exatos de tipo; arquivos gravados em outros apps (WAV, M4A como `audio/x-m4a`, WebM...) ou sem tipo informado eram recusados, e áudio anexado como "Documento" no WhatsApp era ignorado.
- **Agora** (`src/audio/storage.ts`): mais formatos (WAV, WebM, FLAC, 3GP, AIFF, WMA) e nomes alternativos de tipo (`audio/x-m4a`, `audio/mp3`, `audio/x-wav`...) viram um tipo canônico, que é o guardado e o enviado ao analisador. Sem tipo ou com `application/octet-stream`, vale a **extensão** do nome do arquivo. Tipos claramente não-áudio (PDF, imagem, vídeo) continuam recusados.
- **Documento que é áudio**: o parser do webhook (`parser.ts`) transforma um "Documento" com tipo ou extensão de áudio em evento de áudio (`voice: false`); PDF e afins seguem como documento (material da dúvida).
- **Chat de teste**: o botão de anexar áudio envia o nome do arquivo (`X-Filename`) e aceita as extensões acima; o botão de documento também trata áudio como áudio.
- **Sem análise obrigatória**: o arquivo é só guardado (R2 + tabela `audios`); a análise continua sendo do serviço externo via API, e o analisador síncrono é opcional.
- **Limite de tamanho**: continua `MAX_AUDIO_BYTES` (16 MB, o teto de mídia do WhatsApp). Gravações longas podem passar disso; aumentar o limite vale para o chat web, mas não para o WhatsApp real.
