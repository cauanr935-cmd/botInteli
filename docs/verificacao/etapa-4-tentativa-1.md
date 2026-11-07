# Verificação — Etapa 4, tentativa 1

## Resultado de `npm ci && npm run verify`
Verde. typecheck e lint limpos; 17 arquivos, 242 testes passando (antes dos adversariais; com eles, mais 17).

## Critérios de aceite
| Critério | Status | Evidência |
| --- | --- | --- |
| C4.1 | OK | tests/registration.test.ts "C4.1" (2 envios: flow + lista; dados normalizados salvos); src/registration/decide.ts |
| C4.2 | OK | "C4.2" (1 + 3 envios, `FIELDS.length`); adversarial confirma com limites padrão 4/10min |
| C4.3 | OK | "C4.3" fallback e Flow (5 casos, dica única, nada salvo); adversarial: consent "false"/1/"on", 101 chars, nome numérico, "oi" como nome |
| C4.4 | OK | "C4.4" + CHECK `users_consent_before_data` na migração 0004 e regra equivalente no MemoryRepo; adversarial: dados digitados antes do aceite não são gravados retroativamente |
| C4.5 | OK | "C4.5" aplica 0001-0004 em PGlite, relrowsecurity=true em users, reaplicação idempotente, CHECK recusa dado sem consentimento |
| C4.6 | OK | "C4.6" confere campos de fields.ts, OptIn obrigatório com link, payload com `consent`, sem endpoint |
| C4.7 | OK | "C4.7" Flow e fallback: 1 mensagem (lista) |

## Testes adversariais escritos
Arquivo: tests/adversarial/etapa-4/adv.test.ts (17 testes, todos passam)
| Teste | O que tenta quebrar | Resultado |
| --- | --- | --- |
| nfm_reply sem "oi" antes | salvar cadastro fora do estado | nada salvo, nada enviado |
| nfm duplicado (mesmo wamid) e 6 em paralelo | idempotência / duplicar confirmação | 2 envios no total |
| 8 formulários inválidos | consent como string/número, limites, tipos | nada salvo |
| respostas antes do aceite | guardar dados sem consentimento (R6) | nada salvo |
| dica no meio com limites padrão | exceder 4 msgs/10min | <= 4 envios |
| "sair" no meio | responder/gravar após opt-out | silêncio, nada salvo |
| logs | telefone, e-mail, nome em log | limpo |
| falha ao gravar | confirmar sem salvar (fail closed) | não envia |

## Auditoria das regras R1–R6
| Regra | Status | Observação |
| --- | --- | --- |
| R1 | OK | `graph.facebook.com` só em src/whatsapp/client.ts; envio só via sendGuarded (Flow é `interactive`); template só na recusa |
| R2 | OK | resposta única por entrada; consentimento sem resposta (economia); dica única; sem "aguarde" |
| R3 | OK | logs mascarados; sem segredos; .env ignorados |
| R4 | OK | testes sem rede (fetch mockado) |
| R5 | OK | sem libs não oficiais |
| R6 | OK | consent_at/terms_version gravados antes dos dados; CHECK no banco; RLS ligado; termo cita PRIVACY_POLICY_URL no fallback |

Observações menores (não reprovam): com 1 dica no meio do fallback e limite padrão de 4/10min, a confirmação final pode ser silenciada pelo limite (o estado não avança; a pessoa retoma depois). O OptIn do Flow usa URL de exemplo, documentada em DECISOES/PENDENCIAS para o humano trocar. `wa_id` fica em texto protegido por RLS (aceito pelo plano).

## O que não foi bem implementado
Nada.

VEREDITO: APROVADO
