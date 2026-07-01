import { makeServerPool } from '@/lib/server-db';
import { sendEvolutionText } from '@/lib/evolution-api';
import type { OptimizerAnalysisResultV2 } from '@/lib/optimizer';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

async function loadWhatsAppConfig(): Promise<{
  instanceName: string;
  groupJid: string;
  notificarCriseApenas: boolean;
} | null> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM public.system_settings
        WHERE key IN (
          'otimizador_whatsapp_zapi_client_id',
          'otimizador_whatsapp_group_jid',
          'otimizador_whatsapp_ativo',
          'otimizador_notificar_crise_apenas'
        )`,
    );

    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    if (map['otimizador_whatsapp_ativo'] !== 'true') return null;
    if (!map['otimizador_whatsapp_group_jid']) return null;
    if (!map['otimizador_whatsapp_zapi_client_id']) return null;

    const { rows: instances } = await pool.query<{ instance_id: string }>(
      `SELECT instance_id FROM public.zapi_clients WHERE id = $1 AND provider = 'evolution'`,
      [map['otimizador_whatsapp_zapi_client_id']],
    );

    if (!instances[0]?.instance_id) return null;

    return {
      instanceName: instances[0].instance_id,
      groupJid: map['otimizador_whatsapp_group_jid'],
      notificarCriseApenas: map['otimizador_notificar_crise_apenas'] === 'true',
    };
  } finally {
    await pool.end();
  }
}

function estadoEmoji(estado: string): string {
  if (estado === 'CRISE') return '🔴';
  if (estado === 'ATENCAO') return '⚠️';
  return '✅';
}

function verdictEmoji(v: string): string {
  if (v === 'URGENTE') return '🚨';
  if (v === 'ATENCAO') return '⏰';
  return '✅';
}

// Destaques = top campanhas por severidade (URGENTE primeiro, depois ATENCAO), direto da
// árvore campanha→conjunto→criativo — mesma fonte que a tela, sem IA gerar texto solto de novo.
function topCampaignHighlights(result: OptimizerAnalysisResultV2, limit: number): Array<{ classificacao: string; nome: string; acao: string }> {
  const ordem = { URGENTE: 0, ATENCAO: 1, SAUDAVEL: 2 } as const;
  return [...result.analise_campanhas]
    .filter((c) => c.acao)
    .sort((a, b) => (ordem[a.classificacao] ?? 1) - (ordem[b.classificacao] ?? 1))
    .slice(0, limit)
    .map((c) => ({ classificacao: c.classificacao, nome: c.nome, acao: c.acao }));
}

function buildReportText(result: OptimizerAnalysisResultV2, clientName: string): string {
  const emoji = estadoEmoji(result.estado_da_conta);
  const lines: string[] = [
    `📊 *Otimizador ONMID — ${clientName}*`,
    `📅 ${result.semana_analise}`,
    ``,
    `${emoji} *${result.estado_da_conta}*`,
    ``,
    result.resumo_executivo,
  ];

  const destaques = topCampaignHighlights(result, 3);
  if (destaques.length > 0) {
    lines.push('', '━━━ *Destaques por campanha* ━━━');
    for (const d of destaques) {
      lines.push(`${verdictEmoji(d.classificacao)} *${d.nome}*: ${d.acao}`);
    }
  }

  const executadas = result.acoes_automaticas.filter((a) => a.status_execucao === 'EXECUTAR_AGORA');
  const pendentes = result.acoes_automaticas.filter((a) => a.status_execucao === 'AGUARDAR_APROVACAO');

  if (executadas.length > 0 || pendentes.length > 0) {
    lines.push('', '━━━ *Ações automáticas* ━━━');
    for (const a of executadas) lines.push(`✅ ${a.acao}: ${a.objeto_nome}`);
    for (const a of pendentes) lines.push(`⏳ Aguarda aprovação: ${a.acao} em ${a.objeto_nome}`);
  }

  if (APP_URL) {
    lines.push('', `🔗 Ver no painel: ${APP_URL}/otimizador`);
  }

  return lines.join('\n');
}

export async function sendOptimizerReport(
  result: OptimizerAnalysisResultV2,
  clientName: string,
): Promise<void> {
  try {
    const config = await loadWhatsAppConfig();
    if (!config) return;

    if (config.notificarCriseApenas && result.estado_da_conta !== 'CRISE') return;

    const text = buildReportText(result, clientName);
    const { ok, error } = await sendEvolutionText(config.instanceName, config.groupJid, text);
    if (!ok) console.error('[optimizer-whatsapp] Falha no envio:', error);
  } catch (err) {
    console.error('[optimizer-whatsapp] Erro inesperado:', err);
  }
}
