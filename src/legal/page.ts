// Termos de Uso + Política de Privacidade (LGPD, Lei 13.709/2018), publicados em GET /privacidade (e /termos).
// Texto público e oficial (revisado): NÃO coloque segredos aqui. Os dados do controlador vêm de LEGAL_INFO.

export const LEGAL_VERSION = "2026-11-3";
export const LEGAL_UPDATED = "20 de novembro de 2026";
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
}

export const LEGAL_INFO: LegalInfo = {
  controllerName: "BE MY MENTOR INOVA SIMPLES (I.S.)",
  controllerDoc: "70.237.372/0001-11",
  controllerAddress: "Rua MMDC, nº 80, bairro Butantã, São Paulo/SP, apto 1012A",
  contactEmail: "bemymentoris@gmail.com",
  dpo: "Cauan da Rocha Martins (bemymentoris@gmail.com)",
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const pendingFields = (i: LegalInfo): string[] => (Object.keys(i) as (keyof LegalInfo)[]).filter((k) => i[k].trim() === "");

const BODY = `
<h2 id="termos">Parte A — Termos de Uso</h2>

<h3>1. Quem somos e o aceite</h3>
<p>A <b>Be My Mentor</b> conecta estudantes universitários para mentorias: une quem tem uma dúvida acadêmica a outro estudante que tem o conhecimento para ajudar. O serviço é operado por <b>{{controllerName}}</b> (CNPJ {{controllerDoc}}), empresa do regime Inova Simples, com endereço em {{controllerAddress}}.</p>
<p>Ao tocar em <b>Aceito</b> no WhatsApp, você declara que leu e concorda com estes Termos e com a Política de Privacidade (Parte B). Se não concordar, não use o serviço.</p>

<h3>2. O que o serviço oferece</h3>
<ul>
<li>Conectar mentorados e mentores por meio <b>deste bot de WhatsApp</b>. O projeto está em <b>fase de validação</b>; para o próximo ano está previsto o lançamento de uma plataforma com interface própria.</li>
<li>Assuntos: dúvidas de disciplinas da base curricular, pesquisa avançada, iniciação científica e vivência universitária (por exemplo, trotes de curso e rotina acadêmica).</li>
<li>Registrar mentorias (por áudio) e informar seus horários livres.</li>
<li>Validar as mentorias com <b>conferência final da nossa equipe</b> e emitir um <b>certificado de horas complementares</b>, que você mesmo(a) decide submeter à sua instituição de ensino. <b>Nenhum dado pessoal das mentorias é enviado a bancos de dados de IA</b>: a gravação e a transcrição são tratadas só em equipamento da nossa equipe.</li>
</ul>

<h3>3. Quem pode usar</h3>
<p>O serviço é voltado a estudantes universitários, <b>maiores de 18 anos</b>. Se você tem menos de 18 anos, só pode usar o serviço com o consentimento específico e em destaque de pelo menos um dos seus pais ou responsável legal (LGPD, art. 14, § 1º). Fale conosco antes de continuar.</p>

<h3>4. Suas responsabilidades</h3>
<ul>
<li>Informar dados verdadeiros (nome completo e turma). Nomes falsos ou de outra pessoa podem levar à suspensão.</li>
<li>Usar o serviço apenas para fins acadêmicos, com respeito aos demais participantes. É proibido assediar, discriminar, fazer spam, enviar conteúdo ilegal ou violar direitos autorais.</li>
<li>Não enviar dados pessoais de terceiros, nem dados sensíveis (saúde, religião, orientação sexual, opinião política etc.), em mensagens, áudios ou documentos, a menos que seja indispensável e você tenha autorização.</li>
<li>Enviar apenas áudios de mentorias <b>de que você participou</b>, e somente depois de avisar a outra pessoa de que a conversa será gravada e analisada para validar as horas. A outra pessoa também precisa estar cadastrada e confirmar a mentoria.</li>
</ul>

<h3>5. Mentorias, mentores e horas complementares</h3>
<ul>
<li>Mentores são <b>estudantes</b>, não profissionais contratados. A orientação deles não substitui a de professores, orientadores ou profissionais habilitados, e não garantimos resultado.</li>
<li>Nenhuma hora é concedida sem a conferência da nossa equipe. Quem decide aceitar o certificado e contar as horas é a <b>sua instituição de ensino</b>; não garantimos o aceite.</li>
</ul>

<h3>6. Inteligência artificial</h3>
<p>Usamos um assistente de IA para entender mensagens (por exemplo, a opção que você quis escolher), ler seus horários livres, avaliar se um nome digitado parece real e responder perguntas sobre a Be My Mentor. A IA <b>não tira dúvidas acadêmicas</b>: sua dúvida é apenas registrada para que procuremos um mentor. A IA pode errar; se algo sair errado, é só repetir ou falar conosco.</p>

<h3>7. Conduta, suspensão, saída e alterações</h3>
<ul>
<li><b>Fraude:</b> na primeira fraude confirmada, a sessão não conta e você recebe uma advertência; na segunda, o acesso é encerrado. Certificados que contenham sessão fraudulenta são revogados, e a lista pública mostra apenas “revogado”, sem expor o motivo pessoal. Toda sanção é decidida por pessoas e você tem <b>10 dias</b> para apresentar defesa.</li>
<li>Você pode parar de receber mensagens a qualquer momento enviando <b>sair</b>. Para apagar seus dados, siga a Parte B (item 10).</li>
<li>Podemos atualizar estes Termos e a Política; quando houver mudança relevante, pediremos novo aceite. A versão vigente está sempre nesta página.</li>
</ul>

<h3>8. Responsabilidade, lei e foro</h3>
<p>Não nos responsabilizamos por conteúdo trocado entre usuários, nem por indisponibilidades do WhatsApp ou de provedores externos, na extensão permitida em lei. Estes Termos seguem a legislação brasileira. Eventuais disputas serão resolvidas no foro do seu domicílio, nos termos da lei.</p>

<h2 id="privacidade-politica">Parte B — Política de Privacidade</h2>
<p>Esta política explica, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, “<b>LGPD</b>”), quais dados tratamos, por quê, com quem os compartilhamos e como você exerce seus direitos.</p>

<h3>1. Controlador</h3>
<p>O controlador dos dados é a <b>{{controllerName}}</b> (CNPJ {{controllerDoc}}), {{controllerAddress}}. Canais: e-mail <b>{{contactEmail}}</b> ou WhatsApp <a href="{{whatsappLink}}"><b>{{whatsapp}}</b></a> (Cauan, um dos fundadores, junto com o Bruno).</p>
<p>A sua instituição de ensino <b>não é controladora nem operadora</b> destes dados: ela não recebe dados da Be My Mentor. Ela só recebe o certificado que <b>você</b> decide levar a ela.</p>

<h3>2. Encarregado (DPO)</h3>
<p>Encarregado pelo tratamento de dados pessoais (art. 41): <b>{{dpo}}</b>. Ele recebe seus pedidos e reclamações e conversa com a ANPD.</p>

<h3>3. Quais dados tratamos, para quê e com que base legal</h3>
<table>
<thead><tr><th>Dado</th><th>Finalidade</th><th>Base legal (art. 7º)</th></tr></thead>
<tbody>
<tr><td>Número de WhatsApp e identificadores técnicos da conversa</td><td>Falar com você e operar o serviço; segurança e prevenção a abusos</td><td>Execução do serviço a seu pedido (V); legítimo interesse em segurança (IX)</td></tr>
<tr><td>Pseudônimo (código gerado a partir do seu telefone com uma chave secreta)</td><td>Ligar suas sessões, saldo de horas e conduta sem expor o telefone</td><td>Execução do serviço (V)</td></tr>
<tr><td>Nome completo e turma</td><td>Identificar você, conectar mentores e mentorados, validar e emitir o certificado</td><td>Execução do serviço (V); consentimento (I)</td></tr>
<tr><td>Áudio de apresentação (voz e o que você disser: data de nascimento, esporte, time, hobbies e interesses)</td><td>Fazer a combinação (<i>match</i>) entre pessoas com afinidades</td><td>Consentimento (I)</td></tr>
<tr><td>Papel (mentor, mentorado ou os dois) e áreas em que topa ajudar</td><td>Organizar o <i>match</i></td><td>Execução do serviço (V); consentimento (I)</td></tr>
<tr><td>Dúvidas e documentos que você anexar</td><td>Encontrar um mentor e repassar o material a ele(a)</td><td>Execução do serviço (V); consentimento (I)</td></tr>
<tr><td>Dias e horários livres</td><td>Agendar mentorias</td><td>Execução do serviço (V)</td></tr>
<tr><td>Áudios das mentorias (inclusive a voz da outra pessoa), transcrições e identificação de quem falou cada trecho (diarização)</td><td>Validar a sessão, emitir o certificado e permitir contestação</td><td>Execução do serviço (V); consentimento (I)</td></tr>
<tr><td>Resultado da validação: situação da sessão, minutos contabilizados e saldo; avisos enviados e pedidos de revisão</td><td>Mostrar o resultado, avisar você uma única vez e atender pedidos de revisão humana</td><td>Execução do serviço (V)</td></tr>
<tr><td>Texto das suas mensagens</td><td>Entender o que você quis dizer (IA), responder perguntas sobre a Be My Mentor</td><td>Consentimento (I)</td></tr>
<tr><td>Registro do aceite (data e versão destes Termos), registros técnicos de envio e trilha de auditoria</td><td>Comprovar o consentimento; controle de uso; prevenção a fraude</td><td>Obrigação legal e exercício regular de direitos (II e VI); legítimo interesse (IX)</td></tr>
</tbody>
</table>
<p><b>Terceiros citados na conversa.</b> Pessoas que não participam da mentoria podem ser mencionadas nos áudios. A transcrição fica apenas com a nossa equipe, não é usada para outra finalidade e tem prazo para ser apagada (item 7). Evite citar outras pessoas.</p>
<p><b>Dados sensíveis.</b> Não pedimos dados pessoais sensíveis (art. 5º, II). Se você os mencionar por conta própria em áudios ou documentos, eles não serão usados e serão eliminados nos prazos do item 7; evite enviá-los.</p>

<h3>4. Como tratamos a sua voz</h3>
<p>A voz é dado pessoal. Usamos o áudio da mentoria para <b>transcrever</b> e para <b>separar quem fala em cada trecho</b> dentro daquela sessão (diarização). Os nomes vêm do cadastro e do que vocês dizem na gravação. <b>Não criamos nem guardamos perfil de voz</b>, não comparamos sua voz entre sessões e não a usamos para autenticar ou identificar você fora da mentoria.</p>

<h3>5. Com quem compartilhamos</h3>
<p><b>Nós não vendemos nem comercializamos seus dados</b>, e eles não são compartilhados com terceiros para outras finalidades. Para o serviço funcionar, compartilhamos o mínimo necessário com:</p>
<ul>
<li><b>Outros participantes da mentoria</b>: seu mentor ou mentorado vê o que for necessário (nome, turma, dúvida, material anexado e horários livres).</li>
<li><b>Sua instituição de ensino</b>: só recebe o <b>certificado</b> que você decidir submeter. Gravação, transcrição e análise ficam com a nossa equipe.</li>
<li><b>Prestadores de serviço (operadores)</b>, que tratam dados somente sob nossas instruções: WhatsApp (Meta) e o servidor que faz a ponte com o WhatsApp (envio e recebimento de mensagens e arquivos), Cloudflare (hospedagem do bot e armazenamento temporário dos áudios), Supabase (banco de dados) e Groq / xAI (provedores de inteligência artificial, que recebem apenas o texto das suas mensagens). Carimbos de tempo públicos (OpenTimestamps) recebem apenas códigos de verificação (<i>hashes</i>), nunca dados pessoais.</li>
<li><b>Autoridades</b>, quando houver obrigação legal ou ordem judicial.</li>
</ul>
<p>A <b>transcrição e a análise das gravações</b> rodam em equipamento próprio da nossa equipe: a gravação e a transcrição <b>não são enviadas a nenhum serviço de IA de terceiros</b>. Antes disso, porém, o áudio bruto passa pelo WhatsApp, pelo servidor da ponte e pela Cloudflare até chegar até nós.</p>

<h3>6. Transferência internacional</h3>
<p>Alguns prestadores (como WhatsApp/Meta, Cloudflare, Supabase e os provedores de IA) podem processar dados <b>fora do Brasil</b>, inclusive nos Estados Unidos. Fazemos isso com base no seu <b>consentimento específico e em destaque</b> (art. 33, VIII), dado ao aceitar esta política, e com contratos que exigem proteção compatível com a LGPD. Você pode revogar o consentimento a qualquer momento (item 10), o que pode impedir o uso do serviço.</p>

<h3>7. Certificado e registros verificáveis</h3>
<p>Para dar confiança ao certificado, mantemos um livro de registro e carimbos de tempo públicos que contêm <b>somente informações pseudonimizadas</b> (códigos, <i>hashes</i> e números), nunca nome, telefone, áudio ou texto de transcrição. O seu nome fica em um arquivo separado, que pode ser apagado a seu pedido. A página pública de verificação mostra apenas horas, período, emissor e situação do certificado, <b>sem nome, sem código de participante e sem lista de sessões</b>, e não é indexada por buscadores. O certificado completo (com seu nome e as sessões) fica com você e com a nossa equipe.</p>

<h3>8. Por quanto tempo guardamos</h3>
<ul>
<li><b>Número de WhatsApp, nome, turma, perfil e horários</b>: enquanto você usar o serviço e por até <b>12 meses</b> depois do último contato; depois, eliminados ou anonimizados.</li>
<li><b>Áudio de apresentação</b>: pelo mesmo prazo, enquanto for usado para a combinação entre pessoas.</li>
<li><b>Áudios das mentorias</b>: ficam armazenados na nuvem só até chegarem à nossa equipe, e depois em equipamento próprio, onde são apagados cerca de 30 dias depois de a sessão ser decidida (exceto se houver contestação ou apuração de conduta em aberto).</li>
<li><b>Transcrições e pareceres</b>: por até <b>12 meses</b> depois da decisão sobre a sessão, ou por mais tempo enquanto houver contestação ou apuração de conduta em aberto.</li>
<li><b>Comprovante do aceite</b>: por até <b>5 anos</b>, para o exercício regular de direitos.</li>
<li><b>Registros técnicos de acesso</b>: por <b>6 meses</b>, quando exigido pelo Marco Civil da Internet (art. 15).</li>
<li><b>Livro de registro</b>: permanente, mas só com pseudônimos, <i>hashes</i> e números.</li>
</ul>
<p>Podemos guardar por mais tempo apenas quando a lei exigir ou para nos defendermos em processos.</p>

<h3>9. Segurança, crianças e adolescentes</h3>
<p>Adotamos medidas técnicas e administrativas proporcionais (art. 46): comunicação protegida por HTTPS; acesso restrito por chaves e senhas; telefones substituídos por códigos pseudonimizados nos registros e nos nomes dos arquivos; backups cifrados; e a transcrição e a análise feitas em equipamento próprio. Em caso de incidente de segurança que possa causar risco ou dano relevante, comunicaremos você e a ANPD (art. 48).</p>
<p>O serviço não é destinado a menores de 18 anos. Se soubermos que tratamos dados de menor sem o consentimento de um responsável, eliminaremos esses dados (art. 14).</p>

<h3 id="direitos-lgpd">10. Seus direitos e como exercê-los</h3>
<p>Nos termos do art. 18, você pode pedir, a qualquer momento e gratuitamente: <b>confirmação</b> de que tratamos seus dados; <b>acesso</b>; <b>correção</b> de dados incompletos, inexatos ou desatualizados; <b>anonimização, bloqueio ou eliminação</b> de dados desnecessários, excessivos ou tratados em desconformidade; <b>portabilidade</b>; <b>eliminação</b> dos dados tratados com consentimento; informação sobre com quem compartilhamos os dados; informação sobre a possibilidade de não consentir e suas consequências; e a <b>revogação do consentimento</b>.</p>
<ul>
<li><b>Como pedir</b>: pelo e-mail <b>{{contactEmail}}</b> ou pelo WhatsApp <a href="{{whatsappLink}}">{{whatsapp}}</a>, informando o número com o qual você usa o bot. Podemos pedir uma confirmação de identidade.</li>
<li><b>Prazo</b>: confirmação de tratamento imediata em formato simplificado, ou em até <b>15 dias</b> por declaração completa (art. 19).</li>
<li><b>Parar de receber mensagens</b>: envie <b>sair</b> no bot a qualquer momento. Isso não apaga seus dados; para apagá-los, faça o pedido pelos canais acima.</li>
<li>Se o pedido de eliminação envolver dados que a lei nos obriga a guardar (item 8), explicaremos o motivo.</li>
</ul>

<h3>11. Reclamações</h3>
<p>Se não ficar satisfeito, você pode peticionar à <b>Autoridade Nacional de Proteção de Dados (ANPD)</b>: <a href="https://www.gov.br/anpd">gov.br/anpd</a>.</p>

<h3>12. Inteligência artificial e decisões automatizadas</h3>
<p>No atendimento, a IA recebe <b>somente o texto da sua mensagem</b>, sem nome nem telefone, e só depois do seu aceite. Sobre a validação das mentorias (art. 20): <b>toda sessão aprovada passa pela conferência final da nossa equipe</b> antes de contar horas, e nenhuma hora é concedida sem uma pessoa. Toda sanção por conduta é decidida por pessoas. A única decisão automática é descartar a sessão que não cumpre critérios objetivos (duração, tempo de fala e dois participantes); nesse caso você recebe o motivo pelo WhatsApp e um botão <b>[Pedir revisão]</b>, que leva o caso a uma pessoa da equipe.</p>

<h3>13. Mudanças nesta política</h3>
<p>Podemos atualizar esta política. A versão vigente é a <b>{{version}}</b>, atualizada em {{updated}}. Se a mudança for relevante, pediremos um novo aceite. Cada aceite guarda a data e a versão aceitas.</p>
`;

const STYLE = `
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#000;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 20px 72px}
h1{font-size:1.7rem;line-height:1.25;margin:.2em 0}
h2{font-size:1.3rem;margin:2.2em 0 .4em;padding-top:.7em;border-top:2px solid #000}
h3{font-size:1.05rem;margin:1.6em 0 .3em}
p,li{margin:.5em 0}
a{color:#000;text-decoration:underline}
.meta{color:#444;font-size:.9rem}
nav{margin:1.2em 0;padding:.7em 1em;border:1px solid #000;border-radius:6px}
nav a{display:inline-block;margin-right:1.2em}
.draft{background:#fff;border:2px solid #000;padding:.8em 1em;border-radius:6px;margin:1em 0}
table{width:100%;border-collapse:collapse;font-size:.92rem;margin:1em 0}
th,td{border:1px solid #000;padding:.5em .6em;text-align:left;vertical-align:top}
th{background:#eee}
@media (max-width:560px){table,thead,tbody,tr,th,td{display:block}thead{display:none}tr{margin-bottom:.8em;border:1px solid #000;border-radius:6px}td{border:0;border-bottom:1px solid #000}}
mark{background:#000;color:#fff;padding:0 .25em;border-radius:3px}
`;

/** Renderiza a página (HTML completo, sem JavaScript). Campos vazios viram "[a preencher]" e ativam o aviso de rascunho. */
export function renderLegalPage(info: LegalInfo = LEGAL_INFO): string {
  const val = (k: keyof LegalInfo): string => (info[k].trim() === "" ? "<mark>[a preencher]</mark>" : esc(info[k].trim()));
  const body = BODY
    .replace(/\{\{controllerName\}\}/g, val("controllerName"))
    .replace(/\{\{controllerDoc\}\}/g, val("controllerDoc"))
    .replace(/\{\{controllerAddress\}\}/g, val("controllerAddress"))
    .replace(/\{\{contactEmail\}\}/g, val("contactEmail"))
    .replace(/\{\{dpo\}\}/g, val("dpo"))
    .replace(/\{\{whatsappLink\}\}/g, CONTACT_WHATSAPP_LINK)
    .replace(/\{\{whatsapp\}\}/g, CONTACT_WHATSAPP)
    .replace(/\{\{version\}\}/g, LEGAL_VERSION)
    .replace(/\{\{updated\}\}/g, LEGAL_UPDATED);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Termos de Uso e Política de Privacidade — Be My Mentor</title>
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Termos de Uso e Política de Privacidade — Be My Mentor</h1>
<p class="meta">Versão ${LEGAL_VERSION} · atualizada em ${LEGAL_UPDATED}</p>
<nav><a href="#termos">Termos de Uso</a><a href="#privacidade-politica">Política de Privacidade</a><a href="#direitos-lgpd">Seus direitos (LGPD)</a></nav>
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

export interface LegalSection {
  /** "termos" (Parte A) ou "privacidade" (Parte B, inclui os direitos da LGPD). */
  part: "termos" | "privacidade";
  title: string;
  text: string;
}

const decode = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");

/**
 * Os Termos de Uso e a Política de Privacidade em seções de texto simples (sem HTML): é a base (RAG) que o bot consulta
 * para responder perguntas sobre os termos. Sai do MESMO texto da página pública, então bot e página nunca divergem.
 */
export function legalSections(info: LegalInfo = LEGAL_INFO): LegalSection[] {
  const fill = (k: keyof LegalInfo): string => (info[k].trim() === "" ? "" : info[k].trim());
  const body = BODY
    .replace(/\{\{controllerName\}\}/g, fill("controllerName")).replace(/\{\{controllerDoc\}\}/g, fill("controllerDoc"))
    .replace(/\{\{controllerAddress\}\}/g, fill("controllerAddress")).replace(/\{\{contactEmail\}\}/g, fill("contactEmail"))
    .replace(/\{\{dpo\}\}/g, fill("dpo"))
    .replace(/\{\{whatsappLink\}\}/g, CONTACT_WHATSAPP_LINK).replace(/\{\{whatsapp\}\}/g, CONTACT_WHATSAPP)
    .replace(/\{\{version\}\}/g, LEGAL_VERSION).replace(/\{\{updated\}\}/g, LEGAL_UPDATED);
  const split = body.indexOf('<h2 id="privacidade-politica">');
  const out: LegalSection[] = [];
  const add = (part: LegalSection["part"], html: string): void => {
    const parts = html.split(/<h3[^>]*>/);
    for (const chunk of parts.slice(1)) {
      const [titleHtml, ...rest] = chunk.split("</h3>");
      const text = decode(
        rest.join("").replace(/<\/tr>/g, "\n").replace(/<\/(td|th)>/g, " — ").replace(/<\/li>|<\/p>/g, "\n").replace(/<[^>]+>/g, " "),
      ).replace(/[ \t]+/g, " ").replace(/ — \n/g, "\n").replace(/\n\s*/g, "\n").trim();
      out.push({ part, title: decode((titleHtml ?? "").replace(/<[^>]+>/g, "")).trim(), text });
    }
  };
  add("termos", body.slice(0, split < 0 ? body.length : split));
  if (split >= 0) add("privacidade", body.slice(split));
  return out;
}
