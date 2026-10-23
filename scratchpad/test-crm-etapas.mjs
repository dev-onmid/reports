// Etapas do Kanban editáveis pelo usuário do cliente (2026-10-23):
// regras em src/lib/acesso.ts + gatilhos em src/lib/crm-etapa-gatilhos.ts.
// Compilar antes: npx esbuild src/lib/acesso.ts src/lib/crm-etapa-gatilhos.ts --bundle --platform=node --format=esm --packages=external --outdir=scratchpad/build --out-extension:.js=.mjs
import { regraCliente, escopoDoCliente } from './build/acesso.mjs';
import { rotuloSegueEmUso, contarGatilhos, realinharGatilhos } from './build/crm-etapa-gatilhos.mjs';

let ok = 0, falhas = 0;
const t = (nome, cond) => { if (cond) ok++; else { falhas++; console.log('FALHOU:', nome); } };
const U = '11111111-2222-3333-4444-555555555555';

// --- acesso: atendente (false) e gestor (true) editam etapas
for (const gestor of [false, true]) {
  const quem = gestor ? 'gestor' : 'atendente';
  t(`${quem} lê etapas`, regraCliente(`/api/crm/funnels/${U}/stages`, 'GET', gestor)?.exigeCliente === true);
  t(`${quem} cria etapa`, regraCliente(`/api/crm/funnels/${U}/stages`, 'POST', gestor) !== null);
  t(`${quem} edita etapa`, regraCliente(`/api/crm/stages/${U}`, 'PUT', gestor) !== null);
  t(`${quem} exclui etapa`, regraCliente(`/api/crm/stages/${U}`, 'DELETE', gestor) !== null);
  t(`${quem} renomeia o funil (o editor salva o nome junto)`, regraCliente(`/api/crm/funnels/${U}`, 'PUT', gestor) !== null);
  t(`${quem} NÃO cria funil`, regraCliente('/api/crm/funnels', 'POST', gestor) === null);
  t(`${quem} NÃO exclui funil`, regraCliente(`/api/crm/funnels/${U}`, 'DELETE', gestor) === null);
  t(`${quem} NÃO aplica modelo`, regraCliente(`/api/crm/funnels/${U}/aplicar-modelo`, 'POST', gestor) === null);
  t(`${quem} NÃO salva modelo`, regraCliente('/api/crm/funil-modelos', 'POST', gestor) === null);
  t(`${quem} NÃO saneia kanban`, regraCliente('/api/crm/sanear-kanban', 'POST', gestor) === null);
  t(`${quem}: etapa sem uuid não casa`, regraCliente('/api/crm/stages/abc', 'PUT', gestor) === null);
}

// --- escopo usado pelas rotas para travar o degrau
t('agência = sem escopo (edita degrau)', escopoDoCliente(new Headers({ 'x-onmid-team': 'onmid' })) === null);
t('cliente = escopo (degrau ignorado)', Array.isArray(escopoDoCliente(new Headers({ 'x-onmid-team': 'cliente', 'x-onmid-clientes': 'c1' }))));

// --- gatilhos com pool stub
function stub({ outraEtapa = false, conv = 0, fup = 0, falhaConv = false } = {}) {
  const log = [];
  return {
    log,
    async query(sql, params) {
      log.push({ sql, params });
      if (sql.includes('FROM public.crm_stages')) return { rows: outraEtapa ? [{ '?column?': 1 }] : [] };
      if (sql.includes('COUNT(*)') && sql.includes('client_conversion_eventos_custom')) {
        if (falhaConv) throw new Error('sem tabela');
        return { rows: [{ n: conv }] };
      }
      if (sql.includes('COUNT(*)') && sql.includes('crm_followup_regras')) return { rows: [{ n: fup }] };
      if (sql.startsWith('UPDATE public.client_conversion_eventos_custom') || sql.includes('UPDATE public.client_conversion_eventos_custom')) return { rows: [], rowCount: conv };
      if (sql.includes('UPDATE public.crm_followup_regras')) return { rows: [], rowCount: fup };
      return { rows: [], rowCount: 0 };
    },
  };
}

{
  const p = stub({ outraEtapa: true });
  t('rótulo segue em uso em outra etapa', await rotuloSegueEmUso(p, 'c1', 'Agendado', U) === true);
  t('consulta exclui a própria etapa e filtra cliente', p.log[0].params[0] === 'c1' && p.log[0].params[2] === U && p.log[0].sql.includes('id::text <> $3'));
  t('comparação ignora caixa/espaço', p.log[0].sql.includes('LOWER(TRIM(label))'));
}
t('rótulo livre', await rotuloSegueEmUso(stub(), 'c1', 'Agendado', U) === false);
t('conta conversão + follow-up', await contarGatilhos(stub({ conv: 1, fup: 2 }), 'c1', 'Fechado') === 3);
t('tabela ausente não derruba a contagem', await contarGatilhos(stub({ fup: 1, falhaConv: true }), 'c1', 'Fechado') === 1);
{
  const p = stub({ conv: 1, fup: 1 });
  const n = await realinharGatilhos(p, 'c1', 'Agendado', 'Consulta marcada');
  t('realinha devolve quantos mudaram', n === 2);
  const ups = p.log.filter(l => l.sql.includes('UPDATE'));
  t('3 UPDATEs (conversão, regra, mensagem)', ups.length === 3);
  t('todos presos ao cliente', ups.every(u => u.params[1] === 'c1'));
  t('de → para nos parâmetros', ups.every(u => u.params[0] === 'Consulta marcada' && u.params[2] === 'Agendado'));
  t('conversão não duplica gatilho existente', ups[0].sql.includes('NOT EXISTS'));
}

console.log(`${ok} ok, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
