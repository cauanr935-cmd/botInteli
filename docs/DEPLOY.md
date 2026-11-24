# Deploy — passo a passo

Objetivo: publicar o bot sem custo. Faça os passos na ordem. Cada passo marcado com [humano] só você pode fazer (contas, tokens, chip).

## 0. Pré-requisitos

- Node.js atual (LTS) e `npm install` feito.
- `npm run verify` verde e `npm run build` (dry-run do Worker, sem credenciais) passando.

## 1. Criar as contas [humano]

1. **Oracle Cloud**: crie a conta e uma VM (a camada gratuita "Always Free" serve) para rodar a Evolution API em Docker.
2. **Cloudflare**: crie a conta (plano gratuito).
3. **Supabase**: crie o projeto (plano gratuito).
4. Um **chip dedicado** ao bot (nunca o seu número pessoal): o canal é o WhatsApp Web (Baileys), com risco de banimento (ver `CLAUDE.md` e `bot.md`, seção 12).
5. Defina a API do analisador de áudio: URL, chave, formato de envio e de resposta, limite gratuito/preço por áudio. O adaptador genérico está em `src/audio/analyzer.ts`; se o contrato for diferente, ajuste só esse arquivo.

## 2. Supabase: aplicar as migrações [humano]

No SQL Editor (ou `supabase db push`), aplique **em ordem** os arquivos de `supabase/migrations/`:

`0001_processed_messages.sql`, `0002_budget.sql`, `0003_conversation.sql`, `0004_registration.sql`, `0005_services.sql`, `0006_last_service.sql`, `0007_audios.sql`, `0008_housekeeping.sql`, `0009_mentorias.sql`, `0010_perfil_duvidas.sql`, `0011_horarios_contato.sql`, `0012_materiais.sql`, `0013_horarios_estruturados.sql`, `0014_perfil_texto.sql`, `0015_mentoria_v2.sql`, `0016_sensitive_events.sql`, `0017_pending_choices.sql`, `0018_matching.sql`, `0019_nome_cauan.sql`, `0020_nova_mentoria.sql`, `0021_curadoria.sql`, `0022_match_v2.sql`, `0023_certificado_pedidos.sql`.

Depois copie `SUPABASE_URL` e a **service key** (Settings > API). A service key é segredo: nunca vai para o git.

## 3. Cloudflare R2: criar o bucket [humano]

```
npx wrangler r2 bucket create bot-whatsapp-audios
```

O binding `AUDIOS` já está em `wrangler.toml`. Os áudios são dado pessoal (a voz identifica a pessoa): defina a política de retenção (regra de ciclo de vida do bucket) conforme a política de privacidade.

## 4. Variáveis e secrets

Variáveis não secretas ficam em `[vars]` do `wrangler.toml`. Segredos entram com `wrangler secret put` (nunca no código):

```
npx wrangler secret put EVOLUTION_API_KEY
npx wrangler secret put EVOLUTION_WEBHOOK_TOKEN
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put ANALYZER_API_KEY
npx wrangler secret put ADMIN_TOKEN
```

Valores sensíveis sem valor padrão seguro (configure como secret ou `[vars]`): `EVOLUTION_URL`, `EVOLUTION_INSTANCE`, `SUPABASE_URL`, `ANALYZER_API_URL`, `PRIVACY_POLICY_URL`.

Todas as variáveis de `.dev.vars.example`:

| Variável | Onde | Observação |
| --- | --- | --- |
| `EVOLUTION_URL` | var ou secret | URL pública (https) da Evolution API na VM, sem barra final. `http://` só vale para `localhost`. |
| `EVOLUTION_API_KEY` | secret | Chave global da Evolution (`AUTHENTICATION_API_KEY` do container); vai no header `apikey`. |
| `EVOLUTION_INSTANCE` | var ou secret | Nome da instância criada na Evolution (letras, números, `.`, `-`, `_`). Também é a chave da trava manual e do contador. |
| `EVOLUTION_WEBHOOK_TOKEN` | secret | Segredo (16+ caracteres) que a Evolution envia no header `x-webhook-token` em cada chamada ao `/webhook`. |
| `EVOLUTION_NATIVE_INTERACTIVE` | var | `false` (padrão) = botões e listas em texto numerado; `true` = tenta botões/listas nativos (instáveis no Baileys). |
| `SUPABASE_URL` | var | URL do projeto. |
| `SUPABASE_SERVICE_KEY` | secret | Service key. |
| `ANALYZER_API_URL` | var | URL da API de análise de áudio. |
| `ANALYZER_API_KEY` | secret | Chave da API de análise. |
| `ADMIN_TOKEN` | secret | Valor longo e aleatório; protege `/admin/*`. |
| `ADMIN_WA_IDS` | secret | Números E.164 dos admins do matching, separados por vírgula (ex.: `+5511999990000,+5511988887777`). Habilita `/duvidas` e `/mentores` no WhatsApp. Vazio = ninguém é admin. |
| `TIMEZONE` | var | Fuso que define a virada do dia (padrão `America/Sao_Paulo`). `META_ACCOUNT_TIMEZONE` antigo ainda vale como alias. |
| `ANTI_FLOOD_MAX_PER_DAY` | var | Teto de mensagens enviadas por dia pelo número (proteção contra banimento). `0` = desligado (padrão); máximo 990. |
| `MAX_BOT_MSGS_PER_USER_PER_DAY` | var | Padrão 12. |
| `MAX_BOT_MSGS_PER_USER_PER_10MIN` | var | Padrão 4. |
| `PRIVACY_POLICY_URL` | var | URL pública da política de privacidade. |
| `TERMS_VERSION` | var | Versão do termo (ex.: `2025-01`); gravada com o consentimento. |
| `MAX_AUDIO_BYTES` | var | Padrão 16000000. |
| `MAX_AUDIO_STREAM_BYTES` | var | Padrão 300000000. Teto dos arquivos copiados em stream do S3/R2 da Evolution (ver "Áudios grandes" abaixo). |
| `MEDIA_URL_HOSTS` | var | Hosts permitidos da URL do arquivo no S3 (separados por vírgula). Vazio = só o download normal, até `MAX_AUDIO_BYTES`. |
| `ANALYZER_TIMEOUT_MS` | var | Padrão 8000. |
| `NETWORK_OPEN_AT` | var | Abertura da rede (ISO com fuso, ex.: `2026-11-23T00:00:00-03:00`). Antes disso as pessoas se cadastram, mas **não pedem mentoria**. Vazio = rede aberta. |
| `NETWORK_EARLY_ACCESS` | secret | Números liberados para pedir mentoria antes da abertura, separados por vírgula (ex.: `88999990000,85 9999-0000`; DDI 55 e 9º dígito são opcionais). `wrangler secret put NETWORK_EARLY_ACCESS`. Sem ele, ninguém é liberado. |
| `AI_API_KEY` | secret | Chave da IA. `gsk_…` = Groq; `AIza…` ou `AQ.…` = Google Gemini (gratuito, modelo padrão `gemini-flash-latest`); `xai-…` = xAI Grok (o provedor é detectado pelo prefixo). Opcional: sem ela o bot funciona sem IA. Nomes antigos `XAI_API_KEY` e `GROQ_API_KEY` também valem. |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | secret (opcional) | Só para o painel conferir o estado do provedor que o bot **não** está usando (o que está em uso vem de `AI_API_KEY`). Sem elas, a linha do outro provedor aparece como "sem chave". |
| `AI_MODEL` | var | Padrão por provedor: Groq `openai/gpt-oss-120b`, xAI `grok-4`. Confirme o nome no console do provedor. |
| `AI_BASE_URL` | var | Padrão por provedor (Groq `https://api.groq.com/openai/v1`, xAI `https://api.x.ai/v1`); precisa ser https. |
| `AI_TIMEOUT_MS` | var | Padrão 6000. Passou disso, o bot decide sozinho. |

Para desenvolvimento local copie `.dev.vars.example` para `.dev.vars` (ignorado pelo git).

## 5. Subir a Evolution API na VM [humano]

A Evolution (v2, integração Baileys) roda em Docker na VM Oracle. Fixe uma **versão exata** da imagem (não use `latest`): os formatos de botão, lista e mídia mudam entre versões.

1. Na VM, suba o container com `AUTHENTICATION_API_KEY` (esse é o valor de `EVOLUTION_API_KEY`), banco/cache conforme a doc da versão escolhida e HTTPS na frente (proxy reverso com certificado). Libere só as portas necessárias.
2. Crie a instância: `POST {EVOLUTION_URL}/instance/create` com `{"instanceName": "<EVOLUTION_INSTANCE>", "integration": "WHATSAPP-BAILEYS", "qrcode": true}` e o header `apikey`.
3. Leia o QR Code (`GET /instance/connect/<instância>`) com o WhatsApp do **chip dedicado**: Aparelhos conectados > Conectar um aparelho.
4. Configure o webhook da instância (confira o formato exato na doc da sua versão e com `GET /webhook/find/<instância>`):

```
POST {EVOLUTION_URL}/webhook/set/<EVOLUTION_INSTANCE>
{ "webhook": { "enabled": true, "url": "https://<seu-worker>.workers.dev/webhook",
  "headers": { "x-webhook-token": "<EVOLUTION_WEBHOOK_TOKEN>" },
  "byEvents": false, "base64": false, "events": ["MESSAGES_UPSERT"] } }
```

Só `MESSAGES_UPSERT` interessa (status de entrega e preço são ignorados: não existe cobrança por conversa).

## 6. Deploy

```
npm run verify
npm run build        # dry-run offline, valida o bundle
npx wrangler deploy
```

O cron diário (`0 6 * * *`, UTC) mantém o Supabase ativo, apaga `processed_messages` com mais de 7 dias, devolve a `AWAIT_AUDIO` conversas presas em `PROCESSING_AUDIO` há mais de 10 minutos (sem enviar mensagem) e registra o uso do dia do limitador anti-flood (`reserved_count` / `stop_at`).

## 6.1 Mentorias: painel e API de integração [humano]

Fluxo no bot: Menu > *Registrar mentoria* > anexar o arquivo de áudio (só o áudio). O áudio vai ao R2 e os metadados ficam em `audios` (migração `0009_mentorias.sql`). Sem `ANALYZER_API_URL`, a análise é feita pelo sistema externo, que busca o áudio pela API.

Segredos (nunca no código). Gere o hash da senha e os valores aleatórios com `node scripts/hash-password.mjs 'senha com 12+ caracteres'` e grave cada um com `npx wrangler secret put`:

- `PANEL_USER`: usuário do painel.
- `PANEL_PASSWORD_HASH`: hash PBKDF2 impresso pelo script (a senha não é guardada).
- `PANEL_SESSION_SECRET`: segredo (32+ caracteres) que assina a sessão.
- `INTEGRATION_API_KEY`: chave (32+ caracteres) do sistema analisador.
- `PESSOA_ID_SECRET`: segredo (32+ caracteres) do HMAC que gera o `pessoa_id` (telefone -> id) usado no banco, no caminho do R2 (`audios/<pasta>/<pessoa_id>/`, `materiais/<pessoa_id>/`) e na API. Gere e envie sem exibir: `openssl rand -hex 32 | npx wrangler secret put PESSOA_ID_SECRET`. **Faça backup fora da Cloudflare** (gerenciador de senhas): os secrets do Worker não podem ser lidos de volta. **NUNCA troque o valor sem uma migração**: o notebook usa o `pessoa_id` para somar as horas e o histórico de conduta de cada pessoa, e trocar o segredo gera outro id para o mesmo telefone (a pessoa vira outra, no banco, no R2 e no notebook). Sem o segredo o Worker falha fechado (não grava nem envia). Em 2026-11-18, antes da troca para HMAC, as duas linhas de teste que existiam (`users`: 1, sem consentimento e sem `wa_id_hash`; `pending_choices`: 1) foram apagadas com `delete from pending_choices; delete from users;` (**já executado**; `audios`, `doubts`, `doubt_materials` e `matches` já estavam vazias). Com a base vazia não há migração de banco nem de R2. Se algum dia o segredo precisar mudar com dados no banco, será preciso um script que recalcule `wa_id_hash` a partir de `users.wa_id` e copie as chaves do R2 para o caminho novo, com verificação.
Ordem de publicação: `npm run verify` 100% verde -> `wrangler secret put PESSOA_ID_SECRET` -> `wrangler deploy`.

Painel: `https://<seu-worker>.workers.dev/painel` (login; bloqueio por tentativas). API do analisador (`Authorization: Bearer <INTEGRATION_API_KEY>`): `GET /api/v1/mentorias?status=pending`, `GET /api/v1/mentorias/<id>/audio`, `POST /api/v1/mentorias/<id>/result`. Detalhes em `bot.md`.

Cada mentoria consome cerca de 6 mensagens do bot; por isso `MAX_BOT_MSGS_PER_USER_PER_10MIN` e `..._PER_DAY` ficam em 8 e 40 no `wrangler.toml`.

## 7. Conferir o webhook [humano]

1. `GET https://<seu-worker>.workers.dev/health` deve responder `ok`.
2. Sem o header, `POST /webhook` deve responder `401`; com `x-webhook-token` correto, `200`.
3. Mande uma mensagem de outro celular para o número do bot e acompanhe `npx wrangler tail`.

## 8. Testar com poucos números [humano]

Antes de divulgar, teste com 2 ou 3 contatos seus: boas-vindas, consentimento, cadastro, menu (texto numerado: responder `1`, `2`...), resposta pronta e envio de áudio. Acompanhe `GET /admin/budget` (header `Authorization: Bearer <ADMIN_TOKEN>`) e os logs. **Valide na sua versão da Evolution** os pontos não documentados listados em `docs/PENDENCIAS_HUMANAS.md` (formato do `messages.upsert`, resposta do `getBase64FromMediaMessage`, `@lid`).

## 9. Aquecer o número (anti-ban) [humano]

1. Use um chip **novo e dedicado**, com conta de uso real por alguns dias antes de ligar o bot.
2. Aumente o volume aos poucos; ligue o limitador (`ANTI_FLOOD_MAX_PER_DAY`, por exemplo 300) e ajuste conforme o uso.
3. O bot só responde a quem escreveu primeiro e nunca envia mensagem em massa (R2). Não mude isso.
4. Mantenha recargas no chip para a operadora não cancelar a linha.

## Checklist de produção

- [ ] Evolution fixada numa versão exata, atrás de HTTPS, com `AUTHENTICATION_API_KEY` forte; instância conectada pelo QR Code.
- [ ] Webhook da instância com `x-webhook-token` igual a `EVOLUTION_WEBHOOK_TOKEN`; `POST /webhook` sem token responde 401.
- [ ] Política de privacidade publicada; `PRIVACY_POLICY_URL` e `TERMS_VERSION` definidos.
- [ ] Fuso conferido (`TIMEZONE`).
- [ ] **Risco de banimento aceito** (Baileys é não oficial): chip dedicado, número aquecido, `ANTI_FLOOD_MAX_PER_DAY` definido.
- [ ] Migrações 0001 a 0023 aplicadas; bucket R2 criado com retenção definida.
- [ ] Contrato do analisador definido e testado.
- [ ] Monitorar `GET /admin/budget` (uso do dia, trava) e os logs `warn` (80% do teto) e `critical` (teto atingido). A trava manual pode ser ligada pelo banco e só é liberada por `POST /admin/budget/unlock`.

## Trocar a IA para o Google Gemini (opcional)

1. Crie a chave no Google AI Studio (formato `AIza…` ou `AQ.…`).
2. `wrangler secret put AI_API_KEY` e cole a chave. O bot detecta o Gemini pelo prefixo (modelo `gemini-flash-latest`).
3. Se existirem `AI_BASE_URL`/`AI_MODEL` de outro provedor, apague (`wrangler secret delete`): valores que não são do Google são ignorados, mas confundem o painel.
4. **Reserva automática:** se existirem chaves de outros provedores (`GROQ_API_KEY`, `XAI_API_KEY`...), elas viram reserva: quando o Gemini falha (503, limite, timeout), a mesma pergunta vai à Groq/xAI. Não precisa configurar nada.
5. Faça o deploy e confira o painel (estado da IA) e os logs `choice_not_understood` (devem cair).

## IA como supervisor do bot (opcional: Groq ou xAI Grok)

O bot funciona sozinho. Com uma chave de IA (`AI_API_KEY`), um modelo **intervém** quando o bot não entende a pessoa ou pode decidir errado. A API é no formato OpenAI (`chat/completions`); o provedor sai do prefixo da chave: `gsk_…` = **Groq**, `xai-…` = **xAI Grok**.

1. **Supervisor de intenção** (`src/ai/agent.ts`, `ROUTES`): estados "o que você quer fazer?", Sim/Não da dúvida, papel e o texto da dúvida. Só é consultado quando o bot gerou dica/silêncio (ou, no texto da dúvida, sempre). `sair`, `menu`, `oi`, `sim` e `não` **nunca** vão para a IA. A IA só escolhe uma opção de lista fechada, que vira o mesmo botão que a pessoa poderia ter tocado (mesmas travas de anti-flood, anti-spam e consentimento).
2. **Horários livres**: no serviço *Horários* a IA lê o texto livre ("segunda e quarta à tarde", "de seg a sex 19h às 21h") e grava as faixas em `users.availability_slots` (`[{day, start, end}]`), além do texto original em `users.availability`. Se a IA falhar ou não estiver configurada, o texto é guardado como veio; se a IA ler e não achar horários, o bot pede de novo (1 dica).
3. **Nome**: a IA avalia se o nome parece real (apelido, objeto, personagem e nome de uma palavra só são suspeitos: "Zé do Frango", "Baralho da Silva", "Sofá", "Antônio"). Suspeito => o bot pergunta "é mesmo o seu nome?" (Sim segue; Não pede o nome de novo). Sem IA, só o nome de uma palavra é confirmado.
4. **Turma**: sempre com número (T27, T26, T24...). Só letras ou número fora do padrão (4+ dígitos) pedem de novo. Regra do código, sem IA.
5. **A IA nunca tira dúvidas de conteúdo** (ex.: cálculo, programação): a dúvida é só guardada para a equipe procurar um mentor. Depois do cadastro, a IA responde apenas perguntas sobre o funcionamento do programa (como funciona, cadastro, horários, contato) e fica em **silêncio** com assuntos sem relação (ex.: previsão do tempo). Os fatos que ela pode usar estão em `FAQ_PROMPT` (`src/ai/grok.ts`): atualize-os se o programa mudar.

Em qualquer erro, timeout (`AI_TIMEOUT_MS`), confiança < 0,6 ou chave ausente, o bot decide sozinho. Para a IA vai **só o texto da mensagem** (até 500 caracteres), sem nome nem telefone, e apenas depois do consentimento. Falhas aparecem nos logs como `ai_http_error` (com o status: 401/403 = chave ou provedor errado, 404 = modelo inexistente) e `ai_failed`.

```bash
cd ~/Documentos/botWhatsaap/bot-whatsapp-kit
# envia a chave do .dev.vars sem mostrá-la
grep '^XAI_API_KEY=' .dev.vars | cut -d= -f2- | tr -d '\r\n' | npx wrangler secret put AI_API_KEY
npx wrangler deploy
```

## Termos de Uso e Política de Privacidade
- Página pública: `GET /privacidade` (alias `/termos`), gerada por `src/legal/page.ts`. Sem JavaScript, sem cookies, com CSP restrita.
- A versão (`LEGAL_VERSION`) precisa ser igual a `TERMS_VERSION` em `wrangler.toml`: o aceite de cada pessoa guarda a data e essa versão (`consent_at`, `terms_version`). Ao mudar o texto de forma relevante, suba as duas versões juntas.
- `PRIVACY_POLICY_URL` (secret) deve apontar para essa página; o link vai na mensagem de consentimento.

## Modo admin do chat de teste

Variáveis opcionais `CHAT_ADMIN_USER` e `CHAT_ADMIN_PASS` trocam o login do modo admin do `/chat` (o padrão de teste está no código). Defina-as antes de qualquer uso real.


## Mentoria v2: integração com o Transcritor [humano]

Etapa 1 (arquivo -> papel -> assunto -> data -> parceiro -> confirmação do parceiro). **Nada disto foi aplicado em produção pelos agentes.**

1. **Migração** (antes do deploy do código; ela só acrescenta colunas, uma função e um gatilho, então o código antigo continua funcionando):
   - SQL Editor do Supabase: colar e rodar `supabase/migrations/0015_mentoria_v2.sql`; ou `supabase db push`.
   - Conferir: `select column_name from information_schema.columns where table_name = 'audios' and column_name in ('ocorreu_em','partner_wa_id_hash','partner_confirmed_at','partner_rejected_at','audio_sha256','audio_deleted_at','contested_reason');` (7 linhas).
2. **Deploy do Worker**: `npm run verify && npx wrangler deploy`.
3. **Cron**: o gatilho diário já existente passa a limpar também as mentorias (incompletas > 24 h; sem resposta do parceiro > 7 dias). Confirmar nos logs `cron_mentoria_cleanup`.
4. **Compatibilidade com o notebook** (rotas `/api/v1/mentorias` iguais): `status=pending` agora só lista mentorias confirmadas pelo parceiro (as anteriores à v2, sem `ocorreu_em`, continuam listadas). O notebook não precisa mudar.


## Aviso da decisão da equipe (curadoria) [humano]

O notebook reenvia `POST /api/v1/mentorias/<id>/result` com `result.curadoria`; o bot avisa cada participante quando a situação dele muda para `aprovada` ou `recusada` (contrato em `docs/INTEGRACAO_TRANSCRITOR.md`). **Nada disto foi aplicado em produção pelos agentes.**

1. **Migração** (antes do deploy do código; só acrescenta uma coluna, duas funções e a tabela `revisao_pedidos`, então o código antigo continua funcionando):
   - SQL Editor do Supabase: colar e rodar `supabase/migrations/0021_curadoria.sql`; ou `supabase db push`.
   - Conferir: `select column_name from information_schema.columns where table_name = 'audios' and column_name = 'notified_curadoria';` (1 linha) e `select to_regclass('public.revisao_pedidos');` (não nulo).
2. **Deploy do Worker**: `npm run verify && npx wrangler deploy` (só com o verify 100% verde).
3. **Conferir**: o notebook reenvia o resumo de uma mentoria de teste; a mensagem chega uma vez (reenvio igual não manda de novo) e o painel mostra a curadoria e "já avisado".


## Áudios grandes (gravar direto no R2)

O download pelo Worker (base64) passa de 16 MB e estoura a memória (128 MB). Para arquivos grandes, a **Evolution grava no R2** (S3) e o Worker só **copia em stream** para `audios/mentorias/...`:

1. No `.env` da Evolution (VM): `S3_ENABLED=true`, `S3_ACCESS_KEY`/`S3_SECRET_KEY` (token S3 do R2), `S3_BUCKET=<bucket de mídia da Evolution>`, `S3_ENDPOINT=<conta>.r2.cloudflarestorage.com`, `S3_PORT=443`, `S3_USE_SSL=true`, `S3_REGION=auto`. Exponha o bucket por um domínio público/URL assinada.
2. No Worker: `MEDIA_URL_HOSTS="<host da URL>"` (anti-SSRF: outros hosts são ignorados) e, se quiser, `MAX_AUDIO_STREAM_BYTES`.
3. O webhook passa a trazer `mediaUrl` na mensagem. Sem `mediaUrl` ou host não listado, o bot usa o caminho antigo (limite de `MAX_AUDIO_BYTES`).

**Não verificado contra uma instância real:** o nome do campo `mediaUrl` e o formato da URL (ver `docs/PENDENCIAS_HUMANAS.md`).
