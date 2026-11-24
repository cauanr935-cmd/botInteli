// Páginas do painel (HTML/JS puros). CSP com nonce: sem recursos externos. Dados exibidos só via textContent (sem XSS).
// Sem crases e sem "dollar-chave" dentro dos scripts (estão em String.raw).
const BASE_CSS = String.raw`
:root{--bg:#f4f6f8;--card:#fff;--txt:#14202b;--sub:#5d6b78;--line:#dde3e8;--acc:#0b7a5b}
@media (prefers-color-scheme:dark){:root{--bg:#0f161c;--card:#18222b;--txt:#e6edf3;--sub:#93a1ad;--line:#2a3640;--acc:#2fbf93}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.4 system-ui,sans-serif}
button,input{font:inherit}
`;

export function loginPage(nonce: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Painel — entrar</title>
<style nonce="${nonce}">${BASE_CSS}
.wrap{min-height:100vh;display:grid;place-items:center;padding:16px}
form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px}
h1{font-size:18px;margin:0 0 4px}label{font-size:13px;color:var(--sub)}
input{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt)}
button{padding:10px;border:0;border-radius:8px;background:var(--acc);color:#fff;font-weight:600;cursor:pointer}
button:disabled{opacity:.6}#err{color:#c62828;font-size:13px;min-height:18px}</style></head>
<body><div class="wrap"><form id="f" autocomplete="on"><h1>Painel de mentorias</h1>
<div><label for="u">Usuário</label><input id="u" name="username" autocomplete="username" required></div>
<div><label for="p">Senha</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
<div id="err" role="alert"></div><button id="b" type="submit">Entrar</button></form></div>
<script nonce="${nonce}">${String.raw`
document.getElementById("f").addEventListener("submit", function(e){
  e.preventDefault();
  var b = document.getElementById("b"), err = document.getElementById("err");
  b.disabled = true; err.textContent = "";
  fetch("/painel/api/login", {method:"POST", credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-Requested-With":"painel"},
    body: JSON.stringify({user: document.getElementById("u").value, password: document.getElementById("p").value})})
  .then(function(r){ return r.json().then(function(j){ return {r:r, j:j}; }); })
  .then(function(x){
    if(x.r.ok){ location.reload(); return; }
    err.textContent = x.r.status === 429 ? "Muitas tentativas. Tente novamente mais tarde." : (x.j.error || "Falha ao entrar.");
    b.disabled = false;
  }).catch(function(){ err.textContent = "Sem conexão."; b.disabled = false; });
});`}</script></body></html>`;
}

export function dashboardPage(nonce: string, open = false): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Painel de mentorias</title>
<style nonce="${nonce}">${BASE_CSS}
header{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:14px 16px;background:var(--card);border-bottom:1px solid var(--line)}
header h1{font-size:17px;margin:0;flex:1;min-width:160px}
header button,.btn{padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--txt);cursor:pointer}
.burger{font-size:20px;line-height:1;padding:6px 12px}
.menu{background:var(--card);border-bottom:1px solid var(--line);padding:8px 16px;display:flex;flex-direction:column;gap:2px}.menu[hidden]{display:none}
.menu button{text-align:left;padding:10px 12px;border:0;border-radius:8px;background:transparent;color:var(--txt);cursor:pointer}.menu button:hover,.menu button.on{background:var(--bg);color:var(--acc);font-weight:600}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.chip{padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--txt);cursor:pointer}.chip.on{background:var(--acc);color:#fff;border-color:var(--acc)}
select.pick{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt);margin-bottom:10px}
main{max-width:1200px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px}
.top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.subject{font-weight:600;font-size:16px;flex:1}
.pill{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--sub);white-space:nowrap}
.pill.ok{color:var(--acc);border-color:var(--acc)}.pill.warn{color:#b26a00;border-color:#b26a00}.pill.bad{color:#c62828;border-color:#c62828}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:8px 0;font-size:14px}dt{color:var(--sub)}dd{margin:0}
audio{width:100%;max-width:420px;margin-top:6px}pre{background:var(--bg);padding:8px;border-radius:8px;overflow:auto;font-size:12px}
.empty{color:var(--sub);text-align:center;padding:28px 0}.muted{color:var(--sub);font-size:13px}
#more{display:block;margin:12px auto;padding:8px 16px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--txt);cursor:pointer}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.stat b{display:block;font-size:26px;color:var(--acc)}.stat span{font-size:13px;color:var(--sub)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
h2{font-size:15px;margin:0 0 10px}h3{font-size:14px;margin:14px 0 6px;color:var(--acc)}
.pills{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.doubt.sel{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc)}
.txt{white-space:pre-wrap;word-break:break-word;margin:6px 0}
.go{padding:7px 12px;border:0;border-radius:8px;background:var(--acc);color:#fff;font-weight:600;cursor:pointer}
.go[disabled]{opacity:.5;cursor:not-allowed}.go.confirm{background:#b26a00}.go.cancel{background:#c62828}
.banner{background:var(--card);border:1px solid var(--acc);border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:14px}
#toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--txt);color:var(--bg);padding:10px 16px;border-radius:10px;max-width:90vw;display:none;z-index:9}
.mentor{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line);padding:8px 0}.mentor:first-of-type{border-top:0}.mentor .who{flex:1;min-width:150px}
#up .updrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}#up input[type=tel]{flex:1;min-width:230px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt)}#up input[type=file]{max-width:100%;color:var(--txt)}
@media (max-width:860px){.cols{grid-template-columns:1fr}}
@media (max-width:560px){main{padding:10px}dl{grid-template-columns:1fr}dt{margin-top:6px}.card{padding:12px}}</style></head>
<body><header><button class="btn burger" id="burger" aria-label="Menu" aria-expanded="false" aria-controls="menu">&#9776;</button><h1 id="title">Página inicial</h1></header>
<nav class="menu" id="menu" hidden>
  <button data-go="dash">Página inicial</button><button data-go="conn">Conexões</button><button data-go="ment">Mentorias registradas</button><button data-go="bot">Status do bot</button>
  <button id="reload">Atualizar</button>${open ? "" : `<button id="out">Sair</button>`}
</nav>
<main>
<section id="v-dash">
  <div class="stats" id="stats"></div>
  <div id="banner"></div>
  <div class="cols">
    <div><h2>Dúvidas dos mentorados</h2><div id="doubts"></div></div>
    <div><h2>Mentores por disciplina</h2><div id="mentors"></div></div>
  </div>
</section>
<section id="v-conn" hidden>
  <h2>Conexões (matches)</h2><div class="chips" id="mfilters"></div><div id="matches"></div><button id="mmore" hidden style="display:block;margin:12px auto;padding:8px 16px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--txt);cursor:pointer">Mostrar mais</button>
</section>
<section id="v-bot" hidden>
  <div class="card" id="ai"><div class="top"><div class="subject">IA do bot</div><button class="btn" id="ai-test">Testar agora</button></div><div id="ai-rows"><p class="muted">verificando…</p></div></div>
</section>
<section id="v-ment" hidden>
  <div class="card" id="up">
    <div class="top"><div class="subject">Enviar áudio de uma mentoria</div></div>
    <p class="muted">Para o áudio que não chegou pelo WhatsApp. Ao confirmar, o bot trata como um áudio recebido, registra e avisa a pessoa no WhatsApp para continuar. Só funciona para quem já escreveu ao bot.</p>
    <div class="updrow">
      <input id="up-phone" type="tel" inputmode="numeric" placeholder="Telefone com DDI e DDD (ex.: 5511999990000)" autocomplete="off">
      <input id="up-file" type="file" accept="audio/*,video/mp4,video/mpeg,video/webm,video/ogg,.mp3,.mpeg,.mpg,.mpga,.mp2,.m4a,.mp4,.m4v,.ogg,.oga,.ogv,.opus,.wav,.aac,.amr,.webm,.flac,.3gp,.aif,.aiff,.wma">
      <button class="go" id="up-go" disabled>Enviar áudio</button>
      <button class="btn" id="up-cancel" hidden>Cancelar</button>
    </div>
    <p class="muted" id="up-msg" role="status"></p>
  </div>
  <div id="reviews"></div><div id="list"></div><button id="more" hidden>Carregar mais</button></section>
</main><div id="toast" role="status"></div>
<script nonce="${nonce}">${String.raw`
(function(){
  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; }
  function fmt(iso){ return new Date(iso).toLocaleString("pt-BR"); }
  function ago(iso){ var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime())/60000)); return m < 60 ? "há " + m + " min" : m < 1440 ? "há " + Math.round(m/60) + " h" : "há " + Math.round(m/1440) + " d"; }
  function hh(t){ var p = String(t||"").split(":"); return p.length < 2 ? "" : Number(p[0]) + "h" + (p[1] === "00" ? "" : p[1]); }
  function cap(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
  function row(dl, k, v){ dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, v)); }
  var toastT = null;
  function toast(msg){ var t = document.getElementById("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(function(){ t.style.display = "none"; }, 6000); }
  function post(url, body){
    return fetch(url, {method:"POST", credentials:"same-origin", headers:{"Content-Type":"application/json","X-Requested-With":"painel"}, body: JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j, status:r.status}; }); });
  }

  /* ---------- menu ---------- */
  var VIEWS = {dash:"Página inicial", conn:"Conexões", ment:"Mentorias registradas", bot:"Status do bot"};
  var cur = "dash", menu = document.getElementById("menu"), burger = document.getElementById("burger");
  function setMenu(open){ menu.hidden = !open; burger.setAttribute("aria-expanded", open ? "true" : "false"); }
  burger.onclick = function(){ setMenu(menu.hidden); };
  function go(which){
    cur = which;
    Object.keys(VIEWS).forEach(function(k){ document.getElementById("v-" + k).hidden = k !== which; });
    document.getElementById("title").textContent = VIEWS[which];
    Array.prototype.forEach.call(menu.querySelectorAll("[data-go]"), function(b){ b.className = b.getAttribute("data-go") === which ? "on" : ""; });
    setMenu(false);
    if(which === "ment" && !list.firstChild) loadMent(true);
  }
  Array.prototype.forEach.call(menu.querySelectorAll("[data-go]"), function(b){ b.onclick = function(){ go(b.getAttribute("data-go")); }; });

  /* ---------- enviar áudio de mentoria pela equipe ---------- */
  (function(){
    var phoneI = document.getElementById("up-phone"), fileI = document.getElementById("up-file"), go = document.getElementById("up-go"),
        cancel = document.getElementById("up-cancel"), msg = document.getElementById("up-msg");
    var armed = false, busy = false;
    var OUT = {
      done: "Pronto: o áudio foi registrado e a pessoa foi avisada no WhatsApp.",
      unknown_contact: "Esse número nunca escreveu ao bot, então não dá para enviar (proteção contra mensagem fria).",
      no_consent: "Essa pessoa ainda não aceitou os termos, então o áudio não pode ser guardado.",
      invalid: "O arquivo foi recusado (tipo ou tamanho fora do aceito).",
      failed: "Não deu para processar o arquivo agora. Tente de novo."
    };
    function digits(){ return phoneI.value.replace(/\D/g, ""); }
    function ready(){ return digits().length >= 10 && digits().length <= 15 && fileI.files && fileI.files.length === 1; }
    function reset(){ armed = false; cancel.hidden = true; go.className = "go"; go.textContent = "Enviar áudio"; go.disabled = !ready() || busy; }
    function refresh(){ if(armed) reset(); go.disabled = !ready() || busy; }
    phoneI.oninput = refresh; fileI.onchange = function(){ msg.textContent = ""; refresh(); };
    cancel.onclick = function(){ reset(); msg.textContent = ""; };
    go.onclick = function(){
      if(!ready() || busy) return;
      var f = fileI.files[0], mb = (f.size / 1048576).toFixed(1);
      if(!armed){
        armed = true; cancel.hidden = false; go.className = "go confirm"; go.textContent = "Confirmar envio";
        msg.textContent = "Vai registrar " + f.name + " (" + mb + " MB) para +" + digits() + " e avisar a pessoa no WhatsApp. Clique em Confirmar envio.";
        return;
      }
      busy = true; armed = false; cancel.hidden = true; go.disabled = true; go.textContent = "Enviando…";
      msg.textContent = "Enviando " + mb + " MB, aguarde (não feche a página)…";
      fetch("/painel/api/audio-manual?phone=" + digits() + "&name=" + encodeURIComponent(f.name), {
        method: "POST", credentials: "same-origin", body: f,
        headers: { "Content-Type": f.type || "application/octet-stream", "X-Requested-With": "painel" }
      }).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return {ok: r.ok, j: j}; }); })
        .then(function(x){
          var t = x.ok ? OUT.done : (x.j.outcome ? OUT[x.j.outcome] : x.j.error) || OUT.failed;
          msg.textContent = t; toast(t); if(x.ok){ fileI.value = ""; }
        })
        .catch(function(){ msg.textContent = OUT.failed; toast(OUT.failed); })
        .then(function(){ busy = false; reset(); });
    };
    reset();
  })();

  /* ---------- dashboard ---------- */
  var data = null, selected = null, confirmKey = null, discKey = "", mfilter = "all", mshow = 20;
  var ACTIVE = ["aguardando_mentor", "aguardando_mentorado", "aguardando_local", "sem_horario"];
  var STATUS = {
    aguardando_mentor: ["aguardando horários do mentor", "warn"], aguardando_mentorado: ["aguardando o mentorado escolher", "warn"],
    aguardando_local: ["aguardando o local", "warn"], sem_horario: ["sem horário em comum: nova grade pedida", "bad"],
    confirmado: ["mentoria confirmada", "ok"], realizada: ["mentoria realizada", "ok"], cancelado: ["cancelado", ""]
  };
  function renderStats(){
    var box = document.getElementById("stats"); box.textContent = "";
    [["Usuários na rede", data.counts.members.total], ["Mentores inscritos", data.counts.members.mentors], ["Mentorados inscritos", data.counts.members.mentees], ["Dúvidas abertas", data.counts.openDoubts], ["Conexões em andamento", data.counts.activeMatches], ["Mentorias confirmadas", data.counts.confirmed], ["Mentorias concluídas", data.counts.completed || 0]].forEach(function(x){
      var s = el("div", "stat"); s.appendChild(el("b", null, String(x[1]))); s.appendChild(el("span", null, x[0])); box.appendChild(s);
    });
  }
  function renderBanner(){
    var b = document.getElementById("banner"); b.textContent = "";
    var d = selected !== null ? data.doubts.filter(function(x){ return x.seq === selected; })[0] : null;
    if(!d){ selected = null; return; }
    var w = el("div", "banner");
    w.appendChild(el("span", null, "Conectando a dúvida D" + d.seq + " de " + (d.name || "mentorado") + ". Escolha um mentor na disciplina da dúvida. "));
    var c = el("button", "btn", "Cancelar seleção"); c.onclick = function(){ selected = null; confirmKey = null; render(); }; w.appendChild(c);
    b.appendChild(w);
  }
  function renderDoubts(){
    var box = document.getElementById("doubts"); box.textContent = "";
    if(data.doubts.length === 0){ box.appendChild(el("div", "empty", "Nenhuma dúvida aberta agora.")); return; }
    data.doubts.forEach(function(d){
      var c = el("div", "card doubt" + (d.seq === selected ? " sel" : ""));
      var top = el("div", "top"); top.appendChild(el("div", "subject", "D" + d.seq + " · " + (d.name || "sem nome")));
      top.appendChild(el("span", "muted", d.phoneMasked + " · " + ago(d.createdAt))); c.appendChild(top);
      var pills = el("div", "pills"); (d.categories.length ? d.categories : [{label:"sem disciplina"}]).forEach(function(k){ pills.appendChild(el("span", "pill", k.label)); }); c.appendChild(pills);
      c.appendChild(el("div", "txt", d.text));
      var b = el("button", "go", d.seq === selected ? "Escolhendo mentor…" : "Conectar a um mentor");
      b.onclick = function(){ selected = d.seq; confirmKey = null; discKey = d.categories.length ? d.categories[0].key : discKey; render(); var m = document.getElementById("mentors"); if(m.scrollIntoView && window.innerWidth < 860) m.scrollIntoView({behavior:"smooth"}); };
      c.appendChild(b); box.appendChild(c);
    });
  }
  function mentorRow(m, doubt){
    var r = el("div", "mentor"), who = el("div", "who");
    who.appendChild(el("div", null, "M" + m.seq + " · " + (m.name || "sem nome")));
    who.appendChild(el("div", "muted", m.phoneMasked + " · " + (m.slots ? m.slots.replace(/\n/g, "  ") : "sem horários informados")));
    r.appendChild(who);
    if(m.busy) r.appendChild(el("span", "pill warn", "em outra conexão"));
    if(doubt){
      var key = doubt.seq + "-" + m.seq, ask = confirmKey === key;
      var b = el("button", "go" + (ask ? " confirm" : ""), ask ? "Confirmar: o bot vai chamar " + (m.name || "o mentor") : "Conectar com D" + doubt.seq);
      b.disabled = !!m.busy;
      b.onclick = function(){
        if(!ask){ confirmKey = key; render(); return; }
        b.disabled = true; b.textContent = "Conectando…";
        post("/painel/api/match", {doubtSeq: doubt.seq, mentorSeq: m.seq}).then(function(x){
          toast(x.j.message || x.j.error || "Falha."); if(x.ok){ selected = null; } confirmKey = null; load();
        }).catch(function(){ toast("Sem conexão."); confirmKey = null; render(); });
      };
      r.appendChild(b);
    }
    return r;
  }
  function renderMentors(){
    var box = document.getElementById("mentors"); box.textContent = "";
    if(data.mentors.length === 0){ box.appendChild(el("div", "empty", "Nenhum mentor cadastrado ainda.")); return; }
    var doubt = selected !== null ? data.doubts.filter(function(x){ return x.seq === selected; })[0] : null;
    var want = doubt ? doubt.categories.map(function(k){ return k.key; }) : [];
    var known = data.disciplines.map(function(d){ return d.key; });
    function inDisc(m, key){ return m.categories.some(function(k){ return k.key === key; }); }
    var rest = data.mentors.filter(function(m){ return !m.categories.some(function(k){ return known.indexOf(k.key) >= 0; }); });
    var opts = [];
    data.disciplines.forEach(function(dsc){ var n = data.mentors.filter(function(m){ return inDisc(m, dsc.key); }).length; if(n) opts.push({key: dsc.key, label: dsc.label, n: n}); });
    opts.sort(function(a, b){ return (want.indexOf(b.key) >= 0 ? 1 : 0) - (want.indexOf(a.key) >= 0 ? 1 : 0); });
    if(rest.length) opts.push({key: "_none", label: "Sem disciplina informada", n: rest.length});
    if(!opts.some(function(o){ return o.key === discKey; })) discKey = "";
    var sel = el("select", "pick"); sel.setAttribute("aria-label", "Disciplina");
    var ph = el("option", null, "Escolha uma disciplina…"); ph.value = ""; sel.appendChild(ph);
    opts.forEach(function(o){ var op = el("option", null, o.label + " (" + o.n + ")" + (want.indexOf(o.key) >= 0 ? " · da dúvida" : "")); op.value = o.key; if(o.key === discKey) op.selected = true; sel.appendChild(op); });
    sel.onchange = function(){ discKey = sel.value; confirmKey = null; renderMentors(); };
    box.appendChild(sel);
    if(!discKey){ box.appendChild(el("p", "muted", "Escolha uma disciplina para ver os mentores dela.")); return; }
    var ms = discKey === "_none" ? rest : data.mentors.filter(function(m){ return inDisc(m, discKey); });
    var c = el("div", "card"); ms.forEach(function(m){ c.appendChild(mentorRow(m, doubt)); }); box.appendChild(c);
  }
  function renderMatches(){
    var box = document.getElementById("matches"); box.textContent = "";
    function inF(m, f){ return f === "all" || (f === "andamento" ? ACTIVE.indexOf(m.status) >= 0 : m.status === f); }
    var fb = document.getElementById("mfilters"); fb.textContent = "";
    [["all","Todas"],["andamento","Em andamento"],["confirmado","Confirmadas"],["realizada","Realizadas"],["cancelado","Canceladas"]].forEach(function(f){
      var n = data.matches.filter(function(m){ return inF(m, f[0]); }).length;
      var ch = el("button", "chip" + (mfilter === f[0] ? " on" : ""), f[1] + " (" + n + ")");
      ch.onclick = function(){ mfilter = f[0]; mshow = 20; confirmKey = null; renderMatches(); }; fb.appendChild(ch);
    });
    var all = data.matches.filter(function(m){ return inF(m, mfilter); }), mm = document.getElementById("mmore");
    mm.hidden = all.length <= mshow; mm.onclick = function(){ mshow += 20; renderMatches(); };
    if(all.length === 0){ box.appendChild(el("div", "empty", data.matches.length === 0 ? "Nenhuma conexão ainda." : "Nenhuma conexão neste filtro.")); return; }
    all.slice(0, mshow).forEach(function(m){
      var c = el("div", "card"), top = el("div", "top"), st = STATUS[m.status] || [m.status, ""];
      top.appendChild(el("div", "subject", "#" + m.seq + " · " + (m.mentee || "mentorado") + " ⇄ " + (m.mentor || "mentor")));
      top.appendChild(el("span", "pill " + st[1], st[0])); c.appendChild(top);
      c.appendChild(el("div", "txt", "D" + m.doubtSeq + ": " + m.doubtText));
      var dl = el("dl");
      if(m.day){ row(dl, "Horário", cap(m.day) + ", " + hh(m.start) + " às " + hh(m.end)); }
      if(m.location){ row(dl, "Local", m.location); }
      row(dl, "Criado", fmt(m.createdAt)); c.appendChild(dl);
      if(m.status !== "cancelado" && m.status !== "realizada" && m.status !== "confirmado"){
        var ck = "c" + m.seq;
        if(confirmKey === ck){
          var f = el("div", "card"), sel = el("select"), DAYS = [["segunda","Segunda"],["terca","Terça"],["quarta","Quarta"],["quinta","Quinta"],["sexta","Sexta"],["sabado","Sábado"],["domingo","Domingo"]];
          DAYS.forEach(function(d){ var o = el("option", null, d[1]); o.value = d[0]; sel.appendChild(o); });
          var t1 = el("input"), t2 = el("input"), loc = el("input");
          t1.type = "time"; t1.value = "18:00"; t2.type = "time"; t2.value = "20:00"; loc.type = "text"; loc.placeholder = "Local (opcional)"; loc.maxLength = 100;
          [sel, t1, t2, loc].forEach(function(x){ f.appendChild(x); });
          var ok = el("button", "go", "Enviar confirmação aos dois");
          ok.onclick = function(){
            ok.disabled = true;
            post("/painel/api/match/confirm", {matchSeq: m.seq, day: sel.value, start: t1.value, end: t2.value, location: loc.value}).then(function(x){ toast(x.j.message || x.j.error || "Falha."); confirmKey = null; load(); }).catch(function(){ toast("Sem conexão."); confirmKey = null; render(); });
          };
          f.appendChild(ok); c.appendChild(f);
        } else {
          var cb = el("button", "go", "Confirmar horário"); cb.onclick = function(){ confirmKey = ck; render(); }; c.appendChild(cb);
        }
      }
      if(m.status !== "cancelado"){
        var key = "x" + m.seq, ask = confirmKey === key;
        var b = el("button", "go cancel", ask ? "Confirmar cancelamento" : "Cancelar conexão");
        b.onclick = function(){
          if(!ask){ confirmKey = key; render(); return; }
          b.disabled = true;
          post("/painel/api/match/cancel", {matchSeq: m.seq}).then(function(x){ toast(x.j.message || x.j.error || "Falha."); confirmKey = null; load(); }).catch(function(){ toast("Sem conexão."); confirmKey = null; render(); });
        };
        c.appendChild(b);
      }
      box.appendChild(c);
    });
  }
  function render(){ renderStats(); renderBanner(); renderDoubts(); renderMentors(); renderMatches(); }
  function num(n){ return Number(n).toLocaleString("pt-BR"); }
  var AI_LABEL = {ok:"funcionando", limit:"limite estourado", invalid_key:"chave inválida", no_key:"sem chave", bad_model:"modelo inválido", down:"fora do ar", config_invalid:"config inválida"};
  function aiRow(j){
    var r = el("div", "mentor"), who = el("div", "who");
    who.appendChild(el("b", null, j.provider + (j.active ? " · em uso pelo bot" : "")));
    var t = j.message + (j.model && j.state !== "no_key" ? " (" + j.model + ")" : "");
    if(j.limits){
      if(j.limits.requestsRemaining !== undefined) t += " · requisições restantes hoje: " + num(j.limits.requestsRemaining) + (j.limits.requestsLimit ? " de " + num(j.limits.requestsLimit) : "");
      if(j.limits.tokensRemaining !== undefined) t += " · tokens restantes no minuto: " + num(j.limits.tokensRemaining) + (j.limits.tokensLimit ? " de " + num(j.limits.tokensLimit) : "");
    }
    who.appendChild(el("div", "muted", t + " · verificado às " + new Date(j.checkedAt).toLocaleTimeString("pt-BR")));
    r.appendChild(who);
    var good = j.state === "ok", bad = j.state === "limit" || j.state === "invalid_key" || j.state === "bad_model";
    r.appendChild(el("span", "pill " + (good ? "ok" : bad ? "bad" : "warn"), AI_LABEL[j.state] || j.state));
    return r;
  }
  function loadAi(){
    var box = document.getElementById("ai-rows");
    box.textContent = ""; box.appendChild(el("p", "muted", "verificando…"));
    fetch("/painel/api/ia", {credentials:"same-origin"}).then(function(r){ return r.json(); }).then(function(j){
      box.textContent = "";
      if(!j || !j.items){ box.appendChild(el("p", "muted", "Não foi possível verificar agora.")); return; }
      j.items.forEach(function(it){ box.appendChild(aiRow(it)); });
    }).catch(function(){ box.textContent = ""; box.appendChild(el("p", "muted", "Não foi possível verificar agora.")); });
  }
  document.getElementById("ai-test").onclick = loadAi;
  function load(){
    fetch("/painel/api/dashboard", {credentials:"same-origin"}).then(function(r){
      if(r.status === 401){ location.reload(); return null; } return r.json();
    }).then(function(j){ if(!j) return; data = j; render(); })
    .catch(function(){ document.getElementById("doubts").textContent = "Falha ao carregar."; });
  }

  /* ---------- mentorias registradas (aba antiga) ---------- */
  var list = document.getElementById("list"), more = document.getElementById("more"), last = null, PAGE = 25;
  function kb(n){ return n < 1024 ? n + " B" : (n/1024).toFixed(1) + " KB"; }
  function card(m){
    var c = el("div", "card"), top = el("div", "top");
    top.appendChild(el("div", "subject", m.subject || "(sem assunto)"));
    top.appendChild(el("span", "pill " + (m.analysis.status === "done" ? "ok" : ""), m.analysis.status === "done" ? "analisada" : "análise pendente"));
    if(m.contested){ top.appendChild(el("span", "pill", m.contested === "recusada" ? "contestada pelo parceiro" : "expirada (sem resposta do parceiro)")); }
    else if(m.partnerStatus === "aguardando"){ top.appendChild(el("span", "pill", "aguardando confirmação do parceiro")); }
    c.appendChild(top);
    var dl = el("dl");
    row(dl, "Com quem", m.partner || "-");
    if(m.occurredOn){ row(dl, "Aconteceu em", m.occurredOn.split("-").reverse().join("/")); }
    row(dl, "Papel de quem registrou", m.role === "mentor" ? "Mentor" : m.role === "mentorado" ? "Mentorado" : "-");
    row(dl, "Registrado por", m.registrant ? ((m.registrant.name || "sem nome") + " (" + (m.registrant.phoneMasked || "-") + ")") : "-");
    row(dl, "Data", fmt(m.createdAt));
    row(dl, "Áudio", m.mime + " · " + kb(m.bytes));
    if(m.curadoria){
      var cs = {aguardando_equipe:"aguardando a equipe", aprovada:"aprovada", recusada:"recusada", parcial:"parcial"};
      row(dl, "Curadoria", cs[m.curadoria.status] || m.curadoria.status);
      m.curadoria.participantes.forEach(function(p){
        row(dl, "· " + (p.papel === "mentor" ? "Mentor" : p.papel === "mentorado" ? "Mentorado" : "Participante"),
          (cs[p.situacao] || p.situacao) + (p.situacao === "aguardando_equipe" ? "" : p.avisado ? " · já avisado" : " · não avisado"));
      });
    }
    c.appendChild(dl);
    if(m.audioDeleted){ c.appendChild(el("p", "muted", m.contested ? "Áudio apagado (mentoria contestada)." : "Áudio apagado após a análise.")); }
    else { var a = el("audio"); a.controls = true; a.preload = "none"; a.src = "/painel/audio/" + m.id; c.appendChild(a); }
    if(m.analysis.status === "done"){
      var d = el("details"); d.appendChild(el("summary", null, "Resultado da análise"));
      d.appendChild(el("pre", null, JSON.stringify(m.analysis.result, null, 2))); c.appendChild(d);
    }
    return c;
  }
  function loadReviews(){
    fetch("/painel/api/revisoes?status=aberta", {credentials:"same-origin"}).then(function(r){ return r.ok ? r.json() : null; }).then(function(j){
      var box = document.getElementById("reviews"); box.textContent = ""; if(!j || !j.items.length) return;
      var c = el("div", "card"); c.appendChild(el("h3", null, "Pedidos de revisão abertos (" + j.items.length + ")"));
      c.appendChild(el("p", "muted", "Atender pelo notebook: mentorias decidir --forcar."));
      j.items.forEach(function(x){
        var dl = el("dl");
        row(dl, "Mentoria", x.mentoriaId);
        row(dl, "Data", x.occurredOn ? x.occurredOn.split("-").reverse().join("/") : (x.createdAt ? fmt(x.createdAt) : "-"));
        row(dl, "Papel de quem pediu", x.role === "mentor" ? "Mentor" : x.role === "mentorado" ? "Mentorado" : "-");
        row(dl, "Pedido em", fmt(x.requestedAt)); c.appendChild(dl);
      });
      box.appendChild(c);
    }).catch(function(){});
  }
  function loadMent(reset){
    if(reset){ list.textContent = ""; last = null; loadReviews(); }
    var q = "/painel/api/mentorias?limit=" + PAGE + (last ? "&before=" + encodeURIComponent(last) : "");
    fetch(q, {credentials:"same-origin"}).then(function(r){
      if(r.status === 401){ location.reload(); return null; }
      return r.json();
    }).then(function(j){
      if(!j) return;
      if(j.items.length === 0 && !last){ list.appendChild(el("div", "empty", "Nenhuma mentoria registrada ainda.")); }
      j.items.forEach(function(m){ list.appendChild(card(m)); last = m.createdAt; });
      more.hidden = j.items.length < PAGE;
    }).catch(function(){ list.appendChild(el("div", "empty", "Falha ao carregar.")); });
  }
  more.onclick = function(){ loadMent(false); };
  document.getElementById("reload").onclick = function(){ setMenu(false); if(cur === "ment") loadMent(true); else if(cur === "bot") loadAi(); else load(); };
  var outBtn = document.getElementById("out");
  if(outBtn) outBtn.onclick = function(){
    fetch("/painel/api/logout", {method:"POST", credentials:"same-origin", headers:{"X-Requested-With":"painel"}}).then(function(){ location.reload(); });
  };
  load(); loadAi();
  setInterval(function(){ if((cur === "dash" || cur === "conn") && document.visibilityState === "visible" && !confirmKey) load(); }, 30000);
})();`}</script></body></html>`;
}
