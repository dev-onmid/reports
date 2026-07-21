import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { fetchEvolutionContacts } from '@/lib/evolution-api';

// Backfill de identidade do chat (cara de WhatsApp): puxa os contatos da
// instância Evolution do cliente (nome do WhatsApp + foto de perfil) e aplica
// nos leads. Chamado pelo chat-view ao abrir o CRM de um cliente.
//
// Regras:
// - nome: só preenche quando o lead está SEM nome real (null, vazio ou igual ao
//   próprio número) — nunca sobrescreve nome digitado pela equipe.
// - foto: sempre atualiza quando o contato tem foto (URLs da Meta expiram, o
//   refresh a cada abertura funciona como cache).
export const maxDuration = 60;

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

export async function POST(req: NextRequest) {
  const { clientId } = await req.json().catch(() => ({})) as { clientId?: string };
  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: instances } = await pool.query<{ instance_id: string }>(
      `SELECT instance_id FROM public.client_zapi_instances
        WHERE client_id = $1 AND ativo = TRUE AND provider = 'evolution'
        ORDER BY created_at ASC`,
      [clientId],
    );
    if (instances.length === 0) {
      return Response.json({ ok: true, updatedNames: 0, updatedPics: 0, avatars: {}, reason: 'sem instância Evolution' });
    }

    // Contatos de todas as instâncias do cliente (normalmente 1)
    const byNumber = new Map<string, { name: string | null; pictureUrl: string | null }>();
    for (const inst of instances) {
      const contacts = await fetchEvolutionContacts(inst.instance_id).catch(() => []);
      for (const c of contacts) {
        const prev = byNumber.get(c.number);
        byNumber.set(c.number, {
          name: c.name ?? prev?.name ?? null,
          pictureUrl: c.pictureUrl ?? prev?.pictureUrl ?? null,
        });
      }
    }
    if (byNumber.size === 0) {
      return Response.json({ ok: true, updatedNames: 0, updatedPics: 0, avatars: {} });
    }

    const { rows: leads } = await pool.query<{ id: string; nome: string | null; numero: string | null; profile_picture_url: string | null }>(
      `SELECT id, nome, numero, profile_picture_url FROM public.crm_leads WHERE client_id = $1 AND numero IS NOT NULL`,
      [clientId],
    );

    // Índice por sufixo de 8 dígitos cobre a variação do 9º dígito brasileiro
    // (554391779645 vs 5543991779645) sem falso-positivo relevante.
    const bySuffix = new Map<string, { name: string | null; pictureUrl: string | null }>();
    for (const [num, info] of byNumber) bySuffix.set(num.slice(-8), info);

    let updatedNames = 0;
    let updatedPics = 0;
    const avatars: Record<string, string> = {};

    for (const lead of leads) {
      const num = digits(lead.numero);
      if (num.length < 8) continue;
      const contact = byNumber.get(num) ?? bySuffix.get(num.slice(-8));
      if (!contact) continue;

      const nomeAtual = (lead.nome ?? '').trim();
      const semNomeReal = !nomeAtual || digits(nomeAtual) === num || nomeAtual === lead.numero;
      const novoNome = semNomeReal && contact.name?.trim() ? contact.name.trim() : null;
      const novaFoto = contact.pictureUrl ?? null;

      if (novaFoto) avatars[num] = novaFoto;
      if (!novoNome && (!novaFoto || novaFoto === lead.profile_picture_url)) continue;

      await pool.query(
        `UPDATE public.crm_leads
            SET nome = COALESCE($2, nome),
                profile_picture_url = COALESCE($3, profile_picture_url)
          WHERE id = $1::uuid`,
        [lead.id, novoNome, novaFoto],
      );
      if (novoNome) updatedNames++;
      if (novaFoto && novaFoto !== lead.profile_picture_url) updatedPics++;
    }

    return Response.json({ ok: true, updatedNames, updatedPics, avatars });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
