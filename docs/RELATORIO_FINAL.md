# Relatório final (Etapa 8)

Medido por `scripts/simulate.ts` (rodado por `tests/simulation.test.ts`, `npm run simulate`). A simulação usa a fiação real de produção (`route` -> assinatura -> idempotência -> `createEventHandler` -> motor -> `sendGuarded`), com Graph API falsa que conta envios, `MemoryRepo`, R2 e analisador falsos, relógio controlável. Configuração: `STOP_AT = 950`, 12 msgs/dia e 4 msgs/10 min por pessoa, Flow ativo.

## Mensagens por pessoa (medido)

| Situação | Envios | Cenário |
| --- | --- | --- |
| Pessoa nova: "oi" (Flow) + formulário (confirmação + menu) + escolha do serviço de áudio + áudio (resultado) | **4** | S3 |
| Áudio extra na mesma sessão | **1** | S3 |
| Pessoa já cadastrada voltando (menu + escolha + resultado) | **3** | S3 |
| Cadastro sem Flow (fallback por texto) | 1 + nº de campos (testado na Etapa 4, C4.2), mais 2 até o resultado | C4.2 |

## Pessoas por mês (stop_at ÷ mensagens por pessoa)

- Pessoas novas (4 msgs cada): 950 ÷ 4 = **237 pessoas/mês**.
- Pessoas já cadastradas voltando (3 msgs cada): 950 ÷ 3 = **316 pessoas/mês**.
- Cada áudio extra custa 1 mensagem: 950 ÷ 1 = 950 áudios/mês se todos fossem extras.
- S1 confirma: 300 pessoas novas pediriam 1.200 envios; o app parou em exatamente **950** (1.200 webhooks, todos 200; 1 alerta `warn` a 80% e 1 `critical` na abertura do disjuntor; 0 envios depois do corte).

## Resultados dos cenários

| Cenário | Resultado medido |
| --- | --- |
| S1 estouro | 950 envios, reservado 950, 0 envios após o corte, 1200/1200 webhooks 200 |
| S2 spam | 50 pessoas x 30 "oi" = 50 envios |
| S3 economia | 4 / 1 / 3 |
| S4 reentrega | 80 envios com entrega única e 80 com entrega em dobro (160 webhooks); máx. 4 por pessoa; 20 áudios guardados nos dois casos |
| S5 cobrança | 20 envios antes do sinal; 0 depois até o unlock; 1 depois do unlock |
| S6 virada | novembro cheio (950): 0 envios às 23:59:30 de SP; 1 envio às 00:00:30 de 1/12; dezembro reservado = 1 |
| S7 rajada | 100 mensagens em 1 min = 4 envios (limite de 10 min) |

## Regra -> teste que comprova

| Regra | Testes |
| --- | --- |
| R1 `STOP_AT`, margem mínima, constante fixa | `tests/config.test.ts` (C0.3, C0.4); SQL: `tests/budget-sql.test.ts` (C2.2, C2.3) |
| R1 único arquivo de envio | `tests/budget-http.test.ts` / `tests/architecture.test.ts` (C2.1) |
| R1 reserva atômica e concorrência | C2.2, C2.3 |
| R1 virada do mês | C2.4; `tests/simulation.test.ts` S6 |
| R1 trava por `pricing` pago, só humano destrava | C2.5; S5 |
| R1 templates proibidos | C2.6 |
| R1 janela 23h30 | C2.7; C6.5 |
| R1 fail closed e vaga não devolvida | C2.8, C2.9 |
| R1 webhook 200 com disjuntor aberto | C2.10; S1, S5 |
| R1 alertas 80% / critical | C2.12; S1 |
| R1 total de envios dentro do limite | S1 |
| R2 entradas esperadas, variações, dica única, silêncio | C3.1, C3.2, C3.3, C3.4 |
| R2 limites por pessoa | C3.5; S7 |
| R2 tipos não esperados | C3.6, C1.4 |
| R2 idempotência de wamid | C1.3; S4 |
| R2 uma entrada = uma resposta, sem "aguarde" | C3.9, C6.3; S3 |
| R2 spam de "oi" | C3.1; S2 |
| R3 assinatura HMAC | C1.2 |
| R3 telefone mascarado, sem conteúdo em log | C1.6, C0.5 |
| R3 admin com Bearer | C2.11 |
| R3 sem segredos no git | C0.6 |
| R4 sem rede | todos os testes usam mocks/memória/PGlite; simulador sem `fetch` real |
| R5 sem bibliotecas não oficiais | C0.6 (dependências proibidas) |
| R6 consentimento antes de dados | C4.4, C4.5; áudio sem consentimento: C6.8 |
| R6 `consent_at` e `terms_version` | C4.2, C4.5 |
| Pipeline de áudio / mídia 5 min | C6.1 a C6.7 |
| Operação (cron, build offline) | C7.1 a C7.4 (`tests/ops.test.ts`) |

Itens humanos pendentes (credenciais, chip, publicação do Flow, formato real do analisador): `docs/PENDENCIAS_HUMANAS.md`.
