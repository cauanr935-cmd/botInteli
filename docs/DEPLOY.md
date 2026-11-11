# Deploy — passo a passo

Objetivo: publicar o bot sem custo. Faça os passos na ordem. Cada passo marcado com [humano] só você pode fazer (contas, tokens, chip).

## 0. Pré-requisitos

- Node.js atual (LTS) e `npm install` feito.
- `npm run verify` verde e `npm run build` (dry-run do Worker, sem credenciais) passando.

## 1. Criar as contas [humano]

1. **Meta for Developers**: crie a conta e um app do tipo Business com o produto WhatsApp.
2. Crie/use um portfólio empresarial (Business Manager).
3. **Cloudflare**: crie a conta (plano gratuito).
4. **Supabase**: crie o projeto (plano gratuito).
5. Defina a API do analisador de áudio: URL, chave, formato de envio e de resposta, limite gratuito/preço por áudio. O adaptador genérico está em `src/audio/analyzer.ts`; se o contrato for diferente, ajuste só esse arquivo.

## 2. Supabase: aplicar as migrações [humano]

No SQL Editor (ou `supabase db push`), aplique **em ordem** os arquivos de `supabase/migrations/`:

`0001_processed_messages.sql`, `0002_budget.sql`, `0003_conversation.sql`, `0004_registration.sql`, `0005_services.sql`, `0006_last_service.sql`, `0007_audios.sql`, `0008_housekeeping.sql`, `0009_mentorias.sql`, `0010_perfil_duvidas.sql`, `0011_horarios_contato.sql`, `0012_materiais.sql`, `0013_horarios_estruturados.sql`, `0014_perfil_texto.sql`.

Depois copie `SUPABASE_URL` e a **service key** (Settings > API). A service key é segredo: nunca vai para o git.

## 3. Cloudflare R2: criar o bucket [humano]

```
npx wrangler r2 bucket create bot-whatsapp-audios
```

O binding `AUDIOS` já está em `wrangler.toml`. Os áudios são dado pessoal (a voz identifica a pessoa): defina a política de retenção (regra de ciclo de vida do bucket) conforme a política de privacidade.

## 4. Variáveis e secrets

Variáveis não secretas ficam em `[vars]` do `wrangler.toml`. Segredos entram com `wrangler secret put` (nunca no código):

```
npx wrangler secret put WHATSAPP_TOKEN
npx wrangler secret put APP_SECRET
npx wrangler secret put VERIFY_TOKEN
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put ANALYZER_API_KEY
npx wrangler secret put ADMIN_TOKEN
```

Valores sensíveis sem valor padrão seguro (configure como secret ou `[vars]`): `PHONE_NUMBER_ID`, `SUPABASE_URL`, `ANALYZER_API_URL`, `PRIVACY_POLICY_URL`.

Todas as variáveis de `.dev.vars.example`:

| Variável | Onde | Observação |
| --- | --- | --- |
| `WHATSAPP_TOKEN` | secret | Token permanente de usuário de sistema (Meta). |
| `PHONE_NUMBER_ID` | secret ou var | Painel WhatsApp > API Setup. |
| `APP_SECRET` | secret | Segredo do app Meta; valida `X-Hub-Signature-256`. |
| `VERIFY_TOKEN` | secret | Valor longo e aleatório; o mesmo vai no painel da Meta. |
| `GRAPH_API_VERSION` | var | Ex.: `v21.0`. |
| `SUPABASE_URL` | var | URL do projeto. |
| `SUPABASE_SERVICE_KEY` | secret | Service key. |
| `ANALYZER_API_URL` | var | URL da API de análise de áudio. |
| `ANALYZER_API_KEY` | secret | Chave da API de análise. |
| `ADMIN_TOKEN` | secret | Valor longo e aleatório; protege `/admin/*`. |
| `META_ACCOUNT_TIMEZONE` | var | Fuso da conta Meta (padrão `America/Sao_Paulo`); confirme na Meta. Define a virada do mês. |
| `BUDGET_SAFETY_MARGIN` | var | Padrão 50, mínimo 10 (corte em 950). |
| `MAX_BOT_MSGS_PER_USER_PER_DAY` | var | Padrão 12. |
| `MAX_BOT_MSGS_PER_USER_PER_10MIN` | var | Padrão 4. |
| `WHATSAPP_FLOW_ID` | var (opcional) | ID do Flow publicado; sem ele o bot usa o cadastro por perguntas. |
| `PRIVACY_POLICY_URL` | var | URL pública da política de privacidade. |
| `TERMS_VERSION` | var | Versão do termo (ex.: `2025-01`); gravada com o consentimento. |
| `MAX_AUDIO_BYTES` | var | Padrão 16000000. |
| `ANALYZER_TIMEOUT_MS` | var | Padrão 8000. |
| `AI_API_KEY` | secret | Chave da IA. `gsk_…` = Groq; `xai-…` = xAI Grok (o provedor é detectado pelo prefixo). Opcional: sem ela o bot funciona sem IA. Nomes antigos `XAI_API_KEY` e `GROQ_API_KEY` também valem. |
| `AI_MODEL` | var | Padrão por provedor: Groq `openai/gpt-oss-120b`, xAI `grok-4`. Confirme o nome no console do provedor. |
| `AI_BASE_URL` | var | Padrão por provedor (Groq `https://api.groq.com/openai/v1`, xAI `https://api.x.ai/v1`); precisa ser https. |
| `AI_TIMEOUT_MS` | var | Padrão 6000. Passou disso, o bot decide sozinho. |

Para desenvolvimento local copie `.dev.vars.example` para `.dev.vars` (ignorado pelo git).

## 5. Publicar o Flow de cadastro [humano]

1. WhatsApp Manager > Flows > Criar Flow (categoria Cadastro/Sign up) e cole `flows/cadastro.json` no editor JSON.
2. Troque a `url` do componente OptIn pelo valor real de `PRIVACY_POLICY_URL`.
3. Se o editor reclamar da versão do Flow JSON (`6.2`), use a versão mais recente aceita e confira TextInput/OptIn/Footer.
4. Teste na pré-visualização e **publique** (rascunho não pode ser enviado).
5. Copie o ID para `WHATSAPP_FLOW_ID`. O Flow pede nome completo e aceite; depois, o bot pede um áudio de apresentação. Se mudar os campos do formulário, edite `src/registration/fields.ts`, `flows/cadastro.json` e crie uma migração com as colunas.

## 6. Deploy

```
npm run verify
npm run build        # dry-run offline, valida o bundle
npx wrangler deploy
```

O cron diário (`0 6 * * *`, UTC) mantém o Supabase ativo, apaga `processed_messages` com mais de 7 dias, devolve a `AWAIT_AUDIO` conversas presas em `PROCESSING_AUDIO` há mais de 10 minutos (sem enviar mensagem) e registra o uso do mês (`reserved_count` / `stop_at`).

## 6.1 Mentorias: painel e API de integração [humano]

Fluxo no bot: Menu > *Registrar mentoria* > anexar o arquivo de áudio (só o áudio). O áudio vai ao R2 e os metadados ficam em `audios` (migração `0009_mentorias.sql`). Sem `ANALYZER_API_URL`, a análise é feita pelo sistema externo, que busca o áudio pela API.

Segredos (nunca no código). Gere o hash da senha e os valores aleatórios com `node scripts/hash-password.mjs 'senha com 12+ caracteres'` e grave cada um com `npx wrangler secret put`:

- `PANEL_USER`: usuário do painel.
- `PANEL_PASSWORD_HASH`: hash PBKDF2 impresso pelo script (a senha não é guardada).
- `PANEL_SESSION_SECRET`: segredo (32+ caracteres) que assina a sessão.
- `INTEGRATION_API_KEY`: chave (32+ caracteres) do sistema analisador.

Painel: `https://<seu-worker>.workers.dev/painel` (login; bloqueio por tentativas). API do analisador (`Authorization: Bearer <INTEGRATION_API_KEY>`): `GET /api/v1/mentorias?status=pending`, `GET /api/v1/mentorias/<id>/audio`, `POST /api/v1/mentorias/<id>/result`. Detalhes em `bot.md`.

Cada mentoria consome cerca de 6 mensagens do bot; por isso `MAX_BOT_MSGS_PER_USER_PER_10MIN` e `..._PER_DAY` ficam em 8 e 40 no `wrangler.toml`.

## 7. Registrar o webhook na Meta [humano]

1. No app da Meta > WhatsApp > Configuration, informe a Callback URL `https://<seu-worker>.workers.dev/webhook` e o `VERIFY_TOKEN`.
2. Assine o campo `messages` (traz mensagens e status).
3. Confira `GET https://<seu-worker>.workers.dev/health` (deve responder `ok`).

## 8. Testar com o número de teste da Meta [humano]

Use primeiro o **número de teste** da Meta: envia para até **5 destinatários** cadastrados. Percorra: boas-vindas, consentimento, cadastro (Flow), menu, resposta pronta, envio de áudio. Acompanhe `GET /admin/budget` (header `Authorization: Bearer <ADMIN_TOKEN>`) e os logs (`npx wrangler tail`).

## 9. Registrar o chip (só depois dos testes) [humano]

1. Compre um chip pré-pago **novo**, nunca ativado no WhatsApp nem no WhatsApp Business.
2. Registre o número na API (código por SMS ou ligação) e defina o PIN de duas etapas.
3. Mantenha recargas no chip para a operadora não cancelar a linha.
4. Atualize `PHONE_NUMBER_ID` e `WHATSAPP_TOKEN` para o número real.

## Checklist de produção

- [ ] Empresa verificada no Meta Business Manager.
- [ ] Política de privacidade publicada; `PRIVACY_POLICY_URL` e `TERMS_VERSION` definidos.
- [ ] Conferir o cadastro publicado: nome completo e aceite no Flow; perguntas pessoais respondidas por áudio depois do formulário.
- [ ] Fuso da conta de mensagens confirmado na Meta (`META_ACCOUNT_TIMEZONE`).
- [ ] **Não cadastrar forma de pagamento no Billing Hub.** Sem forma de pagamento, a Meta não entrega mensagens além da franquia: segunda proteção, além do disjuntor (950 de 1.000).
- [ ] Migrações 0001 a 0013 aplicadas; bucket R2 criado com retenção definida.
- [ ] Contrato do analisador definido e testado.
- [ ] Monitorar `GET /admin/budget` (uso do mês, disjuntor) e os logs `warn` (80% do corte) e `critical` (disjuntor aberto).
- [ ] Se o disjuntor manual abrir por sinal de cobrança, investigue antes de liberar pelo endpoint `POST /admin/budget/unlock`.

## IA como supervisor do bot (opcional: Groq ou xAI Grok)

O bot funciona sozinho. Com uma chave de IA (`AI_API_KEY`), um modelo **intervém** quando o bot não entende a pessoa ou pode decidir errado. A API é no formato OpenAI (`chat/completions`); o provedor sai do prefixo da chave: `gsk_…` = **Groq**, `xai-…` = **xAI Grok**.

1. **Supervisor de intenção** (`src/ai/agent.ts`, `ROUTES`): estados "o que você quer fazer?", Sim/Não da dúvida, papel e o texto da dúvida. Só é consultado quando o bot gerou dica/silêncio (ou, no texto da dúvida, sempre). `sair`, `menu`, `oi`, `sim` e `não` **nunca** vão para a IA. A IA só escolhe uma opção de lista fechada, que vira o mesmo botão que a pessoa poderia ter tocado (mesmas travas de orçamento, anti-spam e consentimento).
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
