import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { processarReuniao, type AcaoInput, type ReuniaoInput } from '@/lib/reuniao-intake';

/**
 * Entrada das reuniões do TLDV, chamada pelo Make.
 *
 * Autenticação por segredo compartilhado no header `x-onmid-secret` — não há
 * sessão de browser aqui. Sem `MAKE_INTEGRATION_SECRET` configurado a rota
 * responde 503 e não processa nada: falhar fechado é melhor do que ficar aberta
 * porque alguém esqueceu a variável de ambiente.
 */

function segredoConfere(req: NextRequest): 'ok' | 'sem-segredo' | 'negado' {
  const esperado = process.env.MAKE_INTEGRATION_SECRET;
  if (!esperado) return 'sem-segredo';
  const recebido = req.headers.get('x-onmid-secret') ?? '';
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // timingSafeEqual exige mesmo tamanho; o teste de length antes vaza só o
  // tamanho do segredo, que não ajuda quem estiver adivinhando.
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'negado';
}

/**
 * A prioridade chega como a IA escreve ("Alta") ou como o ClickUp numera (2).
 * 1 urgente · 2 alta · 3 normal · 4 baixa.
 */
function prioridadeDe(raw: unknown): number | null {
  const n = Number(raw);
  if ([1, 2, 3, 4].includes(n)) return n;
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'urgente') return 1;
  if (s === 'alta') return 2;
  if (s === 'media' || s === 'média' || s === 'normal') return 3;
  if (s === 'baixa') return 4;
  return null;
}

function normalizarAcoes(raw: unknown): AcaoInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AcaoInput[] => {
    if (!item || typeof item !== 'object') return [];
    const o = item as Record<string, unknown>;
    // `acao`/`item_original` é o dialeto da IA consolidada do Make; os demais
    // nomes cobrem quem chamar o endpoint direto.
    const titulo = [o.titulo, o.name, o.acao].find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? '';
    if (!titulo) return [];
    const descricao = [o.descricao, o.item_original].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const prazo = Number(o.prazo_dias);
    return [{
      titulo,
      descricao: descricao ? (o.item_original === descricao ? `📌 Trecho original: ${descricao}` : descricao) : undefined,
      setor: typeof o.setor === 'string' ? o.setor : undefined,
      status: typeof o.status === 'string' ? o.status : undefined,
      prazo_dias: Number.isFinite(prazo) ? prazo : null,
      prioridade: prioridadeDe(o.prioridade),
    }];
  });
}

/**
 * As ações podem vir soltas em `acoes` ou dentro de `ia`.
 *
 * O segundo formato existe porque o Make manda a saída da IA verbatim: montar
 * um array JSON à mão no corpo da requisição, lá, significa concatenar string
 * e quebra no primeiro título que tiver aspas. Repassar o objeto inteiro é
 * mais simples de configurar e mais difícil de corromper.
 */
function extrairAcoes(body: Record<string, unknown>): AcaoInput[] {
  const diretas = normalizarAcoes(body.acoes);
  if (diretas.length) return diretas;
  const ia = body.ia;
  if (ia && typeof ia === 'object') return normalizarAcoes((ia as Record<string, unknown>).acoes);
  return [];
}

/**
 * Alertas viram a tarefa "NOVA INFORMAÇÃO" — que antes era um módulo do Make
 * com os três assignees de social CHUMBADOS. `NO_GLOBAL_SIGNAL_88417` é a
 * sentinela que o prompt da IA usa para "não há alerta".
 */
function extrairAlertas(body: Record<string, unknown>): string | null {
  const ia = body.ia;
  const bruto = typeof body.alertas === 'string'
    ? body.alertas
    : ia && typeof ia === 'object' && typeof (ia as Record<string, unknown>).alertas === 'string'
      ? (ia as Record<string, unknown>).alertas as string
      : '';
  const texto = bruto.trim();
  if (!texto || texto.includes('NO_GLOBAL_SIGNAL')) return null;
  return texto;
}

export async function POST(req: NextRequest) {
  const auth = segredoConfere(req);
  if (auth === 'sem-segredo') {
    return Response.json({ ok: false, erro: 'integracao_nao_configurada' }, { status: 503 });
  }
  if (auth === 'negado') {
    return Response.json({ ok: false, erro: 'nao_autorizado' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, erro: 'json_invalido' }, { status: 400 });
  }

  const cliente = typeof body.cliente === 'string' ? body.cliente.trim() : '';
  if (!cliente) {
    return Response.json({ ok: false, erro: 'cliente_obrigatorio' }, { status: 400 });
  }

  const input: ReuniaoInput = {
    cliente,
    meeting_id: typeof body.meeting_id === 'string' ? body.meeting_id : undefined,
    doc_url: typeof body.doc_url === 'string' ? body.doc_url : undefined,
    acoes: extrairAcoes(body),
    alertas: extrairAlertas(body),
  };

  const pool = makeServerPool();
  try {
    const r = await processarReuniao(pool, input);
    // Cliente não resolvido não é erro de quem chamou: é o caso normal de
    // cliente novo. 200 com ok:false deixa o Make ler `sugestoes` e avisar no
    // WhatsApp sem tratar como falha de requisição.
    return Response.json(r);
  } catch (err) {
    console.error('[integracao reuniao]', err);
    return Response.json({ ok: false, erro: 'falha_interna' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
