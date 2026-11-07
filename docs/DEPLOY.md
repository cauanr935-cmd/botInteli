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

`0001_processed_messages.sql`, `0002_budget.sql`, `0003_conversation.sql`, `0004_registration.sql`, `0005_services.sql`, `0006_last_service.sql`, `0007_audios.sql`, `0008_housekeeping.sql`.

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

Para desenvolvimento local copie `.dev.vars.example` para `.dev.vars` (ignorado pelo git).

## 5. Publicar o Flow de cadastro [humano]

1. WhatsApp Manager > Flows > Criar Flow (categoria Cadastro/Sign up) e cole `flows/cadastro.json` no editor JSON.
2. Troque a `url` do componente OptIn pelo valor real de `PRIVACY_POLICY_URL`.
3. Se o editor reclamar da versão do Flow JSON (`6.2`), use a versão mais recente aceita e confira TextInput/OptIn/Footer.
4. Teste na pré-visualização e **publique** (rascunho não pode ser enviado).
5. Copie o ID para `WHATSAPP_FLOW_ID`. Se mudar os campos do cadastro: edite `src/registration/fields.ts`, `flows/cadastro.json` e crie uma migração com as colunas.

## 6. Deploy

```
npm run verify
npm run build        # dry-run offline, valida o bundle
npx wrangler deploy
```

O cron diário (`0 6 * * *`, UTC) mantém o Supabase ativo, apaga `processed_messages` com mais de 7 dias, devolve a `AWAIT_AUDIO` conversas presas em `PROCESSING_AUDIO` há mais de 10 minutos (sem enviar mensagem) e registra o uso do mês (`reserved_count` / `stop_at`).

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
- [ ] Campos definitivos do cadastro definidos (hoje: nome, e-mail, cidade).
- [ ] Fuso da conta de mensagens confirmado na Meta (`META_ACCOUNT_TIMEZONE`).
- [ ] **Não cadastrar forma de pagamento no Billing Hub.** Sem forma de pagamento, a Meta não entrega mensagens além da franquia: segunda proteção, além do disjuntor (950 de 1.000).
- [ ] Migrações 0001 a 0008 aplicadas; bucket R2 criado com retenção definida.
- [ ] Contrato do analisador definido e testado.
- [ ] Monitorar `GET /admin/budget` (uso do mês, disjuntor) e os logs `warn` (80% do corte) e `critical` (disjuntor aberto).
- [ ] Se o disjuntor manual abrir por sinal de cobrança, investigue antes de liberar pelo endpoint `POST /admin/budget/unlock`.
