# Bot de WhatsApp — regras do projeto

Este arquivo vale para TODOS os agentes (orquestrador, implementador, verificador). Leia inteiro antes de qualquer trabalho.

## O que estamos construindo

Um bot de WhatsApp que usa a **Evolution API v2 em modo Baileys** (WhatsApp Web / QR Code, hospedada numa VM Oracle Cloud via Docker) — antes usava a Cloud API oficial da Meta (ver R5) — e que:

1. Faz o cadastro da pessoa (com consentimento LGPD) e grava no banco de dados.
2. Mostra um menu de seleção de serviços (estilo "recarga de celular": a pessoa escolhe numa lista).
3. Responde com respostas prontas que vêm do banco.
4. Recebe áudios, guarda num armazenamento nosso e envia o áudio para uma **API externa de análise de áudio**. O bot não analisa nada, só encaminha e devolve o resultado.

## Stack (tudo no plano gratuito)

- **TypeScript** (strict) rodando em **Cloudflare Workers** (servidor do webhook + cron).
- **Evolution API v2 (Baileys)** numa VM Oracle (Docker): o Worker só fala HTTP com ela. O Baileys nunca entra no `package.json` do Worker.
- **Cloudflare R2** para guardar os áudios.
- **Supabase (Postgres)** para cadastros, estado das conversas, contador de mensagens e logs.
- **Vitest** para testes. Para testar SQL sem Docker, prefira **PGlite** (Postgres em WASM).
- Versões de bibliotecas: use as atuais e estáveis; registre escolhas em `docs/DECISOES.md`.

## REGRAS INVIOLÁVEIS

Qualquer violação reprova a etapa, mesmo que todos os testes passem.

### R1 — Proteger o número (anti-ban / anti-flood) e nunca falar sem controle

Contexto: o canal é o WhatsApp Web via Baileys. **Não existe franquia, janela de 24h nem cobrança por conversa**; o risco real é o **banimento** do número por volume ou comportamento de spam. A antiga regra "nunca sair do gratuito" (1.000 conversas Meta, margem, `STOP_AT`) foi substituída por esta proteção; a infraestrutura de disjuntor foi mantida.

- Toda mensagem enviada passa por **uma única função** (`sendGuarded`, `src/whatsapp/client.ts`). Só **um** arquivo conhece a API da Evolution: `src/whatsapp/evolutionClient.ts`. Nenhum outro arquivo envia mensagem nem chama a Evolution (`tests/architecture.test.ts`).
- **Trava manual** (disjuntor humano): ligada por um humano, só fecha pelo endpoint admin protegido. Com ela ligada, nenhuma mensagem sai.
- **Limitador anti-flood opcional**: `ANTI_FLOOD_MAX_PER_DAY` (env; 0 = desligado; máximo 990). Antes de cada envio, **reserva atômica** de uma vaga no contador **do dia** (`UPDATE ... WHERE reserved_count < stop_at`). Sem vaga → não envia. A contagem é conservadora: não devolve a vaga se o envio falhar. Log `warn` a 80% e `critical` ao atingir o teto.
- **Nunca escrever para quem nunca escreveu ao bot** (mensagem fria é o maior gatilho de ban). Não é janela de 24h: vale para qualquer pessoa que já tenha falado com o bot.
- **Fail closed**: se o banco estiver fora ou a reserva/consulta der erro, **não envia**.
- **Templates e Flows não existem** neste canal: `sendGuarded` devolve `unsupported_type` para qualquer tipo que não seja texto ou botões/lista.
- **"Quebrar a aplicação" = parar de enviar, não derrubar o endpoint.** O webhook continua respondendo **200** à Evolution quando o token é válido, mesmo com a trava ou o teto abertos.
- Não existe gatilho automático por status de cobrança (`billable`): status de entrega/preço são ignorados.

### R2 — Anti-spam e economia de mensagens

- O bot só responde quando a mensagem da pessoa é uma **entrada esperada no estado atual da conversa**. Isso inclui variações: maiúsculas, acentos, letras repetidas ("oiii"), pontuação e sinônimos.
- Entrada inesperada: **no máximo 1 dica por estado**. Depois disso, **nunca silêncio de cara**: o Axo manda um aviso curto e descontraído ("aqui não é lugar de resenha…", tom de estudante universitário, mesmo registro da pessoa) usando as vagas que sobram dos limites por pessoa. A **última vaga é sempre a despedida** ("vou ficar na minha…"), então o silêncio que vem depois nunca surpreende. Só depois disso, silêncio até chegar uma entrada válida. O aviso sempre relê os envios recentes antes de sair (rajadas simultâneas não multiplicam avisos) e nunca ultrapassa os limites do R2 nem o anti-flood do R1. Código: `offTopicNotice` em `src/axo/voice.ts` e `sendOffTopic` em `src/conversation/engine.ts`.
- Repetição não gera resposta. Exemplo: "oi" depois que as boas-vindas já foram enviadas → **silêncio**.
- Limites por pessoa: `MAX_BOT_MSGS_PER_USER_PER_DAY` (padrão **12**) e `MAX_BOT_MSGS_PER_USER_PER_10MIN` (padrão **4**). Acima disso, silêncio.
- O mesmo ID de mensagem (`key.id` do Baileys, o antigo `wamid`) recebido duas vezes é ignorado (idempotência; a Evolution pode reenviar eventos).
- Tipos não esperados no estado (figurinha, reação, imagem, vídeo, localização, contato) → silêncio.
- **Uma entrada válida = no máximo uma resposta.** Junte textos numa mensagem só. Proibido "aguarde", "processando" ou "recebi seu áudio" como mensagem separada.
- Use mensagens interativas (botões e listas): cada uma conta como **1** mensagem.

### R3 — Segurança e privacidade

- O `/webhook` exige o segredo compartilhado `EVOLUTION_WEBHOOK_TOKEN` (header `x-webhook-token` ou `Authorization: Bearer`), comparado em tempo constante. Ausente ou inválido → 401, nada processado. (A Evolution não assina o corpo.) O corpo do webhook traz a `apikey` da Evolution: nunca logue corpos.
- Nenhum segredo no código ou no git. Variáveis em `.dev.vars.example` / `.env.example`.
- Telefones mascarados nos logs (ex.: `5511*****1234`). Nenhum conteúdo de mensagem ou dado de cadastro em log.
- Endpoints admin exigem `Authorization: Bearer ADMIN_TOKEN`.

### R4 — Testes nunca acessam a rede real

Evolution API, analisador de áudio, Supabase e R2 são sempre mockados, em memória ou PGlite. Nenhum teste depende de credencial real.

### R5 — Canal não oficial: isolamento, política de uso e aviso de ban

- **Decisão (2026-11-12): o canal WhatsApp migrou da Cloud API oficial da Meta para a Evolution API (Baileys).** Motivo e trade-offs em `docs/DECISOES.md`. Isto **revoga** a antiga proibição de Baileys/whatsapp-web.js: eles rodam **dentro da Evolution**, na VM, e **nunca** no Worker nem no `package.json`.
- **Aviso:** o Baileys usa o protocolo do WhatsApp Web sem autorização e **viola os Termos de Serviço do WhatsApp**; o número pode ser **banido** a qualquer momento, sem suporte nem recurso. Use um **chip dedicado**, nunca o número pessoal.
- **Política de uso (obrigatória):** só responder a quem escreveu primeiro; nada de disparo em massa nem mensagem para desconhecidos; 1 resposta por entrada (R2); limites por pessoa; anti-flood diário e trava manual (R1).
- **Isolamento de borda:** só `src/whatsapp/evolutionClient.ts` conhece a Evolution. O motor (`src/conversation/*`), o cadastro e o pipeline de áudio são agnósticos de canal.

### R6 — LGPD

Nenhum dado de cadastro e nenhum áudio é guardado antes do consentimento explícito. Guardar `consent_at` e `terms_version`. O termo cita `PRIVACY_POLICY_URL`. Os áudios são dado pessoal (a voz pode identificar a pessoa).

## Fatos da Evolution API v2 (não invente outros; na dúvida, consulte a documentação da versão fixada e registre em DECISOES.md)

- Autenticação: header `apikey: {EVOLUTION_API_KEY}` em todas as chamadas.
- Envio: `POST {EVOLUTION_URL}/message/sendText/{instância}` com `{ "number": "<E164 sem +>", "text": "..." }`. Botões e listas: `/message/sendButtons/{instância}` e `/message/sendList/{instância}` — **instáveis no Baileys**; o padrão é o **texto numerado** (`1) ... 2) ...`) e a resposta numérica volta ao `id` da opção via `pending_choices`.
- Entrada: webhook da instância, evento `MESSAGES_UPSERT` (`messages.upsert`), com `data.key.{remoteJid,fromMe,id}` e `data.message.*` (formato Baileys). `key.id` é o id único (idempotência). Ignorar `fromMe`, grupos e status.
- Mídia recebida: `POST /chat/getBase64FromMediaMessage/{instância}`; não há URL temporária.
- Não existem: janela de 24h, templates, status de preço (`billable`), Flows (`nfm_reply`), verificação de webhook (`hub.challenge`).
- **Não verificado contra uma instância real** (ver `docs/PENDENCIAS_HUMANAS.md`): corpo exato do `sendText` (`text` x `textMessage.text`), `sendButtons`/`sendList`, campos do `messages.upsert`, resposta do `getBase64FromMediaMessage`, `@lid`.

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
