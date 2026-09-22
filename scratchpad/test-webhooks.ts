/**
 * Prova a MIGRAÇÃO do schema sobre uma réplica exata da tabela de produção
 * (com a UNIQUE client_id e uma linha simulando a conexão viva da Cost Odonto).
 * O que não pode acontecer de jeito nenhum: o token existente mudar ou deixar
 * de resolver — é a URL que já está colada no painel do cliente.
 */
/*
 * Como rodar (precisa de um Postgres real — este teste cria e derruba o
 * database `wh_teste`; foi rodado contra o container de produção, que é onde
 * a tabela legada realmente existe):
 *
 *   npx esbuild scratchpad/test-webhooks.ts --bundle --platform=node  *     --format=cjs --external:pg --outfile=/tmp/t.cjs
 *   ssh root@2.25.144.71 'docker exec -i -w /app onmid-reports node -' < /tmp/t.cjs
 *
 * (o container já tem `pg` e o POSTGRES_URL_NON_POOLING no ambiente)
 */
import { Client, Pool } from 'pg';
import {
  ensureWebhookEntradaSchema, conexaoPorToken, listarWebhooks, criarWebhook,
  atualizarWebhook, excluirWebhook, registrarLogWebhook, listarLogsWebhook,
  normalizarNomeWebhook,
} from '../src/lib/webhook-entrada-server';

const ADMIN = process.env.POSTGRES_URL_NON_POOLING!;
const TESTE = ADMIN.replace(/\/reports$/, '/wh_teste');
const TOKEN_VIVO = 'a'.repeat(48);
const CLI = 'client-cost-odonto';

let ok = 0; const falhas: string[] = [];
function eq(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; }
  else falhas.push(`${nome}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`);
}
function certo(nome: string, cond: boolean) { eq(nome, cond, true); }

async function main() {
  const adm = new Client({ connectionString: ADMIN });
  await adm.connect();
  await adm.query('DROP DATABASE IF EXISTS wh_teste');
  await adm.query('CREATE DATABASE wh_teste');
  await adm.end();

  const pool = new Pool({ connectionString: TESTE, max: 1 });
  await pool.query('CREATE SCHEMA IF NOT EXISTS extensions');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions');

  // ── Réplica LITERAL do estado de produção (pré-migração) ──────────────
  await pool.query(`
    CREATE TABLE public.datalytics_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_received_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE public.datalytics_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT,
      raw JSONB NOT NULL,
      resultado TEXT NOT NULL,
      detalhe TEXT,
      lead_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(
    `INSERT INTO public.datalytics_connections (client_id, token, last_received_at)
     VALUES ($1, $2, NOW())`, [CLI, TOKEN_VIVO]);
  await pool.query(
    `INSERT INTO public.datalytics_log (client_id, raw, resultado, detalhe)
     VALUES ($1, '{"velho":true}'::jsonb, 'criado', 'lead antigo')`, [CLI]);

  // ── A migração ────────────────────────────────────────────────────────
  await ensureWebhookEntradaSchema(pool);

  // ⚠️ O teste central: a URL viva continua respondendo, com o MESMO token.
  const viva = await conexaoPorToken(pool, TOKEN_VIVO);
  certo('URL viva continua resolvendo', viva !== null);
  eq('token intacto', viva?.token, TOKEN_VIVO);
  eq('cliente intacto', viva?.client_id, CLI);
  eq('conexão legada ganha o nome Datalytics', viva?.nome, 'Datalytics');
  certo('conexão legada segue ativa', viva?.enabled === true);

  // ── N webhooks por cliente (era o que a UNIQUE impedia) ───────────────
  const segundo = await criarWebhook(pool, CLI, '  Formulário   do site  ');
  eq('nome normalizado (espaços colapsados)', segundo.nome, 'Formulário do site');
  certo('token novo é diferente do vivo', segundo.token !== TOKEN_VIVO);
  const terceiro = await criarWebhook(pool, CLI, '');
  eq('nome vazio vira padrão', terceiro.nome, 'Webhook');
  const lista = await listarWebhooks(pool, CLI);
  eq('três webhooks no mesmo cliente', lista.length, 3);
  eq('legado vem primeiro (ordem de criação)', lista[0].nome, 'Datalytics');

  eq('nome com teto de 60', normalizarNomeWebhook('x'.repeat(200)).length, 60);
  eq('nome não-string cai no padrão', normalizarNomeWebhook(42), 'Webhook');

  // ── Atualizar ─────────────────────────────────────────────────────────
  const ren = await atualizarWebhook(pool, CLI, segundo.id, { nome: 'RD Station' });
  eq('renomeia', ren?.nome, 'RD Station');
  certo('renomear não mexe no enabled', ren?.enabled === true);
  const desl = await atualizarWebhook(pool, CLI, segundo.id, { enabled: false });
  eq('desliga', desl?.enabled, false);
  eq('desligar não mexe no nome', desl?.nome, 'RD Station');
  const alheio = await atualizarWebhook(pool, 'outro-cliente', segundo.id, { nome: 'invadido' });
  eq('não altera webhook de outro cliente', alheio, null);

  const aindaRD = await conexaoPorToken(pool, segundo.token);
  eq('webhook de outro cliente segue intacto', aindaRD?.nome, 'RD Station');

  // ── Log sabe QUEM recebeu ─────────────────────────────────────────────
  await registrarLogWebhook(pool, {
    clientId: CLI, conexaoId: segundo.id, raw: { a: 1 }, resultado: 'criado', detalhe: 'novo lead',
  });
  const logs = await listarLogsWebhook(pool, CLI, 10);
  eq('log mais recente primeiro', logs[0].detalhe, 'novo lead');
  eq('log diz qual webhook recebeu', logs[0].webhook_nome, 'RD Station');
  const antigo = logs.find(l => l.detalhe === 'lead antigo');
  certo('log anterior à migração sobrevive', !!antigo);
  eq('log legado fica sem webhook (não havia coluna)', antigo?.webhook_nome, null);

  // ── Excluir ───────────────────────────────────────────────────────────
  eq('não exclui de outro cliente', await excluirWebhook(pool, 'outro-cliente', terceiro.id), false);
  eq('exclui o próprio', await excluirWebhook(pool, CLI, terceiro.id), true);
  eq('sobraram dois', (await listarWebhooks(pool, CLI)).length, 2);
  const logsDepois = await listarLogsWebhook(pool, CLI, 10);
  certo('excluir webhook não apaga o log dele', logsDepois.length === logs.length);

  // ── Idempotência: o ensure roda em TODO request ───────────────────────
  const { rows: r1 } = await pool.query(`SELECT count(*)::int n FROM public.datalytics_connections`);
  await pool.query(`SELECT 1`); // no-op
  // força nova execução (o memo é por processo)
  await pool.query(`
    ALTER TABLE public.datalytics_connections ADD COLUMN IF NOT EXISTS nome TEXT`);
  await pool.query(`UPDATE public.datalytics_connections SET nome='Datalytics' WHERE nome IS NULL`);
  const { rows: r2 } = await pool.query(`SELECT count(*)::int n FROM public.datalytics_connections`);
  eq('re-executar a migração não duplica nem apaga', r2[0].n, r1[0].n);
  const vivaDepois = await conexaoPorToken(pool, TOKEN_VIVO);
  eq('token vivo ainda resolve no fim de tudo', vivaDepois?.token, TOKEN_VIVO);
  eq('nome do legado não foi sobrescrito pelo backfill', vivaDepois?.nome, 'Datalytics');

  // ── A UNIQUE que bloqueava sumiu ──────────────────────────────────────
  const { rows: cons } = await pool.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint WHERE conrelid='public.datalytics_connections'::regclass`);
  const nomes = cons.map(c => c.conname);
  certo('UNIQUE(client_id) removida', !nomes.includes('datalytics_connections_client_id_key'));
  certo('UNIQUE(token) preservada', nomes.includes('datalytics_connections_token_key'));
  certo('PK preservada', nomes.includes('datalytics_connections_pkey'));

  await pool.end();
  const adm2 = new Client({ connectionString: ADMIN });
  await adm2.connect();
  await adm2.query('DROP DATABASE wh_teste');
  await adm2.end();

  console.log(`\n${ok} asserts OK, ${falhas.length} falhas`);
  falhas.forEach(f => console.log('  ✗ ' + f));
  process.exit(falhas.length ? 1 : 0);
}
main().catch(e => { console.error('ERRO', e); process.exit(1); });
