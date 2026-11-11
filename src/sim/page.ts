// Página do simulador de chat (estilo WhatsApp). HTML/JS puros, sem dependências externas.
// Atenção: sem crases e sem "dollar-chave" dentro do script (está num String.raw).
export const PAGE_HTML = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Chat de teste</title>
<style>
  :root{--bg:#efeae2;--head:#008069;--out:#d9fdd3;--in:#fff;--txt:#111b21;--sub:#667781;--btn:#00a884}
  @media (prefers-color-scheme:dark){:root{--bg:#0b141a;--head:#1f2c34;--out:#005c4b;--in:#202c33;--txt:#e9edef;--sub:#8696a0;--btn:#00a884}}
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  @supports (height:100dvh){html,body{height:100dvh}} /* celular: a barra do navegador não corta o campo de texto */
  body{display:flex;flex-direction:column;background:var(--bg);color:var(--txt);font:15px/1.35 system-ui,sans-serif;max-width:720px;margin:0 auto}
  header{background:var(--head);color:#fff;padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top));display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  header b{flex:1}
  header small{opacity:.8;display:block;font-weight:400}
  header button{font-size:12px;margin-left:4px;background:transparent;border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;
    transition:transform .15s ease,background-color .15s ease,border-color .15s ease,box-shadow .15s ease}
  header button:hover:not(:disabled){transform:scale(1.1);background:rgba(255,255,255,.2);border-color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3)}
  header button:active:not(:disabled){transform:scale(.95);background:rgba(255,255,255,.35)}
  header button:focus-visible{outline:2px solid #fff;outline-offset:2px}
  header button:disabled{cursor:default}
  header button.working{background:#ffb300;border-color:#ffb300;color:#111;transform:scale(1.05)}
  header button.done{background:#00c853;border-color:#00c853;color:#fff;transform:scale(1.05)}
  header button.fail{background:#d32f2f;border-color:#d32f2f;color:#fff;transform:scale(1.05)}
  #feed{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:6px}
  .msg{max-width:82%;padding:7px 10px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 1px rgba(0,0,0,.15)}
  .in{align-self:flex-end;background:var(--out)}
  .out{align-self:flex-start;background:var(--in)}
  .time{display:block;text-align:right;font-size:11px;color:var(--sub);margin-top:2px}
  .opts{align-self:flex-start;display:flex;flex-direction:column;gap:4px;max-width:88%;width:min(260px,88%)}
  .opt{background:var(--in);color:var(--btn);border:0;border-radius:8px;padding:9px;font:600 14px system-ui;cursor:pointer;box-shadow:0 1px 1px rgba(0,0,0,.15)}
  .opt:disabled{opacity:.45;cursor:default}
  .typing{align-self:flex-start;color:var(--sub);font-style:italic}
  .err{align-self:center;color:#c62828;font-size:13px}
  footer{display:flex;gap:8px;padding:8px 10px;background:var(--head)}
  footer input[type=text]{flex:1;border:0;border-radius:20px;padding:10px 14px;font:inherit;background:var(--in);color:var(--txt)}
  footer button{border:0;border-radius:50%;width:42px;height:42px;background:var(--btn);color:#fff;font-size:18px;cursor:pointer}
  footer button{transition:transform .15s ease,background-color .15s ease}
  footer button:hover:not(:disabled){transform:scale(1.1)}
  footer button:active:not(:disabled){transform:scale(.94)}
  footer button:disabled{opacity:.4;cursor:default}
  footer button.rec{background:#d32f2f;animation:pulse 1.2s ease-in-out infinite}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(211,47,47,.55)}50%{box-shadow:0 0 0 9px rgba(211,47,47,0)}}
  #recbar{flex:1;display:none;align-items:center;gap:10px;background:var(--in);border-radius:20px;padding:4px 12px 4px 10px;min-width:0}
  #recbar.on{display:flex}
  #recdot{width:11px;height:11px;border-radius:50%;background:#d32f2f;flex:none;animation:blink 1s ease-in-out infinite}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
  #rectime{font:600 15px ui-monospace,Menlo,Consolas,monospace;color:var(--txt);min-width:42px}
  #wave{flex:1;height:34px;min-width:0}
  #recstate{font-size:12px;color:var(--sub);white-space:nowrap}
  #cancelRec{background:transparent;color:var(--sub);width:34px;height:34px;font-size:17px}
  #cancelRec:hover:not(:disabled){color:#d32f2f}
  @media (max-width:480px){#recstate{display:none}}
  #sheet{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:flex-end;justify-content:center}
  #sheet .box{background:var(--in);width:100%;max-width:720px;border-radius:14px 14px 0 0;max-height:70vh;overflow:auto;padding:8px 0}
  .row{padding:12px 18px;cursor:pointer;border-bottom:1px solid rgba(128,128,128,.2)}
  .row small{display:block;color:var(--sub)}
  audio{max-width:100%;width:240px;height:36px}
  .msg{overflow-wrap:anywhere}
  footer{padding-bottom:calc(8px + env(safe-area-inset-bottom))}
  footer input[type=text]{min-width:0;font-size:16px} /* 16px evita o zoom automático do iPhone ao digitar */
  #pop{max-width:calc(100vw - 16px)}
  #pop input{font-size:16px}
  #mpanel .box{width:min(680px,100vw - 16px)}
  @media (max-width:560px){
    header{padding:10px 12px;padding-top:calc(10px + env(safe-area-inset-top));gap:8px}
    header>div:first-child{flex:1 1 100%;min-width:0;padding-right:40px}
    header button{font-size:11px;padding:4px 8px;margin-left:0}
    header>#userBtn{position:absolute;top:calc(10px + env(safe-area-inset-top));right:12px}
    #pop{right:8px;top:48px}
    #feed{padding:10px 10px}
    .msg{max-width:90%}
    footer{gap:6px;padding-left:8px;padding-right:8px}
    footer button{width:38px;height:38px;font-size:16px}
    #recbar{padding:3px 8px}
    #pop .perr{font-size:12px}
  }
  @media (max-width:360px){footer button#doc{display:none}} /* telas muito estreitas: o campo de texto ganha espaço */
  header{position:relative}
  #userBtn{width:32px;height:32px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0}
  #userBtn svg{width:18px;height:18px;fill:currentColor}
  #userBtn.on{background:#ffb300;border-color:#ffb300;color:#111}
  #pop{display:none;position:absolute;top:50px;right:12px;z-index:5;width:230px;background:var(--in);color:var(--txt);border-radius:10px;padding:12px;box-shadow:0 4px 18px rgba(0,0,0,.3);font-size:13px}
  #pop.open{display:block}
  #pop input{width:100%;margin:0 0 8px;border:1px solid rgba(128,128,128,.4);border-radius:6px;padding:7px 9px;font:inherit;background:transparent;color:var(--txt)}
  #pop button{width:100%;border:0;border-radius:6px;padding:7px;background:var(--btn);color:#fff;font:600 13px system-ui;cursor:pointer;margin:0}
  #pop .perr{color:#c62828;font-size:12px;min-height:16px;margin-bottom:4px}
  #pop p{margin:0 0 8px}
  body.admin header{background:#5b3a00}
  .adminbar{background:#ffb300;color:#111;font-size:12px;text-align:center;padding:3px}
  .msg .tag{display:block;font-size:11px;font-weight:600;color:#b36b00;margin-bottom:2px}
  #pop .sw{background:#2e7d32;margin-bottom:8px}
  #pop .sw.off{background:#c62828}
  #pop .alt2{background:transparent;color:var(--btn);border:1px solid var(--btn);margin-bottom:8px}
  #mpanel{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:9}
  #mpanel .box{background:var(--in);color:var(--txt);width:min(680px,94vw);max-height:86vh;overflow:auto;border-radius:12px;padding:14px}
  #mpanel h3{margin:0 0 8px;font-size:15px;display:flex;justify-content:space-between;align-items:center}
  #mpanel pre{background:rgba(128,128,128,.15);border-radius:8px;padding:10px;overflow:auto;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:4px 0 6px}
  #mpanel .mb{margin:0 0 4px;font-size:12px;border:1px solid rgba(128,128,128,.4);background:transparent;color:var(--txt);border-radius:6px;padding:3px 9px;cursor:pointer}
  #mpanel .mt{font-weight:600;margin-top:10px}
</style>
</head>
<body>
<header><div style="flex:1"><b>Bot (modo teste)</b><small>mesmo motor do bot · sem WhatsApp</small></div><button id="resetNew" title="Apaga tudo e começa como primeiro contato">Reiniciar: 1º contato</button><button id="resetRet" title="Mantém o cadastro: o próximo oi pergunta a dúvida principal">Já cadastrado</button><button id="userBtn" title="Entrar como admin" aria-label="Entrar como admin"><svg viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z"/></svg></button>
<div id="pop"></div></header>
<div id="adminbar" class="adminbar" style="display:none">Modo admin: você está no lugar do bot</div>
<div id="feed"></div>
<footer>
  <input id="txt" type="text" placeholder="Mensagem" autocomplete="off">
  <div id="recbar" role="status" aria-live="polite">
    <button id="cancelRec" type="button" title="Cancelar gravação (não envia)">&#128465;</button>
    <span id="recdot"></span>
    <span id="rectime">0:00</span>
    <canvas id="wave" width="240" height="34"></canvas>
    <span id="recstate">Gravando… toque em &#9632; para enviar</span>
  </div>
  <button id="file" title="Anexar áudio">&#128206;</button>
  <button id="doc" title="Anexar documento">&#128196;</button>
  <button id="mic" title="Gravar áudio">&#127908;</button>
  <button id="send" title="Enviar">&#10148;</button>
</footer>
<input id="pick" type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.oga,.opus,.aac,.amr,.flac,.webm,.3gp,.aiff,.wma" hidden>
<input id="pickDoc" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" hidden>
<div id="sheet"><div class="box" id="rows"></div></div>
<script>
(function(){
  var KEY = new URLSearchParams(location.search).get("key") || "";
  var feed = document.getElementById("feed"), txt = document.getElementById("txt");
  var busy = false, rec = null, chunks = [];
  var ADMIN = "", BOT_ON = true;
  try { ADMIN = sessionStorage.getItem("chatAdmin") || ""; } catch(e) {}

  function api(path, opts){
    opts = opts || {}; opts.headers = Object.assign({"X-Chat-Key": KEY}, ADMIN ? {"X-Chat-Admin": ADMIN} : {}, opts.headers || {});
    return fetch(path, opts).then(function(r){ if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function hhmm(iso){ var d = new Date(iso); return d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}); }
  function scroll(){ feed.scrollTop = feed.scrollHeight; }
  function lockOpts(on){ document.querySelectorAll(".opt").forEach(function(b){ b.disabled = on; }); }

  function bubble(item){
    var el = document.createElement("div");
    el.className = "msg " + item.dir;
    if(ADMIN && item.by){
      var tg = document.createElement("span"); tg.className = "tag"; tg.textContent = "Você (admin)"; el.appendChild(tg);
    }
    if(item.kind === "audio"){
      var a = document.createElement("audio"); a.controls = true;
      fetch("/chat/api/media/" + item.mediaId, {headers:{"X-Chat-Key":KEY}}).then(function(r){return r.blob();})
        .then(function(b){ a.src = URL.createObjectURL(b); });
      el.appendChild(a);
    } else {
      el.appendChild(document.createTextNode(item.ui ? item.ui.body : (item.text || "")));
    }
    var t = document.createElement("span"); t.className = "time"; t.textContent = hhmm(item.at); el.appendChild(t);
    feed.appendChild(el);
    if(item.ui && item.ui.buttons){
      var box = document.createElement("div"); box.className = "opts";
      item.ui.buttons.forEach(function(b){
        var x = document.createElement("button"); x.className = "opt"; x.textContent = b.title;
        x.onclick = function(){ send({kind:"button", id:b.id, title:b.title}); };
        box.appendChild(x);
      });
      feed.appendChild(box);
    }
    if(item.ui && item.ui.list){
      var box2 = document.createElement("div"); box2.className = "opts";
      var y = document.createElement("button"); y.className = "opt"; y.textContent = "☰ " + item.ui.list.button;
      y.onclick = function(){ openList(item.ui.list); };
      box2.appendChild(y); feed.appendChild(box2);
    }
  }
  function showErr(e){ var d = document.createElement("div"); d.className = "err"; d.textContent = "Erro: " + e.message; feed.appendChild(d); scroll(); }
  function render(items){ items.forEach(bubble); scroll(); }
  var lastSig = "";
  function refresh(){
    return api("/chat/api/history").then(function(r){
      if(ADMIN && typeof r.botOn === "boolean" && r.botOn !== BOT_ON){ BOT_ON = r.botOn; applyMode(); }
      var sig = r.items.map(function(i){ return i.id; }).join("|");
      if(sig === lastSig) return;
      lastSig = sig;
      var stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
      feed.innerHTML = ""; r.items.forEach(bubble); if(stick) scroll();
    });
  }
  // Admin e pessoa consultam o histórico de poucos em poucos segundos.
  (function poll(){
    setTimeout(function(){ if(!busy && !rec && !document.hidden) refresh().catch(function(){}); poll(); }, ADMIN ? 2000 : 3000);
  })();

  function openList(list){
    var rows = document.getElementById("rows"); rows.innerHTML = "";
    list.rows.forEach(function(r){
      var d = document.createElement("div"); d.className = "row"; d.textContent = r.title;
      if(r.description){ var s = document.createElement("small"); s.textContent = r.description; d.appendChild(s); }
      d.onclick = function(){ closeSheet(); send({kind:"list", id:r.id, title:r.title}); };
      rows.appendChild(d);
    });
    document.getElementById("sheet").style.display = "flex";
  }
  function closeSheet(){ document.getElementById("sheet").style.display = "none"; }
  document.getElementById("sheet").onclick = function(e){ if(e.target.id === "sheet") closeSheet(); };

  function run(promise){
    if(busy) return; busy = true; lockOpts(true);
    var t = document.createElement("div"); t.className = "typing"; t.textContent = "digitando…"; feed.appendChild(t); scroll();
    promise().then(function(){ t.remove(); lastSig = ""; return refresh(); })
      .catch(function(e){ t.remove(); var d = document.createElement("div"); d.className = "err"; d.textContent = "Erro: " + e.message; feed.appendChild(d); scroll(); })
      .then(function(){ busy = false; lockOpts(false); });
  }
  function send(input){
    run(function(){ return api("/chat/api/send", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(input)}); });
  }
  function sendAudio(blob){
    // Arquivo escolhido: segue o nome junto, para o servidor reconhecer o formato pela extensão quando o aparelho não informa o tipo.
    var type = (blob.type || "application/octet-stream");
    var hdr = {"Content-Type": type};
    if(blob.name) hdr["X-Filename"] = encodeURIComponent(blob.name);
    run(function(){ return api("/chat/api/audio", {method:"POST", headers:hdr, body: blob}); });
  }

  function sendDoc(f){
    var type = (f.type || "application/octet-stream");
    run(function(){ return api("/chat/api/document", {method:"POST", headers:{"Content-Type": type, "X-Filename": encodeURIComponent(f.name)}, body: f}); });
  }

  function sendText(){
    var v = txt.value.trim(); if(!v || busy) return; txt.value = "";
    if(ADMIN){ api("/chat/api/admin/reply", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({text:v})}).then(refresh).catch(showErr); return; }
    send({kind:"text", text:v});
  }
  document.getElementById("send").onclick = sendText;
  txt.onkeydown = function(e){ if(e.key === "Enter") sendText(); };

  var pick = document.getElementById("pick");
  document.getElementById("file").onclick = function(){ pick.click(); };
  pick.onchange = function(){ if(pick.files[0]) sendAudio(pick.files[0]); pick.value = ""; };

  var pickDoc = document.getElementById("pickDoc");
  document.getElementById("doc").onclick = function(){ pickDoc.click(); };
  pickDoc.onchange = function(){ if(pickDoc.files[0]) sendDoc(pickDoc.files[0]); pickDoc.value = ""; };

  var mic = document.getElementById("mic");
  var recbar = document.getElementById("recbar"), rectime = document.getElementById("rectime");
  var wave = document.getElementById("wave"), cancelBtn = document.getElementById("cancelRec");
  var rs = null; // estado da gravação: relógio, ondas e áudio

  function fmt(ms){ var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function setRecUi(on){
    recbar.classList.toggle("on", on);
    txt.style.display = on ? "none" : "";
    ["file","doc","send"].forEach(function(id){ document.getElementById(id).disabled = on; });
    mic.classList.toggle("rec", on);
    mic.textContent = on ? "\u25A0" : "\uD83C\uDFA4";
    mic.title = on ? "Parar e enviar" : "Gravar áudio";
  }
  function drawWave(levels){
    var c = wave.getContext("2d"), w = wave.width, h = wave.height, n = 48, step = w / n, bw = Math.max(2, step * 0.55);
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#d32f2f";
    for(var k = 0; k < n; k++){
      var v = levels[levels.length - n + k] || 0; // mais novo à direita
      var bh = Math.max(3, v * h);
      var x = k * step + (step - bw) / 2;
      c.fillRect(x, (h - bh) / 2, bw, bh);
    }
  }
  function startMeter(stream){
    // Ondas de verdade: nível do microfone via Web Audio. Sem suporte, as ondas ficam animadas só para indicar que grava.
    var levels = [], analyser = null, ctx = null, buf = null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if(AC){ ctx = new AC(); analyser = ctx.createAnalyser(); analyser.fftSize = 512; ctx.createMediaStreamSource(stream).connect(analyser); buf = new Uint8Array(analyser.fftSize); }
    } catch(e){ analyser = null; }
    var last = 0, raf = 0;
    function tick(now){
      if(!rs) return;
      if(now - last > 55){
        last = now; var v;
        if(analyser){
          analyser.getByteTimeDomainData(buf); var sum = 0;
          for(var q = 0; q < buf.length; q++){ var d = (buf[q] - 128) / 128; sum += d * d; }
          v = Math.min(1, Math.sqrt(sum / buf.length) * 5); // RMS ampliado
        } else { v = 0.25 + Math.random() * 0.5; }
        levels.push(v); if(levels.length > 200) levels.shift();
        drawWave(levels);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return function(){ cancelAnimationFrame(raf); if(ctx && ctx.close) ctx.close().catch(function(){}); };
  }
  function recError(msg){ var d = document.createElement("div"); d.className = "err"; d.textContent = msg; feed.appendChild(d); scroll(); }

  function stopRec(cancel){ if(rec){ if(rs) rs.cancelled = !!cancel; rec.stop(); } }
  mic.onclick = function(){
    if(rec){ stopRec(false); return; }
    if(busy) return;
    if(!navigator.mediaDevices || !window.MediaRecorder){ recError("Este navegador não grava áudio. Anexe um arquivo."); return; }
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      var pref = ["audio/ogg;codecs=opus","audio/mp4","audio/webm;codecs=opus"];
      var mime = pref.filter(function(m){ return MediaRecorder.isTypeSupported(m); })[0];
      rec = mime ? new MediaRecorder(stream, {mimeType: mime}) : new MediaRecorder(stream);
      chunks = [];
      rs = { start: Date.now(), cancelled: false, timer: 0, stopMeter: null };
      rec.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function(){
        stream.getTracks().forEach(function(t){ t.stop(); });
        var st = rs; rs = null; clearInterval(st.timer); if(st.stopMeter) st.stopMeter();
        var type = rec.mimeType; rec = null; setRecUi(false);
        if(st.cancelled || !chunks.length) return;
        sendAudio(new Blob(chunks, {type: type}));
      };
      rec.start();
      setRecUi(true); rectime.textContent = "0:00";
      rs.timer = setInterval(function(){ if(rs) rectime.textContent = fmt(Date.now() - rs.start); }, 200);
      rs.stopMeter = startMeter(stream);
    }).catch(function(){ recError("Sem permissão para o microfone. Libere o microfone no navegador e tente de novo."); });
  };
  cancelBtn.onclick = function(){ stopRec(true); };

  var resetBtns = [document.getElementById("resetNew"), document.getElementById("resetRet")];
  resetBtns.forEach(function(b){ b.setAttribute("data-label", b.textContent); });
  function setBtn(b, cls, label){
    b.classList.remove("working","done","fail"); if(cls) b.classList.add(cls);
    b.textContent = label || b.getAttribute("data-label");
  }
  function reset(mode, btn){
    if(busy || btn.classList.contains("working")) return;
    // Sinal imediato de clique: o botão muda de cor, mostra "Reiniciando…" e os dois ficam travados até terminar.
    resetBtns.forEach(function(b){ b.disabled = true; });
    setBtn(btn, "working", "Reiniciando\u2026");
    api("/chat/api/reset", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({mode:mode})})
      .then(function(){
        feed.innerHTML = "";
        setBtn(btn, "done", "\u2713 Reiniciado");
        setTimeout(function(){ setBtn(btn, null); resetBtns.forEach(function(b){ b.disabled = false; }); }, 1500);
      })
      .catch(function(e){
        setBtn(btn, "fail", "\u2717 Falhou");
        var d = document.createElement("div"); d.className = "err"; d.textContent = "Não reiniciou: " + e.message; feed.appendChild(d); scroll();
        setTimeout(function(){ setBtn(btn, null); resetBtns.forEach(function(b){ b.disabled = false; }); }, 2000);
      });
  }
  document.getElementById("resetNew").onclick = function(){ reset("first_contact", this); };
  document.getElementById("resetRet").onclick = function(){ reset("returning", this); };

  // ---- ícone de usuário e login do admin ----
  var pop = document.getElementById("pop"), userBtn = document.getElementById("userBtn");
  function applyMode(){
    document.body.classList.toggle("admin", !!ADMIN);
    userBtn.classList.toggle("on", !!ADMIN);
    userBtn.title = ADMIN ? "Admin (clique para sair)" : "Entrar como admin";
    var bar = document.getElementById("adminbar");
    bar.style.display = ADMIN ? "block" : "none";
    bar.textContent = BOT_ON ? "Modo admin · o bot está respondendo" : "Modo admin · bot DESLIGADO: você responde";
    txt.placeholder = ADMIN ? (BOT_ON ? "Escrever como bot" : "Responder como bot") : "Mensagem";
    ["file","doc","mic"].forEach(function(id){ document.getElementById(id).style.display = ADMIN ? "none" : ""; });
    lastSig = "";
  }
  function drawPop(msg){
    pop.innerHTML = "";
    if(ADMIN){
      var p = document.createElement("p"); p.textContent = "Modo admin ativo."; pop.appendChild(p);
      var sw = document.createElement("button"); sw.className = "sw" + (BOT_ON ? "" : " off");
      sw.textContent = BOT_ON ? "Bot ligado · desativar" : "Bot desligado · ativar";
      sw.onclick = function(){
        sw.disabled = true;
        api("/chat/api/admin/bot", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({on: !BOT_ON})})
          .then(function(r){ BOT_ON = r.botOn; applyMode(); drawPop(); }).catch(function(e){ sw.disabled = false; showErr(e); });
      };
      pop.appendChild(sw);
      var mb = document.createElement("button"); mb.className = "alt2"; mb.textContent = "Mentorias (JSON)";
      mb.onclick = function(){ pop.classList.remove("open"); openMentorias(); };
      pop.appendChild(mb);
      var out = document.createElement("button"); out.textContent = "Sair";
      out.onclick = function(){
        // Ao sair, o bot volta a responder (o servidor reajusta o estado dele).
        out.disabled = true; out.textContent = "Saindo…";
        var done = function(){
          ADMIN = ""; BOT_ON = true; try { sessionStorage.removeItem("chatAdmin"); } catch(e) {}
          pop.classList.remove("open"); applyMode(); refresh().catch(function(){});
        };
        (BOT_ON ? Promise.resolve() : api("/chat/api/admin/bot", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({on:true})})).catch(function(){}).then(done);
      };
      pop.appendChild(out); return;
    }
    var u = document.createElement("input"); u.placeholder = "Usuário"; u.autocomplete = "username";
    var pw = document.createElement("input"); pw.type = "password"; pw.placeholder = "Senha"; pw.autocomplete = "current-password";
    var er = document.createElement("div"); er.className = "perr"; er.textContent = msg || "";
    var go = document.createElement("button"); go.textContent = "Entrar";
    function submit(){
      api("/chat/api/login", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({user:u.value, pass:pw.value})})
        .then(function(r){ ADMIN = r.token; try { sessionStorage.setItem("chatAdmin", ADMIN); } catch(e) {} pop.classList.remove("open"); applyMode(); refresh().catch(function(){}); })
        .catch(function(){ drawPop("Usuário ou senha incorretos"); });
    }
    go.onclick = submit; pw.onkeydown = function(e){ if(e.key === "Enter") submit(); };
    pop.appendChild(u); pop.appendChild(pw); pop.appendChild(er); pop.appendChild(go);
    u.focus();
  }
  var mpanel = document.createElement("div"); mpanel.id = "mpanel"; document.body.appendChild(mpanel);
  mpanel.onclick = function(e){ if(e.target === mpanel) mpanel.style.display = "none"; };
  function openMentorias(){
    mpanel.style.display = "flex"; mpanel.innerHTML = "";
    var box = document.createElement("div"); box.className = "box"; mpanel.appendChild(box);
    var h = document.createElement("h3"); h.textContent = "Mentorias registradas (certificado em JSON)";
    var x = document.createElement("button"); x.className = "mb"; x.textContent = "Fechar"; x.onclick = function(){ mpanel.style.display = "none"; };
    h.appendChild(x); box.appendChild(h);
    var st = document.createElement("div"); st.textContent = "Carregando… (a IA interpreta o assunto na primeira vez)"; box.appendChild(st);
    api("/chat/api/admin/mentorias").then(function(r){
      st.remove();
      if(!r.items.length){ st.textContent = "Nenhuma mentoria registrada ainda."; box.appendChild(st); return; }
      r.items.forEach(function(c){
        var t = document.createElement("div"); t.className = "mt";
        t.textContent = c.mentoria.subject.title + " · " + new Date(c.mentoria.occurred_at).toLocaleString("pt-BR");
        var json = JSON.stringify(c, null, 2);
        var pre = document.createElement("pre"); pre.textContent = json;
        var cp = document.createElement("button"); cp.className = "mb"; cp.textContent = "Copiar JSON";
        cp.onclick = function(){ try { navigator.clipboard.writeText(json); cp.textContent = "Copiado"; } catch(e) { cp.textContent = "Selecione e copie"; } };
        box.appendChild(t); box.appendChild(pre); box.appendChild(cp);
      });
    }).catch(function(e){ st.textContent = "Erro: " + e.message; });
  }
  userBtn.onclick = function(e){ e.stopPropagation(); if(pop.classList.contains("open")){ pop.classList.remove("open"); } else { drawPop(); pop.classList.add("open"); } };
  pop.onclick = function(e){ e.stopPropagation(); };
  document.addEventListener("click", function(){ pop.classList.remove("open"); });
  applyMode();

  refresh().catch(function(e){
    var d = document.createElement("div"); d.className = "err"; d.textContent = "Falha ao carregar (chave correta na URL?): " + e.message; feed.appendChild(d);
  });
})();
</script>
</body>
</html>`;
