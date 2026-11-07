# Verificação — Etapa 8, tentativa 1

## Resultado de `npm ci && npm run verify`
Verde. typecheck e lint limpos; 25 arquivos, 351 testes passando (antes dos meus testes adversariais).

## Critérios de aceite
| Critério | Status | Evidência |
| --- | --- | --- |
| C8.1 (S1-S7 em verify) | OK | `tests/simulation.test.ts` roda os 7 cenários com `scripts/simulate.ts`, que usa a fiação real (`route` -> assinatura -> idempotência -> `createEventHandler` -> motor -> `sendGuarded`), Graph falsa por `fetchImpl`, relógio controlável. Asserções concretas (S1 950 envios, 1200 webhooks 200, 0 após corte; S2 =50; S3 4/1/3; S4 igual à entrega única; S5 0 envios até unlock; S6 zera às 00:00 SP; S7 =4). Sem skip/only/todo. |
| C8.2 (RELATORIO_FINAL) | OK | `docs/RELATORIO_FINAL.md` existe; números (4/1/3, 237 e 316 pessoas, 950, 80/160 webhooks, 20 áudios) conferem com as asserções dos testes. Tem tabela regra -> teste. |
| C8.3 (auditoria global) | OK | Ver tabela abaixo. |

## Testes adversariais escritos (`tests/adversarial/etapa-8/sim.adv.test.ts`)
| Teste | O que tenta quebrar | Resultado |
| --- | --- | --- |
| concorrência 400 pessoas em paralelo, margem 10 | reserva atômica / STOP_AT=990 | passou |
| status category "marketing" com billable:false | trava por categoria | passou |
| status legítimo (service, free) | falso positivo de trava | passou (não trava) |
| assinatura ausente/inválida | R3, 401 sem envio | passou |
| unlock com token errado | trava só abre por humano | passou |
| variações de "oi" + áudio sem cadastro + figurinha | anti-spam / R6 | passou (<=2 envios, 0 áudios guardados) |

## Auditoria das regras R1–R6 (todo o código)
| Regra | Status | Observação |
| --- | --- | --- |
| R1 URL única | OK | `graph.facebook.com` só em `src/whatsapp/client.ts` (envio :87 em sendGuarded; :169 é GET de mídia, não envio). `scripts/` não tem. |
| R1 sem template | OK | única ocorrência é a recusa (`client.ts:41`). |
| R1 envio só via sendGuarded | OK | `createEventHandler` passa `send` = sendGuarded; nenhum outro fetch de mensagem. `fetch` em src só em analyzer/supabase-repo/client. |
| R1 constantes/fail closed/janela/disjuntor | OK | cobertos por testes das Etapas 0-2 (passam) + S1, S5, S6. |
| R2 | OK | S2, S4, S7 e testes da Etapa 3; sem textos "aguarde/processando" além de comentário que os proíbe. |
| R3 | OK | logs usam `maskPhone` e só nomes de evento/tipo/erro; sem conteúdo. Único `.env` versionado é `.dev.vars.example`. |
| R4 | OK | simulador usa `*.invalid` e fetch falso; sem rede. |
| R5 | OK | package.json só tem devDependencies oficiais/ferramentas; nenhuma lib não oficial. |
| R6 | OK | adversarial: áudio sem cadastro não guarda; testes C4.x/C6.8 passam. |
| Regressão | OK | nenhum teste existente modificado (git: só arquivos novos em tests/); sem skip/only/todo. Refatoração de `index.ts` -> `src/webhook/events.ts` registrada em DECISOES.md. |

## O que não foi bem implementado
Nada. (Observação menor, não bloqueante: `analyzer_failed` loga `e.message`; hoje não contém conteúdo de usuário, mas convém monitorar.)

VEREDITO: APROVADO
