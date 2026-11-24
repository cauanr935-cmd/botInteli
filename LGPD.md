# LGPD: dossiê para revisão jurídica

**Este documento não é parecer jurídico.** É o levantamento técnico de como o serviço trata dados pessoais, para um advogado revisar. A coordenação do Inteli lembrou, em 17/11/2026, que a responsabilidade pelo serviço é da Be My Mentor.

Versão de **20/11/2026**; atualize a cada mudança no fluxo.

**Fontes:**
- **Notebook:** o código do Transcritor.
- **Bot:**
  - o código publicado no GitHub (`cauanr935-cmd/botInteli`, último commit em 12/11/2026);
  - os relatórios do agente que mantém o bot (18/11/2026), sobre mudanças já em produção que **ainda não estão no GitHub** (achado 10).
- **Pesquisa "LGPD e o pool de talentos"** (claude.ai, 20/11/2026, não conferida e não é parecer): avaliada ponto a ponto na seção 11. Os fatos que não pude conferir aparecem como "segundo a pesquisa".

## 1. O serviço em uma frase

A **Be My Mentor**:
- conecta estudantes para mentorias;
- recebe a gravação de cada sessão;
- transcreve e analisa a gravação contra critérios;
- tem uma equipe que faz o **check final de toda sessão** e revisa os casos duvidosos;
- avisa os dois participantes pelo WhatsApp com os minutos contabilizados e o saldo;
- emite um certificado de horas que o próprio estudante submete à sua instituição de ensino.

A instituição não recebe dados da Be My Mentor, só o certificado que o aluno leva.

## 2. Papéis

- **Controladora:** **BE MY MENTOR INOVA SIMPLES (I.S.)**, CNPJ **70.237.372/0001-11** (informado em 20/11/2026).
  - Regime: **Inova Simples** (LC 123/2006, art. 65-A, incluído pela LC 167/2019), o regime simplificado para empresas de inovação.
  - Atividade principal: CNAE **8550-3/02**, atividades de apoio à educação. Cobre a validação das mentorias e o certificado.
  - Atividade secundária: CNAE **6311-9/00**, tratamento de dados, provedores de serviços de aplicação e hospedagem na internet. Cobre o bot, a transcrição e a análise.
  - **Falta preencher:** endereço, e-mail de contato e encarregado (ou canal), na política do bot (achado 1) e em `regras/certificado.toml` (`razao_social`, `cnpj`).
- **A instituição de ensino, no piloto, não é controladora nem operadora:**
  - não recebe dados da Be My Mentor;
  - não dá instruções sobre o tratamento;
  - só recebe o certificado que o próprio aluno leva.

  Por isso não há acordo de tratamento com o Inteli. Isso muda se uma instituição contratar o serviço (seção 9).
- **Operadores (fornecedores):**

| Fornecedor | O que faz | Dados | País (verificar) |
|---|---|---|---|
| Cloudflare (Workers, R2) | bot e armazenamento das gravações | mensagens, áudios de mentoria e de perfil, materiais | EUA / global |
| Supabase | banco do bot | cadastro, consentimento, mentorias, resumo e curadoria, pedidos de revisão | conforme a região do projeto |
| **Servidor da Evolution API** (canal do WhatsApp desde 12/11/2026) | ponte entre o bot e o WhatsApp, via Baileys | telefone, mensagens, arquivos | **onde está hospedado? verificar** |
| WhatsApp (Meta) | rede onde as mensagens circulam | telefone, mensagens, arquivos | EUA |
| Groq / xAI (LLM do bot) | classificar intenções, ler horários, resumir o assunto | textos digitados (dúvida, horários, nome digitado) | EUA |
| OpenTimestamps (calendários públicos) | carimbo de tempo | **só hashes**, nenhum dado pessoal | global |
| GitHub Pages | página pública de verificação | credencial pública v3 (sem nome, código do participante nem lista de sessões) | EUA |

**Não são operadores:** a transcrição, a análise por IA (modelo local Qwen) e a emissão rodam **em equipamento próprio** (notebook). A gravação e a transcrição não vão para nenhum serviço de IA de terceiros.

## 3. Mapa dos dados

| Dado | Onde | Para quê | Prazo (proposto) |
|---|---|---|---|
| Telefone (WhatsApp) | bot (Supabase), servidor da Evolution | contato e identificação no bot | enquanto houver conta + 12 meses |
| Pseudônimo (`pessoa_id` = HMAC do telefone com segredo) | bot, notebook (livro, `pessoas.csv`), resumos | ligar sessões, saldo e conduta da mesma pessoa sem expor o telefone | enquanto houver dados da pessoa |
| Nome, turma, perfil, disponibilidade | bot | matching e certificado | conta + 12 meses |
| Consentimento (data e versão dos termos) | bot | prova do aceite | 5 anos |
| **Áudio de perfil** (time, hobbies, data de nascimento, em voz) | R2, `audios/informacoes/` | matching por pontos de similaridade (**finalidade ainda não implementada**) | **indefinido**: hoje é guardado e ninguém o processa |
| Gravação da sessão (voz dos dois) | R2 (`audios/mentorias/`); depois o notebook | transcrever e validar | R2: deveria ser apagada após o download, mas a rota `audio-recebido` **ainda não existe**, então hoje fica no R2 sem prazo (proposta: teto de 72 h, achado 11); notebook: `mentorias limpar` apaga 30 dias depois de a sessão estar decidida, exceto se houver caso de conduta aberto |
| Transcrição e parecer | notebook | validar a sessão; curadoria; contestação | a política do bot diz 5 anos, **sem justificativa**. Proposta: 12 meses depois da decisão, ou mais enquanto houver contestação ou caso de conduta aberto. O certificado não depende da transcrição: ele carrega os hashes. |
| Sessão registrada sem análise | notebook (livro) e bot (resumo `sem_analise`) | testes ou sessões que a equipe avaliou por outro meio | idem |
| Embeddings de voz | só na memória durante o processamento | separar quem fala dentro da sessão | não são gravados (conferido no código, 18/11/2026) |
| Livro de registro | notebook | trilha auditável: sessões, decisões da curadoria, certificados, conduta | permanente; só pseudônimos, hashes e números |
| `pessoas.csv` (pseudônimo → nome) | notebook | imprimir o nome no certificado | até a eliminação |
| Resumo da análise e **curadoria** (status, minutos e saldo por `pessoa_id`) | bot (`analysis_result`) | mostrar o resultado e avisar os participantes | junto com a mentoria no bot |
| **Avisos enviados** (`notified_curadoria`) e **pedidos de revisão** (`revisao_pedidos`) | bot | não avisar duas vezes; atender o pedido de revisão humana (art. 20) | junto com a mentoria |
| Certificado completo (nome, código BMM, sessões, observações da curadoria) | notebook e com o titular | comprovante | enquanto verificável; apagado na eliminação |
| Certificado público (v3: sem nome, código do participante nem lista de sessões; só horas, período, emissor e status) | GitHub Pages | verificação por terceiros | enquanto verificável |

## 4. Bases legais (proposta, a validar)

- **Cadastro, matching, gravação, transcrição, análise e certificado:** execução de contrato ou procedimentos preliminares (art. 7º, V) com quem se cadastra. A política atual também cita consentimento (art. 7º, I).
- **Áudio de perfil:** a política cita consentimento (art. 7º, I). Só se sustenta com uma finalidade em uso (achado 7).
- **A outra pessoa gravada:** ela também é cadastrada e **confirma a mentoria e aceita os termos antes da análise**. Sem confirmação, a gravação não chega ao notebook; o bot apaga em 7 dias quem não responde ou recusa.
- **Terceiros citados na conversa:** pessoas que não participam podem ser mencionadas pelo nome na gravação, às vezes com dado de saúde ou religião.
  - Base: legítimo interesse (art. 7º, IX), com teste de balanceamento.
  - Minimização:
    - a transcrição fica só no notebook;
    - não vai ao bot (o resumo não tem texto, trechos nem nomes);
    - não é usada para outra finalidade;
    - tem prazo (seção 3).
  - A transcrição **não é redigida**: ela precisa ser literal para a análise e para a contestação. Se surgir dado sensível de terceiro, a equipe não o usa e o prazo curto o elimina.
- **Antifraude e conduta:** legítimo interesse (art. 7º, IX), com teste de balanceamento documentado. O guia da ANPD diz que essa base **não serve para dado sensível**.
- **Registro do aceite e trilha de auditoria:** cumprimento de obrigação legal e exercício regular de direitos (art. 7º, II e VI).

## 5. Voz: dado biométrico?

- A ANPD (Radar Tecnológico: Biometria, 2024) inclui a voz entre as características biométricas. Dado biométrico ligado a uma pessoa é **sensível** (art. 5º, II) e exige as bases do art. 11.
- **O que fazemos:**
  - a voz é usada só para **separar falantes dentro de uma sessão** (diarização);
  - os nomes vêm do cadastro e da autoapresentação dita na gravação, não de comparação com perfis de voz;
  - não há perfil de voz guardado nem comparação entre sessões;
  - os embeddings existem só na memória.
- **Exceção:** a opção `--reference` do transcritor usa amostras de voz fornecidas para reconhecer pessoas. Ela é **identificação biométrica** e não é usada no fluxo do bot. Só deve ser usada com consentimento específico e destacado (art. 11, I).
- **Áudios de perfil:** hoje ninguém os processa. Se a extração vier a comparar vozes, ela vira biometria.
- **Sem regra da ANPD:** a biometria segue em desenvolvimento na Agenda Regulatória (balanço de ago/2026, segundo a pesquisa).
  - Na tomada de subsídios (NT 23/2025), contribuintes disseram que a gravação de voz "não é biométrica por si só, mas pode se tornar" quando usada para extrair características identificadoras.
  - Isso **não é posição da ANPD**. Tratar a voz como não biométrica é apostar numa lacuna que pode fechar.
- **Com precisão:** a diarização compara vozes **dentro da sessão** para agrupar as falas de cada pessoa. Isso distingue falantes, mas não os identifica: quem é quem vem do texto.
- **Pergunta ao advogado:** a diarização sem perfil afasta o enquadramento como tratamento biométrico para identificação? Se não afastar, qual base (art. 11, I, com consentimento destacado no termo)?

## 6. Outros pontos de atenção

- **Menores de 18 anos:** calouros podem ter 17 anos, e a data de nascimento já é coletada no áudio de perfil. O Enunciado CD/ANPD nº 1/2023 admite as bases dos arts. 7º e 11, com o melhor interesse do menor. Decidir entre consentimento do responsável e bloqueio no cadastro. Avaliar também o **ECA Digital** (Lei 15.211/2025, em vigor desde 17/03/2026, segundo a pesquisa), que trata de serviços digitais de "acesso provável" por adolescentes.
- **Transferência internacional (art. 33):** a Res. CD/ANPD 19/2024 exige as cláusulas-padrão da ANPD sem alteração desde 23/08/2025, e a política do bot hoje cita o consentimento (art. 33, VIII). Conferir os contratos (DPAs) de Cloudflare, Supabase, Groq/xAI e do servidor da Evolution, e publicar o aviso de transferência.
- **Decisões automatizadas (art. 20):**
  - **toda** sessão aprovada passa pelo check final da equipe (`mentorias decidir`) antes de contar horas, inclusive a que o analisador recomendou;
  - toda sanção por conduta é decidida por humanos, com prazo de defesa (10 dias);
  - a sessão que não cumpre os critérios objetivos (duração, fala, dois participantes) é descartada automaticamente;
  - nesse caso a pessoa recebe pelo WhatsApp a mensagem de recusa com o botão **[Pedir revisão]** (implementado no bot em 18/11, segundo o relatório). A equipe atende pelo notebook com `mentorias decidir --forcar`.
  - **O que a lei exige:** o §3º do art. 20, que garantia revisão por pessoa natural, foi vetado (Lei 13.853/2019), e o art. 20 ainda não foi regulamentado. Mesmo assim, a revisão humana é a prática segura.
  - **Por que a recusa objetiva continua automática** (decisão de 20/11/2026):
    - os critérios são verificáveis por qualquer um (duração, fala, dois participantes);
    - a mensagem diz o motivo;
    - um toque leva o caso a um humano.
  - Nenhuma hora é concedida sem humano.
- **Avisos aos participantes:** depois do check, o bot avisa cada participante com os minutos contabilizados e o saldo. Esses avisos levam só a data da sessão e números, sem nome nem telefone de ninguém.
- **Conduta (proposta de cláusula para os termos):** na 1ª fraude confirmada, a pessoa perde a sessão e recebe advertência; na 2ª, é banida. Certificados com sessão fraudulenta são revogados, e a lista pública mostra só "revogado", sem motivo pessoal.
- **Incidentes:** comunicação à ANPD e aos titulares em até 3 dias úteis (Res. CD/ANPD 15/2024). O prazo dobra para pequeno porte, mas não conte com isso (veja "Encarregado"). Falta o plano escrito.
- **Encarregado (DPO):** agentes de pequeno porte são dispensados (Res. CD/ANPD 2/2022, art. 11), mas precisam de um canal de contato.
  - **Pelo porte**, a Be My Mentor (Inova Simples, startup) se enquadra.
  - **Pelo risco, provavelmente não.** A dispensa não vale para tratamento de alto risco, que é um critério geral mais um específico:
    - geral: afetar significativamente interesses e direitos (aqui, horas que o aluno usa para se formar);
    - específico: tecnologia emergente (LLM), possível dado sensível (voz), possíveis menores.
  - **O ônus da prova é do agente:** na primeira multa da ANPD (Telekall, 2023), a microempresa foi punida por "não comprovar que não fazia tratamento de alto risco".
  - **Recomendação:** indicar um encarregado por **ato formal**, com as formas de atuação e as atividades (Res. CD/ANPD 18/2024, art. 3º), e publicar o contato na política do bot.
  - **Pergunta ao advogado:** confirmar o enquadramento como alto risco.
- **RIPD (art. 38):** recomendado desde já, por causa da biometria e da IA. Rascunho na seção 8.
  - O RIPD ainda não foi regulamentado, mas a ANPD o exige na prática.
- **Documentar é prioridade:** a falta de prova de conformidade é infração por si (art. 6º, X, responsabilização e prestação de contas). Segundo a pesquisa, três das cinco multas ao TikTok (ago/2026) se basearam só em princípios. Primeiro ROPA, RIPD, teste de balanceamento e plano de incidentes (seção 10).

## 7. Achados no bot e no notebook

| # | Achado | Situação em 20/11/2026 |
|---|---|---|
| 1 | **Política em rascunho:** controlador, documento, endereço, e-mail e encarregado vazios (`LEGAL_INFO` em `src/legal/page.ts`). | **Pendente** (GitHub). O CNPJ já existe (seção 2): falta preencher razão social, CNPJ, endereço, e-mail e encarregado ou canal. |
| 2 | **Texto errado sobre compartilhamento:** a política diz que a instituição recebe "quem participou, quando e a transcrição". O certo é "você recebe um certificado e decide submetê-lo à sua instituição; gravação, transcrição e análise ficam com a equipe". | **Pendente** (GitHub). |
| 3 | **Pseudônimo fraco:** `wa_id_hash` era SHA-256 do telefone sem chave, revertido por força bruta. | **Resolvido em produção** (relatório de 18/11): HMAC com `PESSOA_ID_SECRET`, exposto como `pessoa_id`; banco zerado antes da troca. **Não aparece no GitHub** (achado 10). O segredo precisa de backup fora da Cloudflare e nunca pode ser trocado sem migração. |
| 4 | **Canal não oficial:** desde 12/11 o bot usa a Evolution API (Baileys), biblioteca não oficial do WhatsApp. Há risco de bloqueio do número e de violação dos termos da Meta, contra a regra original do bot. A política ainda cita "Meta/WhatsApp" como operador, sem mencionar o servidor da Evolution. | **Pendente:** avaliar com o advogado; voltar à Cloud API oficial ou declarar o servidor como operador. |
| 5 | **Específico do Inteli:** turma "do Inteli" e persona "alunos do Inteli". | Pendente (pedido de 18/11). |
| 6 | **Eliminação:** não há rota para o bot repassar o `pessoa_id` ao notebook. O notebook já tem `mentorias pessoa-eliminar`. | Pendente. |
| 7 | **Áudios de perfil sem uso:** `audios/informacoes/` (time, hobbies, data de nascimento) é guardado e ninguém processa; a API só entrega mentorias ao notebook. Guardar dado pessoal sem finalidade em uso fere os princípios de finalidade e necessidade (art. 6º, I e III). Antes de continuar coletando, definir onde a extração roda, o que extrai (descartar religião, política e saúde, art. 5º, II) e quando apaga. | **Registrado como decisão pendente** no bot (`docs/PENDENCIAS_HUMANAS.md`, 18/11), incluindo se a coleta continua. |
| 8 | **Áudios órfãos no R2:** a limpeza do banco em 18/11 deixou no bucket arquivos sem registro (`audios/<hash>/…`, formato antigo, com o hash reversível no caminho). Nenhuma rotina os vê nem apaga. | **Pendente com humano:** apagar pelo painel da Cloudflare (prefixo `audios/`) e criar uma checagem periódica de órfãos. |
| 9 | **Telefone no caminho do bucket.** | Os objetos novos usam o pseudônimo com HMAC (relatório de 18/11). Os antigos somem com o achado 8. |
| 10 | **Código em produção fora do GitHub:** o último commit publicado é de 12/11, mas o Worker em produção já tem HMAC, pastas separadas, curadoria e pedidos de revisão (commits locais, como o `78336f8`, no computador do cofounder). Sem o código no repositório remoto, não há cópia de segurança nem trilha de auditoria do que roda com dados pessoais. | **Pendente:** fazer o push e manter produção = repositório. |
| 11 | **Áudio fica no R2 depois do download:** a rota `audio-recebido` (contrato, pedido v2-3) não existe, então a gravação fica em dois lugares, R2 e notebook, sem prazo no R2. | **Pendente:** implementar a rota e, como rede de segurança, uma regra de expiração no bucket com teto de **72 h** depois da confirmação do notebook, com log de exclusão. |
| 12 | **O notebook baixava sem conferir o consentimento:** ele confiava que o bot só lista mentorias confirmadas. Se o bot errasse, a gravação de quem não consentiu seria baixada e transcrita. A trava `ponte.certificavel` só barrava as horas. | **Corrigido no notebook (20/11/2026):** `mentorias baixar` só baixa quando os dois papéis estão identificados, com consentimento, e o parceiro confirmou (`ponte.falta_consentimento`). Senão, a mentoria fica "aguardando consentimento". |
| 13 | **A página pública permitia singularizar:** a credencial pública listava cada sessão (data, minutos, tipo, temas), e o repositório do GitHub Pages é público e navegável. Num grupo pequeno, isso aponta para uma pessoa. | **Corrigido na credencial v3 (20/11/2026):** a pública só tem horas, período, emissor e status, e as sessões ficam só no PDF do titular. A página tem `noindex`. Nenhum certificado tinha sido emitido, então não houve o que republicar. |

## 8. Rascunho de RIPD (estrutura)

1. Descrição do tratamento: seções 1 a 3.
2. Necessidade e proporcionalidade:
   - transcrição e análise locais, sem IA de terceiros no conteúdo;
   - **mas o áudio bruto passa pela nuvem antes de chegar ao notebook:** WhatsApp, servidor da Evolution, Cloudflare R2 e Supabase (metadados), em outros países (art. 33). A política precisa dizer isso com essas palavras, e "processado localmente" vale só para a transcrição e a análise;
   - minimização: certificado sem matrícula, versão pública sem nome, avisos só com números;
   - retenção curta do áudio (a cumprir no R2, achado 11).
3. Riscos e medidas:

| Risco | Medida |
|---|---|
| Vazamento da gravação ou da transcrição | ficam no notebook; disco cifrado (**a fazer**); backup cifrado (AES-256-GCM, `mentorias backup`); no R2, apagar após o download (achado 11) |
| Reidentificação por hash | HMAC no bot (feito em produção); credencial pública com sal, que impede testar nomes |
| Decisão automatizada injusta | check final humano de toda aprovação; recusa automática só por critério objetivo, com [Pedir revisão]; prazo de defesa na conduta; motivo registrado |
| Uso indevido da voz | sem perfil de voz; `--reference` desligado; áudio de perfil sem processamento (achado 7) |
| Imutabilidade × direito à eliminação | o livro só tem pseudônimos e hashes; o nome fica num arquivo apagável |
| Canal não oficial | ver achado 4 |
| Dados de terceiros citados na conversa | transcrição só no notebook, fora do resumo e com prazo (seção 4) |
| Singularização pela página pública | credencial v3 sem sessões, `noindex` (achado 13) |
| Processar a voz de quem não consentiu | bot só lista confirmadas; notebook confere de novo antes de baixar (achado 12) |

4. Riscos residuais e aprovação.

## 9. Fases futuras: B2B e pool de talentos (restrições de produto)

Ainda não existem no produto. Registro aqui o que a pesquisa de 20/11 aponta, para não construir algo que a lei não sustenta.

- **Papel no B2B:** ser contratada não faz a Be My Mentor virar operadora automaticamente. Conta quem decide a finalidade e os elementos essenciais (art. 5º, VI e VII; Guia de Agentes de Tratamento da ANPD).
  - Se a instituição define finalidade, critérios e retenção, a Be My Mentor é **operadora** (art. 39): trata só sob as instruções dela e não usa os dados para nada próprio.
  - Se a Be My Mentor mantém os critérios, a relação direta com o aluno e os próprios termos, e a instituição só paga ou aceita o certificado, ela continua **controladora**, sozinha ou em conjunto.
  - O contrato e o fluxo do produto precisam refletir a escolha.
- **Operador não reaproveita dados:** gravações, transcrições e pareceres de um contrato B2B não podem alimentar outro produto. Quem reaproveita vira controlador sem base legal e responde por isso (arts. 39 e 42).
- **Pool de talentos, só no arranjo restrito:**
  - relação direta com o aluno, com a Be My Mentor como controladora;
  - **opt-in depois** da emissão do certificado, em outra tela ou momento, e recusar não tem efeito nenhum nas horas. Consentimento pedido no fluxo das horas não é livre (arts. 5º, XII, 8º §4º, 9º §3º; por analogia, o caso Bocconi na Itália);
  - entram **só dados derivados**: o certificado e os resultados por competência, que o próprio aluno leva (portabilidade, art. 18, V). **Nunca** áudio, transcrição ou parecer;
  - consentimento específico para compartilhar com cada empresa ou finalidade (art. 7º §5º), com lista de destinatários e revogação fácil;
  - sem inferir traços (emoção, personalidade) da voz; ranking com revisão humana e auditoria de vieses (arts. 6º, IX, 12 §2º e 20);
  - bases, chaves e equipes separadas da certificação, sem *join* automático;
  - menores de 18 fora do pool.
- **Neutralidade:** quem certifica e também vende talentos tem conflito de interesse. A venda não pode influenciar a certificação (art. 6º, boa-fé). Separar marca, base e equipe.
- **M&A:** o consentimento dado à Be My Mentor não passa automaticamente a um comprador. Informar a possível sucessão e prever nos contratos.
- **Antes da fase 2 ou 3:** RIPD próprio, contrato de operador ou acordo de controladoria conjunta, e parecer de advogado.

## 10. Checklist para levar ao advogado

1. Este dossiê e o mapa de dados (seção 3)
2. Registro das operações (ROPA simplificado)
3. Política de privacidade (bot, `src/legal/page.ts`), com os achados 1, 2 e 4
4. Termos de uso, com a cláusula de conduta
5. Termo de consentimento para gravação e, se aplicável, biometria de voz
6. Teste de legítimo interesse (antifraude)
7. RIPD (seção 8)
8. Política de retenção e eliminação (incluindo o R2: achados 8 e 11)
9. Política simples de segurança da informação (cifrar o disco do notebook; backup do `PESSOA_ID_SECRET` e da chave do emissor)
10. DPAs dos fornecedores e cláusulas-padrão da ANPD (incluindo o servidor da Evolution)
11. Plano de resposta a incidentes
12. Fluxo de atendimento aos direitos do titular (art. 18), com prazo de 15 dias
13. Tratamento de menores de idade (a data de nascimento já é coletada no áudio de perfil)
14. Modelo de certificado e política de revogação
15. Comprovante do CNPJ 70.237.372/0001-11 e ato constitutivo da Inova Simples (emissor e controlador formal). Confirmar como a política e o certificado identificam o controlador se a empresa sair do Inova Simples e mudar de natureza jurídica.
16. Ato formal de indicação do encarregado (Res. CD/ANPD 18/2024) e enquadramento como alto risco (Res. CD/ANPD 2/2022)
17. ECA Digital (Lei 15.211/2025) para calouros de 17 anos
18. Para o B2B e o pool (seção 9): minuta de contrato de operador ou de acordo de controladoria conjunta, e o desenho do opt-in posterior

**Prioridade**, porque a falta de documentação já é infração: itens 2 (ROPA), 6 (balanceamento), 7 (RIPD) e 11 (incidentes).

## 11. Pesquisa de 20/11/2026: avaliação ponto a ponto

A pesquisa listou 13 pontos sobre a fase atual e 7 sobre as fases futuras. Conferi cada um contra o código e este dossiê.

| # | Ponto da pesquisa | Avaliação | O que mudou |
|---|---|---|---|
| 1 | Papel indefinido | Em parte: a Be My Mentor já é declarada controladora, e o Inteli não recebe dados | seção 2; ROPA no checklist |
| 2 | Áudio retido no bot | Válido (já era o achado 11) | teto proposto de 72 h |
| 3 | Falta o consentimento do parceiro | Desatualizado para o bot (lista só confirmadas), mas havia um furo no notebook | **código:** achado 12 |
| 4 | Embeddings de voz = biometria | Em parte: os nomes vêm do texto e os embeddings ficam só na memória; a falta de regra é real | seção 5 |
| 5 | "Local" × nuvem | Válido (comunicação) | seção 8 |
| 6 | Terceiros citados | Válido; a redação automática foi descartada (transcrição literal) | seções 4 e 8 |
| 7 | O LLM decide sozinho | Desatualizado: toda aprovação passa pela equipe; a recusa objetiva tem [Pedir revisão] | seção 6 (veto ao art. 20 §3º) |
| 8 | Página pública permite singularizar | Válido | **código:** credencial v3, achado 13 |
| 9 | Hash do áudio | Válido como está | teste de balanceamento (checklist 6) |
| 10 | Retenção de 5 anos | Válido | seção 3 |
| 11 | Menores e ECA Digital | Válido em parte (menores já estavam) | seção 6; checklist 17 |
| 12 | Falta documentação | Válido (já no checklist) | marcado como prioridade |
| 13 | Pequeno porte pode não valer | Válido; corrige a versão anterior deste dossiê | seção 6 |
| 14–20 | B2B e pool | Válidos como restrições futuras; o papel no B2B depende de quem decide | seção 9 |

Não conferi os fatos posteriores a meados de 2026, que dependem só da pesquisa: Lei 15.352/2026 (ANPD como agência), multa ao TikTok, caso das escolas do Paraná, Res. CD/ANPD 32/2026. Conferir antes de citar.

## Fontes

- ANPD, Radar Tecnológico: Biometria (2024): https://www.gov.br/anpd/pt-br/centrais-de-conteudo/documentos-tecnicos-orientativos/radar-tecnologico-biometria-anpd-1.pdf
- Guia de legítimo interesse: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/copy_of_guia_legitimo_interesse.pdf
- Enunciado CD/ANPD nº 1/2023 (crianças e adolescentes): https://www.in.gov.br/en/web/dou/-/enunciado-cd/anpd-n-1-de-22-de-maio-de-2023-485306934
- Res. CD/ANPD 2/2022 (pequeno porte): https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/regulamentacoes-da-anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022
- Res. CD/ANPD 19/2024 (transferência internacional): https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024
- RIPD: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd
- Lei 13.853/2019, vetos (art. 20 §3º): https://www2.camara.leg.br/legin/fed/lei/2019/lei-13853-8-julho-2019-788785-veto-158685-pl.html
- Res. CD/ANPD 18/2024 (encarregado): https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-18-de-16-de-julho-de-2024
- Lei 15.211/2025 (ECA Digital): https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm
- Lei 14.063/2020 (assinaturas eletrônicas): https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica/saiba-mais-sobre-a-assinatura-eletronica
