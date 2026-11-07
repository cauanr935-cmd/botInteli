# Verificação — Etapa 3, tentativa 1

## Resultado de `npm ci && npm run verify`
Verde: typecheck, lint e 15 arquivos / 207 testes passando (antes dos meus testes). Nenhum skip/only/todo em `tests/conversation.test.ts`.

## Critérios de aceite
| Critério | Status | Evidência |
| --- | --- | --- |
| C3.1 | OK | tests/conversation.test.ts "C3.1" (20 seguidas, rajada de 20, wamid repetido); adversarial: rajada paralela de 30 "oi" = 1 envio |
| C3.2 | OK | "C3.2" (2 envios); adversarial: 30 lixos paralelos = 1 dica |
| C3.3 | OK | tabela com >=40 casos (`it.each`) + normalizador; src/conversation/normalize.ts, synonyms.ts |
| C3.4 | OK | "C3.4" decide zera hint ao mudar de estado e fluxo completo |
| C3.5 | OK | "C3.5" decide e engine (10min, dia, ontem não conta); adversarial: sair/voltar x15 <= 4 envios |
| C3.6 | OK | "C3.6" figurinha/reação/imagem/vídeo/localização/contato = 0 envios; adversarial com button/list/sticker |
| C3.7 | OK | teste confere imports de machine/normalize/synonyms/texts; sem Date.now/fetch/etc. Conferi manualmente |
| C3.8 | OK | "C3.8" opt-out, só "voltar"; honrado mesmo com limite estourado |
| C3.9 | OK | varredura de `allBotTexts()` |

## Testes adversariais escritos
Arquivo: tests/adversarial/etapa-3/adv.test.ts (9 testes, todos passam)
| Teste | O que tenta quebrar | Resultado |
| --- | --- | --- |
| rajada paralela de 30 "oi" | condição de corrida / CAS de estado | 1 envio, OK |
| 30 lixos paralelos | dica única sob concorrência | 1 envio, OK |
| variações de saudação em paralelo | idem com variações | <=2, OK |
| sair/voltar em loop | limite de 10 min com entradas válidas | <=4, OK |
| sair com limite estourado | opt-out ignorado por limite | fica OPTED_OUT, OK |
| button/list/sticker em NEW/MENU/AWAIT_REGISTRATION | tipos inesperados | silêncio, OK |
| entradas esquisitas / body undefined | robustez do normalizador | sem exceção, OK |
| limite diário 11 vs 12 | off-by-one | OK |

## Auditoria das regras R1–R6
| Regra | Status | Observação |
| --- | --- | --- |
| R1 | OK | `graph.facebook.com` só em src/whatsapp/client.ts; engine envia só via `send` (sendGuarded); sem "template" além da recusa |
| R2 | OK | 1 resposta por entrada (`replies.slice(0,1)`), dica única, limites a partir de outbound_log, CAS por versão |
| R3 | OK | logs usam maskPhone, sem conteúdo de mensagem |
| R4 | OK | testes usam fetch simulado, MemoryRepo, PGlite |
| R5 | OK | sem libs não oficiais |
| R6 | OK (n/a nesta etapa) | cadastro é da Etapa 4 |

Regressão: testes das etapas anteriores seguem passando e presentes.

## O que não foi bem implementado
Nada.

VEREDITO: APROVADO
