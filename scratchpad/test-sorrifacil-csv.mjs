import XLSX from 'xlsx';
import { gzipSync, gunzipSync } from 'node:zlib';
// CSV sintético em windows-1252 SEM BOM, como o CRM exporta
const txt = 'CLINICA;DATA CADASTRO;NOME;SITUACAO;NUMERO ORCAMENTO\r\nSão José;22/09/2026 12:19;João Ávila;Avaliação Agendada;-\r\nRolândia;22/09/2026 12:17;Maria;Não Contactado;-\r\nIngleses;21/09/2026 10:00;Zé;Em Atendimento;123\r\n';
const cp1252 = Buffer.from([...txt].map(c => c.charCodeAt(0))); // chars <=0xFF: latin1==cp1252 aqui
function csvParaUtf8(buf){ const t=new TextDecoder('windows-1252').decode(buf); return Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(t,'utf8')]); }
function parse(buf, nome){ // mesmo caminho da rota: gunzip por magic bytes + XLSX.read raw p/ csv
  if (buf[0]===0x1f&&buf[1]===0x8b){ buf=gunzipSync(buf); nome=nome.replace(/\.gz$/i,''); }
  const wb=XLSX.read(buf,{type:'buffer',raw: /\.csv$/i.test(nome)?true:undefined});
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
}
let fail=0; const ok=(c,m)=>{ if(!c){fail++;console.log('FALHOU',m);} else console.log('ok',m); };
const novo = parse(gzipSync(csvParaUtf8(cp1252)), 'x.csv.gz');
ok(novo.length===3,'3 linhas');
ok(novo[0].CLINICA==='São José','São José intacto: '+novo[0].CLINICA);
ok(novo[1].CLINICA==='Rolândia','Rolândia intacto');
ok(novo[0].SITUACAO==='Avaliação Agendada','situação com acento');
ok(novo[0]['NUMERO ORCAMENTO']==='-','marcador - preservado');
ok(novo[2]['NUMERO ORCAMENTO']==123||novo[2]['NUMERO ORCAMENTO']==='123','id numérico');
const cru = parse(cp1252,'x.csv');
console.log('sem conversão (caminho manual de hoje):', JSON.stringify(cru[0].CLINICA));
process.exit(fail?1:0);
