# Pendências humanas

> **Atualização 2026-11-12:** o canal WhatsApp migrou da Meta para a **Evolution API (Baileys)**. Os itens antigos da Meta (conta, token, `PHONE_NUMBER_ID`, número de teste, Flow, Billing Hub, verificação da empresa) estão **obsoletos**; ficam abaixo só como histórico. A lista vigente é a seção seguinte.

## Migração para a Evolution API (vigente)
- [ ] Criar a VM Oracle Cloud e subir a Evolution v2 em Docker, **com a versão fixada**, atrás de HTTPS (`docs/DEPLOY.md`, seção 5).
- [ ] Definir `AUTHENTICATION_API_KEY` forte na Evolution → `EVOLUTION_API_KEY`; gerar `EVOLUTION_WEBHOOK_TOKEN` (16+ caracteres aleatórios); definir `EVOLUTION_URL` e `EVOLUTION_INSTANCE` no Worker (`wrangler secret put` / `[vars]`). Atualizar o `.dev.vars` local.
- [ ] Comprar um chip **dedicado e novo**; criar a instância e conectar pelo QR Code; manter o aparelho/chip ativo e com recargas.
- [ ] Configurar o webhook da instância (`MESSAGES_UPSERT`, header `x-webhook-token`) e conferir com `GET /webhook/find/<instância>`.
- [ ] Aplicar `supabase/migrations/0017_pending_choices.sql` (ou rodar o `schema_completo.sql`).
- [ ] Decidir `ANTI_FLOOD_MAX_PER_DAY` (recomendado ligar, ex.: 300) e aquecer o número aos poucos.
- [ ] **Aceitar o risco de banimento** (Baileys viola os Termos do WhatsApp) e ter um plano B (outro chip).
- [ ] **Validar numa instância real** (nada disso foi testado contra a Evolution; a documentação é ambígua):
  - [ ] corpo do `sendText` aceito pela sua versão (`{ number, text }`; se rejeitar, a doc cita `textMessage.text`);
  - [ ] o payload real de `messages.upsert` (texto, áudio/nota de voz, documento, contato) bate com `src/whatsapp/parser.ts` (`tests/helpers/evolution.ts` reproduz o formato assumido);
  - [ ] `POST /chat/getBase64FromMediaMessage` aceita `{ message: { key: { id } } }` e devolve `{ base64, mimetype }` (se exigir a mensagem inteira, ajustar `createMediaClient`);
  - [ ] como chega o telefone quando o remetente aparece como `@lid` (campo `remoteJidAlt`?);
  - [ ] se botões/listas nativos entregam (`EVOLUTION_NATIVE_INTERACTIVE=true`); caso não, manter o texto numerado;
  - [ ] que as respostas "1", "2" ao texto numerado chegam como `conversation`/`extendedTextMessage`.

## Histórico (Meta — obsoleto)

Coisas que só uma pessoa da equipe pode fazer. Os agentes acrescentam itens aqui e seguem trabalhando com mocks.

## Contas e credenciais
- [ ] Criar conta no Meta for Developers e um app do tipo Business com o produto WhatsApp.
- [ ] Criar/usar um portfólio empresarial na Meta (Business Manager).
- [ ] Gerar token de acesso permanente (usuário de sistema) → `WHATSAPP_TOKEN`.
- [ ] Copiar `PHONE_NUMBER_ID`, `APP_SECRET`; definir `VERIFY_TOKEN` e `ADMIN_TOKEN` (valores longos e aleatórios).
- [ ] Criar conta na Cloudflare; criar bucket R2 para os áudios.
- [ ] Criar projeto no Supabase; copiar `SUPABASE_URL` e a service key.
- [ ] Definir a API do analisador de áudio: URL, chave, formato de envio e de resposta, limite gratuito/preço por áudio.

## Número
- [ ] Testar tudo primeiro com o número de teste da Meta (até 5 destinatários cadastrados).
- [ ] Comprar um chip pré-pago **novo**, nunca ativado no WhatsApp nem no app WhatsApp Business.
- [ ] Registrar o chip na API (código por SMS ou ligação) e definir o PIN de duas etapas.
- [ ] Manter recargas no chip para a operadora não cancelar a linha.

## Conformidade
- [ ] Publicar a política de privacidade e definir `PRIVACY_POLICY_URL` e `TERMS_VERSION`.
- [ ] Verificar a empresa no Meta Business Manager.
- [x] Definir o cadastro: nome completo e aceite LGPD; perguntas pessoais respondidas por áudio.
- [ ] Confirmar o fuso da conta de mensagens na Meta e ajustar `META_ACCOUNT_TIMEZONE` se não for `America/Sao_Paulo`.
- [ ] **Não** cadastrar forma de pagamento no Billing Hub enquanto a meta for custo zero (segunda proteção além do disjuntor).

## Publicação
- [ ] Publicar o Flow de cadastro (`flows/cadastro.json`) no WhatsApp Manager e definir `WHATSAPP_FLOW_ID`.
- [ ] Fazer o deploy seguindo `docs/DEPLOY.md` e registrar a URL do webhook no app da Meta.

## Etapa 2
- [ ] Aplicar `supabase/migrations/0002_budget.sql` no projeto Supabase (depois da 0001).

## Publicar o Flow de cadastro (Etapa 4)
- [ ] No WhatsApp Manager > Flows > Criar Flow (categoria "Cadastro"/Sign up), colar o conteúdo de `flows/cadastro.json` no editor JSON.
- [ ] Trocar a `url` do componente OptIn (`https://example.com/politica-de-privacidade`) pelo valor real de `PRIVACY_POLICY_URL`.
- [ ] Se o editor reclamar da versão do Flow JSON (`6.2`), usar a versão mais recente aceita e conferir se os componentes TextInput/OptIn/Footer continuam válidos.
- [ ] Testar o Flow no modo de pré-visualização e depois publicar (rascunho não pode ser enviado a usuários).
- [ ] Copiar o ID do Flow para `WHATSAPP_FLOW_ID`. Sem ele, o bot usa o cadastro por perguntas (fallback).
- [ ] Confirmar que o Flow pede apenas nome completo e aceite; o áudio de apresentação é solicitado depois do formulário.
- [ ] Se trocar os campos do cadastro: editar `src/registration/fields.ts`, `flows/cadastro.json` e uma migração nova com as colunas.

## Etapa 6 — Pipeline de áudio
- [ ] Aplicar `supabase/migrations/0007_audios.sql` no Supabase.
- [ ] Criar o bucket R2 `bot-whatsapp-audios` (binding `AUDIOS` já está no `wrangler.toml`) e definir política de retenção dos áudios (dado pessoal).
- [ ] Fornecer o contrato da API de análise (formato de envio e de resposta). Sem `docs/ANALISADOR.md`, vale o adaptador genérico em `src/audio/analyzer.ts` (`HttpAudioAnalyzer`); ajustar só esse arquivo. Definir também `ANALYZER_API_URL` e `ANALYZER_API_KEY`.

## Etapa 7 — Operação
- [ ] Aplicar `supabase/migrations/0008_housekeeping.sql` no Supabase (cron depende de `release_stuck_processing`).
- [ ] Seguir `docs/DEPLOY.md` (contas, secrets, bucket, webhook, número de teste, chip) e o checklist de produção.

## IA (Groq / xAI Grok)
- [ ] Enviar a chave: `npx wrangler secret put AI_API_KEY`. Confirmar o nome do modelo (`AI_MODEL`) no console do provedor: os padrões podem ter sido renomeados.
- [ ] LGPD: o texto das mensagens (após o consentimento) é enviado ao provedor de IA para classificar a intenção e ler horários. Citar isso na política de privacidade (`PRIVACY_POLICY_URL`) e revisar o termo de consentimento.

## Termos de Uso e Política de Privacidade (LGPD)
Página pública em `GET /privacidade` (e `/termos`), texto em `src/legal/page.ts`. **É um rascunho técnico: precisa de revisão de advogado(a) antes de divulgar.**
- [ ] Preencher `LEGAL_INFO` em `src/legal/page.ts`: razão social/nome, CNPJ/CPF, endereço, e-mail para pedidos dos titulares, encarregado (DPO, art. 41) e foro. Enquanto houver campo vazio, a página mostra "RASCUNHO".
- [ ] Apontar o consentimento para a página: `echo "https://bot-whatsapp.bot-whatsaap-inteli.workers.dev/privacidade" | npx wrangler secret put PRIVACY_POLICY_URL` e fazer o deploy.
- [ ] **Blockchain**: a política diz que só vão informações pseudonimizadas (ids e hashes), nunca o texto da transcrição, nome ou telefone. Garantir que o sistema de validação faça isso: dado pessoal em blockchain não pode ser apagado depois (conflita com o art. 18 da LGPD).
- [ ] Confirmar os prazos de guarda propostos (12 meses após o último contato; 5 anos para mentorias e validações; 6 meses de logs) e a lista de operadores (Meta, Cloudflare, Supabase, Groq, transcrição/blockchain).
- [ ] Confirmar que a diarização (identificar quem falou) não é usada para autenticar ou identificar pessoas fora da mentoria; se for, tratar a voz como dado biométrico (sensível, art. 11) com consentimento específico.
- [ ] Decidir sobre menores de 18 anos (a política exige consentimento de responsável) e se o bot deve perguntar a idade.
- [ ] Quem aceitou antes (versão `2025-01`) não aceitou esta versão: avaliar pedir novo aceite.
- [ ] Criar o procedimento interno para atender pedidos de acesso/correção/eliminação (hoje não há comando no bot; o pedido é manual, pelo e-mail ou WhatsApp).

## 2026-11-10 — Mentoria v2 (integração com o Transcritor)
- [ ] Aplicar `supabase/migrations/0015_mentoria_v2.sql` no Supabase e fazer o deploy (comandos em `docs/DEPLOY.md`, seção "Mentoria v2"). **Antes de subir o código**, senão o fluxo novo falha ao gravar a data e o parceiro.
- [ ] Decidir se mostrar o nome de até 3 cadastrados na busca de parceiro por nome é aceitável para a política de privacidade (hoje: só para quem já se cadastrou, mínimo de 4 letras).
- [ ] Avisar quem usa o bot: o registro de mentoria agora pergunta papel, assunto, data e parceiro depois do arquivo; o parceiro precisa estar cadastrado (aceite LGPD) para confirmar.
- [ ] **Eliminação (LGPD art. 18)**: o contrato prevê que o bot repasse o `pessoa_id` ao notebook para apagar nome, matrícula e sal. Fora do escopo das 6 etapas da v2: precisa de um comando/rota e de um procedimento.
- [ ] Ambiente de desenvolvimento: existe um `.dev.vars` real na pasta do projeto e o teste C0.6 (`tests/repo-hygiene.test.ts`) exige que ele não exista. É um arquivo seu (ignorado pelo git); o teste falha só por isso, não por código. Mova o arquivo para fora da pasta ao rodar `npm run verify`, ou ajuste o teste.
