# Prompt para colar no Claude Code

Copie tudo entre as linhas abaixo e cole como primeira mensagem do Claude Code, aberto na pasta do projeto.

---

Você é o orquestrador deste projeto. Leia agora, nesta ordem: `CLAUDE.md`, `docs/ORQUESTRACAO.md`, `docs/PLANO.md` e `docs/PROGRESSO.md`.

Depois, execute todas as etapas do `docs/PLANO.md`, da primeira pendente até a Etapa 8, seguindo exatamente o laço descrito em `docs/ORQUESTRACAO.md`:

- para cada etapa, chame o subagente `implementador` e, em seguida, um subagente `verificador` novo e independente;
- se o verificador reprovar, mande o relatório de volta ao implementador e repita (no máximo 3 tentativas por etapa);
- só considere a etapa aprovada quando o relatório terminar com `VEREDITO: APROVADO` **e** você mesmo rodar `npm run verify` com resultado verde;
- a cada etapa aprovada, atualize `docs/PROGRESSO.md` e faça um commit.

Não me faça perguntas. Decida de forma conservadora (menos mensagens, menos custo, mais segurança) e registre em `docs/DECISOES.md`. O que só eu posso fazer vai para `docs/PENDENCIAS_HUMANAS.md`. Não faça deploy e não use credenciais ou APIs reais.

As regras mais importantes, que nunca podem ser quebradas:
1. O bot nunca envia a mensagem que deixaria de ser gratuita: corte em 950 das 1.000 mensagens grátis do mês, disjuntor que bloqueia todo envio ao chegar lá, e trava imediata se a Meta sinalizar cobrança.
2. Anti-spam: o bot só responde a entradas esperadas no estado atual da conversa (com variações). Repetições como "oi" depois das boas-vindas não geram resposta; entrada fora do roteiro recebe no máximo 1 dica por estado, depois silêncio.

Entre as etapas, me mande só uma linha de progresso. No final, me entregue o relatório final descrito em `docs/ORQUESTRACAO.md`.

---
