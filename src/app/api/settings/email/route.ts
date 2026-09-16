import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import {
  lerConfigSmtp, salvarConfigSmtp, removerConfigSmtp, enviarEmail,
} from '@/lib/email-envio';

/**
 * Remetente dos e-mails do sistema (alertas e avisos de lead).
 *
 * GET    → configuração atual + qual remetente está valendo agora
 * POST   → salva; `{ testar: true, para }` manda uma mensagem de teste
 * DELETE → apaga o SMTP e o envio volta para o Gmail conectado
 *
 * ⚠️ A senha SÓ entra, nunca sai: o GET devolve `temSenha`, não o valor. Ela é
 * gravada cifrada e não tem por que voltar para o navegador.
 */

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    const smtp = await lerConfigSmtp(pool);
    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM public.google_connections
        WHERE account_type = 'gmail' AND status = 'connected' AND refresh_token IS NOT NULL
        ORDER BY connected_at DESC LIMIT 1`,
    );
    return Response.json({
      smtp,
      gmail: rows[0]?.email ?? null,
      // o que sai hoje: SMTP completo vence; senão a reserva; senão ninguém
      valendo: smtp?.temSenha ? 'smtp' : rows[0] ? 'gmail' : 'nenhum',
    });
  } catch (err) {
    console.error('[settings/email] GET', err);
    return Response.json({ smtp: null, gmail: null, valendo: 'nenhum' });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    const body = await request.json().catch(() => ({}));

    if (body.host !== undefined || body.user !== undefined || body.senha !== undefined
        || body.fromNome !== undefined || body.fromEmail !== undefined
        || body.port !== undefined || body.secure !== undefined) {
      const r = await salvarConfigSmtp(pool, {
        host: body.host, port: body.port === undefined ? undefined : Number(body.port),
        secure: body.secure, user: body.user, senha: body.senha,
        fromNome: body.fromNome, fromEmail: body.fromEmail,
      }, scope.userId ?? undefined);
      if (!r.ok) return Response.json({ error: r.erro }, { status: 400 });
    }

    if (body.testar) {
      const para = String(body.para ?? '').trim();
      if (!para) return Response.json({ error: 'Informe o e-mail que vai receber o teste' }, { status: 400 });
      const envio = await enviarEmail(pool, {
        to: para,
        subject: 'Teste de envio — ONMID Reports',
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#18181b">
          <p><strong>Deu certo.</strong> Este é o remetente que vai disparar os avisos de lead e os alertas do sistema.</p>
          <p style="color:#71717a;font-size:13px">Mensagem de teste enviada pelo painel de Configurações.</p>
        </div>`,
        text: 'Deu certo. Este é o remetente que vai disparar os avisos de lead e os alertas do sistema.',
      });
      return Response.json({ ok: envio.ok, via: envio.via, erro: envio.erro });
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[settings/email] POST', err);
    return Response.json({ error: 'Não foi possível salvar' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function DELETE(request: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });
    await removerConfigSmtp(pool);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[settings/email] DELETE', err);
    return Response.json({ error: 'Não foi possível remover' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
