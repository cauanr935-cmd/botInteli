# Kit do bot de WhatsApp para o Claude Code

Este pacote faz o Claude Code construir o bot sozinho, em 9 etapas. Cada etapa é escrita por um subagente (implementador) e conferida por outro, independente (verificador), que aprova ou reprova com a lista do que está errado. O próprio Claude Code orquestra o vai e volta: você cola um prompt e acompanha.

## O que tem aqui

| Arquivo | Para que serve |
| --- | --- |
| `PROMPT_INICIAL.md` | O único prompt que você cola no Claude Code. |
| `CLAUDE.md` | Regras do projeto, lidas automaticamente pelo Claude Code. Inclui as regras invioláveis de orçamento e anti-spam. |
| `docs/PLANO.md` | As 9 etapas, com critérios de aceite verificáveis. |
| `docs/ORQUESTRACAO.md` | Como o orquestrador conduz cada etapa (implementar → verificar → corrigir, até 3 tentativas). |
| `.claude/agents/implementador.md` | Subagente que escreve o código de uma etapa. |
| `.claude/agents/verificador.md` | Subagente que confere, tenta quebrar e dá o veredito. |
| `docs/PROGRESSO.md` | Status de cada etapa; permite retomar se a sessão cair. |
| `docs/DECISOES.md` | Decisões que os agentes tomarem sozinhos. |
| `docs/PENDENCIAS_HUMANAS.md` | O que só vocês podem fazer (contas, chip, credenciais). |

## Como usar

1. Descompacte o kit. Ele cria a pasta `bot-whatsapp-kit`, que será a pasta do projeto (pode renomear). A pasta `.claude` dentro dela é oculta; confira que ela veio junto.
2. Abra um terminal **dentro** dessa pasta e rode `claude`.
3. Cole o texto de `PROMPT_INICIAL.md`.
4. Acompanhe. Ele manda uma linha a cada etapa aprovada e um relatório no final.

Para não ter que aprovar cada ação: quando o Claude Code pedir permissão para `npm`, `npx` ou `git`, escolha a opção de sempre permitir. Também dá para iniciar com `claude --permission-mode acceptEdits`, que aceita edições de arquivo automaticamente.

**Se a sessão cair ou o limite de uso acabar:** abra o Claude Code de novo na mesma pasta e cole o mesmo prompt. Ele lê `docs/PROGRESSO.md` e continua da etapa pendente.

**Sobre o consumo:** o processo roda muitos subagentes (até 6 por etapa, se houver reprovações) e usa bastante do seu limite do Claude. É normal precisar de mais de uma sessão.

## As duas regras que você pediu

**1. Nunca passar do gratuito.** A Meta dá 1.000 mensagens grátis por número por mês. O código:
- conta cada mensagem **antes** de enviar, de forma atômica (sem risco de duas mensagens passarem juntas);
- corta em **950** (margem de 50, ajustável, mínimo 10);
- ao chegar no corte, abre um **disjuntor**: nenhuma mensagem sai até virar o mês;
- se a Meta sinalizar cobrança em qualquer mensagem, trava na hora e só destrava manualmente;
- não envia templates (nunca são grátis) nem mensagens fora da janela de 24h;
- se o banco falhar, não envia.

"Quebrar a aplicação" foi implementado como **parar de enviar**, não como derrubar o servidor. O servidor continua respondendo "OK" para a Meta. Se ele começasse a dar erro, a Meta reenviaria os eventos em loop e poderia desativar o webhook.

**Proteção extra:** enquanto a meta for custo zero, **não cadastrem cartão no Billing Hub da Meta**. Sem forma de pagamento, a própria Meta para de entregar depois da 1.000ª mensagem. Se um dia decidirem aceitar custo, aí sim cadastrem o cartão e revisem a regra R1 do `CLAUDE.md`.

**2. Anti-spam.** O bot só responde ao que espera no momento da conversa, aceitando variações ("oi", "Oiii", "olá!", "bom dia"; "sim", "s", "ok", "👍"). Se a pessoa manda "oi" de novo depois das boas-vindas, silêncio. Se manda algo fora do roteiro, recebe **uma** dica; depois disso, silêncio até responder o esperado. Há também limite por pessoa: 12 mensagens do bot por dia e 4 a cada 10 minutos.

## O que esperar no fim

- Código testado, com uma simulação de 300 pessoas provando que o bot para em 950 mensagens.
- `docs/DEPLOY.md` com o passo a passo para publicar.
- `docs/RELATORIO_FINAL.md` com quantas mensagens cada pessoa gasta e quantas pessoas cabem por mês. A meta do plano é 4 mensagens por pessoa nova (cadastro + 1 áudio), ou seja, cerca de 237 pessoas novas por mês.

## Antes de rodar, vale ajustar

- **Campos do cadastro:** estão como nome, e-mail e cidade em `docs/PLANO.md` (Etapa 4). Troque se já souberem quais são.
- **API do analisador de áudio:** o kit cria um adaptador genérico. Se já tiverem a documentação da API, coloquem um arquivo `docs/ANALISADOR.md` com o formato de envio e resposta antes de rodar, e o implementador vai usá-lo.
