// Origem e IDs do parâmetro AUTOMÁTICO da Meta (rodada de 2026-09-14).
//   npx esbuild src/lib/lead-tracking.ts --bundle --platform=node --format=esm \
//     --external:pg --outfile=scratchpad/build/lead-tracking.mjs
import assert from 'node:assert';
import { originFromTracking } from './build/lead-tracking.mjs';
import { pareceIdMeta } from './build/meta-ad-resolver.mjs';
let n = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// Siglas do {{site_source_name}} — o caso REAL do lead de 14/09
eq(originFromTracking({ utm_source: 'ig' }), 'instagram', 'ig = Instagram');
eq(originFromTracking({ utm_source: 'IG' }), 'instagram', 'caixa alta');
eq(originFromTracking({ utm_source: ' ig ' }), 'instagram', 'com espaço');
eq(originFromTracking({ utm_source: 'fb' }), 'meta', 'fb = Meta');
eq(originFromTracking({ utm_source: 'msg' }), 'meta', 'messenger');
eq(originFromTracking({ utm_source: 'an' }), 'meta', 'audience network');
eq(originFromTracking({ utm_source: 'faceads' }), 'meta', 'faceads (76 leads na base)');

// ⚠️ O motivo de a sigla casar INTEIRA: substring quebraria estes.
eq(originFromTracking({ utm_source: 'digital' }), 'digital', '"digital" contém ig e NÃO é Instagram');
eq(originFromTracking({ utm_source: 'banner' }), 'banner', '"banner" contém an');
eq(originFromTracking({ utm_source: 'newsletter' }), 'newsletter', 'não inventa canal');

// Não regredir o que já funcionava
eq(originFromTracking({ utm_source: 'instagram' }), 'instagram', 'nome por extenso');
eq(originFromTracking({ utm_source: 'facebook' }), 'meta', 'facebook');
eq(originFromTracking({ utm_source: 'google' }), 'google', 'google');
eq(originFromTracking({ gclid: 'x', utm_source: 'ig' }), 'google', 'click id vence utm');

// pareceIdMeta: só traduz o que é ID de verdade
eq(pareceIdMeta('52604281079464'), true, 'ad id real do lead');
eq(pareceIdMeta('52604281006064'), true, 'campaign id real');
eq(pareceIdMeta('[ON] [FORMS] [NACIONAL] - 01/09'), false, 'nome de campanha nunca é ID');
eq(pareceIdMeta('DARK - RAFA 03'), false, 'nome de anúncio');
eq(pareceIdMeta('paid'), false, 'utm_medium');
eq(pareceIdMeta('2026'), false, 'número curto não é ID de objeto');
eq(pareceIdMeta(''), false, 'vazio');
eq(pareceIdMeta(null), false, 'nulo');
eq(pareceIdMeta(undefined), false, 'indefinido');

// ⚠️ Erro clássico ao estender UPDATE posicional: placeholder sem parâmetro.
const src = await import('node:fs').then(m => m.readFileSync('src/lib/lead-tracking.ts', 'utf8'));
// ⚠️ Ancorar no UPDATE em si: a função ganhou a tradução de ID antes dele, e
// recortar pelo primeiro `.catch(` passou a pegar o bloco errado (este assert
// pegou isso em 14/09 — é exatamente para isso que ele existe).
const corpo = src.slice(src.indexOf('export async function applyLeadAttribution'));
const update = corpo.slice(corpo.indexOf('UPDATE public.crm_leads'),
                           corpo.indexOf('[lead-tracking applyLeadAttribution]'));
const maior = Math.max(...[...update.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
const args = update.slice(update.indexOf('[\n', update.indexOf('WHERE id = $1')));
const params = args.split('\n').filter(l => /^\s{6}\S.*,$/.test(l)).length;
eq(maior, 28, 'maior placeholder do UPDATE');
eq(params, maior, `parâmetros (${params}) têm de bater com placeholders (${maior})`);

// ⚠️⚠️ REGRESSÃO QUE MOTIVOU ESTE TESTE: a tradução de ID→nome existia só na
// rota da LP, e 3 dos 5 leads com ID entraram pelo DATALYTICS. A régua agora
// mora em applyLeadAttribution, mas ela só funciona se a porta passar o
// `clientId` — este assert é o que impede uma porta nova de esquecer.
{
  const { execSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const grep = execSync("grep -rn 'applyLeadAttribution(' src/ || true", { encoding: 'utf8' });
  const chamadas = grep.trim().split('\n')
    .filter(l => l && !l.includes('export async function'));
  assert.ok(chamadas.length >= 6, `esperava 6+ portas, achei ${chamadas.length}`);
  n++;

  for (const linha of chamadas) {
    const [arq, numStr] = linha.split(':');
    const linhas = fs.readFileSync(arq, 'utf8').split('\n');
    const inicio = Number(numStr) - 1;
    // recorta o objeto passado na chamada (até fechar as chaves)
    let bloco = '', prof = 0;
    for (let k = inicio; k < Math.min(inicio + 25, linhas.length); k++) {
      bloco += linhas[k] + '\n';
      prof += (linhas[k].match(/\{/g) ?? []).length - (linhas[k].match(/\}/g) ?? []).length;
      if (prof <= 0 && k > inicio) break;
    }
    assert.ok(/\bclientId\b/.test(bloco), `${arq}:${numStr} chama applyLeadAttribution SEM clientId — ID de anúncio não vira nome nessa porta`);
    n++;
  }
}

console.log(`OK — ${n} asserts`);
