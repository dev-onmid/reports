import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  createEvolutionInstance, fetchEvolutionInstances, getEvolutionQrCode, getEvolutionState, setEvolutionWebhook, webhookOrigin,
} from '@/lib/evolution-api';
import { AGENCIA, upsertSinal } from '@/lib/notificacoes';

/**
 * O PRÓPRIO CLIENTE reconecta o WhatsApp do CRM dele quando cai (2026-10-09).
 *
 * ⚠️ UM WhatsApp por cliente (decisão do Matheus, 09/10): sem nenhum, o cliente
 * conecta um que já nasce vinculado a ELE (instância criada aqui, com webhook);
 * com um (ou mais) já vinculado, só RECONECTA — nunca adiciona outro, não apaga,
 * não troca de instância. Os 4 clientes que hoje têm dois números (Cinfel,
 * Atibaia, Empas, PicoLocos) foram montados pela agência e seguem como estão.
 *
 * ⚠️⚠️ O risco real é escanear com OUTRO celular: a instância passa a ser o
 * número novo, e o atendimento (e os disparos, e o rastreio) sai por ele sem
 * ninguém perceber. Por isso guardamos o último número visto conectado
 * (`client_zapi_instances.numero_conectado`) e, ao voltar a conectar, comparamos:
 * número diferente vira aviso na tela E alarme para a agência.
 *
 * Aberta ao usuário de cliente (src/lib/acesso.ts); toda consulta leva o
 * `client_id` no WHERE, então uma instância de outro cliente não é alcançável
 * nem trocando o id.
 */

type Pool = ReturnType<typeof makeServerPool>;
type Linha = { id: string; nome: string | null; instance_id: string; numero_conectado: string | null };

let colunaPronta: Promise<unknown> | null = null;
function ensureColuna(pool: Pool) {
  if (!colunaPronta) {
    colunaPronta = pool.query(`ALTER TABLE public.client_zapi_instances ADD COLUMN IF NOT EXISTS numero_conectado TEXT`)
      .catch((e) => { colunaPronta = null; throw e; });
  }
  return colunaPronta;
}

const digitos = (v: string | null | undefined) => String(v ?? '').split('@')[0].replace(/\D/g, '');

/** Mesmo número com e sem o nono dígito (o JID do WhatsApp costuma vir sem). */
function mesmoNumero(a: string, b: string): boolean {
  const k = (d: string) => (d.startsWith('55') && d.length >= 12 ? d.slice(2) : d);
  const x = k(a), y = k(b);
  if (!x || !y) return true;
  return x.slice(0, 2) === y.slice(0, 2) && x.slice(-8) === y.slice(-8);
}

async function instanciasDoCliente(pool: Pool, clientId: string, id?: string | null): Promise<Linha[]> {
  await ensureColuna(pool);
  const { rows } = await pool.query<Linha>(
    `SELECT id::text, nome, instance_id, numero_conectado
       FROM public.client_zapi_instances
      WHERE client_id = $1 AND ativo = true AND provider = 'evolution'
        AND ($2::text IS NULL OR id::text = $2)
      ORDER BY created_at ASC`,
    [clientId, id ?? null],
  );
  return rows;
}

async function numeroAtual(instanceName: string): Promise<string> {
  const lista = await fetchEvolutionInstances().catch(() => []);
  return digitos(lista.find(i => i.name === instanceName)?.ownerJid ?? null);
}

/** Estado de cada WhatsApp do cliente; com `instanciaId`, também confere o número ao conectar. */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const instanciaId = req.nextUrl.searchParams.get('instanciaId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const linhas = await instanciasDoCliente(pool, clientId, instanciaId);
    const instancias = await Promise.all(linhas.map(async (l) => {
      const estado = await getEvolutionState(l.instance_id).then(s => s.state).catch(() => 'unknown');
      let numero: string | null = null;
      let numeroDiferente = false;
      if (estado === 'open') {
        numero = await numeroAtual(l.instance_id) || null;
        if (numero && l.numero_conectado && !mesmoNumero(numero, l.numero_conectado)) {
          numeroDiferente = true;
          await upsertSinal(pool, {
            userId: AGENCIA,
            tipo: 'instancia',
            signalKey: `instancia:numero-trocado:${l.id}:${numero}`,
            severidade: 'critico',
            importante: true,
            titulo: 'WhatsApp do cliente reconectado com OUTRO número',
            descricao: `A instância "${l.nome ?? l.instance_id}" atendia ${l.numero_conectado} e foi conectada pelo próprio cliente com ${numero}. `
              + 'Atendimento, disparos e rastreio passam a sair por esse número.',
            href: `/clientes/${clientId}?tab=rastreio`,
            clientId,
          }).catch(() => {});
        }
        // Primeira vez (sem número guardado) ou mesmo número: guarda como o atual.
        // Número diferente NÃO sobrescreve: o registro do original fica até a
        // agência decidir — senão o próximo GET já acharia tudo normal.
        if (numero && (!l.numero_conectado || !numeroDiferente)) {
          await pool.query(`UPDATE public.client_zapi_instances SET numero_conectado = $2 WHERE id::text = $1`, [l.id, numero]);
        }
        // Reconectar pode ter vindo de uma instância cujo webhook se perdeu.
        const origem = webhookOrigin(req.url);
        if (origem && !/localhost|0\.0\.0\.0|127\.0\.0\.1/.test(origem)) {
          await setEvolutionWebhook(l.instance_id, `${origem}/api/webhook/whatsapp/${l.id}`).catch(() => null);
        }
      }
      return {
        id: l.id,
        nome: l.nome,
        estado,
        numero,
        numeroEsperado: l.numero_conectado,
        numeroDiferente,
      };
    }));
    return Response.json({ instancias });
  } finally {
    await pool.end();
  }
}

/** Nome de instância a partir do nome do cliente: "crm-clinica-sorriso". */
function nomeDeInstancia(nomeCliente: string): string {
  const slug = nomeCliente.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `crm-${slug || 'cliente'}`;
}

/**
 * Gera o QR Code. Com `instanciaId`, reconecta aquela instância do cliente.
 * Sem, usa o WhatsApp único do cliente — e, se ele ainda não tiver nenhum,
 * cria e vincula (o limite de UM é conferido sob trava, para dois cliques
 * seguidos não criarem dois).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { clientId?: string; instanciaId?: string };
  if (!body.clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });
  const clientId = body.clientId;
  const pool = makeServerPool();
  try {
    let [l] = await instanciasDoCliente(pool, clientId, body.instanciaId ?? null);
    if (!l && body.instanciaId) return Response.json({ error: 'WhatsApp não encontrado para este cliente.' }, { status: 404 });

    if (!l) {
      await pool.query('BEGIN');
      try {
        await pool.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`whatsapp-cliente:${clientId}`]);
        // Qualquer instância ativa (inclusive Z-API) conta para o limite de UM.
        const { rows: [{ n }] } = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int n FROM public.client_zapi_instances WHERE client_id = $1 AND ativo = true`, [clientId],
        );
        if (n > 0) {
          await pool.query('ROLLBACK');
          return Response.json({ error: 'Este cliente já tem um WhatsApp vinculado. Para trocar de número, fale com a Onmid.' }, { status: 409 });
        }
        const { rows: [cli] } = await pool.query<{ name: string }>(`SELECT name FROM public.clients WHERE id = $1`, [clientId]);
        if (!cli) { await pool.query('ROLLBACK'); return Response.json({ error: 'Cliente não encontrado.' }, { status: 404 }); }
        const existentes = new Set((await fetchEvolutionInstances().catch(() => [])).map(i => i.name));
        let nome = nomeDeInstancia(cli.name);
        for (let i = 2; existentes.has(nome); i++) nome = `${nomeDeInstancia(cli.name)}-${i}`;
        const criada = await createEvolutionInstance(nome);
        const { rows: [nova] } = await pool.query<{ id: string }>(
          `INSERT INTO public.client_zapi_instances (client_id, nome, instance_id, token, provider)
           VALUES ($1, $2, $3, $4, 'evolution') RETURNING id::text`,
          [clientId, `WhatsApp ${cli.name}`, nome, criada.hash],
        );
        await pool.query('COMMIT');
        const origem = webhookOrigin(req.url);
        if (origem) await setEvolutionWebhook(nome, `${origem}/api/webhook/whatsapp/${nova.id}`).catch(() => null);
        [l] = await instanciasDoCliente(pool, clientId, nova.id);
      } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        return Response.json({ error: `Não foi possível criar o WhatsApp: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
      }
    }

    const estado = await getEvolutionState(l.instance_id).then(s => s.state).catch(() => 'unknown');
    if (estado === 'open') return Response.json({ estado, instanciaId: l.id });
    // Antes de gerar o QR, garante que sabemos qual número atendia — é a régua
    // para perceber se o cliente escanear com outro celular.
    if (!l.numero_conectado) {
      const anterior = await numeroAtual(l.instance_id);
      if (anterior) await pool.query(`UPDATE public.client_zapi_instances SET numero_conectado = $2 WHERE id::text = $1`, [l.id, anterior]);
    }
    const qr = await getEvolutionQrCode(l.instance_id).catch(() => null);
    if (!qr?.base64) {
      return Response.json({
        estado, instanciaId: l.id,
        error: 'O servidor do WhatsApp não gerou o QR Code agora. Tente de novo em 1 minuto; se continuar, avise a Onmid.',
      }, { status: 502 });
    }
    return Response.json({ estado, instanciaId: l.id, qr: qr.base64, numeroEsperado: l.numero_conectado });
  } finally {
    await pool.end();
  }
}
