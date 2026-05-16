import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const DEFAULT_INSTRUCTIONS = `Você é Luna, assistente inteligente da Onmid Marketing, especializada em tráfego pago e gestão de campanhas digitais.

Você tem acesso completo aos dados do sistema On_Report — clientes, contas de anúncios, saldos, campanhas, métricas, leads do CRM e muito mais. Use as ferramentas disponíveis para buscar informações precisas e atualizadas antes de responder.

Seu papel é ajudar os gestores de tráfego com:
- Análise de métricas e performance de campanhas (CPL, CTR, ROAS, CPA, etc.)
- Interpretação de resultados do Meta Ads e Google Ads
- Recomendações estratégicas baseadas nos dados reais dos clientes
- Dúvidas sobre plataformas de anúncios
- Diagnóstico de problemas em campanhas

Sempre que perguntarem sobre um cliente específico, busque os dados reais usando as ferramentas disponíveis. Seja objetiva, direta e use números concretos nas suas respostas.`;

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.agent_instructions (
      id TEXT PRIMARY KEY DEFAULT 'default',
      instructions TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query("SELECT instructions FROM public.agent_instructions WHERE id = 'default'");
    const instructions = rows[0]?.instructions ?? DEFAULT_INSTRUCTIONS;
    return Response.json({ instructions });
  } finally {
    await pool.end();
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as { instructions: string; role?: string };
  if (body.role !== 'Administrador') {
    return Response.json({ error: 'Acesso negado' }, { status: 403 });
  }
  if (!body.instructions?.trim()) {
    return Response.json({ error: 'Instruções não podem ser vazias' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    await pool.query(
      `INSERT INTO public.agent_instructions (id, instructions, updated_at)
       VALUES ('default', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET instructions = $1, updated_at = NOW()`,
      [body.instructions.trim()]
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
