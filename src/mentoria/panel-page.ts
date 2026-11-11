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

export function dashboardPage(nonce: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Painel de mentorias</title>
<style nonce="${nonce}">${BASE_CSS}
header{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:14px 16px;background:var(--card);border-bottom:1px solid var(--line)}
header h1{font-size:17px;margin:0;flex:1}
header button{padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--txt);cursor:pointer}
main{max-width:1100px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px}
.top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.subject{font-weight:600;font-size:16px;flex:1}
.pill{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--sub)}
.pill.ok{color:var(--acc);border-color:var(--acc)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:8px 0;font-size:14px}dt{color:var(--sub)}dd{margin:0}
audio{width:100%;max-width:420px;margin-top:6px}pre{background:var(--bg);padding:8px;border-radius:8px;overflow:auto;font-size:12px}
@media (max-width:560px){main{padding:10px}dl{grid-template-columns:1fr}dt{margin-top:6px}.card{padding:12px}}
.empty{color:var(--sub);text-align:center;padding:40px 0}
#more{display:block;margin:12px auto;padding:8px 16px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--txt);cursor:pointer}</style></head>
<body><header><h1>Painel de mentorias</h1><button id="reload">Atualizar</button><button id="out">Sair</button></header>
<main><div id="list"></div><button id="more" hidden>Carregar mais</button></main>
<script nonce="${nonce}">${String.raw`
(function(){
  var list = document.getElementById("list"), more = document.getElementById("more"), last = null, PAGE = 25;
  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; }
  function fmt(iso){ return new Date(iso).toLocaleString("pt-BR"); }
  function kb(n){ return n < 1024 ? n + " B" : (n/1024).toFixed(1) + " KB"; }
  function row(dl, k, v){ dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, v)); }
  function card(m){
    var c = el("div", "card"), top = el("div", "top");
    top.appendChild(el("div", "subject", m.subject || "(sem assunto)"));
    top.appendChild(el("span", "pill " + (m.analysis.status === "done" ? "ok" : ""), m.analysis.status === "done" ? "analisada" : "análise pendente"));
    c.appendChild(top);
    var dl = el("dl");
    row(dl, "Com quem", m.partner || "-");
    row(dl, "Papel de quem registrou", m.role === "mentor" ? "Mentor" : m.role === "mentorado" ? "Mentorado" : "-");
    row(dl, "Registrado por", m.registrant ? ((m.registrant.name || "sem nome") + " (" + (m.registrant.phoneMasked || "-") + ")") : "-");
    row(dl, "Data", fmt(m.createdAt));
    row(dl, "Áudio", m.mime + " · " + kb(m.bytes));
    c.appendChild(dl);
    var a = el("audio"); a.controls = true; a.preload = "none"; a.src = "/painel/audio/" + m.id; c.appendChild(a);
    if(m.analysis.status === "done"){
      var d = el("details"); d.appendChild(el("summary", null, "Resultado da análise"));
      d.appendChild(el("pre", null, JSON.stringify(m.analysis.result, null, 2))); c.appendChild(d);
    }
    return c;
  }
  function load(reset){
    if(reset){ list.textContent = ""; last = null; }
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
  document.getElementById("reload").onclick = function(){ load(true); };
  more.onclick = function(){ load(false); };
  document.getElementById("out").onclick = function(){
    fetch("/painel/api/logout", {method:"POST", credentials:"same-origin", headers:{"X-Requested-With":"painel"}}).then(function(){ location.reload(); });
  };
  load(true);
})();`}</script></body></html>`;
}
