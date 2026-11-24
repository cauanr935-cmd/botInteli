// Base de conhecimento (RAG) da Be My Mentor para o agente de IA responder perguntas sobre o programa.
// A base é pequena, então vai inteira no prompt (sem busca): o modelo só pode usar o que está aqui.
// Para atualizar, edite este arquivo (fonte: fundadores). Português, direto, sem informação sigilosa.

export const BMM_KNOWLEDGE = `
## 1. O que é a Be My Mentor
- É uma rede (com proposta de rede social) que conecta estudantes universitários.
- Objetivo: unir um aluno que tem uma dúvida acadêmica a outro aluno que tem o conhecimento para saná-la.
- Público: estudantes universitários.
- Origem: a Be My Mentor é uma iniciativa criada por Cauan e Bruno, dois alunos do Inteli, que são os fundadores e sócios.

## 2. Assuntos permitidos
A plataforma é restrita ao meio acadêmico:
- dúvidas sobre disciplinas regulares da base curricular;
- assuntos avançados de pesquisa;
- iniciação científica;
- vivência universitária em geral (como trotes de curso e rotina acadêmica).

## 3. Estágio atual
- O projeto está em fase de validação da ideia.
- Hoje, a conexão entre os alunos acontece exclusivamente por este bot.
- Para o próximo ano está previsto o lançamento de uma plataforma com interface própria, usabilidade aprimorada e uma experiência de usuário diferenciada.

## 4. Privacidade e dados
- Os dados gerados nas mentorias de hoje são usados única e exclusivamente para a validação e emissão de horas complementares.
- Os dados dos usuários e das mentorias não são comercializados e não são compartilhados com terceiros sob nenhuma hipótese. É uma garantia direta dos fundadores.
- Para o serviço funcionar, usamos prestadores que tratam os dados sob nossas instruções (WhatsApp/Meta, hospedagem e banco de dados, provedores de inteligência artificial (Groq e xAI, que recebem só o texto das mensagens; por isso não se deve escrever dados sensíveis no texto livre)). A transcrição e a análise das gravações rodam em equipamento da própria equipe, e a instituição de ensino só recebe o certificado que o próprio aluno decidir levar a ela. Os detalhes (dados coletados, prazos, direitos da LGPD como acessar, corrigir ou apagar os dados) estão nos Termos de Uso e na Política de Privacidade, cujo link é enviado no cadastro. Para pedir acesso ou exclusão, a pessoa fala com o Contato.

## 5. Como funciona a validação das horas complementares
1. Os áudios das mentorias são armazenados em um bucket.
2. Um analisador de áudio integrado ao bot busca esses arquivos.
3. O sistema transcreve o áudio e faz a diarização (identifica qual usuário falou cada parte).
4. A equipe faz a conferência final de toda sessão antes de contar horas.
5. É emitido um certificado de horas complementares, com registro e carimbo de tempo verificáveis (só códigos, sem dados pessoais), que o aluno decide submeter à sua instituição de ensino.

## 6. Como usar o bot hoje
- Cadastro: nome completo, turma (as turmas têm número, como T27, T26, T24) e um áudio de apresentação.
- A pessoa pode ser mentor, mentorado ou os dois. Mentores escolhem as áreas em que topam ajudar: Computação, Matemática, Liderança, Negócios, Design/UX e Vida Acadêmica (iniciação científica, monitoria, bolsas, preparação para provas, recuperação e troca de curso).
- Mentorados registram a dúvida: o bot só GUARDA a dúvida, e a equipe procura um mentor para tirá-la. O bot nunca responde dúvidas de conteúdo.
- Menu: Registrar mentoria (enviar o áudio da mentoria), Horários (informar os dias e horários livres) e Contato.
- Contato: WhatsApp do Cauan, um dos fundadores da Be My Mentor (o outro é o Bruno): 88 99289-5332.
`.trim();
