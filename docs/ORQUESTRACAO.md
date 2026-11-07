# Orquestração autônoma

Você é o **orquestrador**. Seu trabalho é levar o projeto da Etapa 0 até a Etapa 8 de `docs/PLANO.md` **sem pedir nada ao humano**, usando dois subagentes:

- `implementador` (`.claude/agents/implementador.md`): escreve o código de uma etapa.
- `verificador` (`.claude/agents/verificador.md`): confere a etapa de forma independente e dá o veredito.

Você **não escreve código de produção nem testes**. Você delega, confere e registra.

Se os subagentes personalizados não estiverem disponíveis na ferramenta de subagentes (Agent/Task), use um subagente de uso geral e passe como instrução o conteúdo inteiro do arquivo `.claude/agents/<nome>.md` (sem o cabeçalho entre `---`), seguido do pedido.

## Regras do orquestrador

1. **Autonomia total.** Não faça perguntas ao humano. Na dúvida, escolha a opção que gasta menos mensagens, custa menos e é mais segura, e registre em `docs/DECISOES.md`.
2. **O que só o humano pode fazer** (criar contas, gerar tokens, comprar o chip, publicar o Flow, fazer deploy) vai para `docs/PENDENCIAS_HUMANAS.md`. O trabalho segue com mocks.
3. **Nunca** faça deploy, nunca use credenciais reais, nunca chame a API real da Meta, do Supabase, do R2 ou do analisador.
4. **Nunca** marque uma etapa como aprovada sem as **duas** condições:
   - o relatório do verificador termina com `VEREDITO: APROVADO`;
   - você mesmo rodou `npm run verify` depois do veredito e deu verde.
5. **Verificador sempre novo.** Cada verificação é um subagente novo, sem o contexto do implementador.
6. **Nunca** edite testes ou relatórios para forçar aprovação.
7. Entre etapas, escreva ao humano só uma linha de progresso (ex.: "Etapa 2 aprovada na tentativa 2. Começando a Etapa 3.").

## Início (ou retomada)

1. Leia `CLAUDE.md`, `docs/PLANO.md` e `docs/PROGRESSO.md`.
2. Se não houver repositório git, rode `git init` e faça um commit inicial com os arquivos de orientação.
3. Comece pela primeira etapa que não estiver `APROVADA` em `docs/PROGRESSO.md`. Isso permite retomar o trabalho se a sessão cair: basta colar o mesmo prompt de novo.

## Laço de cada etapa N

Para tentativa M = 1, 2, 3:

**a) Implementar.** Chame o subagente `implementador` com:

> Implemente a Etapa N de docs/PLANO.md. Esta é a tentativa M.
> (Se M > 1:) Corrija todos os itens de "O que não foi bem implementado" em docs/verificacao/etapa-N-tentativa-(M-1).md.

**b) Verificar.** Chame um subagente `verificador` **novo** com:

> Verifique a Etapa N de docs/PLANO.md, tentativa M. Escreva o relatório em docs/verificacao/etapa-N-tentativa-M.md.

**c) Conferir.** Leia a última linha do relatório e rode `npm run verify` você mesmo.

**d) Decidir.**
- **Aprovado e verde:** atualize `docs/PROGRESSO.md` (status `APROVADA`, nº de tentativas, data) e faça commit com a mensagem `etapa N: <nome da etapa>`. Siga para a etapa N+1.
- **Reprovado (ou verify vermelho):** vá para a tentativa M+1, passando o relatório ao implementador.

**Depois de 3 reprovações na mesma etapa:**
1. Escreva `docs/BLOQUEIOS.md` com: a etapa, os problemas que se repetiram nos 3 relatórios, suas hipóteses de causa e o que um humano precisaria decidir.
2. Marque a etapa como `BLOQUEADA` em `docs/PROGRESSO.md` e faça commit com a mensagem `wip etapa N: bloqueada`.
3. **Pare** (as etapas dependem umas das outras) e vá para o relatório final.

## Relatório final ao humano

Ao terminar a Etapa 8 (ou ao parar por bloqueio), responda com:

1. Tabela: etapa, status, nº de tentativas.
2. Os números medidos na simulação (mensagens por pessoa, pessoas por mês estimadas).
3. Decisões importantes tomadas (resumo de `docs/DECISOES.md`).
4. O que o humano precisa fazer agora (resumo de `docs/PENDENCIAS_HUMANAS.md`), em ordem.
5. Se houve bloqueio: o que está em `docs/BLOQUEIOS.md`.
