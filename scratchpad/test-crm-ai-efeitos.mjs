// Prova que `semEfeitosExternos` realmente impede follow-up e conversão DENTRO
// do motor — o teste do lote só prova que a flag é PEDIDA.
// Recompile antes de rodar (comando no fim do arquivo) e passe a env:
//   ANTHROPIC_API_KEY=chave-de-teste node scratchpad/test-crm-ai-efeitos.mjs
// ⚠️ Sem a env o motor lança antes de chegar nas asserções e 10 "falham" por
// motivo errado — o SDK é stubado, mas a checagem da chave é do nosso código.
import { analisarConversa } from './build/crm-ai-analysis.mjs';

globalThis.__efeitos ??= { followup: [], conversao: [] };
let ok = 0, fail = 0;
const t = (nome, cond) => { if (cond) { ok++; } else { fail++; console.error('✗', nome); } };

// Pool falso que responde por padrão de SQL, registrando os UPDATEs.
function poolFalso({ iaAtiva = true, globalOn = true } = {}) {
  const updates = [];
  return {
    updates,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/^(CREATE|ALTER|DO|INSERT INTO public\.crm_ia_avisos)/i.test(s)) return { rows: [] };
      if (/FROM public\.crm_leads\s+WHERE id = \$1/i.test(s) && /SELECT id, client_id/i.test(s)) {
        return { rows: [{ id: 'lead-1', client_id: 'cli-1', funnel_id: null,
          status: 'Em Atendimento', temperatura: 'frio', ia_ultimo_analise: null,
          time_interno: false, numero: '5543999990000' }] };
      }
      if (/system_settings/i.test(s)) return { rows: globalOn ? [] : [{ value: 'false' }] };
      if (/client_tracking_config/i.test(s)) return { rows: [{ limite: 500, ativa: iaAtiva }] };
      if (/COUNT\(\*\)::int AS total/i.test(s) && /crm_ia_historico/i.test(s)) return { rows: [{ total: 0 }] };
      if (/FROM public\.crm_messages/i.test(s)) {
        return { rows: [{ direction: 'in', text: 'quero fechar' }, { direction: 'out', text: 'vamos lá' }] };
      }
      if (/crm_temperatura_criterios/i.test(s)) return { rows: [] };
      if (/FROM public\.crm_stages/i.test(s)) {
        return { rows: [{ label: 'Em Atendimento' }, { label: 'Fechado' }] };
      }
      if (/outbound_after_last_inbound/i.test(s)) {
        return { rows: [{ outbound_after_last_inbound: 0, last_direction: 'out',
          last_inbound_at: null, first_outbound_after_last_inbound_at: null }] };
      }
      if (/ctwa_clid, valor_rs/i.test(s)) return { rows: [{ ctwa_clid: null, valor_rs: 0 }] };
      if (/^UPDATE/i.test(s)) { updates.push({ s, params }); return { rows: [] }; }
      return { rows: [] };
    },
  };
}
const zerar = () => { globalThis.__efeitos.followup.length = 0; globalThis.__efeitos.conversao.length = 0; };

// ── caminho normal: efeitos ACONTECEM ───────────────────────────────────────
{
  zerar();
  const p = poolFalso();
  const r = await analisarConversa(p, 'lead-1');
  t('caminho normal analisa', r.analisou === true);
  t('caminho normal move o status', r.moveuStatus === true && r.statusNovo === 'Fechado');
  t('caminho normal ENFILEIRA follow-up', globalThis.__efeitos.followup.length === 1);
  t('caminho normal DISPARA conversão', globalThis.__efeitos.conversao.length === 1);
}

// ── lote retroativo: efeitos NÃO acontecem, board muda ──────────────────────
{
  zerar();
  const p = poolFalso();
  const r = await analisarConversa(p, 'lead-1', { semEfeitosExternos: true });
  t('⚠️ retroativo NÃO manda follow-up', globalThis.__efeitos.followup.length === 0);
  t('⚠️ retroativo NÃO dispara conversão', globalThis.__efeitos.conversao.length === 0);
  t('retroativo AINDA move o status', r.moveuStatus === true && r.statusNovo === 'Fechado');
  t('retroativo AINDA move a temperatura', r.moveuTemperatura === true);
  t('retroativo gravou o UPDATE de status no banco',
    p.updates.some(u => /SET status = \$1/.test(u.s.replace(/\s+/g, ' '))));
  t('retroativo gravou a marca de análise',
    p.updates.some(u => /ia_ultimo_analise/.test(u.s)));
}

// ── interruptores ───────────────────────────────────────────────────────────
{
  zerar();
  const r = await analisarConversa(poolFalso({ iaAtiva: false }), 'lead-1');
  t('IA desligada no cliente: não analisa', r.analisou === false && r.motivo === 'desligada_cliente');
}
{
  zerar();
  const r = await analisarConversa(poolFalso({ iaAtiva: false }), 'lead-1', { forcarMesmoDesligada: true });
  t('⚠️ forçar vence o interruptor do cliente (é o retroativo perdido)', r.analisou === true);
}
{
  zerar();
  const r = await analisarConversa(poolFalso({ globalOn: false }), 'lead-1');
  t('interruptor GERAL desligado: não analisa', r.analisou === false && r.motivo === 'desligada_global');
}
{
  zerar();
  const r = await analisarConversa(poolFalso({ globalOn: false }), 'lead-1', { forcarMesmoDesligada: true });
  t('forçar vence o interruptor geral também', r.analisou === true);
}
// time interno continua fora MESMO forçando — não é lead de cliente
{
  zerar();
  const p = poolFalso();
  const orig = p.query.bind(p);
  p.query = async (sql, params) => {
    const r = await orig(sql, params);
    if (r.rows[0]?.id === 'lead-1') return { rows: [{ ...r.rows[0], time_interno: true }] };
    return r;
  };
  const r = await analisarConversa(p, 'lead-1', { forcarMesmoDesligada: true, semEfeitosExternos: true });
  t('⚠️ time interno fica fora mesmo forçando', r.analisou === false && r.motivo === 'time_interno');
}

console.log(`\n${ok} asserts OK${fail ? `, ${fail} FALHARAM` : ''}`);
process.exit(fail ? 1 : 0);
// npx esbuild src/lib/crm-ai-analysis.ts --bundle --format=esm --outfile=scratchpad/build/crm-ai-analysis.mjs \
//   --alias:@/lib/followup-send=$PWD/scratchpad/stubs/followup.mjs \
//   --alias:@/lib/conversions=$PWD/scratchpad/stubs/conversions.mjs \
//   --alias:@/lib/ai-usage-logger=$PWD/scratchpad/stubs/ai-usage.mjs \
//   --alias:@anthropic-ai/sdk=$PWD/scratchpad/stubs/anthropic.mjs --external:pg --log-level=error
