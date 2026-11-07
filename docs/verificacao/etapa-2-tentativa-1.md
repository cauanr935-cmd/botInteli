# Verificação — Etapa 2, tentativa 1

## Resultado de `npm ci && npm run verify`
Verde: typecheck, lint e 99 testes (11 arquivos) passam. Meus testes adversariais ficam em `tests/adversarial/etapa-2/` e rodam no mesmo `vitest run`. Um deles falha (veja abaixo).

## Critérios de aceite
| Critério | Status | Evidência |
| --- | --- | --- |
| C2.1 | OK | `tests/architecture.test.ts` (inclui prova de que falharia com arquivo infrator) |
| C2.2 | OK | `budget-sql.test.ts` (PGlite, 950/951) e `client.test.ts` (Graph com zero chamadas depois) |
| C2.3 | OK (ressalva) | PGlite com 100 simultâneas = 10. PGlite usa uma conexão só, então a concorrência real vem da atomicidade do `UPDATE ... WHERE`, que está correta |
| C2.4 | OK | `monthKey` + SQL + `client.test.ts` (trava continua ligada na virada) |
| C2.5 | OK | `budget-http.test.ts` (billable, regular, utility; só o admin destrava) |
| C2.6 | OK | `client.test.ts` |
| C2.7 | OK | `client.test.ts` e meu teste de borda (23h30 exato envia, +1ms bloqueia) |
| C2.8 | OK | `client.test.ts` |
| C2.9 | OK | `client.test.ts` |
| C2.10 | OK | `budget-http.test.ts` |
| C2.11 | OK | `budget-http.test.ts` |
| C2.12 | OK | `client.test.ts` e `budget-sql.test.ts` |

## Testes adversariais escritos
| Arquivo > teste | O que tenta quebrar | Resultado |
| --- | --- | --- |
| adv.test.ts > janela 23h30 exata e +1ms | borda da janela | passa |
| adv.test.ts > lock ligado, 100 envios simultâneos | trava manual sob concorrência | passa |
| adv.test.ts > pricing parcial | status sem type/category | passa (liga a trava) |
| adv.test.ts > assinatura inválida em status | forjar status para travar ou destravar | passa (401, sem trava) |
| adv.test.ts > admin GET unlock, "bearer" minúsculo | rotas e método do admin | passa |
| adv.test.ts > SQL stop_at e lock | corte não sobe, lock com 100 simultâneas, stop_at=0 | passa |
| adv.test.ts > month_key virada de ano | fuso | passa |
| retry.test.ts > falha transitória ao ligar a trava | perda do sinal billable | **FALHA** |

## Auditoria das regras R1–R6
| Regra | Status | Observação |
| --- | --- | --- |
| R1 | Violada em ponto fraco | URL da Graph só em `client.ts`; template recusado; fail closed na reserva. Problema 1 abaixo |
| R2 | N/A | Etapa 3 |
| R3 | OK | Telefone nunca vai em log; hash do wa_id no `outbound_log`; admin com tempo constante |
| R4 | OK | Nenhum teste acessa a rede |
| R5 | OK | Nenhuma biblioteca proibida |
| R6 | N/A | Etapa 4 |

## O que não foi bem implementado
1. **O sinal "billable" se perde se a trava manual falhar ao ser ligada.** Onde: `src/webhook/handler.ts:39-52` junto com `src/budget/status.ts:19`. `processEvents` registra a chave de idempotência (`claimMessage`) antes de chamar `onEvent`. Se `setManualLock` lançar erro por uma falha transitória do banco, o erro só é logado e o webhook devolve 200. Quando a Meta reenvia o mesmo status, o evento é descartado como duplicado e a trava nunca é ligada. O teste `tests/adversarial/etapa-2/retry.test.ts` reproduz isso. Importa porque o objetivo de C2.5 é abrir o disjuntor sem falhar, e um blip de banco o deixa aberto no sentido errado, ou seja, o bot continua enviando mensagens possivelmente pagas. Como corrigir: tratar status com pricing pago sem depender do claim, ou liberar a chave com `unclaim` se `onEvent` lançar erro. Outra opção é aplicar `handleStatusEvent` antes do claim, já que ligar a trava é idempotente.

VEREDITO: REPROVADO
