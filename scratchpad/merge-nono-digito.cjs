/**
 * Mescla leads duplicados pelo NONO DÍGITO (2026-09-28).
 *
 * O WhatsApp entrega o JID do celular antigo sem o nono dígito e a planilha da
 * clínica grava com ele: a mesma pessoa virou duas linhas, e a dashboard contou
 * as duas. Este script funde os pares mantendo UMA linha por pessoa.
 *
 * ⚠️ Só funde celular (assinante começando em 6-9). Fixo fica de fora: (43)
 * 3333-4444 e (43) 9 3333-4444 são linhas diferentes e fundi-las juntaria duas
 * pessoas.
 *
 * Uso: node merge.cjs [--dry] [--cliente=<id>]
 */
const {Pool}=require('pg');
const fs=require('fs');
const DRY=process.argv.includes('--dry');
const soCliente=(process.argv.find(a=>a.startsWith('--cliente='))||'').split('=')[1];
const pool=new Pool({connectionString:process.env.POSTGRES_URL_NON_POOLING||process.env.DATABASE_URL});

// tabelas que apontam para crm_leads.id
const REFS=['agendor_log','conversion_log','crm_conversations','crm_disparo_leads','crm_followup_execucoes',
 'crm_ia_historico','crm_lead_tag_assignments','crm_messages','crm_status_historico','datalytics_log',
 'lead_tracking_events','link_redirect_clicks','lp_origens_log','sults_envios','sults_movimentos','sults_negocios'];

const MONOTONICOS=['agendou','compareceu','fechou'];
const MAIOR=['valor_rs','revenue'];
const NUNCA=['id','client_id','created_at'];

// chave canônica: sem DDI, sem nono dígito — só quando é celular
const CANON=`
 CASE WHEN length(n)=11 AND substring(n from 3 for 1)='9' AND substring(n from 4 for 1) ~ '[6-9]'
      THEN substring(n from 1 for 2)||substring(n from 4)
      WHEN length(n)=10 AND substring(n from 3 for 1) ~ '[6-9]' THEN n
      ELSE NULL END`;
const SEM_DDI=`CASE WHEN length(regexp_replace(COALESCE(numero,''),'\\D','','g'))>11
        AND regexp_replace(COALESCE(numero,''),'\\D','','g') LIKE '55%'
       THEN substring(regexp_replace(COALESCE(numero,''),'\\D','','g') from 3)
       ELSE regexp_replace(COALESCE(numero,''),'\\D','','g') END`;

(async()=>{
  const cols=(await pool.query(
    `SELECT column_name c FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_leads'`
  )).rows.map(r=>r.c).filter(c=>!NUNCA.includes(c));

  const grupos=(await pool.query(`
    WITH b AS (SELECT id, client_id, ${SEM_DDI} AS n FROM crm_leads
                WHERE COALESCE(registro_tipo,'hibrido')<>'venda' AND numero IS NOT NULL
                  ${soCliente?`AND client_id='${soCliente}'`:''}),
         c AS (SELECT id, client_id, n, ${CANON} AS k FROM b)
    SELECT client_id, k, array_agg(id ORDER BY id) ids, COUNT(*) n
      FROM c WHERE k IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)>1`)).rows;

  console.log(`grupos duplicados: ${grupos.length} | linhas a remover: ${grupos.reduce((a,g)=>a+ (+g.n) -1,0)}`);
  if(!grupos.length){await pool.end();return;}

  // backup completo das linhas envolvidas
  const todosIds=grupos.flatMap(g=>g.ids);
  const bk=(await pool.query(`SELECT * FROM crm_leads WHERE id = ANY($1)`,[todosIds])).rows;
  const arq=`/tmp/backup-merge-nono-digito-${new Date().toISOString().slice(0,10)}.json`;
  fs.writeFileSync(arq,JSON.stringify(bk));
  console.log(`backup de ${bk.length} linhas em ${arq}`);

  let fundidos=0, erros=0;
  for(const g of grupos){
    const linhas=(await pool.query(
      `SELECT * FROM crm_leads WHERE id = ANY($1) ORDER BY
         (funnel_id IS NOT NULL) DESC,
         (length(regexp_replace(COALESCE(numero,''),'\\D','','g'))>=13) DESC,
         (raw IS NOT NULL) DESC,
         created_at ASC`,[g.ids])).rows;
    const [viv,...mortos]=linhas;
    const sets=[],vals=[];
    for(const c of cols){
      let v=null, usar=false;
      if(MONOTONICOS.includes(c)){
        if(mortos.some(m=>m[c]===true) && viv[c]!==true){v=true;usar=true;}
      } else if(MAIOR.includes(c)){
        const max=Math.max(...linhas.map(l=>Number(l[c])||0));
        if(max>(Number(viv[c])||0)){v=max;usar=true;}
      } else {
        const vazio = viv[c]===null||viv[c]===undefined||viv[c]==='';
        if(vazio){ const m=mortos.find(m=>m[c]!==null&&m[c]!==undefined&&m[c]!==''); if(m){v=m[c];usar=true;} }
      }
      if(usar){vals.push(v);sets.push(`${c} = $${vals.length}`);}
    }
    if(DRY){
      if(fundidos<5) console.log(`  [dry] viv=${viv.numero} "${(viv.nome||'').slice(0,20)}" <- ${mortos.map(m=>m.numero).join(',')} | preenche: ${sets.length} campos`);
      fundidos++; continue;
    }
    const cli=await pool.connect();
    try{
      await cli.query('BEGIN');
      for(const t of REFS){
        for(const m of mortos){
          try{ await cli.query(`UPDATE ${t} SET lead_id=$1 WHERE lead_id=$2`,[viv.id,m.id]); }
          catch(e){ if(e.code==='23505'){ await cli.query(`DELETE FROM ${t} WHERE lead_id=$1`,[m.id]); } else if(e.code!=='42P01') throw e; }
        }
      }
      for(const m of mortos) await cli.query(`UPDATE crm_leads SET origem_lead_id=$1 WHERE origem_lead_id=$2`,[viv.id,m.id]);
      if(sets.length){ vals.push(viv.id); await cli.query(`UPDATE crm_leads SET ${sets.join(', ')} WHERE id=$${vals.length}`,vals); }
      await cli.query(`DELETE FROM crm_leads WHERE id = ANY($1)`,[mortos.map(m=>m.id)]);
      await cli.query('COMMIT');
      fundidos++;
    }catch(e){ await cli.query('ROLLBACK'); erros++; if(erros<5) console.error('  ERRO grupo',g.k,e.message); }
    finally{ cli.release(); }
  }
  console.log(`${DRY?'[DRY] ':''}grupos processados: ${fundidos} | erros: ${erros}`);
  await pool.end();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)});
