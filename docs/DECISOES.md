# Decisões

Decisões tomadas pelos agentes sem consultar o humano. Formato: data · etapa · decisão · motivo.

| Data | Etapa | Decisão | Motivo |
| --- | --- | --- | --- |
| (inicial) | — | Corte de orçamento padrão em 950 mensagens/mês (margem de 50 sobre as 1.000 grátis) | Folga para mensagens em trânsito e diferenças de contagem entre nós e a Meta |
| (inicial) | — | Templates proibidos | Templates nunca entram na franquia gratuita |
| (inicial) | — | Campos do cadastro provisórios: nome, e-mail, cidade | Ainda não definidos pela equipe; ficam num arquivo só para trocar fácil |
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
