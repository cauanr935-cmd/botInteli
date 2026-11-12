# Bot de WhatsApp — regras do projeto

Este arquivo vale para TODOS os agentes (orquestrador, implementador, verificador). Leia inteiro antes de qualquer trabalho.

## O que estamos construindo

Um bot na **WhatsApp Cloud API oficial da Meta** que:

1. Faz o cadastro da pessoa (com consentimento LGPD) e grava no banco de dados.
2. Mostra um menu de seleção de serviços (estilo "recarga de celular": a pessoa escolhe numa lista).
3. Responde com respostas prontas que vêm do banco.
4. Recebe áudios, guarda num armazenamento nosso e envia o áudio para uma **API externa de análise de áudio**. O bot não analisa nada, só encaminha e devolve o resultado.

## Stack (tudo no plano gratuito)

- **TypeScript** (strict) rodando em **Cloudflare Workers** (servidor do webhook + cron).
- **Cloudflare R2** para guardar os áudios.
- **Supabase (Postgres)** para cadastros, estado das conversas, contador de mensagens e logs.
- **Vitest** para testes. Para testar SQL sem Docker, prefira **PGlite** (Postgres em WASM).
- Versões de bibliotecas: use as atuais e estáveis; registre escolhas em `docs/DECISOES.md`.

## REGRAS INVIOLÁVEIS

Qualquer violação reprova a etapa, mesmo que todos os testes passem.

### R1 — Nunca sair do gratuito (disjuntor de orçamento)

Contexto: a Meta dá **1.000 mensagens de serviço grátis por número comercial por mês**. A franquia zera à meia-noite (fuso da conta Meta) do dia 1. A partir da 1.001ª, a Meta cobra. O app **nunca** pode chegar nesse ponto.

- `META_FREE_TIER_PER_MONTH = 1000` é uma **constante no código**, nunca variável de ambiente.
- `BUDGET_SAFETY_MARGIN` (env, padrão **50**, mínimo **10**) define o corte: `STOP_AT = 1000 - margem` (padrão **950**). Config que gere `STOP_AT > 990` ou margem < 10 faz o app recusar subir.
- **Toda** mensagem enviada passa por **uma única função** (`sendGuarded`), no **único arquivo** que conhece a URL `graph.facebook.com/.../messages`. Nenhum outro arquivo envia mensagem.
- Antes de cada envio: **reserva atômica** de uma vaga no contador do mês (função SQL com `UPDATE ... WHERE reserved_count < stop_at`). Sem vaga → **não envia**.
- A contagem é **conservadora**: conta na reserva e **não devolve** a vaga se o envio falhar.
- **Fail closed**: se o banco estiver fora ou a reserva der erro, **não envia**.
- Ao atingir `STOP_AT`, o **disjuntor abre**: nenhuma mensagem sai até virar o mês. Não existe mensagem de "despedida" (ela também custaria).
- Os **status webhooks** da Meta trazem `pricing` (`billable`, `type`, `category`). Se chegar `billable: true`, `type: "regular"` ou `category` diferente de `"service"`, o **disjuntor manual abre na hora**. Ele só fecha por ação humana (endpoint admin protegido), nunca sozinho.
- **Templates são proibidos**: nunca são grátis. `sendGuarded` recusa qualquer mensagem `type: "template"`.
- **Janela de 24h**: só envia se a última mensagem da pessoa foi há menos de **23h30** (margem de 30 min). Fora disso, não envia nada.
- Log `warn` ao passar de 80% do `STOP_AT`; log `critical` ao abrir o disjuntor.
- **"Quebrar a aplicação" = parar de enviar, não derrubar o endpoint.** O webhook continua respondendo **200** à Meta com o disjuntor aberto. Se ele devolvesse erro, a Meta reenviaria os eventos e poderia desativar o webhook.

### R2 — Anti-spam e economia de mensagens

- O bot só responde quando a mensagem da pessoa é uma **entrada esperada no estado atual da conversa**. Isso inclui variações: maiúsculas, acentos, letras repetidas ("oiii"), pontuação e sinônimos.
- Entrada inesperada: **no máximo 1 dica por estado**. Depois disso, **nunca silêncio de cara**: o Axo manda um aviso curto e descontraído ("aqui não é lugar de resenha…", tom de estudante universitário, mesmo registro da pessoa) usando as vagas que sobram dos limites por pessoa. A **última vaga é sempre a despedida** ("vou ficar na minha…"), então o silêncio que vem depois nunca surpreende. Só depois disso, silêncio até chegar uma entrada válida. O aviso sempre relê os envios recentes antes de sair (rajadas simultâneas não multiplicam avisos) e nunca ultrapassa os limites do R2 nem o orçamento do R1. Código: `offTopicNotice` em `src/axo/voice.ts` e `sendOffTopic` em `src/conversation/engine.ts`.
- Repetição não gera resposta. Exemplo: "oi" depois que as boas-vindas já foram enviadas → **silêncio**.
- Limites por pessoa: `MAX_BOT_MSGS_PER_USER_PER_DAY` (padrão **12**) e `MAX_BOT_MSGS_PER_USER_PER_10MIN` (padrão **4**). Acima disso, silêncio.
- O mesmo `wamid` (ID da mensagem) recebido duas vezes é ignorado (idempotência; a Meta reenvia webhooks).
- Tipos não esperados no estado (figurinha, reação, imagem, vídeo, localização, contato) → silêncio.
- **Uma entrada válida = no máximo uma resposta.** Junte textos numa mensagem só. Proibido "aguarde", "processando" ou "recebi seu áudio" como mensagem separada.
- Use mensagens interativas (botões e listas): cada uma conta como **1** mensagem.

### R3 — Segurança e privacidade

- Validar `X-Hub-Signature-256` (HMAC-SHA256 do corpo **bruto** com `APP_SECRET`, comparação em tempo constante). Assinatura inválida → 401, nada processado.
- Nenhum segredo no código ou no git. Variáveis em `.dev.vars.example` / `.env.example`.
- Telefones mascarados nos logs (ex.: `5511*****1234`). Nenhum conteúdo de mensagem ou dado de cadastro em log.
- Endpoints admin exigem `Authorization: Bearer ADMIN_TOKEN`.

### R4 — Testes nunca acessam a rede real

Graph API, analisador de áudio, Supabase e R2 são sempre mockados, em memória ou PGlite. Nenhum teste depende de credencial real.

### R5 — Só a API oficial

Proibido Baileys, whatsapp-web.js, venom-bot, wppconnect ou qualquer biblioteca não oficial. Elas violam os termos e levam a banimento.

### R6 — LGPD

Nenhum dado de cadastro e nenhum áudio é guardado antes do consentimento explícito. Guardar `consent_at` e `terms_version`. O termo cita `PRIVACY_POLICY_URL`. Os áudios são dado pessoal (a voz pode identificar a pessoa).

## Fatos da Meta (não invente outros; na dúvida, consulte a documentação oficial e registre em DECISOES.md)

- Verificação do webhook: `GET` com `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. Responda o `challenge` com 200 se o token bater.
- Envio: `POST https://graph.facebook.com/{GRAPH_API_VERSION}/{PHONE_NUMBER_ID}/messages` com `messaging_product: "whatsapp"`. A versão vem de env.
- Mídia recebida: o webhook traz o ID; `GET /{media_id}` devolve uma URL que **expira em 5 minutos**; o download exige o token. O ID de mídia vindo do webhook vale 7 dias.
- Status webhooks: objeto `pricing` com `billable`, `pricing_model: "PMP"`, `type` (`free_customer_service` ou `regular`) e `category`.
- Janela de atendimento: 24h, reiniciada a cada mensagem da pessoa.
- Limites de mensagens interativas: até 3 botões (título ≤ 20 caracteres); lista com até 10 linhas (título ≤ 24, descrição ≤ 72); corpo ≤ 1024 caracteres.
- WhatsApp Flows: a resposta do formulário chega como `interactive.type = "nfm_reply"` com `response_json`.
- Número de teste da Meta: envia para até 5 números cadastrados. Use-o antes de qualquer número real.

## Comandos

- `npm run verify` = typecheck + lint + todos os testes. **Precisa passar ao final de toda etapa.**

## Documentos do projeto

- `docs/PLANO.md`: etapas e critérios de aceite.
- `docs/ORQUESTRACAO.md`: como o orquestrador conduz as etapas.
- `docs/PROGRESSO.md`: status de cada etapa (fonte de verdade para retomar o trabalho).
- `docs/DECISOES.md`: decisões tomadas sem consultar o humano, com o porquê.
- `docs/PENDENCIAS_HUMANAS.md`: o que só o humano pode fazer (contas, credenciais, chip, publicar Flow).
- `docs/verificacao/`: relatórios do verificador.

## Convenções

- Código e nomes em inglês; comentários, textos do bot e documentação em português.
- Um commit por etapa aprovada.
- Na dúvida, escolha a opção que **gasta menos mensagens, custa menos e é mais segura**, e registre a escolha em DECISOES.md.
