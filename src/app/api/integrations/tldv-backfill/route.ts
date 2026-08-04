import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { makeServerPool } from '@/lib/server-db';
import { conferirSegredoIntegracao, respostaSegredo } from '@/lib/integration-secret';
import { normalizeClientName, resolveClientByName } from '@/lib/reuniao-intake';
import { parseChecklist, salvarResumoReuniao } from '@/lib/reuniao-resumos';
import { logAiUsage } from '@/lib/ai-usage-logger';
import { buscarReuniao, buscarTranscricao, dataIso, listarReunioes } from '@/lib/tldv';

/**
 * Backfill do repositório de reuniões (aba Reuniões do cliente) a partir do
 * histórico do TLDV — reuniões que já rodaram ANTES da automação começar a
 * mandar resumo pra cá.
 *
 * Para cada reunião recente do TLDV que ainda não está em `reuniao_resumos`:
 * tenta casar o cliente pelo TÍTULO (mesmas regras determinísticas do
 * pipeline, `resolveClientByName`) — mas os títulos do TLDV costumam ser
 * genéricos ("04/08/2026-Meeting", confirmado no dry-run), então o caminho
 * normal é a IA identificar o cliente PELA TRANSCRIÇÃO, escolhendo de uma
 * lista fechada da carteira (com abstenção e nível de confiança; só grava
 * confiança alta/média — baixa vai pro relatório como palpite, sem gravar).
 * A mesma chamada gera resumo + checklist. Grava com o link da gravação.
 *
 * NÃO dispara os webhooks do Make (nada de doc no Drive, tarefa no ClickUp ou
 * WhatsApp) — escreve só na tabela da aba. Idempotente: reunião já gravada
 * (qualquer cliente) é pulada; rodar de novo continua de onde parou.
 *
 * GET ?limit=10 — processa as N mais recentes (clamp 1..20).
 * GET ?limit=10&dry=1 — só mostra o casamento título→cliente, sem IA nem gravação.
 * Auth: header `x-onmid-secret` (mesmo segredo do pipeline Make/TLDV).
 */

export const maxDuration = 300;

const MODEL = 'claude-sonnet-4-6';
const ORCAMENTO_MS = 260_000;
const TRANSCRICAO_MAX_CHARS = 150_000;

type Saida = {
  meeting_id: string;
  titulo_tldv: string;
  cliente?: string;
  resumo_id?: string;
  motivo?: string;
  sugestoes?: string[];
};

/**
 * Uma chamada só: identifica o cliente pela transcrição (quando o título não
 * resolveu) E gera título/resumo/checklist. `clienteConhecido` preenchido pula
 * a identificação (a IA só resume).
 */
async function analisarReuniao(opts: {
  clienteConhecido: string | null;
  nomesCarteira: string[];
  tituloReuniao: string;
  transcricao: string;
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  const identificar = !opts.clienteConhecido;
  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system:
      'Você analisa reuniões entre a agência de marketing ONMID e seus clientes, em português do Brasil. ' +
      'Responda SOMENTE um objeto JSON válido, sem markdown, no formato: ' +
      '{"cliente": "nome EXATO copiado da lista fornecida, ou NAO_IDENTIFICADO", ' +
      '"confianca": "alta|media|baixa", ' +
      '"titulo": "tema da reunião em até 60 caracteres", ' +
      '"resumo": "2 a 4 parágrafos objetivos: contexto, o que foi discutido e o que foi DECIDIDO", ' +
      '"checklist": ["3 a 8 itens acionáveis — próximos passos e pendências combinadas na reunião"]}. ' +
      'Identificação: procure na conversa o nome da empresa/negócio do cliente, produtos, cidade e nomes das pessoas. ' +
      'Só aponte um cliente da lista se houver evidência clara na transcrição; na dúvida, NAO_IDENTIFICADO com confianca baixa. ' +
      'Reunião interna da ONMID (sem cliente presente ou sem ser SOBRE um cliente específico) = NAO_IDENTIFICADO. ' +
      'Resumo/checklist: baseie-se apenas no que está na transcrição; não invente compromissos.',
    messages: [{
      role: 'user',
      content:
        (identificar
          ? `Clientes da carteira (escolha um destes ou NAO_IDENTIFICADO):\n${opts.nomesCarteira.join('\n')}\n\n`
          : `Cliente desta reunião (já identificado — repita no campo "cliente" com confianca "alta"): ${opts.clienteConhecido}\n\n`) +
        `Título da reunião na agenda: ${opts.tituloReuniao}\n\nTranscrição:\n${opts.transcricao.slice(0, TRANSCRICAO_MAX_CHARS)}`,
    }],
  });

  void logAiUsage({
    source: 'reuniao_backfill',
    model: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  });

  const texto = response.content.find((b) => b.type === 'text')?.text ?? '';
  const json = texto.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('IA não devolveu JSON');
  const parsed = JSON.parse(json) as {
    cliente?: unknown; confianca?: unknown; titulo?: unknown; resumo?: unknown; checklist?: unknown;
  };
  const resumo = typeof parsed.resumo === 'string' ? parsed.resumo.trim() : '';
  if (!resumo) throw new Error('IA devolveu resumo vazio');
  return {
    cliente: typeof parsed.cliente === 'string' ? parsed.cliente.trim() : 'NAO_IDENTIFICADO',
    confianca: parsed.confianca === 'alta' || parsed.confianca === 'media' ? parsed.confianca : 'baixa',
    titulo: typeof parsed.titulo === 'string' && parsed.titulo.trim() ? parsed.titulo.trim().slice(0, 120) : null,
    resumo,
    checklist: parseChecklist(parsed.checklist),
  };
}

export async function GET(req: NextRequest) {
  const auth = conferirSegredoIntegracao(req);
  if (auth !== 'ok') return respostaSegredo(auth);

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 10) || 10, 1), 20);
  const dry = url.searchParams.get('dry') === '1';
  const inicio = Date.now();

  const pool = makeServerPool();
  const gravadas: Saida[] = [];
  const puladasExistentes: Saida[] = [];
  const semCliente: Saida[] = [];
  const semTranscricao: Saida[] = [];
  const erros: Saida[] = [];
  let semTempo = 0;

  try {
    const reunioes = await listarReunioes(limit);

    const ids = reunioes.map((m) => m.id);
    const { rows } = ids.length
      ? await pool.query<{ meeting_id: string }>(
          'SELECT DISTINCT meeting_id FROM public.reuniao_resumos WHERE meeting_id = ANY($1)',
          [ids],
        ).catch(() => ({ rows: [] as { meeting_id: string }[] })) // tabela pode não existir ainda
      : { rows: [] };
    const existentes = new Set(rows.map((r) => r.meeting_id));

    // Carteira pra IA escolher (só ativos, lista fechada) e pra resolver o
    // nome que ela devolver de volta pro id.
    const { rows: carteira } = await pool.query<{ id: string; name: string; status: string | null }>(
      'SELECT id, name, status FROM public.clients',
    );
    const ativos = carteira.filter((c) => (c.status ?? 'Ativo') === 'Ativo' && normalizeClientName(c.name ?? '').length > 0);
    const porNomeNorm = new Map(ativos.map((c) => [normalizeClientName(c.name), c]));

    for (const m of reunioes) {
      const base: Saida = { meeting_id: m.id, titulo_tldv: m.name ?? '' };

      if (existentes.has(m.id)) { puladasExistentes.push(base); continue; }
      if (Date.now() - inicio > ORCAMENTO_MS) { semTempo++; continue; }

      try {
        const { match, motivo } = await resolveClientByName(pool, m.name ?? '');

        if (dry) {
          if (match) gravadas.push({ ...base, cliente: match.name, motivo: `dry-run: ${motivo}` });
          else semCliente.push({ ...base, motivo: `${motivo} — na execução real a IA tenta identificar pela transcrição` });
          continue;
        }

        const detalhe = await buscarReuniao(m.id).catch(() => m);
        const t = await buscarTranscricao(m.id);
        if (!t?.data?.length) { semTranscricao.push({ ...base, cliente: match?.name }); continue; }
        const transcricao = t.data.map((f) => `[${f.speaker}] ${f.text}`).join('\n');

        const ia = await analisarReuniao({
          clienteConhecido: match?.name ?? null,
          nomesCarteira: ativos.map((c) => c.name),
          tituloReuniao: m.name ?? '',
          transcricao,
        });

        // Título casou → vale o título. Senão, vale a IA — mas só com
        // confiança alta/média E nome que existe na carteira; o resto vira
        // relatório pro humano decidir, nunca gravação no cliente errado.
        const cliente = match
          ?? (ia.confianca !== 'baixa' ? porNomeNorm.get(normalizeClientName(ia.cliente)) ?? null : null);
        if (!cliente) {
          semCliente.push({ ...base, motivo: `IA: ${ia.cliente} (confiança ${ia.confianca}) — não gravado` });
          continue;
        }

        const quando = dataIso(detalhe.happenedAt ?? m.happenedAt);
        const r = await salvarResumoReuniao(pool, {
          clientId: cliente.id,
          resumo: ia.resumo,
          titulo: ia.titulo ?? m.name ?? null,
          meetingId: m.id,
          recordingUrl: `https://tldv.io/app/meetings/${m.id}`,
          checklist: ia.checklist,
          reuniaoEm: quando ? new Date(quando) : null,
        });
        gravadas.push({ ...base, cliente: cliente.name, resumo_id: r.id, motivo: match ? 'título' : `transcrição (confiança ${ia.confianca})` });
      } catch (err) {
        erros.push({ ...base, motivo: err instanceof Error ? err.message : String(err) });
      }
    }

    return Response.json({
      ok: true,
      dry,
      vistas: reunioes.length,
      gravadas,
      puladas_existentes: puladasExistentes,
      sem_cliente: semCliente,
      sem_transcricao: semTranscricao,
      erros,
      sem_tempo: semTempo,
      took_ms: Date.now() - inicio,
    });
  } catch (err) {
    console.error('[tldv-backfill]', err);
    return Response.json({
      ok: false,
      erro: 'falha_interna',
      detalhe: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await pool.end();
  }
}
