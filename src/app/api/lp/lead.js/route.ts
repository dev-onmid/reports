import type { NextRequest } from 'next/server';

/**
 * Script universal de captura de lead — serve para QUALQUER site ou LP.
 *
 * Uma linha no site do cliente:
 *   <script src="https://reports.onmid.app/api/lp/lead.js?k=TOKEN" defer></script>
 *
 * O que ele faz sozinho:
 *   1. guarda o rastreio do anúncio na PRIMEIRA visita (sobrevive à navegação)
 *   2. escuta o envio de qualquer formulário da página
 *   3. adivinha quais campos são nome/telefone/e-mail/cidade
 *   4. manda para o Reports, que resolve cliente e site pelo token
 *
 * Não interfere no site: não impede o envio, não muda o formulário, não
 * depende de jQuery nem de framework. Se algo falhar, o formulário do cliente
 * segue funcionando como sempre — captura é acessório, o site é o principal.
 *
 * Sem build: é texto servido como JS, igual ao tag.js do Radar de LP.
 */

export const dynamic = 'force-dynamic';

const TOKEN_REGEX = /^[a-f0-9]{32,64}$/i;

export async function GET(req: NextRequest) {
  const k = new URL(req.url).searchParams.get('k') ?? '';
  // Token inválido gera um script inerte em vez de erro: um <script> que
  // devolve 404 enche o console do cliente de vermelho sem ajudar ninguém.
  const token = TOKEN_REGEX.test(k) ? k : '';
  const origem = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://reports.onmid.app';

  const js = `(function(){
"use strict";
var TOKEN=${JSON.stringify(token)},URL_ENVIO=${JSON.stringify(origem)}+"/api/integrations/lp/"+TOKEN;
if(!TOKEN)return;

var CHAVES=["utm_source","utm_medium","utm_campaign","utm_content","utm_term",
"gclid","wbraid","gbraid","fbclid","ttclid","msclkid","keyword","matchtype",
"device","network","placement","campaignid","adgroupid","creative"];
var GUARDA="onmid_rastreio";

/* Primeira visita vence: se a pessoa chega por um anúncio e volta depois pelo
   Google orgânico, quem trouxe ela foi o anúncio. E os parâmetros somem da URL
   assim que ela navega — por isso guardar já na chegada. */
function guardar(){try{
  var p=new URLSearchParams(location.search),achou=false,d={};
  for(var i=0;i<CHAVES.length;i++){var v=p.get(CHAVES[i]);if(v){d[CHAVES[i]]=v.slice(0,300);achou=true;}}
  if(!achou||sessionStorage.getItem(GUARDA))return;
  d.page_url=location.href.slice(0,1000);
  d.referrer=document.referrer?document.referrer.slice(0,300):"";
  sessionStorage.setItem(GUARDA,JSON.stringify(d));
}catch(e){}}

function ler(){
  var d={};try{d=JSON.parse(sessionStorage.getItem(GUARDA)||"{}");}catch(e){d={};}
  try{var p=new URLSearchParams(location.search);
    for(var i=0;i<CHAVES.length;i++){var v=p.get(CHAVES[i]);if(v)d[CHAVES[i]]=v.slice(0,300);}
  }catch(e){}
  if(!d.page_url)d.page_url=location.href.slice(0,1000);
  return d;
}

/* Adivinhar o campo: cada site nomeia do seu jeito. Olha name, id, type,
   placeholder e o texto do <label> ligado ao campo — o que vier primeiro. */
function rotulo(el){
  var t=[el.name,el.id,el.getAttribute("placeholder"),el.getAttribute("aria-label")].join(" ");
  try{
    if(el.id){var l=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(l)t+=" "+l.textContent;}
    var pai=el.closest("label");if(pai)t+=" "+pai.textContent;
  }catch(e){}
  return t.toLowerCase();
}
function acha(campos,regex,tipos){
  for(var i=0;i<campos.length;i++){
    var c=campos[i];
    if(tipos&&tipos.indexOf(c.type)>-1&&c.value)return c.value;
    if(regex.test(rotulo(c))&&c.value)return c.value;
  }
  return null;
}

function coletar(form){
  var campos=[].slice.call(form.querySelectorAll("input,select,textarea"))
    .filter(function(c){return c.type!=="hidden"&&c.type!=="submit"&&c.type!=="checkbox"&&c.type!=="radio";});
  var d=ler();
  d.nome     = acha(campos,/nome|name|nombre/,[]);
  d.telefone = acha(campos,/tel|fone|phone|whats|celular|cel\\b/,["tel"]);
  d.email    = acha(campos,/mail/,["email"]);
  d.cidade   = acha(campos,/cidade|city|munic/,[]);
  d.origem   = location.hostname;
  return d;
}

function enviar(d){
  if(!d||(!d.telefone&&!d.email))return;   // sem contato não há lead
  try{
    var corpo=JSON.stringify(d);
    /* text/plain é requisição "simple" do CORS: vai direto, sem preflight.
       keepalive garante a entrega mesmo se a página navegar em seguida —
       formulário quase sempre redireciona logo após o envio. */
    fetch(URL_ENVIO,{method:"POST",body:corpo,headers:{"content-type":"text/plain"},keepalive:true})
      .catch(function(){});
  }catch(e){}
}

guardar();

/* Captura na FASE DE CAPTURA (true): roda antes de qualquer handler do site,
   inclusive dos que chamam preventDefault e enviam por conta própria. */
document.addEventListener("submit",function(ev){
  try{var f=ev.target;if(f&&f.tagName==="FORM")enviar(coletar(f));}catch(e){}
},true);

/* Para quem prefere mandar na mão (site com envio próprio, SPA, etc.):
   window.onmidLead.enviar({nome:"", telefone:"", email:"", cidade:""}) */
window.onmidLead={enviar:function(d){var base=ler();for(var k in d)base[k]=d[k];
  base.origem=base.origem||location.hostname;enviar(base);},rastreio:ler};
})();`;

  return new Response(js, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}
