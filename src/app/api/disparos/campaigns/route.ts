import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { parsePhoneList } from '@/lib/phone-formatter';
import { getCallerScope } from '@/lib/disparos-access';
import { serializeActiveDays } from '@/lib/disparos-schedule';
import { checkWhatsappNumbers, checkEvolutionStatus } from '@/lib/evolution-api';
import { resolverDestino, garantirZapiClient, nomeConfere } from '@/lib/disparos-destinos';

async function ensureColumns(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS active_from TEXT;
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS active_until TEXT;
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS active_days TEXT;
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS next_tick_at TIMESTAMPTZ;
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS messages JSONB;
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS daily_limit INT;
  `);
}

export async function GET(request: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    const scope = await getCallerScope(request, pool);
    const { rows } = await pool.query(
      `SELECT c.*, cl.name AS client_name, cl.instance_id,
              link.client_id AS onmid_client_id, oc.name AS onmid_client_name
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
         LEFT JOIN LATERAL (
           SELECT client_id FROM public.client_zapi_instances
            WHERE instance_id = cl.instance_id AND ativo = true
            ORDER BY created_at DESC LIMIT 1
         ) link ON true
         LEFT JOIN public.clients oc ON oc.id = link.client_id
        WHERE ($1::boolean OR cl.owner_id = $2)
        ORDER BY c.created_at DESC`,
      [scope.unrestricted, scope.userId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    /** Cliente da ONMID (clients.id) — o destino é o cliente, não a instância. */
    onmidClientId: string;
    /** Qual número do cliente usar (client_zapi_instances.instance_id). */
    instanceId: string;
    /** Nome do cliente digitado na confirmação. */
    confirmClientName: string;
    name: string;
    message: string;
    messages?: string[];
    imageUrls?: string[];
    numbers: string;
    startsAt: string;
    endsAt?: string;
    intervalMin: number;
    intervalMax: number;
    dailyLimit?: number | null;
    activeFrom?: string;
    activeUntil?: string;
    activeDays?: number[];
  };

  const { onmidClientId, instanceId, confirmClientName, name, message, messages, imageUrls, numbers, startsAt, endsAt, activeFrom, activeUntil, activeDays } = body;
  // Piso anti-bloqueio: intervalo aleatório nunca abaixo de 90s (decisão do
  // Matheus, 2026-07-31) — mesmo que o form mande menos, o servidor trava aqui
  // e o motor (worker/tick) trava de novo pra campanhas antigas.
  const intervalMin = Math.max(90, Number(body.intervalMin) || 90);
  const intervalMax = Math.max(intervalMin + 30, Number(body.intervalMax) || 0);
  // Teto diário por número: null = sem limite (explícito); default 120/dia.
  const dailyLimit = body.dailyLimit === null ? null : Math.max(1, Number(body.dailyLimit) || 120);
  const activeDaysText = serializeActiveDays(activeDays);
  const imageUrl = imageUrls && imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;
  const messagesJson = messages && messages.length > 1 ? JSON.stringify(messages) : null;

  if (!onmidClientId || !instanceId) {
    return Response.json({
      error: 'Escolha o cliente e o número de WhatsApp que vai disparar.',
    }, { status: 400 });
  }
  if (!name || !message || !numbers || !startsAt) {
    return Response.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
  }

  if (endsAt) {
    const endsAtDate = new Date(endsAt);
    const startsAtDate2 = new Date(startsAt);
    if (endsAtDate <= startsAtDate2) {
      return Response.json({ error: 'Horário de término deve ser depois do início.' }, { status: 400 });
    }
  }

  const parsed = parsePhoneList(numbers);
  if (parsed.length === 0) {
    return Response.json({ error: 'Nenhum número válido encontrado.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    const scope = await getCallerScope(request, pool);

    // ── Portão do servidor ──────────────────────────────────────────────
    // A tela é só apresentação. Aqui é onde se garante que (1) a instância é
    // MESMO daquele cliente, (2) quem disparou digitou o nome do cliente e (3)
    // o WhatsApp está conectado AGORA. Foi a ausência do item 3 que deixou uma
    // campanha nascer apontada pra uma instância inexistente e queimar 89
    // contatos em 404 antes de alguém perceber (20/08/2026).
    const destino = await resolverDestino(pool, onmidClientId, instanceId);
    if ('erro' in destino) {
      return Response.json({ error: destino.erro }, { status: 400 });
    }
    if (!nomeConfere(confirmClientName ?? '', destino.clientName)) {
      return Response.json({
        error: `Confirmação não confere. Digite exatamente o nome do cliente: ${destino.clientName}`,
      }, { status: 400 });
    }

    if (destino.provider === 'evolution') {
      let conectada = false;
      try { conectada = await checkEvolutionStatus(destino.instanceId); } catch { conectada = false; }
      if (!conectada) {
        return Response.json({
          error: `O WhatsApp de ${destino.clientName} não está conectado (${destino.instanceId}). `
               + 'Reconecte em Configurações → Instâncias antes de criar a campanha.',
          instancia_desconectada: true,
        }, { status: 409 });
      }
    }

    // Resolve-ou-cria a linha de zapi_clients desta instância: o FK da campanha
    // e o JOIN do worker continuam intactos.
    const clientId = await garantirZapiClient(pool, {
      instanceId: destino.instanceId,
      nomeCliente: destino.clientName,
      provider: destino.provider,
      token: destino.token,
      ownerId: scope.unrestricted ? null : scope.userId,
    });

    const startsAtDate = new Date(startsAt);
    const initialStatus = startsAtDate <= new Date() ? 'running' : 'pending';

    // ── Validação anti-bloqueio: confere na Evolution quais números EXISTEM no
    // WhatsApp antes de entrar na campanha (número quebrado = falha certa +
    // reputação queimada). Best-effort: instância Z-API ou Evolution fora do ar
    // → segue sem validação, nunca bloqueia a criação por indisponibilidade.
    let finalNumbers = parsed;
    let invalid: Array<{ phone: string; name?: string | null }> = [];
    if (destino.provider === 'evolution') {
      const check = await checkWhatsappNumbers(destino.instanceId, parsed.map(p => p.phone));
      if (check && check.size > 0) {
        finalNumbers = parsed.filter(p => check.get(p.phone.replace(/\D/g, '')) !== false);
        invalid = parsed
          .filter(p => check.get(p.phone.replace(/\D/g, '')) === false)
          .map(p => ({ phone: p.phone, name: p.name ?? null }));
      }
    }
    if (finalNumbers.length === 0) {
      return Response.json({
        error: `Nenhum número da lista existe no WhatsApp (${invalid.length} inválidos). Confira os números.`,
        invalid_count: invalid.length,
        invalid: invalid.slice(0, 50),
      }, { status: 400 });
    }

    const { rows: [campaign] } = await pool.query(
      `INSERT INTO public.zapi_campaigns
         (client_id, name, message, image_url, status, starts_at, ends_at, interval_min, interval_max, total, active_from, active_until, active_days, messages, daily_limit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [clientId, name, message, imageUrl || null, initialStatus, startsAt, endsAt || null, intervalMin, intervalMax, finalNumbers.length, activeFrom || null, activeUntil || null, activeDaysText, messagesJson, dailyLimit],
    );

    for (let i = 0; i < finalNumbers.length; i++) {
      await pool.query(
        `INSERT INTO public.zapi_numbers (campaign_id, phone, name, position) VALUES ($1,$2,$3,$4)`,
        [campaign.id, finalNumbers[i].phone, finalNumbers[i].name || null, i],
      );
    }

    return Response.json({
      ...campaign,
      invalid_count: invalid.length,
      invalid: invalid.slice(0, 50),
    }, { status: 201 });
  } finally {
    await pool.end();
  }
}
