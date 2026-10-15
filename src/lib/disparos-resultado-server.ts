/**
 * Leitura do resultado das campanhas de disparo (server). A lógica de decisão
 * mora em `disparos-resultado.ts` (pura); aqui só se junta o dado.
 *
 * ⚠️ NADA é gravado: derivado na leitura, como a taxa de resposta antiga — quem
 * responde ou compra depois aparece sozinho na próxima abertura.
 *
 * ⚠️ Lê o CLIENTE inteiro de uma vez (todas as campanhas das instâncias dele),
 * porque a atribuição de pedido é "envio mais recente entre TODAS as campanhas".
 * Calcular campanha por campanha contaria a mesma venda em várias.
 */
import type { makeServerPool } from '@/lib/server-db';
import { normalizarTelefoneBR, sufixo8 } from '@/lib/cardapioweb-recorrencia';
import { lerPedidosDelivery } from '@/lib/delivery-orders';
import {
  classificarConversa, atribuirPedidosAosEnvios, JANELA_PEDIDO_DIAS,
  type EnvioDisparo, type MensagemRecebida, type ResumoDisparo, type ContatoResultado,
} from '@/lib/disparos-resultado';

type Pool = ReturnType<typeof makeServerPool>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
/** Venda no CRM fechada até N dias depois do disparo (ciclo de venda de serviço é mais longo que delivery). */
const JANELA_CRM_DIAS = 30;

export async function analisarCampanhas(
  pool: Pool, campaignIds: string[], detalheDe?: string,
): Promise<{ resumos: Map<string, ResumoDisparo>; contatos: ContatoResultado[]; onmidClientId: string | null }> {
  const resumos = new Map<string, ResumoDisparo>();
  let contatos: ContatoResultado[] = [];
  let onmidDoDetalhe: string | null = null;
  if (campaignIds.length === 0) return { resumos, contatos, onmidClientId: null };

  // Campanha → cliente ONMID (mesmo vínculo da taxa antiga e da tela).
  const { rows: camps } = await pool.query<{ id: string; onmid: string | null }>(
    `SELECT c.id, link.client_id AS onmid
       FROM public.zapi_campaigns c
       JOIN public.zapi_clients cl ON cl.id = c.client_id
       LEFT JOIN LATERAL (
         SELECT client_id FROM public.client_zapi_instances
          WHERE instance_id = cl.instance_id AND ativo = true
          ORDER BY created_at DESC LIMIT 1
       ) link ON true
      WHERE c.id = ANY($1::uuid[])`,
    [campaignIds],
  );

  const porCliente = new Map<string, string[]>();
  for (const c of camps) {
    if (!c.onmid) {
      resumos.set(c.id, vazio(c.id, false));
      continue;
    }
    const l = porCliente.get(c.onmid) ?? []; l.push(c.id); porCliente.set(c.onmid, l);
    if (c.id === detalheDe) onmidDoDetalhe = c.onmid;
  }

  for (const [onmid, pedidas] of porCliente) {
    // Todas as campanhas das instâncias do cliente — base da atribuição.
    const { rows: todas } = await pool.query<{ id: string }>(
      `SELECT c.id FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
        WHERE cl.instance_id IN (SELECT instance_id FROM public.client_zapi_instances WHERE client_id = $1 AND ativo = true)`,
      [onmid],
    );
    const idsCliente = [...new Set([...todas.map(r => r.id), ...pedidas])];

    const { rows: envRows } = await pool.query<{ id: string; campaign_id: string; phone: string; name: string | null; sent_at: Date }>(
      `SELECT id, campaign_id, phone, name, sent_at FROM public.zapi_numbers
        WHERE campaign_id = ANY($1::uuid[]) AND status = 'sent' AND sent_at IS NOT NULL`,
      [idsCliente],
    );
    // Um envio por pessoa por campanha (lista antiga podia ter o número 2×): fica o 1º.
    const vistos = new Set<string>();
    const envios: (EnvioDisparo & { phone: string; name: string | null })[] = [];
    for (const r of envRows.sort((a, b) => a.sent_at.getTime() - b.sent_at.getTime())) {
      const chave = normalizarTelefoneBR(r.phone) ?? '';
      const k = `${r.campaign_id}|${chave || r.phone}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      envios.push({ envioId: r.id, campanhaId: r.campaign_id, chave, enviadoEm: iso(r.sent_at), phone: r.phone, name: r.name });
    }

    // Leads do cliente, indexados pela chave completa e pelo sufixo de 8.
    const { rows: leads } = await pool.query<{ id: string; numero: string; fechou: boolean | null; valor_rs: string | null; fechado_em: Date | string | null }>(
      `SELECT id, numero, fechou, valor_rs::text, fechado_em FROM public.crm_leads
        WHERE client_id = $1 AND numero IS NOT NULL AND numero <> ''`,
      [onmid],
    ).catch(() => ({ rows: [] as { id: string; numero: string; fechou: boolean | null; valor_rs: string | null; fechado_em: Date | string | null }[] }));
    const porChaveLead = new Map<string, typeof leads[number]>();
    const porSufixo = new Map<string, typeof leads[number]>();
    for (const l of leads) {
      const k = normalizarTelefoneBR(l.numero); if (k && !porChaveLead.has(k)) porChaveLead.set(k, l);
      const s = sufixo8(l.numero); if (s && !porSufixo.has(s)) porSufixo.set(s, l);
    }
    const leadDe = (phone: string) => porChaveLead.get(normalizarTelefoneBR(phone) ?? '') ?? porSufixo.get(sufixo8(phone) ?? '') ?? null;

    // Mensagens recebidas desses leads desde o 1º envio.
    const enviosPedidos = envios.filter(e => pedidas.includes(e.campanhaId));
    const leadIds = [...new Set(enviosPedidos.map(e => leadDe(e.phone)?.id).filter((x): x is string => !!x))];
    const desde = enviosPedidos.reduce((m, e) => (e.enviadoEm < m ? e.enviadoEm : m), new Date().toISOString());
    const msgsPorLead = new Map<string, MensagemRecebida[]>();
    if (leadIds.length) {
      const { rows: msgs } = await pool.query<{ lead_id: string; texto: string; tipo: string | null; created_at: Date }>(
        `SELECT lead_id, left(text, 500) AS texto, tipo, created_at FROM public.crm_messages
          WHERE lead_id = ANY($1::uuid[]) AND direction = 'in' AND created_at >= $2
          ORDER BY created_at ASC`,
        [leadIds, desde],
      ).catch(() => ({ rows: [] as { lead_id: string; texto: string; tipo: string | null; created_at: Date }[] }));
      for (const m of msgs) {
        const l = msgsPorLead.get(m.lead_id) ?? []; l.push({ texto: m.texto, em: iso(m.created_at), tipo: m.tipo }); msgsPorLead.set(m.lead_id, l);
      }
    }

    // Pedidos de delivery (Anota AI / Cardápio Web) → atribuição.
    const { pedidos } = await lerPedidosDelivery(pool, onmid);
    const temDelivery = pedidos.length > 0;
    const compras = atribuirPedidosAosEnvios(envios, pedidos.map(p => ({
      chave: normalizarTelefoneBR(p.customer_phone) ?? '',
      criadoEm: iso(p.created_at),
      total: Number(p.total) || 0,
      cancelado: /cancel/i.test(String(p.status ?? '')),
    })), JANELA_PEDIDO_DIAS);

    for (const campId of pedidas) {
      const r = vazio(campId, true);
      r.fonteVenda = temDelivery ? 'delivery' : null;
      const doCamp = enviosPedidos.filter(e => e.campanhaId === campId);
      for (const e of doCamp) {
        r.enviados++;
        const lead = leadDe(e.phone);
        // Só mensagens DEPOIS deste envio — a conversa de antes não é resposta.
        const depois = (lead ? msgsPorLead.get(lead.id) ?? [] : []).filter(m => m.em > e.enviadoEm).slice(0, 15);
        const conv = classificarConversa(e.enviadoEm, depois);
        if (conv.classe === 'interesse') r.interesse++;
        if (conv.classe === 'parar') r.parar++;
        if (conv.classe === 'automatica') r.automaticas++;
        if (conv.classe === 'interesse' || conv.classe === 'humana' || conv.classe === 'parar') r.responderam++;

        const compra = compras.get(e.envioId) ?? null;
        if (compra) { r.compradores++; r.pedidos += compra.pedidos; r.receita += compra.receita; }

        let vendaCrm: ContatoResultado['vendaCrm'] = null;
        if (lead && (lead.fechou || Number(lead.valor_rs) > 0)) {
          const em = lead.fechado_em ? iso(lead.fechado_em).slice(0, 10) : null;
          const dEnvio = e.enviadoEm.slice(0, 10);
          const limite = new Date(Date.parse(e.enviadoEm) + JANELA_CRM_DIAS * 86_400_000).toISOString().slice(0, 10);
          // ⚠️ Sem data de fechamento não dá para dizer que veio DESTE disparo.
          if (em && em >= dEnvio && em <= limite) {
            vendaCrm = { valor: Number(lead.valor_rs) || 0, em };
            r.vendasCrm++; r.receitaCrm += vendaCrm.valor;
          }
        }

        if (campId === detalheDe) {
          contatos.push({
            envioId: e.envioId, nome: e.name, telefone: e.phone, enviadoEm: e.enviadoEm,
            classe: conv.classe,
            resposta: conv.principal ? { texto: conv.principal.texto, em: conv.principal.em, tipo: conv.principal.tipo ?? null } : null,
            recebidas: conv.recebidas, leadId: lead?.id ?? null, compra, vendaCrm,
          });
        }
      }
      if (!temDelivery && r.vendasCrm > 0) r.fonteVenda = 'crm';
      r.taxa = r.enviados > 0 ? (r.responderam / r.enviados) * 100 : null;
      r.receita = Math.round(r.receita * 100) / 100;
      r.receitaCrm = Math.round(r.receitaCrm * 100) / 100;
      resumos.set(campId, r);
    }
  }

  // Quem comprou primeiro, depois quem demonstrou interesse, depois quem respondeu.
  const peso: Record<string, number> = { interesse: 1, humana: 2, parar: 3, automatica: 4, sem_resposta: 5 };
  contatos = contatos.sort((a, b) =>
    Number(!!(b.compra || b.vendaCrm)) - Number(!!(a.compra || a.vendaCrm))
    || peso[a.classe] - peso[b.classe]
    || (b.resposta?.em ?? b.enviadoEm).localeCompare(a.resposta?.em ?? a.enviadoEm));
  return { resumos, contatos, onmidClientId: onmidDoDetalhe };
}

function vazio(campaignId: string, mensuravel: boolean): ResumoDisparo {
  return {
    campaignId, mensuravel, enviados: 0, responderam: 0, interesse: 0, parar: 0, automaticas: 0,
    taxa: null, fonteVenda: null, compradores: 0, pedidos: 0, receita: 0, vendasCrm: 0, receitaCrm: 0,
  };
}
