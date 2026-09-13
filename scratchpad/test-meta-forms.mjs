// Rebuild antes de rodar: npx esbuild src/lib/meta-leadgen-forms.ts --bundle --platform=node --format=esm --external:pg --outfile=scratchpad/build/meta-leadgen-forms.mjs
import assert from 'node:assert/strict';
import { normalizarFormulario, ordenarFormularios, mesclarCamposAssinados } from './build/meta-leadgen-forms.mjs';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// shape REAL devolvido pela Graph em 13/09 (CondoStore)
const f = normalizarFormulario({ id:'1751378586280766', name:'[ON] [65_100] [NOVO] [JUNHO26]', status:'ACTIVE', leads_count:189, created_time:'2026-06-01T10:00:00+0000',
  questions:[{key:'qual_capital_disponível_para_investimento?',type:'CUSTOM'},{key:'full_name',type:'FULL_NAME'},{key:'phone_number',type:'PHONE'}] });
ok(f.id === '1751378586280766' && f.nome.includes('JUNHO26'), 'id e nome preservados');
ok(f.leadsTotal === 189 && f.status === 'ACTIVE', 'leads_count e status');
ok(f.perguntas.includes('full_name') && f.perguntas.includes('phone_number'), 'perguntas pelas chaves');
ok(normalizarFormulario({}) === null, 'sem id → null');
ok(normalizarFormulario({ id:'9' }).nome === 'Formulário 9', 'sem nome → rótulo com id');
ok(normalizarFormulario({ id:'9', status:'archived' }).status === 'ARCHIVED', 'status em caixa alta');
ok(normalizarFormulario({ id:'9', leads_count:'x' }).leadsTotal === 0, 'leads_count inválido → 0');

const ord = ordenarFormularios([
  { id:'a', nome:'Zeta', status:'ARCHIVED', leadsTotal:999, criadoEm:null, perguntas:[] },
  { id:'b', nome:'Beta', status:'ACTIVE', leadsTotal:0, criadoEm:null, perguntas:[] },
  { id:'c', nome:'Alfa', status:'ACTIVE', leadsTotal:0, criadoEm:null, perguntas:[] },
  { id:'d', nome:'Gama', status:'ACTIVE', leadsTotal:50, criadoEm:null, perguntas:[] },
]);
ok(ord.map(x=>x.id).join('') === 'dcba', 'ativos primeiro (mais leads → nome), arquivado por último mesmo com 999 leads');

// ⚠️ o POST substitui a lista — mesclar é o que não desliga feed/messages
ok(mesclarCamposAssinados(['feed','messages'], 'leadgen').join(',') === 'feed,leadgen,messages', 'mescla e ordena');
ok(mesclarCamposAssinados(['leadgen'], 'leadgen').length === 1, 'idempotente');
ok(mesclarCamposAssinados(null, 'leadgen').join(',') === 'leadgen', 'Página sem assinatura → só leadgen');
ok(mesclarCamposAssinados([' feed ', ''], 'leadgen').join(',') === 'feed,leadgen', 'trim e vazio fora');
console.log(`✅ ${n} asserts`);
