"use client";

// Adaptador: transforma o que as rotas já devolvem no contrato `DadosDelivery`.
//
// É o único lugar que conhece o formato das fontes. Os componentes recebem o
// tipo limpo e não sabem de onde veio — foi assim que o protótipo deixou de
// depender do gerador de dados fictícios.

import { useEffect, useMemo, useState } from 'react';
import {
  HEATMAP_VAZIO,
  type CanalTrafego, type DadosDelivery, type PresencaInstagram, type SaldoCanal,
} from '@/types/dashboard';

type ResumoKpi = { receita: number; pedidos: number; ticketMedio: number; clientesUnicos: number; clientesNovos: number };

/** Resposta de /api/clients/[id]/cardapioweb. */
type RespostaCardapio = {
  conectado: boolean;
  kpis?: {
    atual: ResumoKpi;
    anterior: ResumoKpi;
    variacao: { receita: number | null; pedidos: number | null; ticketMedio: number | null };
  };
  // O funil vem como FOTO por etapa: { etapas: { novo: {clientes,receita}, ... }, totalClientes }.
  funil?: { periodo?: { etapas?: Record<string, { clientes: number; receita: number }> } };
  serie?: Array<{ data: string; receita: number; pedidos: number }>;
  heatmap?: { faixas: string[]; matriz: number[][]; max: number };
  frequencia?: Array<{ chave: string; nome: string; clientes: number }>;
  sincronizacao?: { ultima_sync_em?: string | null };
};

/** Cor de cada faixa de frequência — mais pedidos = melhor = tom mais "vivo". */
const TOM_FREQUENCIA: Record<string, 'muted' | 'blue' | 'secondary' | 'primary'> = {
  '1': 'muted', '2-4': 'blue', '5-9': 'secondary', '10+': 'primary',
};

export type EntradaTrafego = {
  metaSpend: number; metaImpressions: number; metaClicks: number;
  googleCost: number; googleImpressions: number; googleClicks: number;
  metaSaldo: number | null; googleSaldo: number | null;
  instagram: PresencaInstagram;
};

const razao = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function useDadosDelivery(
  clientId: string | null,
  de: string,
  ate: string,
  trafego: EntradaTrafego,
): DadosDelivery | null {
  const [bruto, setBruto] = useState<RespostaCardapio | null>(null);

  useEffect(() => {
    if (!clientId) { setBruto(null); return; }
    let vivo = true;
    setBruto(null);
    fetch(`/api/clients/${clientId}/cardapioweb?from=${de}&to=${ate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setBruto(d); })
      .catch(() => { if (vivo) setBruto(null); });
    return () => { vivo = false; };
  }, [clientId, de, ate]);

  return useMemo<DadosDelivery | null>(() => {
    if (!bruto) return null;

    const a = bruto.kpis?.atual;
    const v = bruto.kpis?.variacao;
    // O funil chega como { etapas: { novo: { clientes, receita }, ... } } — a
    // contagem viva de cada etapa mora em `.clientes`.
    const etapas = bruto.funil?.periodo?.etapas ?? {};
    const conta = (e: string): number => etapas[e]?.clientes ?? 0;
    const dias = Math.max(1, Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1);

    const canais: CanalTrafego[] = [];
    if (trafego.metaSpend > 0 || trafego.metaImpressions > 0) {
      canais.push({
        canal: 'meta',
        investimento: trafego.metaSpend,
        impressoes: trafego.metaImpressions || null,
        cliques: trafego.metaClicks || null,
        resultados: null,
        ctr: razao(trafego.metaClicks, trafego.metaImpressions),
        cpc: razao(trafego.metaSpend, trafego.metaClicks),
      });
    }
    // Google só entra se houve investimento — bloco vazio ocupando seção inteira
    // é desperdício de hierarquia (é o print 09 do briefing).
    if (trafego.googleCost > 0 || trafego.googleImpressions > 0) {
      canais.push({
        canal: 'google',
        investimento: trafego.googleCost,
        impressoes: trafego.googleImpressions || null,
        cliques: trafego.googleClicks || null,
        resultados: null,
        ctr: razao(trafego.googleClicks, trafego.googleImpressions),
        cpc: razao(trafego.googleCost, trafego.googleClicks),
      });
    }

    const investimento = trafego.metaSpend + trafego.googleCost;
    const saldos: SaldoCanal[] = [
      { canal: 'meta' as const, saldo: trafego.metaSaldo, gasto: trafego.metaSpend },
      { canal: 'google' as const, saldo: trafego.googleSaldo, gasto: trafego.googleCost },
    ]
      .filter((s) => s.saldo !== null && s.saldo > 0)
      .map((s) => ({
        canal: s.canal,
        saldo: s.saldo,
        diasRestantes: s.gasto > 0 ? (s.saldo as number) / (s.gasto / dias) : null,
      }));

    const ativos = conta('novo') + conta('recorrente') + conta('reconquistado');

    // Distribuição por frequência → faixas coloridas. A taxa de recorrência sai
    // daqui: quem voltou (2+ pedidos) sobre o total da base.
    const freq = bruto.frequencia ?? [];
    const recorrencia = freq.map((f) => ({
      nome: f.nome, clientes: f.clientes, tom: TOM_FREQUENCIA[f.chave] ?? 'muted',
    }));
    const totalBase = freq.reduce((s, f) => s + f.clientes, 0);
    const umPedido = freq.find((f) => f.chave === '1')?.clientes ?? 0;
    const taxaRecorrencia = totalBase > 0 ? (totalBase - umPedido) / totalBase : null;

    return {
      periodo: { de, ate },
      fonte: bruto.conectado
        ? { status: 'ok', atualizadoEm: bruto.sincronizacao?.ultima_sync_em ?? null }
        : { status: 'sem_integracao', comoConectar: 'Conecte o cardápio digital em Cliente → Configurar → Conexões.' },
      vendas: {
        receita: a?.receita ?? 0,
        pedidos: a?.pedidos ?? 0,
        ticket: a && a.pedidos > 0 ? a.receita / a.pedidos : null,
        novosClientes: a?.clientesNovos ?? 0,
        dias,
      },
      anterior: bruto.kpis?.anterior
        ? { receita: bruto.kpis.anterior.receita, pedidos: bruto.kpis.anterior.pedidos }
        : null,
      variacao: {
        receita: v?.receita ?? null,
        pedidos: v?.pedidos ?? null,
        ticket: v?.ticketMedio ?? null,
      },
      serie: (bruto.serie ?? []).map((p) => ({
        data: p.data,
        // dd/mm a partir de YYYY-MM-DD.
        label: p.data.split('-').reverse().slice(0, 2).join('/'),
        receita: p.receita,
        pedidos: p.pedidos,
        novos: 0,
        investimento: 0,
      })),
      // ⚠️ Só o último degrau (pedidos) tem fonte. Acessos → carrinho → checkout
      // exigem instrumentar o cardápio (futuro: Google Analytics) — ficam `null`,
      // e o Funnel os desenha tracejados como "sem medição", nunca zero.
      funil: {
        acessos: null, viuItens: null, carrinho: null, checkout: null,
        pedidos: a?.pedidos ?? null,
      },
      heatmap: bruto.heatmap ?? HEATMAP_VAZIO,
      clientes: {
        ativos,
        emRisco: conta('em_risco'),
        inativos: conta('inativo'),
        recorrencia,
        taxaRecorrencia,
      },
      canais,
      criativos: [],
      instagram: trafego.instagram,
      saldos,
      investimento,
    } as DadosDelivery;
  }, [bruto, de, ate, trafego]);
}
