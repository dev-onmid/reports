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

// Modo mapa de calor: ?onmid_hm=1 na URL da LP — desenha o overlay em cima da
// própria página (o fundo é a página REAL, sem screenshot) e NÃO coleta nada
// (a visita de quem está analisando não polui os dados).
if(/[?&]onmid_hm=1/.test(location.search)){initHeatmap();return;}

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

// ── Overlay de mapa de calor (só roda com ?onmid_hm=1) ──────────────────────
function initHeatmap(){
  var state={days:30,device:'all',mode:'clicks'};
  var m=location.search.match(/[?&]onmid_days=(\\d+)/);if(m)state.days=Math.min(90,Math.max(1,+m[1]));
  var dm=location.search.match(/[?&]onmid_device=(mobile|tablet|desktop)/);if(dm)state.device=dm[1];
  var data=null,pal=null;

  var wrap=document.createElement('div');
  wrap.style.cssText='position:absolute;top:0;left:0;width:100%;pointer-events:none;z-index:2147483000;';
  var canvas=document.createElement('canvas');
  canvas.style.cssText='position:absolute;top:0;left:0;width:100%;pointer-events:none;';
  var bands=document.createElement('div');
  wrap.appendChild(canvas);wrap.appendChild(bands);

  var bar=document.createElement('div');
  bar.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483001;background:#0e0f14;color:#fff;border:1px solid #2a2b33;border-radius:10px;padding:10px 14px;font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;max-width:94vw;';
  function btn(id,label,on){return '<button data-hm="'+id+'" style="cursor:pointer;border:1px solid '+(on?'#55f52f':'#2a2b33')+';background:'+(on?'rgba(85,245,47,.12)':'transparent')+';color:'+(on?'#fff':'#9a9ba3')+';border-radius:7px;padding:4px 9px;font:inherit;font-weight:700">'+label+'</button>';}
  function renderBar(){
    var count=data?data.total:'…';
    bar.innerHTML=
      '<span style="font-weight:800;letter-spacing:.5px;color:#55f52f">ONMID</span>'+
      '<span style="color:#9a9ba3">Mapa de calor · <b style="color:#fff">'+count+'</b> visitas</span>'+
      '<span style="display:flex;gap:4px">'+btn('mode:clicks','Cliques',state.mode==='clicks')+btn('mode:scroll','Scroll',state.mode==='scroll')+'</span>'+
      '<span style="display:flex;gap:4px">'+btn('device:all','Todos',state.device==='all')+btn('device:mobile','Celular',state.device==='mobile')+btn('device:desktop','Computador',state.device==='desktop')+'</span>'+
      '<span style="display:flex;gap:4px">'+btn('days:7','7d',state.days===7)+btn('days:30','30d',state.days===30)+btn('days:90','90d',state.days===90)+'</span>'+
      btn('close','✕ Fechar',false)+
      (data&&!data.total?'<span style="color:#f5a52f">Sem visitas no filtro — troque período/dispositivo</span>':'');
  }
  bar.addEventListener('click',function(ev){
    var b=ev.target&&ev.target.closest?ev.target.closest('[data-hm]'):null;if(!b)return;
    var v=b.getAttribute('data-hm');
    if(v==='close'){wrap.remove();bar.remove();return;}
    var kv=v.split(':');
    if(kv[0]==='mode'){state.mode=kv[1];renderBar();draw();return;}
    if(kv[0]==='device')state.device=kv[1];
    if(kv[0]==='days')state.days=+kv[1];
    renderBar();load();
  });

  function mount(){document.body.appendChild(wrap);document.body.appendChild(bar);renderBar();load();}
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount);

  function load(){
    var u=src.origin+'/api/lp/heatmap-data?k='+KEY+'&days='+state.days+(state.device!=='all'?'&device='+state.device:'');
    fetch(u).then(function(r){return r.json();}).then(function(d){data=d;renderBar();draw();}).catch(function(){});
  }
  function draw(){
    if(!data)return;
    if(state.mode==='clicks'){bands.style.display='none';canvas.style.display='block';drawClicks();}
    else{canvas.style.display='none';bands.style.display='block';drawBands();}
  }

  function buildPal(){
    var c=document.createElement('canvas');c.width=256;c.height=1;
    var x=c.getContext('2d');var g=x.createLinearGradient(0,0,256,0);
    g.addColorStop(0,'#0033ff');g.addColorStop(0.35,'#00d5ff');g.addColorStop(0.6,'#4dff00');g.addColorStop(0.8,'#ffe100');g.addColorStop(1,'#ff2b00');
    x.fillStyle=g;x.fillRect(0,0,256,1);
    return x.getImageData(0,0,256,1).data;
  }

  // Técnica clássica: acumula intensidade em alpha (gradientes radiais pretos)
  // e depois pinta alpha→cor pela paleta azul→verde→amarelo→vermelho.
  function drawClicks(){
    try{
      var W=vwNow()||document.documentElement.clientWidth||0;
      var H=docHeight();
      if(W<40||H<40){clearTimeout(rt);rt=setTimeout(draw,600);return;} // dims 0 em aba background — tenta de novo
      var scale=Math.min(1,Math.sqrt(4000000/(W*H||1))); // cap ~4M px (getImageData)
      canvas.width=Math.max(1,Math.round(W*scale));
      canvas.height=Math.max(1,Math.round(H*scale));
      canvas.style.height=H+'px';
      var ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      var pts=data.points||[];if(!pts.length)return;
      if(!pal)pal=buildPal();
      var max=1;for(var i=0;i<pts.length;i++)if(pts[i][2]>max)max=pts[i][2];
      var R=Math.max(10,Math.round(canvas.width*0.025));
      for(i=0;i<pts.length;i++){
        var x=pts[i][0]*canvas.width,y=pts[i][1]*canvas.height;
        var a=0.3+0.7*Math.min(1,pts[i][2]/max);
        var g=ctx.createRadialGradient(x,y,0,x,y,R);
        g.addColorStop(0,'rgba(0,0,0,'+(0.5*a).toFixed(3)+')');
        g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,R,0,6.2832);ctx.fill();
      }
      var img=ctx.getImageData(0,0,canvas.width,canvas.height);var d=img.data;
      for(i=3;i<d.length;i+=4){
        var al=d[i];
        if(al){var off=al*4;d[i-3]=pal[off];d[i-2]=pal[off+1];d[i-1]=pal[off+2];d[i]=Math.min(215,45+al);}
      }
      ctx.putImageData(img,0,0);
    }catch(e){}
  }

  // Modo scroll: 4 faixas da página pintadas pelo % de visitas que chegou lá
  // (verde = quase todo mundo viu; vermelho = pouca gente chegou).
  function drawBands(){
    try{
      var H=docHeight();var t=(data&&data.total)||0;
      if(H<40){clearTimeout(rt);rt=setTimeout(draw,600);return;}
      bands.innerHTML='';if(!t)return;
      var f=data.funnel||{};
      var segs=[[0,100],[25,Math.round((f.reach25||0)/t*100)],[50,Math.round((f.reach50||0)/t*100)],[75,Math.round((f.reach75||0)/t*100)]];
      for(var i=0;i<segs.length;i++){
        var pct=segs[i][1];var hue=Math.round(pct*1.2); // 0=vermelho → 120=verde
        var div=document.createElement('div');
        div.style.cssText='position:absolute;left:0;width:100%;top:'+(H*segs[i][0]/100)+'px;height:'+(H*0.25)+'px;background:hsla('+hue+',85%,50%,0.22);border-top:2px dashed rgba(255,255,255,.5);box-sizing:border-box;';
        var chip=document.createElement('div');
        chip.style.cssText='position:absolute;right:14px;top:10px;background:#0e0f14;color:#fff;border:1px solid #2a2b33;border-radius:8px;padding:6px 12px;font:700 16px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
        chip.textContent=pct+'% chegou aqui';
        div.appendChild(chip);bands.appendChild(div);
      }
      var last=document.createElement('div');
      last.style.cssText='position:absolute;left:0;width:100%;top:'+(H-46)+'px;text-align:center;font:700 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#fff;pointer-events:none;';
      last.innerHTML='<span style="background:#0e0f14;border:1px solid #2a2b33;border-radius:8px;padding:6px 12px">'+Math.round((f.reach100||0)/t*100)+'% chegou ao fim</span>';
      bands.appendChild(last);
    }catch(e){}
  }

  var rt;
  window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(draw,300);});
  setTimeout(draw,1500); // redesenha após imagens/lazy-load mudarem a altura
}
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
