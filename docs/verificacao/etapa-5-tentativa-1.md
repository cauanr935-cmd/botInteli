# Verificação — Etapa 5, tentativa 1

## Resultado de `npm ci && npm run verify`
Verde: typecheck, lint e 19 arquivos / 286 testes passando (sem os meus adversariais). Com `tests/adversarial/etapa-5/adv.test.ts`: 2 falhas (ver abaixo).

## Critérios de aceite
| Critério | Status | Evidência |
| --- | --- | --- |
| C5.1 | OK | tests/services.test.ts "C5.1 com 12 ativos..." + `prepareServices` (content.ts) + meu teste de ordenação/corte |
| C5.2 | OK | tests/services.test.ts C5.2 (5 testes); builders.ts valida todos os limites; confirmado por mim nos limites +1 |
| C5.3 | FALHOU | Escolha repetida de serviço SEM áudio responde de novo (machine.ts, ramo `list_reply`: `finish(user, user, [serviceAnswerReply...])`; estado não muda e `hintSentInState` não é usado). O teste "escolha repetida" só cobre o serviço COM áudio; não há teste que cubra a repetição do serviço sem áudio. |
| C5.4 | OK | tests/services.test.ts C5.4 (4 testes), `SESSION_IDLE_MS` em machine.ts |
| C5.5 | OK | tests/services.test.ts C5.5; `makeContent.text` com `hasOwnProperty` (resiste a `__proto__`/`toString`) |

## Testes adversariais escritos
| Arquivo > teste | O que tenta quebrar | Resultado |
| --- | --- | --- |
| etapa-5/adv.test.ts > escolha repetida sem áudio não responde de novo | R2 "repetição não gera resposta" | FALHOU (2ª resposta enviada) |
| > 4 toques repetidos gastam no máximo 1 mensagem | Gasto de orçamento por repetição (lista antiga continua tocável) | FALHOU (4 mensagens, até o limite de 10 min) |
| > construtores: limites exatos e +1 | botões >3, título botão >20, linhas >10, descrição >72 | OK |
| > prepareServices ordem/corte/warn | 15 serviços desordenados | OK |
| > cache com banco falhando | não consultar o banco a cada mensagem; não quebrar | OK |
| > chaves `toString`/`__proto__` em canned | fallback sem quebrar | OK |

## Auditoria das regras R1–R6
| Regra | Status | Observação |
| --- | --- | --- |
| R1 | OK | `graph.facebook.com` só em src/whatsapp/client.ts; "template" só na recusa; builders só montam corpo |
| R2 | VIOLADA | Repetição de escolha de serviço sem áudio gera nova resposta (ver problema 1) |
| R3 | OK | Sem segredos/telefone/conteúdo em log nas mudanças da etapa (logs só com ids de serviço/chaves) |
| R4 | OK | Testes usam mocks/MemoryRepo/PGlite |
| R5 | OK | package.json sem libs proibidas |
| R6 | OK | Sem mudança de cadastro; tabelas novas com RLS sem policy |

Sobre a alteração do C3.7: a ampliação da lista de imports (`../services/content`, `../services/menu`, `../whatsapp/builders`) é justificada em DECISOES.md e os três módulos são de fato puros (sem I/O, relógio, aleatoriedade; só importam tipos e `LIMITS`). A regex proibindo fetch/Date.now/process/console/crypto continua nos mesmos 4 arquivos. Não considero enfraquecimento relevante. Ressalva menor: o teste não varre os 3 arquivos novos por impureza; seria bom incluí-los na lista `pure`.

Sobre "escolha repetida de serviço sem áudio responde de novo": VIOLA R2 e o C5.3 ("escolha repetida ... → regras do anti-spam"). O argumento de que é "entrada válida no estado MENU" não procede: R2 diz explicitamente que repetição não gera resposta, e a lista antiga fica tocável, permitindo gastar mensagens (até 4/10 min e 12/dia por pessoa) com o mesmo toque. Também contradiz a decisão do projeto de, na dúvida, gastar menos mensagens.

## O que não foi bem implementado
1. **Repetição da mesma escolha de serviço sem áudio responde de novo** — onde: `src/conversation/machine.ts` (ramo `user.state === "MENU" && input.type === "list_reply"`, serviço sem áudio) e `docs/DECISOES.md` (decisão "Escolha repetida") — importa: viola R2/C5.3 e gasta orçamento — como corrigir: guardar o último serviço respondido (coluna nova em `users`, ex. `last_service_id`, zerada ao sair de MENU/ao pedir o menu de novo) ou usar um estado/flag equivalente ao `hintSentInState`; se a mesma linha chegar de novo sem o menu ter sido reaberto, silêncio. Adicionar teste na suíte de serviços para a repetição sem áudio (meu adversarial pode ser movido para lá).
2. **(Menor)** C3.7 não verifica pureza dos 3 novos módulos importados — incluir `content.ts`, `menu.ts`, `builders.ts` em `pure`.

VEREDITO: REPROVADO
