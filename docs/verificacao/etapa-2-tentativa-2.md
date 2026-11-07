# Verificação — Etapa 2, tentativa 2

## Resultado de `npm ci && npm run verify`
Verde: typecheck, lint e 108 testes (13 arquivos), incluindo os adversariais de `tests/adversarial/`.

## Critérios de aceite
| Critério | Status | Evidência |
| --- | --- | --- |
| C2.1 | OK | `tests/architecture.test.ts`; `graph.facebook.com` só em `src/whatsapp/client.ts:91` |
| C2.2 | OK | `tests/budget-sql.test.ts`, `tests/client.test.ts` |
| C2.3 | OK | PGlite, 100 simultâneas = 10 (atomicidade do UPDATE único; ressalva de conexão única do PGlite já registrada em DECISOES.md) |
| C2.4 | OK | `monthKey` + SQL + `client.test.ts` |
| C2.5 | OK | `budget-http.test.ts` |
| C2.6 | OK | `client.test.ts` + meu teste de template disfarçado |
| C2.7 | OK | `client.test.ts` + borda 23h30 (tentativa 1) |
| C2.8 | OK | `client.test.ts` |
| C2.9 | OK | `client.test.ts` + meu teste (2 falhas esgotam stop_at=2) |
| C2.10 | OK | `budget-http.test.ts` |
| C2.11 | OK | `budget-http.test.ts` |
| C2.12 | OK | `client.test.ts`, `budget-sql.test.ts` |

## Testes adversariais escritos
| Arquivo > teste | O que tenta quebrar | Resultado |
| --- | --- | --- |
| etapa-2/retry.test.ts | falha transitória ao ligar a trava + reenvio da Meta (problema da tentativa 1) | passa agora (`unclaimMessage` em `handler.ts:59-67`) |
| etapa-2/adv.test.ts (7 testes) | borda 23h30, lock sob concorrência, pricing parcial, assinatura inválida, rotas admin, stop_at, virada de ano | passam |
| etapa-2/t2.test.ts > template disfarçado | `" TEMPLATE "` e campo `template` | passa |
| etapa-2/t2.test.ts > falha da Graph não devolve vaga | C2.9 | passa |
| etapa-2/t2.test.ts > mensagem que falha não é liberada | unclaim não vale para mensagens (sem resposta dupla) | passa |

## Auditoria das regras R1–R6
| Regra | Status | Observação |
| --- | --- | --- |
| R1 | OK | URL só no client; template recusado; fail closed; vaga não devolvida; problema da tentativa 1 corrigido |
| R2 | N/A | Etapa 3 |
| R3 | OK | Logs sem telefone em claro (mascarado), hash no outbound_log |
| R4 | OK | Sem rede nos testes |
| R5 | OK | devDependencies sem libs proibidas |
| R6 | N/A | Etapa 4 |
Sem `skip`/`only` nos testes; sem texto "aguarde"; sem regressão das etapas 0 e 1.

## O que não foi bem implementado
Nada.

VEREDITO: APROVADO
