import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  ensureLeadAvisoSchema, parseFontes, montarMensagem, FONTES_AVISO, type FonteAviso,
} from '@/lib/lead-aviso';
import { instanciaOnmid, sendTextOnmid } from '@/lib/whatsapp-send';

// Config POR CLIENTE do aviso de lead no grupo. Auth = deny-by-default do
// proxy (padrão das demais subrotas de cliente).

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureLeadAvisoSchema(pool);
    const [cfg, envios, oficial] = await Promise.all([
      pool.query(
        `SELECT ativo, group_id, fontes, desde
           FROM public.lead_aviso_config WHERE client_id = $1`, [id]),
      pool.query(
        `SELECT evento_id, fonte, status, erro, texto, created_at
           FROM public.lead_aviso_envios WHERE client_id = $1
          ORDER BY created_at DESC LIMIT 20`, [id]),
      // ⚠️ NÃO é um menu: o remetente é sempre a instância oficial da ONMID.
      // Vai para a tela só para dizer POR ONDE o aviso sai.
      instanciaOnmid(pool),
    ]);
    const c = cfg.rows[0];
    return Response.json({
      ativo: c?.ativo === true,
      groupId: c?.group_id ?? null,
      fontes: parseFontes(c?.fontes),
      desde: c?.desde ?? null,
      envios: envios.rows,
      remetente: oficial ? { id: oficial.id, nome: oficial.name } : null,
    });
  } catch (err) {
    console.error('[lead-aviso GET]', err);
    // Degrada em vez de derrubar a aba inteira do cliente.
    return Response.json({ ativo: false, groupId: null, fontes: FONTES_AVISO, envios: [], remetente: null });
  } finally { await pool.end(); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    ativo?: boolean; groupId?: string | null;
    fontes?: string[]; testar?: boolean;
  };

  const pool = makeServerPool();
  try {
    await ensureLeadAvisoSchema(pool);

    if (body.testar) {
      const { rows: [c] } = await pool.query(
        `SELECT group_id FROM public.lead_aviso_config WHERE client_id = $1`, [id]);
      if (!c?.group_id) {
        return Response.json({ ok: false, error: 'Escolha o grupo e salve antes de testar.' });
      }
      const exemplo = montarMensagem({
        nome: 'Maria de Teste', numero: '5543999998888', fonte: 'meta_forms',
        canal: 'Formulário Meta', campanha: '[EXEMPLO] Campanha de teste',
        anuncio: null, cidade: 'Londrina', uf: 'PR',
      });
      const r = await sendTextOnmid(pool, c.group_id,
        `${exemplo}\n\n_(mensagem de teste enviada pelo painel)_`);
      return Response.json({ ok: r.ok, error: r.ok ? undefined : r.error });
    }

    const fontes = Array.isArray(body.fontes)
      ? parseFontes(body.fontes.filter((f): f is FonteAviso => typeof f === 'string').join(','))
      : null;

    // ⚠️ `desde` é reposicionado sempre que o aviso é LIGADO. Sem isso, religar
    // num cliente antigo despejaria todo o histórico de formulários no grupo —
    // e mensagem enviada não volta.
    await pool.query(
      `INSERT INTO public.lead_aviso_config (client_id, ativo, group_id, fontes, desde)
       VALUES ($1, COALESCE($2, FALSE), $3, COALESCE($4, 'meta_forms,landing_page'), NOW())
       ON CONFLICT (client_id) DO UPDATE SET
         ativo         = COALESCE($2, public.lead_aviso_config.ativo),
         group_id      = COALESCE($3, public.lead_aviso_config.group_id),
         fontes        = COALESCE($4, public.lead_aviso_config.fontes),
         desde         = CASE WHEN $2 IS TRUE AND public.lead_aviso_config.ativo IS NOT TRUE
                              THEN NOW() ELSE public.lead_aviso_config.desde END,
         atualizado_em = NOW()`,
      [id, body.ativo ?? null, body.groupId ?? null, fontes?.join(',') ?? null],
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[lead-aviso PATCH]', err);
    return Response.json({ ok: false, error: 'Não foi possível salvar.' }, { status: 500 });
  } finally { await pool.end(); }
}
