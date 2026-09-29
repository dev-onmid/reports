import type { NextRequest } from 'next/server';
import { instanciaOnmid } from '@/lib/whatsapp-send';
import { makeServerPool } from '@/lib/server-db';
import {
  loadSocialAlertConfig, saveSocialAlertConfig, sendSocialMonitorAlert,
} from '@/lib/social-monitor-alert';

export const dynamic = 'force-dynamic';

// GET — config atual + instâncias Z-API disponíveis para o seletor da UI.
export async function GET() {
  const pool = makeServerPool();
  try {
    const config = await loadSocialAlertConfig(pool);
    // ⚠️ NÃO oferece mais uma lista: aviso da agência sai SEMPRE pela instância
    // oficial da ONMID (o envio, em social-monitor-alert, já ignora o que
    // estiver gravado). Devolver as outras aqui só daria ao gestor a impressão
    // de uma escolha que o servidor descarta — e a pior delas, mandar recado da
    // ONMID pelo WhatsApp de um cliente, é o que motivou a regra.
    const oficial = await instanciaOnmid(pool);
    const instances = oficial
      ? [{ id: oficial.id, name: oficial.name, provider: oficial.provider }]
      : [];
    return Response.json({ config, instances });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Erro ao carregar config' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

// POST — salva a config; com { action: 'test' } também dispara o aviso na hora
// (force: envia mesmo desativado/sem ofensores, pra validar instância+grupo).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    action?: string;
    ativo?: boolean;
    zapiClientId?: string | null;
    groupId?: string | null;
    groupName?: string | null;
  } | null;
  if (!body) return Response.json({ error: 'Body inválido' }, { status: 400 });

  const ativo = body.ativo === true;
  const zapiClientId = body.zapiClientId?.trim() || null;
  const groupId = body.groupId?.trim() || null;
  // Aviso ativo sem instância/grupo salvava "ligado" e devolvia ok — o cron nunca
  // teria destino e o silêncio pareceria sucesso.
  if (ativo && (!zapiClientId || !groupId)) {
    return Response.json({ error: 'Escolha a instância e o grupo antes de ativar o aviso.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const userId = req.headers.get('x-onmid-user-id') ?? undefined;
    await saveSocialAlertConfig(pool, {
      ativo,
      zapiClientId,
      groupId,
      groupName: body.groupName?.trim() || null,
    }, userId);

    if (body.action === 'test') {
      const result = await sendSocialMonitorAlert(pool, { force: true });
      return Response.json({ ok: true, test: result });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Erro ao salvar config' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
