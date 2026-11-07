# Verificação — Etapa 0, tentativa 1

## Resultado de `npm ci && npm run verify`
Verde: typecheck, lint e 26 testes (4 arquivos) passam. Com meu teste adversarial: 1 falha (abaixo).

## Critérios de aceite
| Critério | Status | Evidência |
| --- | --- | --- |
| C0.1 | OK | npm ci + verify verdes |
| C0.2 | OK | tsconfig.json `strict: true`; eslint sem erros |
| C0.3 | OK (com ressalva) | tests/config.test.ts: ausentes (cada variável), margem <10, não numérica. Ressalva: margem >= 1000 aceita (ver problema 1) |
| C0.4 | OK | tests/config.test.ts "C0.4"; constante em src/config.ts:2 |
| C0.5 | OK | tests/logger.test.ts + meu teste adversarial |
| C0.6 | OK | tests/repo-hygiene.test.ts; sem libs proibidas; .gitignore correto; sem .dev.vars |
| C0.7 | OK | tests/index.test.ts; adversarial (POST /health, /health/x, /) → 404 |

## Testes adversariais escritos
| Arquivo > teste | O que tenta quebrar | Resultado |
| --- | --- | --- |
| tests/adversarial/etapa-0/adv.test.ts > margem absurda | BUDGET_SAFETY_MARGIN=1000/5000 | FALHOU: config aceita, STOP_AT = 0 / -4000 |
| idem > espaços / limites 0 | variável só com espaços; limite 0 | passou |
| idem > máscara | formatos com +, parênteses, curto | passou |
| idem > rotas | POST /health, /health/x, / | passou |

## Auditoria das regras R1–R6
| Regra | Status | Observação |
| --- | --- | --- |
| R1 | Parcial | constante e margem mínima ok; falta limite superior da margem (STOP_AT deve ser > 0) |
| R2 | N/A | |
| R3 | OK | sem segredos; logger não registra telefone sem máscara (nenhum uso ainda) |
| R4 | OK | nenhum teste usa rede; nenhum `fetch`/graph.facebook em src |
| R5 | OK | só devDependencies oficiais |
| R6 | N/A | |

## O que não foi bem implementado
1. **Margem >= 1000 aceita, gerando STOP_AT <= 0 (ou negativo)** — onde: `src/config.ts` (cálculo de `stopAt` e `parseInteger` da margem) — por que importa: config absurda sobe silenciosamente com disjuntor inoperante/contador inválido (STOP_AT negativo pode quebrar a função SQL das próximas etapas); R1 pede recusar config insegura. — como corrigir: recusar quando `stopAt < 1` (ou impor margem máxima, ex. <= 500) com mensagem clara, e adicionar teste em tests/config.test.ts.
2. (menor) Logger não mascara automaticamente campos de telefone; depende de quem chama. Aceitável nesta etapa.

VEREDITO: REPROVADO
