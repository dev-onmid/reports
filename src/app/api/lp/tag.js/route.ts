// ── Radar de LP: script embarcável ───────────────────────────────────────────
// Servido como /api/lp/tag.js?k=TRACKING_KEY — primeiro endpoint JS do repo.
// Snippet do cliente: <script src="{base}/api/lp/tag.js?k=KEY" defer></script>
//
// O IIFE é 100% defensivo (nunca pode quebrar a LP do cliente), sem deps,
// listeners passive. Acumula cliques + scroll máximo + duração em memória e
// manda snapshots via sendBeacon (text/plain ⇒ sem preflight CORS) pro
// /api/lp/collect: primeiro send ~3s (pega bounce), flush 20s (só se mudou),
// visibilitychange→hidden e pagehide.
//
// LGPD: nenhum valor digitado sai da página — cliques em input/textarea/select
// nunca carregam texto; só coords + descritor do elemento.
//
// SPA/pushState fora de escopo da Etapa 1: a sessão registra o path do load
// inicial; navegação client-side não gera nova sessão.

const TAG_JS = `(function(){
try{
if(window.__onmidLpTag)return;window.__onmidLpTag=1;
var s=document.currentScript;if(!s||!s.src)return;
var src=new URL(s.src);var KEY=src.searchParams.get('k');if(!KEY)return;
var COLLECT=src.origin+'/api/lp/collect';

// sid: por aba (sessionStorage); fallback em memória se indisponível (Safari private)
var sid;
try{sid=sessionStorage.getItem('__onmid_sid');}catch(e){}
if(!sid){
  try{
    var b=new Uint8Array(8);crypto.getRandomValues(b);sid='';
    for(var i=0;i<8;i++)sid+=('0'+b[i].toString(16)).slice(-2);
  }catch(e){sid=(Math.random().toString(36)+Math.random().toString(36)).replace(/[^a-z0-9]/g,'').slice(0,16);}
  try{sessionStorage.setItem('__onmid_sid',sid);}catch(e){}
}

// device calculado na hora do envio (a janela pode ser redimensionada pós-load);
// memoriza a última medida não-zero (aba em background pode ler 0)
var _vw=0,_vh=0;
function vwNow(){try{var w=window.innerWidth||document.documentElement.clientWidth||0;if(w>0)_vw=w;}catch(e){}return _vw;}
function vhNow(){try{var h=window.innerHeight||document.documentElement.clientHeight||0;if(h>0)_vh=h;}catch(e){}return _vh;}
function deviceNow(){var w=vwNow();return w>0&&w<768?'mobile':(w>0&&w<1024?'tablet':'desktop');}
function docHeight(){
  try{return Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0,1);}catch(e){return 1;}
}

var q={};
try{
  var qs=location.search.replace(/^\\?/,'').split('&');
  for(var j=0;j<qs.length;j++){var kv=qs[j].split('=');if(kv[0])q[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||'');}
}catch(e){}

var start=Date.now(),maxScroll=0,clicks=[],lastSent='';

function onScroll(){
  try{
    var dh=docHeight();
    var bottom=(window.scrollY||window.pageYOffset||0)+vhNow();
    var pct=Math.round(bottom/dh*100);
    if(bottom>=dh-2)pct=100; // sem isso a faixa "100%" nunca enche por arredondamento
    if(pct>maxScroll)maxScroll=Math.min(pct,100);
  }catch(e){}
}

var INTERACTIVE=/^(a|button|input|select|textarea|label)$/i;
function describe(t){
  // sobe até 3 níveis até o ancestral interativo (clique no <span> do botão agrupa com o botão)
  var el=t,depth=0;
  while(el&&depth<3){
    var tag=(el.tagName||'').toLowerCase();
    if(INTERACTIVE.test(tag)||(el.getAttribute&&el.getAttribute('role')==='button'))break;
    el=el.parentElement;depth++;
  }
  if(!el||!el.tagName)el=t;
  var tg=(el.tagName||'div').toLowerCase();
  var desc=tg;
  if(el.id&&/^[a-zA-Z][\\w-]{0,40}$/.test(el.id)){desc=tg+'#'+el.id;}
  else if(el.classList){
    // primeira classe "estável": sem hash/utility (css-1x2ab, md:flex etc falham o regex)
    for(var c=0;c<el.classList.length;c++){
      var cls=el.classList[c];
      if(/^[a-zA-Z][a-zA-Z0-9_-]{2,24}$/.test(cls)&&!/\\d{3,}/.test(cls)){desc=tg+'.'+cls;break;}
    }
  }
  var txt='';
  if(!/^(input|textarea|select)$/.test(tg)){ // LGPD: nada digitado sai da página
    try{txt=(el.getAttribute('aria-label')||el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40);}catch(e){}
  }
  return{el:desc,txt:txt};
}

function onClick(ev){
  try{
    if(clicks.length>=50)return;
    var dh=docHeight();
    var d=describe(ev.target);
    var px=ev.pageX||0,py=ev.pageY||0;
    clicks.push({
      x:Math.round(px),y:Math.round(py),
      xp:Math.round((ev.clientX||0)/(vwNow()||1)*10000)/10000,
      yp:Math.round(py/dh*10000)/10000,
      el:d.el,txt:d.txt
    });
  }catch(e){}
}

function send(){
  try{
    onScroll(); // dobra a posição atual no flush (nem todo scroll dispara evento)
    var payload=JSON.stringify({
      k:KEY,sid:sid,d:deviceNow(),
      vw:vwNow(),vh:vhNow(),dh:docHeight(),
      p:(location.pathname||'/').slice(0,300),
      us:(q.utm_source||'').slice(0,120)||undefined,
      um:(q.utm_medium||'').slice(0,120)||undefined,
      uc:(q.utm_campaign||'').slice(0,120)||undefined,
      r:(document.referrer||'').slice(0,300)||undefined,
      sp:maxScroll,ms:Date.now()-start,clicks:clicks
    });
    if(payload===lastSent)return;
    lastSent=payload;
    if(navigator.sendBeacon){navigator.sendBeacon(COLLECT,payload);}
    else{fetch(COLLECT,{method:'POST',body:payload,keepalive:true}).catch(function(){});}
  }catch(e){}
}

window.addEventListener('scroll',onScroll,{passive:true});
document.addEventListener('click',onClick,{capture:true,passive:true});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')send();});
window.addEventListener('pagehide',send);
setTimeout(function(){onScroll();send();},3000);
setInterval(send,20000);
}catch(e){}
})();`;

export function GET() {
  return new Response(TAG_JS, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
