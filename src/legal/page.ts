// Termos de Uso + Política de Privacidade (LGPD, Lei 13.709/2018), publicados em GET /privacidade (e /termos).
// Texto público: NÃO coloque segredos aqui. Os dados do controlador vêm de LEGAL_INFO (preencher antes de divulgar);
// enquanto houver campo vazio, a página mostra um aviso de rascunho. Revisão jurídica recomendada antes de publicar.

export const LEGAL_VERSION = "2026-11";
export const LEGAL_UPDATED = "10 de novembro de 2026";
export const CONTACT_WHATSAPP = "88 99289-5332";
export const CONTACT_WHATSAPP_LINK = "https://wa.me/5588992895332";

export interface LegalInfo {
  /** Razão social ou nome completo de quem controla os dados (os fundadores / a entidade). */
  controllerName: string;
  /** CNPJ ou CPF do controlador. */
  controllerDoc: string;
  /** Endereço para correspondência. */
  controllerAddress: string;
  /** E-mail para pedidos dos titulares. */
  contactEmail: string;
  /** Nome e contato do encarregado pelo tratamento de dados (art. 41 da LGPD). */
  dpo: string;
  /** Foro (cidade/UF) para eventuais disputas. */
  forum: string;
}

/** PREENCHER antes de divulgar: enquanto algum campo estiver vazio, a página aparece como RASCUNHO. */
export const LEGAL_INFO: LegalInfo = {
  controllerName: "",
  controllerDoc: "",
  controllerAddress: "",
  contactEmail: "",
  dpo: "",
  forum: "",
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const pendingFields = (i: LegalInfo): string[] => (Object.keys(i) as (keyof LegalInfo)[]).filter((k) => i[k].trim() === "");

const BODY = `
<h2 id="termos">Parte A — Termos de Uso</h2>

<h3>1. Quem somos e o aceite</h3>
<p>A <b>Be My Mentor</b> é uma rede que conecta estudantes universitários: une quem tem uma dúvida acadêmica a outro estudante que tem o conhecimento para ajudar. O serviço é operado por <b>{{controllerName}}</b> (CNPJ/CPF {{controllerDoc}}), com endereço em {{controllerAddress}} (“<b>Be My Mentor</b>”, “nós”).</p>
<p>Ao tocar em <b>Aceito</b> no WhatsApp, você declara que leu e concorda com estes Termos e com a Política de Privacidade (Parte B). Se não concordar, não use o serviço.</p>

<h3>2. O que o serviço oferece</h3>
<ul>
<li>Conectar mentorados e mentores por meio <b>deste bot de WhatsApp</b>. O projeto está em <b>fase de validação</b>; para o próximo ano está previsto o lançamento de uma plataforma com interface própria.</li>
<li>Assuntos: dúvidas de disciplinas da base curricular, pesquisa avançada, iniciação científica e vivência universitária (por exemplo, trotes de curso e rotina acadêmica).</li>
<li>Registrar mentorias (por áudio) e informar seus horários livres.</li>
<li>Apoiar a validação e a emissão de <b>horas complementares</b> pela sua instituição de ensino.</li>
</ul>

<h3>3. Quem pode usar</h3>
<p>O serviço é voltado a estudantes universitários, <b>maiores de 18 anos</b>. Se você tem menos de 18 anos, só pode usar o serviço com o consentimento específico e em destaque de pelo menos um dos seus pais ou responsável legal (LGPD, art. 14, § 1º). Fale conosco antes de continuar.</p>

<h3>4. Suas responsabilidades</h3>
<ul>
<li>Informar dados verdadeiros (nome completo e turma). Nomes falsos ou de outra pessoa podem levar à suspensão.</li>
<li>Usar o serviço apenas para fins acadêmicos, com respeito aos demais participantes. É proibido assediar, discriminar, fazer spam, enviar conteúdo ilegal ou violar direitos autorais.</li>
<li>Não enviar dados pessoais de terceiros, nem dados sensíveis (saúde, religião, orientação sexual, opinião política etc.), em mensagens, áudios ou documentos, a menos que seja indispensável e você tenha autorização.</li>
<li>Enviar apenas áudios de mentorias <b>de que você participou</b>, e somente depois de avisar a outra pessoa de que a conversa será gravada e enviada para validação de horas complementares. Quem grava deve ter ciência de todos os participantes.</li>
</ul>

<h3>5. Mentorias, mentores e horas complementares</h3>
<ul>
<li>Mentores são <b>estudantes</b>, não profissionais contratados. A orientação deles não substitui a de professores, orientadores ou profissionais habilitados, e não garantimos resultado.</li>
<li>A emissão das horas complementares é decisão da <b>sua instituição de ensino</b>. Fornecemos os registros para a validação, mas não garantimos o aceite das horas.</li>
</ul>

<h3>6. Inteligência artificial</h3>
<p>Usamos um assistente de IA para entender mensagens (por exemplo, a opção que você quis escolher), ler seus horários livres, avaliar se um nome digitado parece real e responder perguntas sobre a Be My Mentor. A IA <b>não tira dúvidas acadêmicas</b>: sua dúvida é apenas registrada para que procuremos um mentor. A IA pode errar; se algo sair errado, é só repetir ou falar conosco. Nenhuma decisão sobre horas complementares ou sobre o seu acesso é tomada somente pela IA (veja o item 12 da Parte B).</p>

<h3>7. Suspensão, saída e alterações</h3>
<p>Você pode parar de receber mensagens a qualquer momento enviando <b>sair</b>. Para apagar seus dados, siga a Parte B (item 10). Podemos suspender quem descumprir estes Termos. Podemos atualizar estes Termos e a Política; quando houver mudança relevante, pediremos novo aceite. A versão vigente está sempre nesta página.</p>

<h3>8. Responsabilidade, lei e foro</h3>
<p>Não nos responsabilizamos por conteúdo trocado entre usuários, nem por indisponibilidades do WhatsApp ou de provedores externos, na extensão permitida em lei. Estes Termos seguem a legislação brasileira. Fica eleito o foro de <b>{{forum}}</b>, ressalvado o foro do seu domicílio quando a lei assim determinar.</p>

<h2 id="privacidade-politica">Parte B — Política de Privacidade</h2>
<p>Esta política explica, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, “<b>LGPD</b>”), quais dados tratamos, por quê, com quem os compartilhamos e como você exerce seus direitos.</p>

<h3>1. Controlador</h3>
<p>O controlador dos dados é <b>{{controllerName}}</b> (CNPJ/CPF {{controllerDoc}}), {{controllerAddress}}. Canais: e-mail <b>{{contactEmail}}</b> ou WhatsApp <a href="{{whatsappLink}}"><b>{{whatsapp}}</b></a> (Cauã, um dos fundadores).</p>

<h3>2. Encarregado (DPO)</h3>
<p>Encarregado pelo tratamento de dados pessoais (art. 41): <b>{{dpo}}</b>. Ele recebe seus pedidos e reclamações e conversa com a ANPD.</p>

<h3>3. Quais dados tratamos, para quê e com que base legal</h3>
<table>
<thead><tr><th>Dado</th><th>Finalidade</th><th>Base legal (art. 7º)</th></tr></thead>
<tbody>
<tr><td>Número de WhatsApp e identificadores técnicos da conversa</td><td>Falar com você e operar o serviço; segurança e prevenção a abusos</td><td>Execução do serviço a seu pedido (V); legítimo interesse em segurança (IX)</td></tr>
<tr><td>Nome completo e turma</td><td>Identificar você, conectar mentores e mentorados, validar horas complementares</td><td>Consentimento (I); execução do serviço (V)</td></tr>
<tr><td>Áudio de apresentação (voz e o que você disser: data de nascimento, esporte, time, hobbies e interesses)</td><td>Fazer a combinação (<i>match</i>) entre pessoas com afinidades</td><td>Consentimento (I)</td></tr>
<tr><td>Papel (mentor, mentorado ou os dois) e áreas em que topa ajudar</td><td>Organizar o <i>match</i></td><td>Consentimento (I); execução do serviço (V)</td></tr>
<tr><td>Dúvidas e documentos que você anexar</td><td>Encontrar um mentor e repassar o material a ele(a)</td><td>Consentimento (I); execução do serviço (V)</td></tr>
<tr><td>Dias e horários livres</td><td>Agendar mentorias</td><td>Execução do serviço (V)</td></tr>
<tr><td>Áudios das mentorias (inclusive a voz da outra pessoa), transcrições e identificação de quem falou cada trecho (diarização)</td><td>Validar e emitir horas complementares</td><td>Consentimento (I); execução do serviço (V)</td></tr>
<tr><td>Texto das suas mensagens</td><td>Entender o que você quis dizer (IA), responder perguntas sobre a Be My Mentor</td><td>Consentimento (I)</td></tr>
<tr><td>Registro do aceite (data e versão destes Termos) e registros técnicos de envio</td><td>Comprovar o consentimento; controle de uso e de custos</td><td>Obrigação legal e exercício regular de direitos (II e VI); legítimo interesse (IX)</td></tr>
</tbody>
</table>
<p><b>Dados sensíveis.</b> Não pedimos dados pessoais sensíveis (art. 5º, II). Se você os mencionar por conta própria em áudios ou documentos, eles serão tratados apenas para a finalidade da mentoria e com o seu consentimento específico (art. 11, I). Evite enviá-los. A voz é dado pessoal; <b>não a usamos para autenticar ou identificar você fora da mentoria</b>.</p>

<h3>4. Com quem compartilhamos</h3>
<p><b>Nós não vendemos nem comercializamos seus dados</b>, e eles não são compartilhados com terceiros para outras finalidades. Para o serviço funcionar, compartilhamos o mínimo necessário com:</p>
<ul>
<li><b>Outros participantes da mentoria</b>: seu mentor ou mentorado vê o que for necessário (nome, turma, dúvida, material anexado e horários livres).</li>
<li><b>Sua instituição de ensino</b>: recebe os registros necessários para validar e emitir as horas complementares (por exemplo, quem participou, quando e a transcrição da mentoria).</li>
<li><b>Prestadores de serviço (operadores)</b>, que tratam dados somente sob nossas instruções: Meta/WhatsApp (envio e recebimento de mensagens), Cloudflare (hospedagem e armazenamento dos arquivos), Supabase (banco de dados), provedor de inteligência artificial (Groq) e a infraestrutura de blockchain e de transcrição usada na validação das horas.</li>
<li><b>Autoridades</b>, quando houver obrigação legal ou ordem judicial.</li>
</ul>

<h3>5. Transferência internacional</h3>
<p>Alguns prestadores (como Meta, Cloudflare, Supabase e o provedor de IA) podem processar dados <b>fora do Brasil</b>, inclusive nos Estados Unidos. Fazemos isso com base no seu <b>consentimento específico e em destaque</b> (art. 33, VIII), dado ao aceitar esta política, e com contratos que exigem proteção compatível com a LGPD. Você pode revogar o consentimento a qualquer momento (item 10); sem ele, não conseguimos prestar o serviço.</p>

<h3>6. Blockchain e imutabilidade</h3>
<p>Para dar confiabilidade e transparência à validação das horas complementares, registramos informações da mentoria em uma <b>blockchain</b>, que é imutável por natureza: o que é gravado não pode ser alterado nem apagado. Por isso, o registro em blockchain contém <b>somente informações pseudonimizadas</b> (identificadores e códigos de verificação), nunca o texto completo da transcrição, o seu nome ou o seu telefone. O conteúdo completo fica no nosso banco de dados, onde pode ser corrigido, anonimizado ou eliminado a seu pedido.</p>

<h3>7. Por quanto tempo guardamos</h3>
<ul>
<li><b>Cadastro, áudio de apresentação, dúvidas, materiais e horários</b>: enquanto você usar o serviço e por até <b>12 meses</b> depois do último contato; depois, eliminados ou anonimizados.</li>
<li><b>Áudios das mentorias, transcrições e registros de validação</b>: pelo tempo necessário para a validação das horas complementares e para eventual contestação pela instituição, por até <b>5 anos</b>.</li>
<li><b>Registros técnicos de acesso</b>: por <b>6 meses</b>, quando exigido pelo Marco Civil da Internet (art. 15).</li>
<li><b>Comprovante do aceite</b>: pelo prazo necessário para o exercício regular de direitos.</li>
</ul>
<p>Podemos guardar por mais tempo apenas quando a lei exigir ou para nos defendermos em processos.</p>

<h3>8. Segurança</h3>
<p>Adotamos medidas técnicas e administrativas proporcionais (art. 46): comunicação protegida por HTTPS; acesso restrito por chaves e senhas; telefones em formato embaralhado (<i>hash</i>) nos registros técnicos e nos nomes dos arquivos; tabelas do banco com acesso restrito; separação entre os dados guardados e os enviados à IA (enviamos só o texto da mensagem, sem seu nome nem seu telefone); e consentimento verificado antes de guardar qualquer dado ou áudio. Em caso de incidente de segurança que possa causar risco ou dano relevante, comunicaremos você e a ANPD (art. 48).</p>

<h3>9. Crianças e adolescentes</h3>
<p>O serviço não é destinado a menores de 18 anos. Se soubermos que tratamos dados de menor sem o consentimento de um responsável, eliminaremos esses dados (art. 14).</p>

<h3>10. Seus direitos e como exercê-los</h3>
<p>Nos termos do art. 18, você pode pedir, a qualquer momento e gratuitamente: <b>confirmação</b> de que tratamos seus dados; <b>acesso</b>; <b>correção</b> de dados incompletos, inexatos ou desatualizados; <b>anonimização, bloqueio ou eliminação</b> de dados desnecessários, excessivos ou tratados em desconformidade; <b>portabilidade</b>; <b>eliminação</b> dos dados tratados com consentimento; <b>informação</b> sobre com quem compartilhamos; <b>informação sobre a possibilidade de não consentir</b> e suas consequências; e <b>revogação do consentimento</b> (art. 8º, § 5º). Você também pode se <b>opor</b> a tratamentos feitos sem consentimento, se houver descumprimento da lei.</p>
<ul>
<li><b>Como pedir</b>: pelo e-mail <b>{{contactEmail}}</b> ou pelo WhatsApp <a href="{{whatsappLink}}">{{whatsapp}}</a>, informando o número com o qual você usa o bot. Podemos pedir uma confirmação de identidade.</li>
<li><b>Prazo</b>: confirmação de tratamento imediata em formato simplificado, ou em até <b>15 dias</b> por declaração completa (art. 19).</li>
<li><b>Parar de receber mensagens</b>: envie <b>sair</b> no bot a qualquer momento. Isso não apaga seus dados; para apagá-los, faça o pedido pelos canais acima.</li>
<li>Se o pedido de eliminação envolver dados que a lei nos obriga a guardar (item 7), explicaremos o motivo.</li>
</ul>

<h3>11. Reclamações</h3>
<p>Se não ficar satisfeito, você pode peticionar à <b>Autoridade Nacional de Proteção de Dados (ANPD)</b>: <a href="https://www.gov.br/anpd">gov.br/anpd</a>.</p>

<h3>12. Inteligência artificial e decisões automatizadas</h3>
<p>A IA é usada apenas para apoiar o atendimento (interpretar mensagens e horários, avaliar se um nome parece real, responder perguntas sobre o programa). Ela recebe <b>somente o texto da sua mensagem</b>, sem nome nem telefone, e só depois do seu aceite. Nenhuma decisão que afete seus interesses (como a emissão de horas complementares ou o bloqueio do seu acesso) é tomada exclusivamente por tratamento automatizado. Você pode pedir a <b>revisão por uma pessoa</b> (art. 20) pelos canais do item 10.</p>

<h3>13. Mudanças nesta política</h3>
<p>Podemos atualizar esta política. A versão vigente é a <b>{{version}}</b>, atualizada em {{updated}}. Se a mudança for relevante, pediremos um novo aceite. Cada aceite guarda a data e a versão aceitas.</p>
`;

const STYLE = `
:root{--bg:#fff;--fg:#1c1c1e;--sub:#5b6068;--line:#dde0e4;--accent:#0a7d5a;--warn-bg:#fff4d6;--warn-fg:#6b4a00}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141617;--fg:#e9ebee;--sub:#a5abb3;--line:#2c3033;--accent:#4cc9a0;--warn-bg:#3a2f10;--warn-fg:#ffd77a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.7rem;line-height:1.25;margin:.2em 0}
h2{font-size:1.3rem;margin:2em 0 .4em;padding-top:.6em;border-top:2px solid var(--line)}
h3{font-size:1.05rem;margin:1.5em 0 .3em}
p,li{margin:.5em 0}
a{color:var(--accent)}
.meta{color:var(--sub);font-size:.9rem}
nav{margin:1em 0;padding:.6em 1em;border:1px solid var(--line);border-radius:10px}
nav a{display:inline-block;margin-right:1em}
.draft{background:var(--warn-bg);color:var(--warn-fg);padding:.8em 1em;border-radius:10px;margin:1em 0}
table{width:100%;border-collapse:collapse;font-size:.92rem;margin:1em 0}
th,td{border:1px solid var(--line);padding:.5em .6em;text-align:left;vertical-align:top}
th{background:rgba(128,128,128,.12)}
@media (max-width:560px){table,thead,tbody,tr,th,td{display:block}thead{display:none}tr{margin-bottom:.8em;border:1px solid var(--line);border-radius:8px}td{border:0;border-bottom:1px solid var(--line)}}
mark{background:var(--warn-bg);color:var(--warn-fg);padding:0 .25em;border-radius:4px}
`;

/** Renderiza a página (HTML completo, sem JavaScript). Campos vazios viram "[a preencher]" e ativam o aviso de rascunho. */
export function renderLegalPage(info: LegalInfo = LEGAL_INFO): string {
  const pending = pendingFields(info);
  const val = (k: keyof LegalInfo): string => (info[k].trim() === "" ? "<mark>[a preencher]</mark>" : esc(info[k].trim()));
  const body = BODY
    .replace(/\{\{controllerName\}\}/g, val("controllerName"))
    .replace(/\{\{controllerDoc\}\}/g, val("controllerDoc"))
    .replace(/\{\{controllerAddress\}\}/g, val("controllerAddress"))
    .replace(/\{\{contactEmail\}\}/g, val("contactEmail"))
    .replace(/\{\{dpo\}\}/g, val("dpo"))
    .replace(/\{\{forum\}\}/g, val("forum"))
    .replace(/\{\{whatsappLink\}\}/g, CONTACT_WHATSAPP_LINK)
    .replace(/\{\{whatsapp\}\}/g, CONTACT_WHATSAPP)
    .replace(/\{\{version\}\}/g, LEGAL_VERSION)
    .replace(/\{\{updated\}\}/g, LEGAL_UPDATED);
  const banner = pending.length > 0
    ? `<div class="draft"><b>RASCUNHO — não divulgar ainda.</b> Faltam dados do controlador (${pending.length}). Revise com um(a) advogado(a) e preencha <code>LEGAL_INFO</code> em <code>src/legal/page.ts</code>.</div>`
    : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Termos e Privacidade</title>
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Termos de Uso e Política de Privacidade — Be My Mentor</h1>
<p class="meta">Versão ${LEGAL_VERSION} · atualizada em ${LEGAL_UPDATED}</p>
${banner}
<nav><a href="#termos">Termos de Uso</a><a href="#privacidade-politica">Política de Privacidade</a></nav>
${body}
</main>
</body>
</html>`;
}

/** Resposta HTTP pública, sem cookies nem scripts. */
export function legalResponse(info: LegalInfo = LEGAL_INFO): Response {
  return new Response(renderLegalPage(info), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
