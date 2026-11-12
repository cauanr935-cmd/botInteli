# Mapeamento: specs.md (Axo) × código atual

Decisão (2026-11-11): manter Supabase + WhatsApp Cloud API e adicionar, em `src/axo/`, os módulos da spec que não dependem de banco nem de canal. Integração ao engine fica para a próxima etapa.

| Spec | Estado | Onde |
| --- | --- | --- |
| Detector de temas sensíveis (A/B, mensagens fixas CVV, modo cuidado, evento sem texto) | feito (lista inicial; **precisa de revisão profissional**) | `src/axo/sensitive.ts` |
| Analisador de estilo, suavização, linha ESTILO, expressões do Axo | feito | `src/axo/style.ts` |
| Roteador de provedores, cotas, modo econômico, teto por aluno, limite por minuto | feito (puro; contador `uso_provedor` ainda não existe) | `src/axo/router.ts` |
| Guardrails pós-LLM (marcadores, nomes, horários, salas, pt-PT, JSON, taxonomia) | feito | `src/axo/guardrails.ts` |
| Persona e montagem do prompt (teto 1.250 tokens) | feito | `src/axo/persona.ts` |
| Testes (cenários sensíveis, estilo, orçamento 1.200 turnos, pt-BR) | feito | `tests/axo.test.ts` |
| Integração no pipeline (sensível antes de tudo, 1 chamada de LLM por turno) | **pendente** | `src/conversation/engine.ts` |
| Workers AI como provedor principal (hoje: Groq/xAI só classificam intenção) | **pendente** | `src/ai/` |
| D1 (13 tabelas), KV, memória em 3 camadas, resumo em `waitUntil` | **pendente / conflita** (código usa Supabase) | `src/db/` |
| Canal web `/web/msg` + site do Axo | **pendente** (existe simulador `/chat`) | `src/sim/` |
| Motor de match, fluxos de mentor/pedido/encontro/feedback | parcial (mentoria v2 existe com modelo próprio) | `src/mentoria/` |
| Falas prontas em 3 registros, taxonomia de tópicos, lista sensível revisada | **pendente (conteúdo humano)** | — |

Conflitos a decidir com o humano: D1 × Supabase; WhatsApp fora do MVP (spec) × produto atual; LLM que escreve a fala (spec) × IA que só classifica (CLAUDE.md).
