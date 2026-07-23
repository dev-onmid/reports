import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendDocument } from '@/lib/zapi';

export const maxDuration = 60;

// Recebe do navegador o PDF REAL do relatório (renderizado no chat da Luna com o mesmo
// pipeline da tela de Relatórios) já em base64 e envia via WhatsApp (Z-API). O servidor
// resolve a conexão Z-API — o navegador nunca vê tokens. Também guarda uma cópia em
// agent_report_files pra ficar disponível no chat.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    pdf_base64?: string;
    filename?: string;
    phone?: string;
    caption?: string;
    zapi_client_id?: string | null;
    client_name?: string;
  };

  const { pdf_base64, filename, phone } = body;
  if (!pdf_base64 || !filename || !phone) {
    return Response.json({ ok: false, error: 'pdf_base64, filename e phone são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    // Resolve a conexão Z-API: a escolhida > primeira ativa > ferramenta externa da Luna.
    let zapiConn: { instance_id: string; token: string; security_token?: string } | null = null;
    if (body.zapi_client_id) {
      const { rows } = await pool.query(
        'SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id = $1',
        [body.zapi_client_id],
      );
      if (rows[0]) zapiConn = rows[0];
    }
    if (!zapiConn) {
      const { rows } = await pool.query(
        "SELECT instance_id, token, security_token FROM public.zapi_clients WHERE active = true ORDER BY created_at ASC LIMIT 1",
      );
      if (rows[0]) zapiConn = rows[0];
    }
    if (!zapiConn) {
      const { rows } = await pool.query(
        "SELECT config FROM public.agent_external_tools WHERE type = 'zapi_whatsapp' AND enabled = true LIMIT 1",
      );
      if (rows[0]?.config?.instance_id) {
        zapiConn = { instance_id: rows[0].config.instance_id, token: rows[0].config.token, security_token: rows[0].config.security_token };
      }
    }
    if (!zapiConn) {
      return Response.json({ ok: false, error: 'Nenhuma conexão Z-API encontrada.' }, { status: 400 });
    }

    // Guarda uma cópia do arquivo (best-effort).
    try {
      const buf = Buffer.from(pdf_base64, 'base64');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.agent_report_files (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          pdf_data BYTEA NOT NULL,
          filename TEXT NOT NULL,
          client_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
        )
      `);
      await pool.query(
        `INSERT INTO public.agent_report_files (pdf_data, filename, client_name) VALUES ($1, $2, $3)`,
        [buf, filename, body.client_name || 'Relatório'],
      );
    } catch { /* best-effort */ }

    const caption = body.caption ?? `📊 ${body.client_name ? `Relatório — ${body.client_name}` : 'Relatório'}\n\nGerado via Luna IA · Onmid Reports`;
    const result = await sendDocument(
      { instanceId: zapiConn.instance_id, token: zapiConn.token, clientToken: zapiConn.security_token },
      phone, pdf_base64, filename, caption,
    );

    if (result.ok) return Response.json({ ok: true });
    return Response.json({ ok: false, error: result.error || 'Falha ao enviar via WhatsApp.' }, { status: 502 });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Erro interno.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
