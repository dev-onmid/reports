// Formulários nativos de Lead Ads da Página do cliente — listar, conectar,
// desconectar. Atrás do proxy (cookie obrigatório). Ver src/lib/meta-leadgen-forms.ts.
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  resolverPaginaDoCliente, listarFormularios, camposAssinadosNaPagina,
  assinarPaginaParaLeadgen, conectarFormularios, desconectarFormulario, listarConectados,
} from '@/lib/meta-leadgen-forms';

export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const pool = makeServerPool();
  try {
    const conectados = await listarConectados(pool, clientId).catch(() => []);
    const { pagina, motivo } = await resolverPaginaDoCliente(pool, clientId);
    if (!pagina) return Response.json({ pagina: null, motivo, formularios: [], conectados, assinada: false });
    const [{ formularios, erro }, campos] = await Promise.all([listarFormularios(pagina), camposAssinadosNaPagina(pagina)]);
    return Response.json({
      pagina: { id: pagina.pageId, nome: pagina.pageName },
      motivo: erro,
      formularios,
      conectados,
      assinada: campos.includes('leadgen'),
    });
  } finally { await pool.end(); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { formIds?: string[] };
  const ids = Array.isArray(body.formIds) ? body.formIds.map(String).filter(Boolean) : [];
  if (!ids.length) return Response.json({ error: 'Escolha ao menos um formulário.' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const { pagina, motivo } = await resolverPaginaDoCliente(pool, clientId);
    if (!pagina) return Response.json({ error: motivo ?? 'Página não resolvida.' }, { status: 400 });
    const { formularios, erro } = await listarFormularios(pagina);
    if (erro) return Response.json({ error: erro }, { status: 502 });
    const escolhidos = formularios.filter(f => ids.includes(f.id));
    if (!escolhidos.length) return Response.json({ error: 'Os formulários escolhidos não pertencem a esta Página.' }, { status: 400 });

    const { conectados, erro: erroConexao } = await conectarFormularios(pool, clientId, pagina, escolhidos);
    if (erroConexao) return Response.json({ error: erroConexao }, { status: 409 });
    const assinatura = await assinarPaginaParaLeadgen(pagina);
    return Response.json({
      ok: true, conectados, pagina: { id: pagina.pageId, nome: pagina.pageName },
      assinada: assinatura.ok, avisoAssinatura: assinatura.ok ? null : assinatura.erro,
      lista: await listarConectados(pool, clientId),
    });
  } finally { await pool.end(); }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const formId = req.nextUrl.searchParams.get('formId') ?? '';
  if (!formId) return Response.json({ error: 'formId obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const ok = await desconectarFormulario(pool, clientId, formId);
    return Response.json({ ok, lista: await listarConectados(pool, clientId) });
  } finally { await pool.end(); }
}
