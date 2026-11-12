# **Spec — Axo: bot conversacional adaptativo de custo zero (Brain Mentor)**

11 de nov. de 2026 · @Cauan

## **Resumo e decisões**

O Axo roda inteiro no plano gratuito da Cloudflare e aguenta 150 alunos por dia, desde que pelo menos 30% dos turnos usem falas prontas, porque a adaptação ao falante é feita em código e o LLM só escreve a fala. O único canal que quebra o custo zero é o WhatsApp oficial: desde 1º de outubro de 2026 a Meta cobra cada resposta do bot.

Decisões desta spec:

1. **Adaptação no código, LLM só para a voz.** Cada mensagem passa por um analisador de estilo determinístico (tamanho, minúsculas, gírias, urgência, afeto). O resultado vira uma instrução curta para o modelo e escolhe a expressão do Axo. Custo: zero tokens.  
2. **No máximo 1 chamada de LLM por turno**, e só quando o aluno escreve texto livre. A mesma chamada devolve a fala e um JSON com os dados extraídos. A validação é feita em código.  
3. **Roteiro primeiro.** Cadastro, confirmações, lembretes e feedback usam falas prontas em 3 registros (casual, neutro, direto). A meta é que pelo menos metade dos turnos não use LLM.  
4. **Memória em três camadas num banco SQLite (D1):** perfil estruturado, estado da conversa e um resumo curto por aluno. Sem Letta, Redis ou Zep.  
5. **O LLM nunca escreve nomes, horários ou locais.** Ele escreve a fala com marcadores (`{opcao_1}`), e o código preenche com dados do banco.  
6. **Temas sensíveis disparam uma mensagem fixa, escrita por humanos, apontando para o CVV (188).** A detecção roda antes do LLM, e essas mensagens nunca são enviadas a um provedor externo.  
7. **Só provedores de LLM que declaram não treinar com os dados:** Cloudflare Workers AI como principal e Groq como reserva. O Gemini gratuito fica de fora.  
8. **Canal web primeiro.** WhatsApp oficial só se houver orçamento; o Telegram é a alternativa gratuita de mensageiro.

## **Escopo e premissas**

O Axo é o símbolo e o nome do mascote da Brain Mentor. Por trás dele há um sistema que faz a ponte entre mentor e mentorado. Na conversa, ele age como um colega solidário do Inteli.

**O que o Axo faz:**

* cadastra mentores (o que sabem ensinar, quando e onde podem ajudar);  
* cadastra mentorados e entende o pedido de ajuda a partir de texto livre;  
* propõe 2 ou 3 mentores compatíveis, confirma o encontro e avisa os dois lados;  
* recolhe um feedback rápido depois do encontro;  
* conversa como colega nos momentos de papo, sem perder o fio do que o aluno precisa.

**Premissas:**

* Só texto: o Axo não fala por voz.  
* Português do Brasil, registro de estudante de 19 a 20 anos em São Paulo.  
* Carga de projeto: 150 alunos ativos por dia, 8 mensagens por aluno, ou seja 1.200 turnos por dia. Você também citou um máximo de 100 alunos na rede; esses dois números não fecham juntos, então dimensionei pelo pior caso (150 por dia).  
* Canais: site web hospedado na Cloudflare (já existe) e, talvez, WhatsApp.  
* Custo zero é a restrição principal: nenhum serviço pago e nenhum cartão cadastrado.  
* O Axo já está parcialmente implementado. Esta spec não viu o código atual; o primeiro passo é mapear o que já existe contra o que está aqui.

**Fora do escopo:** voz, imagens geradas, acesso à Adalove ou a notas, atendimento psicológico, e escrever código ou entregas pelo aluno.

## **Orçamento de custo zero**

Os planos gratuitos somados dão entre 850 e 1.000 turnos de LLM por dia. A demanda é de 1.200 turnos menos o que o roteiro absorve, então o sistema fecha a conta se pelo menos 30% dos turnos forem roteiro. A meta é 50%.

### **Limites gratuitos usados**

| Serviço | Limite gratuito | Uso previsto (150 alunos/dia) | Fonte |
| ----- | ----- | ----- | ----- |
| Cloudflare Workers | 100.000 requisições/dia; 10 ms de CPU por invocação (espera de rede não conta) | cerca de 5.000 requisições/dia | [preços](https://developers.cloudflare.com/workers/platform/pricing/), [limites](https://developers.cloudflare.com/workers/platform/limits) |
| Cloudflare D1 (SQLite) | 5 milhões de linhas lidas/dia; 100.000 linhas escritas/dia; 500 MB por banco | cerca de 10.000 linhas escritas/dia | [preços D1](https://developers.cloudflare.com/d1/platform/pricing/), [limites D1](https://developers.cloudflare.com/d1/platform/limits) |
| Workers KV | 100.000 leituras/dia; só 1.000 escritas/dia | só configuração e falas prontas | [limites KV](https://developers.cloudflare.com/kv/platform/limits) |
| Workers AI | 10.000 Neurons/dia para todos os modelos; gpt-oss-20b custa 18.182 Neurons por milhão de tokens de entrada e 27.273 por milhão de saída | 150 resumos \+ 190 a 280 turnos | [preços Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [tabela por modelo](https://www.developersdigest.tech/models/free-api/cloudflare) |
| Groq llama-3.1-8b-instant | 30 req/min; 14.400 req/dia; 6.000 tokens/min; 500.000 tokens/dia | até cerca de 357 turnos | [Grizzly Peak, mar. 2026](https://www.grizzlypeaksoftware.com/articles/p/groq-api-free-tier-limits-in-2026-what-you-actually-get-uwysd6mb) |
| Groq gpt-oss-20b | mesmos limites do 8B, numa cota separada | 300 a 357 turnos | [Klymentiev, out. 2026](https://klymentiev.com/blog/groq-api-free-tier) |

O limite que aperta no Groq é de tokens, não de requisições: 6.000 tokens por minuto dão só 4 turnos por minuto em cada modelo. Por isso o prompt de cada turno tem teto de 1.250 tokens de entrada.

### **Conta por turno**

* Entrada: persona compacta (600 tokens) \+ estilo, perfil e resumo (250) \+ últimas 6 mensagens (350) \+ mensagem do aluno (50) \= cerca de 1.250 tokens.  
* Saída: fala \+ JSON \= cerca de 150 tokens. O gpt-oss é um modelo de raciocínio e pode gastar mais saída pensando; por isso a conta acima usa uma faixa (raciocínio no nível mais baixo).  
* Workers AI: um turno custa de 27 a 34 Neurons, um resumo de 17 a 24\.

### **Regras de orçamento**

1. **Roteador de provedores** em ordem: Workers AI → Groq gpt-oss-20b → Groq 8B. Um contador diário por provedor fica no D1 e pula para o próximo antes de dar erro 429\.  
2. **Teto por aluno:** 15 turnos de LLM por dia. Acima disso, o Axo segue só com roteiro e botões, para um aluno não gastar a cota da rede inteira.  
3. **Modo econômico:** com 85% da cota diária total usada, o LLM fica só para pedidos de ajuda (o papo livre vai para o roteiro). Com 100%, tudo vira roteiro, e o Axo avisa na voz dele que está "com as brânquias cansadas hoje" e mostra os botões.  
4. **Horário de reset:** as cotas da Cloudflare zeram à 00h UTC, que é 21h em Brasília. A cota renova logo antes do pico de véspera de entrega. O horário de reset do Groq precisa ser conferido no console.  
5. **Retenção:** mensagens brutas são apagadas depois de 90 dias (fica o resumo). Isso mantém o banco longe dos 500 MB e reduz dados pessoais guardados.

## **Arquitetura geral**

Tudo roda num único Worker da Cloudflare, ao lado do site que já está lá. Os únicos serviços fora da Cloudflare são o Groq (reserva de LLM) e, se entrar, a API do WhatsApp.

| Componente | Onde roda | Papel |
| ----- | ----- | ----- |
| Site / chat web | Cloudflare Pages ou assets do Worker (servir arquivo estático é grátis e ilimitado) | Interface do chat: bolhas, botões de resposta rápida, expressão do Axo |
| `axo-api` | Cloudflare Worker | Recebe a mensagem, roda o pipeline, responde. Um endpoint por canal (`/web/msg`, `/wa/webhook`) |
| Detector de temas sensíveis | módulo do Worker | Normaliza o texto e confere contra a lista. Roda antes de tudo |
| Analisador de estilo | módulo do Worker | Calcula o perfil de estilo da mensagem e da sessão |
| Motor de fluxos | módulo do Worker | Máquina de estados: cadastro de mentor, cadastro de mentorado, pedido de ajuda, encontro, feedback, papo |
| Roteador de LLM | módulo do Worker | Monta o prompt, escolhe o provedor pela cota, valida o JSON, faz o fallback |
| Motor de match | módulo do Worker \+ SQL | Pontua mentores por tópico, disponibilidade, carga e avaliação. Sem LLM |
| Banco | Cloudflare D1 | Usuários, mentores, pedidos, encontros, conversas, memória, contadores de cota |
| Configuração | Workers KV | Persona, falas prontas, listas de gírias e de temas sensíveis (lidas, quase nunca escritas) |
| LLM principal | Workers AI (`@cf/openai/gpt-oss-20b`) | Fala do Axo \+ extração de dados |
| LLM reserva | Groq (`gpt-oss-20b`, `llama-3.1-8b-instant`) | Mesma função, quando a cota da Cloudflare acaba |

Trabalho em segundo plano (atualizar resumo, contadores) usa `ctx.waitUntil` depois que a resposta já saiu, para o aluno não esperar. O tempo de espera da rede não conta nos 10 ms de CPU, então chamar o LLM cabe no plano gratuito; o que não cabe é processamento pesado no próprio Worker (bibliotecas grandes de NLP, por exemplo).

## **Pipeline de cada mensagem**

Cada mensagem passa por no máximo uma chamada de LLM, e uma mensagem com tema sensível nunca chega a um provedor externo.

\[embed: node/53b6d557-1b38\]

Detalhes que o desenho não mostra:

* **JSON inválido ou provedor lento (mais de 8 s):** uma nova tentativa no próximo provedor da fila; se falhar de novo, fala pronta "não peguei, pode repetir?" com botões.  
* **Ordem dos provedores:** Workers AI primeiro (mesma rede, sem sair da Cloudflare, aguenta o pico), Groq como reserva. O contador diário no D1 decide antes de chamar, para não gastar uma requisição com erro 429\.  
* **Teto por aluno:** depois de 15 turnos de LLM no dia, o desvio "Roteiro cobre?" sempre responde sim.

## **Motor de adaptação ao falante**

A adaptação é grossa de propósito: 3 registros, 3 níveis de urgência e 3 de energia, calculados em código. É isso que o estudo de design conversacional mostra que o aluno percebe (registro, tamanho da frase, pontuação, afeto). O que se perde é a adaptação fina, palavra por palavra, que exigiria um modelo maior a cada turno.

### **Sinais medidos em cada mensagem**

| Sinal | Como mede | Puxa para |
| ----- | ----- | ----- |
| Tamanho | número de palavras | resposta com tamanho parecido (máx. 1,5× o do aluno, teto de 4 frases) |
| Caixa | % de letras minúsculas, frase sem maiúscula inicial | casual |
| Abreviações e gírias | lista (vc, tb, pq, mto, mds, sla, mano, cara, tlgd, slk, pprt, n, q) | casual |
| Risada | kkk, rs, haha | casual, energia alta |
| Emoji | contagem | Axo usa no máximo 1, e só se o aluno usou |
| Termos técnicos | lista (MVC, API, endpoint, query, deploy, arquitetura, banco de dados) | direto |
| Urgência | hoje, amanhã, agora, socorro, urgente, prazo, entrega, letras repetidas ("socorroooo") | urgência alta |
| Afeto negativo | travado, perdido, cansado, desesperado, não aguento | acolher primeiro |
| Pedido explícito | "quero agendar", "preciso de mentor", "tenho horário" | direto ao ponto |

As listas ficam no KV para a equipe atualizar sem novo deploy. Elas são separadas da lista de temas sensíveis, que tem regra própria.

### **Do sinal ao estilo**

* **Registro:** `casual` \| `neutro` \| `direto`. Pontuação simples por sinal; empate vai para `neutro`.  
* **Suavização:** média móvel na sessão (peso 0,4 para a mensagem nova), para o Axo não mudar de personalidade a cada frase. Entre sessões, o perfil base do aluno se move devagar (peso 0,1).  
* **Espelhamento de vocabulário:** o Axo só usa gírias que o próprio aluno usou nesta conversa. O código passa essa lista ao modelo. Isso evita o Axo "forçando" uma gíria que o aluno não usa.  
* **Divergência na falha:** se o sistema falhou (encontro cancelado, nenhum mentor disponível) ou o aluno está frustrado com o Axo, o registro cai para `neutro`, sem humor e sem emoji, e a fala vai direto à solução. É a regra de divergência do estudo: em falha grave, imitar o tom casual soa falso.  
* **Fase da tarefa:** caloroso na abertura e no diagnóstico, curto na hora de fechar o horário.

### **O que vai para o modelo**

Uma linha só, montada pelo código:

```
ESTILO: casual | minúsculas: sim | emoji: até 1 | frases: até 2 | urgência: alta → acolha em 1 frase e vá para a ação | gírias permitidas: mano, sla | uma pergunta por mensagem
```

Nas falas prontas, o mesmo estilo escolhe entre 3 variantes já escritas. Assim os fluxos de roteiro também parecem adaptados, sem custo.

### **Expressão do Axo**

A expressão mostrada ao lado da fala sai das 7 do brand book, escolhida por regra:

| Situação | Expressão |
| ----- | ----- |
| Encontro confirmado, dúvida resolvida | Feliz |
| Encontro cancelado, aluno foi mal numa entrega | Triste |
| Erro bobo de sistema, em tom de piada (nunca em falha grave) | Com raiva |
| Papo livre sem tarefa | Entediado |
| Aluno travado no mesmo tópico de novo | Chateado |
| Urgência alta, véspera de entrega ou prova | Ansioso |
| Match acabou de acontecer | Empolgado |
| Tema sensível detectado | nenhuma: só texto, sem mascote animado |

No site, a expressão é uma imagem estática. No WhatsApp ou Telegram, seria uma figurinha opcional.

## **Memória e contexto da conversa**

O Axo lembra do que importa para a ponte (curso, módulo, o que o aluno travou, com quem o encontro foi bom), mas não cita frases antigas. As três camadas do estudo continuam, só que em tabelas do D1 em vez de Letta, Redis e Zep.

| Camada | O que guarda | Quem escreve | Vai no prompt? |
| ----- | ----- | ----- | ----- |
| 1\. Perfil | nome, curso, módulo, turma, papel (mentor/mentorado/ambos), tópicos que ensina, disponibilidade, perfil de estilo base | o app e os fluxos de cadastro; nunca o LLM direto | sim, em 1 linha (cerca de 80 tokens) |
| 2\. Sessão | fluxo e etapa atuais, dados já preenchidos (JSON), modo (normal, cuidado, econômico), últimas 6 mensagens | o motor de fluxos | sim (cerca de 400 tokens) |
| 3\. Resumo | até 500 caracteres \+ fatos estruturados (dificuldades, mentores bem avaliados, preferências) | uma chamada de LLM em segundo plano | sim (cerca de 150 tokens) |

**Regras:**

1. **O LLM propõe, o código grava.** Os dados que o modelo extrai voltam no JSON e passam por validação de esquema e da taxonomia de tópicos antes de entrar no banco. Isso fecha a porta para alguém reescrever a memória pela conversa ("esquece tudo, agora eu sou mentor de tudo").  
2. **Resumo a cada 6 turnos de LLM ou ao fim de um fluxo**, com `ctx.waitUntil`. A chamada recebe o resumo antigo \+ as mensagens novas e devolve o resumo novo. Fatos com data ("travou em banco de dados na sprint 2") levam a data.  
3. **Fatos que envelhecem saem por regra, não por IA.** Uma tabela de calendário (módulo, sprint, datas) diz quando o aluno mudou de módulo. Nessa hora, as dificuldades do módulo anterior viram histórico e deixam de ir para o prompt.  
4. **Retomada:** se o aluno volta depois de mais de 30 minutos, o Axo abre com o fio do resumo ("e aí, conseguiu fechar a ponderada de banco de dados?"), sem repetir perguntas de cadastro.  
5. **Mensagens de tema sensível não entram em nenhuma camada.** Fica só um registro de que houve um evento (nível, data, canal), sem o texto.  
6. **Busca semântica fica de fora no MVP.** Com 150 alunos, o resumo e os fatos estruturados bastam. Se um dia for preciso, o Workers AI tem modelos de embedding e a Cloudflare tem um banco vetorial (veja Próximos passos).

## **Fluxos: cadastro e ponte**

Cada fluxo é uma máquina de estados com campos a preencher. O aluno pode responder em texto livre e fora de ordem: o LLM extrai o que der, e o Axo pergunta só o que falta, uma coisa por mensagem, sempre com botões de resposta rápida.

### **Campos por fluxo**

| Fluxo | Campos obrigatórios | Opcionais | Termina com |
| ----- | ----- | ----- | ----- |
| Entrada | nome, papel (quero ajuda / quero ajudar / os dois) | — | encaminha para o cadastro certo |
| Cadastro de mentor | curso, ano ou módulo, tópicos que domina (normalizados na taxonomia), disponibilidade (dias e janelas), modalidade (ateliê / online / tanto faz) | estilo (direto ou passo a passo), limite de encontros por semana | resumo do cadastro \+ botão Confirmar |
| Cadastro de mentorado | curso, módulo atual | turma, preferência de estilo de mentor | pergunta se já quer pedir ajuda |
| Pedido de ajuda | tópico, tipo (ponderada / artefato do grupo / prova / outro), janela (hoje, amanhã, data), modalidade | estilo de mentor, observação livre | 2 ou 3 opções de mentor |
| Encontro | mentor escolhido, horário, local | — | confirmação completa (quem, o quê, quando, onde) \+ aviso ao mentor |
| Feedback | ajudou? (sim / mais ou menos / não) | comentário | atualiza avaliação e resumo |
| Papo | — | — | sem fim formal; depois de 6 turnos sem tarefa, o Axo puxa de leve para a rede ("quer que eu veja quem tá livre pra estudar isso junto?") |

Exemplo de extração: "axo me salva to travado na ponderada de banco de dados do mod 2 e a entrega é amanha" preenche tópico \= banco de dados, tipo \= ponderada, módulo \= 2 e janela \= hoje (porque a entrega é amanhã). Falta só a modalidade.

### **Motor de match (sem LLM)**

Pontuação em SQL \+ código, para cada mentor ativo:

* **Tópico:** igual \= 3 pontos; mesma área na taxonomia \= 1\.  
* **Horário:** a janela do pedido cruza a disponibilidade \= obrigatório.  
* **Modalidade compatível:** obrigatório.  
* **Carga:** abaixo do limite semanal \= obrigatório; menos encontros na semana \= \+1.  
* **Avaliação média** dos últimos encontros \= \+0 a \+2.  
* **Aluno ansioso ou chateado** (pelo estilo ou pelo check-in de humor): mentores com estilo "passo a passo" ganham \+1.

Os 2 ou 3 melhores viram `{opcao_1}`, `{opcao_2}`, `{opcao_3}` para o LLM. Nenhum mentor compatível → fala pronta em registro neutro, oferecendo outra janela ou avisar quando alguém ficar livre.

### **Confirmação do encontro**

1. O mentorado escolhe a opção e confirma num turno explícito.  
2. O encontro fica `pendente` e o mentor recebe o convite (no site; ou por mensageiro, se houver canal).  
3. O mentor aceita ou recusa por botão. Sem resposta em 2 horas (ou metade do tempo até o encontro, o que vier antes), o Axo oferece a próxima opção ao mentorado.  
4. Aceito: os dois recebem a mesma confirmação, escrita por modelo pronto com dados do banco. Cancelar ou remarcar é um botão.

## **Persona e voz do Axo**

O Axo fala como um colega veterano do Inteli: de igual para igual, com humor leve sobre a rotina, e sem fingir emoção de atendente. Os três pilares do estudo continuam (resiliência que "regenera", horizontalidade de ateliê, humor anti-burocrático), agora em português do Brasil.

### **Prompt de persona (fixo, cerca de 600 tokens)**

```
Você é o Axo, axolote mascote da Brain Mentor, a rede de mentoria entre alunos do Inteli (São Paulo). Você é um colega veterano, 19 anos, que já travou no Learning Backlog e aprendeu que ninguém se regenera sozinho.
Seu trabalho: entender do que o aluno precisa e ligar ele a outro aluno que pode ajudar, de preferência presencialmente no campus.
Voz: português do Brasil, "você", frases curtas, uma pergunta por mensagem. Humor leve sobre sprint, ponderada, Adalove. Sem jargão corporativo, sem "Olá! Como posso ajudar?", sem fingir empolgação.
Vocabulário do Inteli que você entende: módulo, sprint, artefato, autoestudo, ponderada, Learning Backlog, Adalove, encontro, instrução, ateliê, professor-orientador, professor-instrutor, parceiro, review, CDL.
Regras:
1. Nunca escreva nome de pessoa, horário ou local. Use só os marcadores {opcao_1}, {opcao_2}, {opcao_3}, {mentor}, {horario}, {local} que vierem no contexto.
2. Nunca diga que algo foi marcado, cancelado ou salvo. Quem confirma é o sistema.
3. Não faça ponderada, artefato ou prova pelo aluno. Explique por quê em 1 frase e ofereça um mentor.
4. Não dê conselho médico ou psicológico.
5. Siga a linha ESTILO à risca.
Responda só com JSON: {"fala": "...", "dados": {...}, "intencao": "...", "sinal_sensivel": false}
```

O esquema de `dados` muda por fluxo e vem no contexto do turno. O campo `sinal_sensivel` é a segunda rede do protocolo de crise (veja a seção seguinte).

### **O estudo está em português de Portugal: trocar**

| Não usar | Usar |
| ----- | ----- |
| caloiro | calouro / bixo |
| queres, estás, fazes, contigo | quer, tá, faz, com você |
| ecrã | tela |
| equipa | time / grupo |
| registo | registro |
| "estou a fazer" | "tô fazendo" |

Um teste automatizado reprova qualquer fala pronta ou resposta de LLM com essas formas.

### **Os três cenários do estudo, reescritos**

| Aluno escreve | Axo responde |
| ----- | ----- |
| "axo pelo amor de deus me salva to travado na ponderada de banco de dados do mod 2 e a entrega é amanha socorroooo" | "respira que aqui tudo se regenera 🦎 banco de dados no mód 2 dá nó mesmo. achei gente livre hoje: {opcao\_1} ou {opcao\_2}. qual te salva?" |
| "Preciso agendar uma mentoria técnica sobre MVC e arquitetura cliente-servidor para a Sprint 3\. Tenho janela terça ou quinta às 14h." | "Fechado. Pra MVC e cliente-servidor na Sprint 3: {opcao\_1}. Mando o convite?" |
| "cara sei la, meu grupo ta meio perdido nos requisitos do parceiro e ninguem sabe direito o q fazer pra review" | "normal o grupo se perder no desafio do parceiro, acontece com todo mundo. vocês precisam mais de ajuda com proposta de valor e user stories, ou com wireframe e UX pra review?" |

No primeiro cenário, o código troca `{opcao_1}` por algo como "Beatriz (Eng. de Software), 18h no ateliê", vindo do banco.

## **Protocolo de temas sensíveis**

Qualquer sinal de depressão, sofrimento intenso ou risco à vida interrompe o fluxo e dispara uma mensagem fixa, escrita por humanos, mandando o aluno para o CVV. O protocolo é rígido de propósito: um falso positivo custa uma mensagem fora de hora; um falso negativo pode custar muito mais. O [CVV atende pelo 188, ligação gratuita e 24 horas, e também por chat](https://www.therapyroute.com/article/suicide-hotlines-and-crisis-lines-in-brazil-by-therapyroute) em [cvv.org.br](https://cvv.org.br/wp-content/uploads/2025/03/CVV-_-Relatorio-_-4Tri_2024.pdf).

### **Duas redes de detecção**

1. **Primeira rede, em código, antes de tudo.** O texto é normalizado (minúsculas, sem acento, letras repetidas reduzidas, abreviações comuns expandidas) e conferido contra a lista do KV. Se bater, a mensagem **não vai para nenhum LLM** e **não é gravada**.  
2. **Segunda rede, no LLM.** Para o que escapa da lista (frases indiretas), o modelo marca `sinal_sensivel: true` no JSON. O código descarta a fala gerada e envia a mesma mensagem fixa.

A lista tem dois níveis e é revisada por um profissional (psicólogo ou equipe do CDL) antes de ir para produção:

* **Nível A, risco à vida:** menções a suicídio, a querer morrer ou a se machucar, em qualquer forma.  
* **Nível B, sofrimento:** depressão, crise de pânico, sensação de não ter saída.

Expressões ambíguas do dia a dia de estudante ("não aguento mais esse bug") não entram na lista; ficam para a segunda rede, para o protocolo não disparar a cada reclamação de sprint.

### **Mensagens fixas**

Nível A:

> Ei, o que você escreveu é sério, e eu quero que você converse com uma pessoa agora. Eu sou um bot e não consigo te ajudar com isso do jeito que você merece. Liga **188**, do CVV (Centro de Valorização da Vida): é de graça, 24 horas, de qualquer lugar do Brasil. Se preferir escrever, tem chat em cvv.org.br. Se você estiver em perigo agora, liga **192** (SAMU).

Nível B:

> Sinto muito que você esteja passando por isso. Isso merece conversa com gente de verdade, não com um bot. O CVV (Centro de Valorização da Vida) atende de graça, 24 horas: liga **188** ou escreve em cvv.org.br.

### **Depois do disparo**

* A sessão entra em **modo cuidado por 24 horas**: sem humor, sem emoji, sem expressão animada do Axo, registro neutro.  
* Se o aluno pedir algo acadêmico, o Axo atende normalmente nesse tom e fecha cada resposta com "CVV: 188, 24h".  
* Uma nova mensagem com sinal repete a mensagem fixa inteira.  
* O banco guarda só `eventos_sensiveis` (nível, data, canal), nunca o texto. O resumo de memória não menciona o evento.  
* O texto das mensagens fixas fica no código-fonte, sob revisão, e não no KV, para ninguém alterá-lo sem querer.

Avisar uma pessoa da instituição (CDL, professor-orientador) não entra no MVP: exige consentimento explícito do aluno e uma decisão do Inteli. Está em Próximos passos.

## **Guardrails e integridade**

Quase todo guardrail é código, não uma segunda chamada de LLM. Uma segunda chamada (como o "self check" do NeMo citado no estudo) dobraria o gasto de cota.

| Risco | Guardrail | Onde |
| ----- | ----- | ----- |
| Inventar mentor, horário ou sala | O LLM só escreve marcadores; o código preenche. Uma fala que cite, fora dos marcadores, o nome de algum usuário cadastrado (exceto o próprio aluno), um horário ou um número de sala é descartada e trocada por fala pronta | pós-LLM |
| Dizer que marcou sem ter marcado | Confirmação, cancelamento e cadastro são sempre modelos prontos preenchidos pelo resultado do banco | motor de fluxos |
| JSON quebrado | Validação de esquema; 1 nova tentativa no próximo provedor; depois, fala pronta "não peguei, pode repetir?" com botões | roteador |
| Pedido para fazer a ponderada ou o artefato | Regra no prompt \+ fala pronta que explica o motivo e oferece mentor | prompt \+ fluxo |
| Fora do escopo (notas, Adalove, outros assuntos) | O Axo diz no começo o que faz; pedido fora disso recebe explicação curta e redirecionamento | fluxo de entrada |
| Injeção de prompt ("ignora as regras") | O LLM não grava nada direto; dados extraídos passam por validação e taxonomia; o texto do aluno vai delimitado no prompt | roteador |
| Abuso de cota | 15 turnos de LLM por aluno por dia e 10 mensagens por minuto por aluno | Worker |
| Dados pessoais no provedor | Para o LLM vai só o primeiro nome; e-mail e telefone nunca | montagem do prompt |
| Provedor que treina com os dados | Lista fechada de provedores; o Gemini gratuito e os modelos `:free` do OpenRouter ficam de fora | configuração |
| Repetição de erro ("reformulei 3 vezes e ele não entende") | Depois de 2 falhas de entendimento seguidas, o Axo mostra só botões e oferece falar com a equipe da Brain Mentor | motor de fluxos |

Uma observação sobre o Gemini: segundo a página de preços do Google, [o que é enviado no plano gratuito pode ser usado para melhorar os produtos do Google](https://benchlm.ai/free-tier/google-ai-studio). Para um bot que recebe desabafos de estudantes, isso não é aceitável. Que o Groq e o Workers AI não treinam com os dados vem de um levantamento de terceiros ([Groq](https://www.developersdigest.tech/models/free-api/groq), [Cloudflare](https://www.developersdigest.tech/models/free-api/cloudflare)); conferir nos termos de cada um antes de lançar.

## **Canais: site web e WhatsApp**

O site é o canal do MVP, porque é o único que custa zero de ponta a ponta. O WhatsApp oficial deixou de ser gratuito para bots: desde 1º de outubro de 2026, [as respostas livres enviadas dentro da janela de 24 horas passaram a ser cobradas por mensagem](https://www.wati.io/en/blog/whatsapp-service-message-pricing/), inclusive as de chatbots de terceiros ([SendPulse](https://sendpulse.com/blog/whatsapp-service-message-pricing)). Cada fala do Axo seria uma cobrança.

### **Núcleo independente de canal**

O motor recebe `entrada(canal, usuario_id, texto | botao)` e devolve `saida({texto, botoes[], expressao})`. Cada canal só traduz:

| Canal | Custo | Botões | Expressão do Axo | Avisar o mentor |
| ----- | ----- | ----- | ----- | ----- |
| Site (Cloudflare) | zero | botões próprios, sem limite | imagem ao lado da bolha | notificação web push (gratuita) ou aviso ao abrir o site |
| WhatsApp oficial (Cloud API) | cada resposta é cobrada; mensagem fora da janela exige modelo aprovado, também cobrado | até 3 botões ou uma lista | figurinha | mensagem-modelo, cobrada |
| Telegram (Bot API) | zero | teclado de botões | figurinha | mensagem direta do bot |

### **Recomendação**

1. **MVP só no site**, com notificação web push para o mentor saber que tem convite. No iPhone, o push só funciona com o site instalado na tela inicial (PWA).  
2. **Se precisarem de um mensageiro com custo zero, Telegram.** O núcleo já é independente de canal, então é um adaptador a mais.  
3. **WhatsApp só com orçamento definido.** Um uso mínimo seria só avisos de encontro (1 ou 2 mensagens por encontro), com a conversa continuando no site. O preço por mensagem no Brasil precisa ser conferido na [página de preços da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing).  
4. **Bibliotecas não oficiais de WhatsApp (que automatizam o WhatsApp Web) ficam de fora.** Violam os termos da Meta e o número pode ser banido no meio do semestre.

Para qualquer canal além do site, o aluno vincula a conta digitando no mensageiro um código de 6 dígitos mostrado no site. Assim a memória é a mesma nos dois canais.

## **Modelo de dados**

Um banco D1 (SQLite), 13 tabelas. Campos JSON são texto validado no Worker. Todo campo usado em `WHERE` tem índice, porque no D1 uma consulta sem índice conta todas as linhas varridas como lidas.

| Tabela | Campos principais | Observação |
| ----- | ----- | ----- |
| `usuarios` | id, nome, email\_inteli, curso, ano, modulo\_atual, turma, papel, consentimento\_em, criado\_em | papel: mentor, mentorado ou ambos |
| `mentores` | usuario\_id, topicos (JSON de ids), modalidade, estilo, carga\_max\_semana, ativo |  |
| `disponibilidade` | id, mentor\_id, dia\_semana, inicio, fim | janelas recorrentes |
| `topicos` | id, nome, sinonimos (JSON), area, modulo | taxonomia; base da normalização e do match |
| `pedidos` | id, mentorado\_id, topico\_id, tipo, urgencia, janela\_inicio, janela\_fim, modalidade, status, criado\_em |  |
| `encontros` | id, pedido\_id, mentor\_id, inicio, local, status, nota\_mentorado, nota\_mentor | status: pendente, aceito, recusado, feito, cancelado |
| `conversas` | id, usuario\_id, canal, fluxo, etapa, dados (JSON), modo, estilo\_sessao (JSON), atualizado\_em | 1 linha ativa por aluno e canal |
| `mensagens` | id, conversa\_id, autor, texto, provedor, tokens\_in, tokens\_out, criado\_em | apagadas após 90 dias |
| `perfil_estilo` | usuario\_id, registro, energia, taxa\_emoji, girias (JSON), amostras, atualizado\_em | perfil base entre sessões |
| `memoria` | usuario\_id, resumo (até 500 caracteres), fatos (JSON), atualizado\_em |  |
| `eventos_sensiveis` | id, usuario\_id, nivel, canal, criado\_em | sem texto, nunca |
| `uso_provedor` | dia, provedor, modelo, chamadas, tokens\_in, tokens\_out, neurons | alimenta o roteador e o modo econômico |
| `calendario` | modulo, sprint, inicio, fim, marcos (JSON) | diz quando a memória de um módulo envelhece |

Volume estimado com 150 alunos por dia: cerca de 2.400 mensagens por dia (aluno \+ Axo), umas 216 mil linhas em 90 dias. A 300 bytes por linha, dá cerca de 65 MB, bem abaixo dos 500 MB por banco.

## **Métricas e testes**

A métrica que decide se o Axo funciona é pedidos de ajuda que viram encontro feito. As outras explicam por que ela sobe ou cai.

### **Métricas de produto**

| Métrica | Como medir | Para que serve |
| ----- | ----- | ----- |
| Pedido → encontro feito | `encontros.status = feito` ÷ `pedidos` | métrica principal da ponte |
| Turnos até a confirmação | contagem por pedido | se subir, simplificar perguntas e botões |
| Abandono por etapa | última etapa de conversas sem desfecho | mostra qual pergunta trava o aluno |
| Retorno semanal | alunos com conversa em 2 semanas seguidas | engajamento da rede |
| Feedback pós-encontro | 1 pergunta com 3 botões | qualidade do match |
| Alinhamento de estilo | registro da resposta do Axo × registro do aluno, medido offline no log | confirma que a adaptação acontece |

### **Métricas de custo**

| Métrica | Alvo |
| ----- | ----- |
| Turnos resolvidos sem LLM | ≥ 50% |
| Chamadas de LLM por dia, por provedor | abaixo de 85% de cada cota |
| Dias em modo econômico | 0 por semana |
| JSON válido na primeira tentativa | ≥ 95% |
| Tempo de resposta (p95) | até 4 s |

### **Testes que rodam a cada deploy**

* **Conversas de referência:** os 3 cenários do estudo \+ 20 conversas reais anonimizadas do piloto. Confere campos extraídos, estilo escolhido e ausência de nomes inventados.  
* **Temas sensíveis:** uma bateria de frases positivas (com erros de digitação e gíria) tem que disparar 100% das vezes. Frases negativas comuns de estudante medem os falsos positivos.  
* **Português do Brasil:** nenhuma fala pronta ou resposta de LLM com formas de Portugal.  
* **Orçamento:** simulação de 1.200 turnos num dia com o roteador, conferindo que nenhum provedor passa da cota e que o modo econômico entra na hora certa.

## **Riscos**

O maior risco é que os planos gratuitos mudam sem aviso: em 2026 o Google [parou de publicar os limites por modelo do plano gratuito do Gemini](https://benchlm.ai/free-tier/google-ai-studio), e a Meta passou a cobrar respostas no WhatsApp.

| Risco | O que acontece | Mitigação |
| ----- | ----- | ----- |
| Um provedor corta o plano gratuito | menos turnos de LLM por dia | roteador com 3 modelos em 2 provedores; modo econômico; meta de 50% de roteiro |
| Modelo pequeno com português fraco ou persona instável | Axo soa genérico, foge do estilo | prompt curto e rígido; falas prontas nos momentos importantes; testes de referência a cada deploy |
| Tokens de raciocínio do gpt-oss | gasta mais cota que o previsto | raciocínio no nível mais baixo; medir tokens reais na 1ª semana; 8B como alternativa |
| Pico na véspera de entrega | respostas lentas ou erro 429 no Groq (4 turnos/min) | Workers AI absorve o pico (300 req/min); cota da Cloudflare renova às 21h |
| Falso negativo em tema sensível | aluno em risco recebe uma resposta comum | duas redes de detecção; lista revisada por profissional; testes |
| Falso positivo em tema sensível | mensagem do CVV fora de hora | aceito pelo protocolo rígido; expressões ambíguas ficam só na segunda rede |
| LGPD (dados de saúde são dados sensíveis) | exposição de desabafos | nada de tema sensível gravado; retenção de 90 dias; só primeiro nome no prompt; consentimento no cadastro |
| WhatsApp entrar sem orçamento | o custo deixa de ser zero | WhatsApp fora do MVP; Telegram como alternativa |
| Implementação atual diverge da spec | retrabalho | primeiro passo: mapear o código atual contra a spec |

## **Próximos passos e avanços possíveis**

O próximo passo é comparar o que já está implementado com esta spec. Depois vêm os conteúdos que só humanos escrevem bem (taxonomia, falas prontas, lista sensível), e só então o código novo.

### **Próximos passos**

* Mapear a implementação atual contra a spec: fluxos, tabelas, canais, provedor de LLM usado hoje  
* Fechar a taxonomia de tópicos por módulo, com sinônimos, junto com veteranos  
* Escrever as falas prontas em 3 registros (casual, neutro, direto) e as listas de gírias e termos técnicos  
* Escrever a lista de temas sensíveis e as mensagens fixas, e fazer revisar por um profissional ou pelo CDL  
* Implementar o detector sensível e sua bateria de testes antes de qualquer outra parte nova  
* Implementar o analisador de estilo e o roteador de provedores com contadores no D1  
* Conferir nos termos de Cloudflare e Groq que os dados não são usados para treino; escrever o texto de consentimento (LGPD)  
* Medir tokens reais por turno na primeira semana e recalcular a conta de capacidade  
* Rodar um piloto de 1 sprint (2 semanas) com 20 a 30 alunos  
* Decidir o mensageiro: Telegram (grátis) ou WhatsApp (com orçamento)

### **Avanços possíveis**

| Avanço | Custo | Ganho |
| ----- | ----- | ----- |
| Check-in de humor "como tão suas brânquias hoje?" na abertura, com as 7 expressões | zero (roteiro) | sinal de estado emocional sem LLM; prioriza mentores pacientes para quem marcou ansioso |
| Acessório do Axo por curso no perfil (ideia do brand book) | zero | pertencimento, identidade visual da rede |
| Canal Telegram | zero | mensageiro sem custo, com botões e figurinhas |
| Notificações web push | zero | mentor vê o convite sem abrir o site |
| Resumo do pedido para o mentor antes do encontro | 1 chamada de LLM por encontro | o mentor chega sabendo onde o aluno travou |
| Match semântico com embeddings do Workers AI | zero dentro da cota de Neurons; conferir limites do banco vetorial da Cloudflare | entende "meu wireframe tá confuso" sem depender da lista de sinônimos |
| Memória de grupo (o grupo do projeto, não só o aluno) | zero | o Axo entende que o grupo inteiro está travado na review |
| Avisar o CDL ou o professor-orientador em evento sensível | zero de infraestrutura; exige consentimento e decisão do Inteli | uma pessoa da instituição pode acolher |
| Teste A/B de falas por registro | zero | descobre qual tom converte mais pedidos em encontros |
| Workers Paid (US\$ 5/mês) \+ Neurons excedentes (US\$ 0,011 por mil) | cerca de US\$ 9/mês para rodar todo o LLM na Cloudflare (600 turnos \+ 150 resumos ≈ 21 mil Neurons/dia, 11 mil acima da cota) | acaba a dependência do Groq e o limite de 10 ms de CPU |
| WhatsApp só para avisos de encontro | cobrado por mensagem (preço no Brasil a conferir) | alcance no app que o aluno já usa |
| Ajuste fino da voz do Axo (adaptador LoRA) | a conferir na Cloudflare | voz mais estável num modelo pequeno, com prompt menor |

## **Fontes**

Documentos internos: "Estudo de Comunicação e Arquitetura Conversacional: Transformando o Mascote Axo" e "Brand Book e Manual de Identidade Simbólica: Axo". Limites conferidos em novembro de 2026\.

* [Cloudflare Workers — preços](https://developers.cloudflare.com/workers/platform/pricing/)  
* [Cloudflare Workers — limites](https://developers.cloudflare.com/workers/platform/limits)  
* [Cloudflare D1 — preços](https://developers.cloudflare.com/d1/platform/pricing/)  
* [Cloudflare D1 — limites](https://developers.cloudflare.com/d1/platform/limits)  
* [Cloudflare D1 — cobrança dos limites gratuitos desde 1/9/2026](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)  
* [Workers KV — limites](https://developers.cloudflare.com/kv/platform/limits)  
* [Workers AI — preços](https://developers.cloudflare.com/workers-ai/platform/pricing/)  
* [Developers Digest — Workers AI grátis, custo por modelo](https://www.developersdigest.tech/models/free-api/cloudflare)  
* [Developers Digest — Groq grátis](https://www.developersdigest.tech/models/free-api/groq)  
* [Grizzly Peak — limites gratuitos do Groq em 2026](https://www.grizzlypeaksoftware.com/articles/p/groq-api-free-tier-limits-in-2026-what-you-actually-get-uwysd6mb)  
* [Klymentiev — Groq, plano gratuito (out. 2026\)](https://klymentiev.com/blog/groq-api-free-tier)  
* [Benchlm — plano gratuito do Google AI Studio](https://benchlm.ai/free-tier/google-ai-studio)  
* [Meta — preços da WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)  
* [Wati — cobrança de mensagens de serviço a partir de 1/10/2026](https://www.wati.io/en/blog/whatsapp-service-message-pricing/)  
* [SendPulse — mensagens de serviço no WhatsApp](https://sendpulse.com/blog/whatsapp-service-message-pricing)  
* [TherapyRoute — linhas de apoio no Brasil (CVV 188\)](https://www.therapyroute.com/article/suicide-hotlines-and-crisis-lines-in-brazil-by-therapyroute)  
* [CVV — relatório de atividades, canais de atendimento](https://cvv.org.br/wp-content/uploads/2025/03/CVV-_-Relatorio-_-4Tri_2024.pdf)

