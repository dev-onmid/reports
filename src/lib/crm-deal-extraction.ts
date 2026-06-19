import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { getClientInstance } from '@/lib/followup-send';
import { fetchEvolutionMediaBase64 } from '@/lib/evolution-media';
import { logAiUsage } from '@/lib/ai-usage-logger';

const MODEL = 'claude-haiku-4-5-20251001';

export type DealValueSuggestion = {
  valor: number | null;
  trecho: string | null;
  confianca: number;
};

const NO_SUGGESTION: DealValueSuggestion = { valor: null, trecho: null, confianca: 0 };

type LeadMessageRow = {
  direction: 'in' | 'out';
  text: string | null;
  tipo: string | null;
  external_id: string | null;
};

// Messages whose placeholder text suggests an attached image/document — these are the
// only ones worth the extra Evolution round-trip to fetch the real bytes for Claude vision.
function looksLikeMedia(tipo: string | null, text: string | null): boolean {
  if (tipo === 'imagem' || tipo === 'documento') return true;
  const t = (text ?? '').trim();
  return t.startsWith('[Imagem') || t.startsWith('[Doc') || t.startsWith('[Documento');
}

function mediaTypeFor(mimetype: string): 'image' | 'document' | null {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype === 'application/pdf') return 'document';
  return null;
}

export async function extractDealValue(pool: Pool, leadId: string): Promise<DealValueSuggestion> {
  try {
    const { rows: [lead] } = await pool.query<{
      id: string; client_id: string; numero: string | null; whatsapp_lid: string | null;
    }>(
      `SELECT id, client_id, numero, whatsapp_lid FROM public.crm_leads WHERE id = $1`,
      [leadId],
    );
    if (!lead) return NO_SUGGESTION;

    const { rows: messages } = await pool.query<LeadMessageRow>(
      `SELECT direction, text, tipo, external_id
         FROM public.crm_messages
        WHERE lead_id = $1
        ORDER BY created_at DESC
        LIMIT 60`,
      [leadId],
    );
    const ordered = messages.reverse();
    if (ordered.length === 0) return NO_SUGGESTION;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NO_SUGGESTION;

    // Best-effort: re-fetch the real bytes of up to 5 image/document messages so Claude
    // can read prices off a budget/receipt PDF or screenshot, not just the caption text.
    const mediaBlocks: { type: 'image' | 'document'; mimetype: string; base64: string }[] = [];
    const instance = await getClientInstance(pool, lead.client_id).catch(() => null);
    if (instance?.provider === 'evolution') {
      const jid = lead.whatsapp_lid
        ? `${String(lead.whatsapp_lid).replace(/\D/g, '')}@lid`
        : lead.numero
          ? `${String(lead.numero).replace(/\D/g, '')}@s.whatsapp.net`
          : null;
      if (jid) {
        const mediaCandidates = ordered
          .filter(m => m.external_id && looksLikeMedia(m.tipo, m.text))
          .slice(-5);
        for (const m of mediaCandidates) {
          const key = { remoteJid: jid, id: m.external_id, fromMe: m.direction === 'out' };
          const media = await fetchEvolutionMediaBase64(instance.instanceId, key).catch(() => null);
          if (!media) continue;
          const kind = mediaTypeFor(media.mimetype);
          if (!kind) continue;
          mediaBlocks.push({ type: kind, mimetype: media.mimetype, base64: media.base64 });
        }
      }
    }

    const history = ordered
      .map(m => `${m.direction === 'out' ? 'Atendente' : 'Cliente'}: ${m.text ?? ''}`)
      .join('\n');

    const instructions = `Você é um analista de vendas. Leia a conversa de WhatsApp abaixo (e os documentos/imagens anexados, se houver) e identifique o valor final combinado/fechado da venda.

Conversa (mais recente por último):
${history}

Regras:
- Procure o valor que ficou ACORDADO/FECHADO, não orçamentos descartados ou valores apenas mencionados de passagem.
- Se houver mais de um valor, use o mais recente e que pareça definitivo (ex: "fechado", "combinado", "vou pagar", confirmação de pagamento).
- Se algum documento/imagem anexado mostrar um valor (orçamento, recibo, nota), considere-o.
- Se não conseguir identificar um valor com razoável certeza, retorne valor null e confianca 0.

Retorne APENAS um JSON válido, sem texto antes ou depois, no formato exato:
{"valor": 1234.56, "trecho": "trecho da conversa ou documento que evidencia o valor", "confianca": 85}

Se não encontrar valor: {"valor": null, "trecho": null, "confianca": 0}`;

    const content: Anthropic.MessageParam['content'] = [{ type: 'text', text: instructions }];
    for (const block of mediaBlocks) {
      if (block.type === 'image') {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: block.mimetype as 'image/jpeg', data: block.base64 },
        });
      } else {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: block.base64 },
        });
      }
    }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0,
      messages: [{ role: 'user', content }],
    });
    void logAiUsage({
      source: 'crm_deal_extraction',
      model: MODEL,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    });

    const text = response.content.map(b => b.type === 'text' ? b.text : '').join('').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) return NO_SUGGESTION;
    const parsed = JSON.parse(text.slice(start, end + 1)) as { valor?: number | null; trecho?: string | null; confianca?: number };

    const valor = typeof parsed.valor === 'number' && parsed.valor > 0 ? parsed.valor : null;
    return {
      valor,
      trecho: valor ? (parsed.trecho ?? null) : null,
      confianca: valor ? Number(parsed.confianca ?? 0) : 0,
    };
  } catch (err) {
    console.error('[crm-deal-extraction]', err);
    return NO_SUGGESTION;
  }
}
