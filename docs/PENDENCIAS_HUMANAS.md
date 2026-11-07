# Pendências humanas

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
- [ ] Definir os campos definitivos do cadastro (hoje: nome, e-mail, cidade).
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
- [ ] Se trocar os campos do cadastro: editar `src/registration/fields.ts`, `flows/cadastro.json` e uma migração nova com as colunas.
