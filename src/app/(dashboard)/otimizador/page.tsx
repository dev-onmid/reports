"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  LayoutGrid,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Play,
  Presentation,
  Search,
  Settings2,
  Users,
  WandSparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { callerHeaders, getAuthSession } from '@/lib/auth-store';
import type { Client } from '@/lib/mock-data';
import {
  OTIMIZADOR_VARS,
  categoriaDoNode,
  flattenTree,
  type AccountOption,
  type ArvoreResumo,
  type Categoria,
  type ClientDiagnostic,
  type FilaConta,
  type FilaRec,
  type NivelFiltro,
  type ToastState,
  type TreeNode,
} from '@/lib/optimizer-ui';
import { AccountRail } from '@/components/otimizador/account-rail';
import { AccountHealthHero, AccountKpiRow } from '@/components/otimizador/account-health-hero';
import { CampaignTable } from '@/components/otimizador/campaign-tree';
import { ConfigModal } from '@/components/otimizador/config-modal';
import { ConfirmToast } from '@/components/otimizador/confirm-toast';
import { DecisionPanel } from '@/components/otimizador/decision-panel';
import { FilterChips, QuickDecisionCards } from '@/components/otimizador/decision-strip';

// ---------------------------------------------------------------------------
// Main Page — orquestrador: estado + fetch/polling + handlers. Toda a UI vive
// em src/components/otimizador/* e os helpers puros em src/lib/optimizer-ui.ts.
// ---------------------------------------------------------------------------
export default function OtimizadorPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [contas, setContas] = useState<FilaConta[]>([]);
  const [contaFiltro, setContaFiltro] = useState('');
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [resumo, setResumo] = useState<ArvoreResumo | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoriaFiltro, setCategoriaFiltro] = useState<Categoria | null>(null);
  const [nivelFiltro, setNivelFiltro] = useState<NivelFiltro>('todos');
  const [apenasComAcao, setApenasComAcao] = useState(false);
  // Conta mista (Meta + Google) tem análise separada por plataforma — a rota /arvore já devolve
  // os dois canais juntos (cada nó vem com `canal`), a lista agrupa por canal em vez de precisar
  // de um toggle pra trocar de visão. `canais` só informa quais estão disponíveis.
  const [canais, setCanais] = useState<string[]>([]);

  // Admin: análise manual
  const [runLoading, setRunLoading] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<ClientDiagnostic[] | null>(null);
  const [configClientId, setConfigClientId] = useState<string | null>(null);

  const session = getAuthSession();
  const isAdmin = session?.role === 'Administrador';

  async function loadOverview() {
    setLoading(true);
    try {
      const [clientsRes, filaRes] = await Promise.all([
        fetch('/api/clients'),
        fetch('/api/otimizador/fila?hours=200'),
      ]);
      let activeClients: Client[] = [];
      let filaContas: FilaConta[] = [];

      if (clientsRes.ok) {
        const data = await clientsRes.json() as Client[];
        activeClients = data.filter((c) => c.status !== 'Arquivado' && c.status !== 'Inativo');
      }
      if (filaRes.ok) {
        const data = await filaRes.json() as { contas: FilaConta[] };
        filaContas = data.contas ?? [];
      }

      setClients(activeClients);
      setContas(filaContas);
      // Abre a conta vinda por ?clientId= (ex: clique na Sala de guerra) na primeira carga.
      const urlClientId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('clientId') : null;
      setContaFiltro((prev) => {
        const validIds = new Set([...filaContas.map((c) => c.cliente_id), ...activeClients.map((c) => c.id)]);
        if (prev && validIds.has(prev)) return prev;
        if (urlClientId && validIds.has(urlClientId)) return urlClientId;
        return filaContas[0]?.cliente_id ?? activeClients[0]?.id ?? '';
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadOverview(); }, []);

  async function loadTree(clientId: string) {
    if (!clientId) { setTreeNodes([]); setResumo(null); setGeneratedAt(null); setCanais([]); return; }
    setTreeLoading(true);
    setTreeError(null);
    try {
      const res = await fetch(`/api/otimizador/arvore?clientId=${encodeURIComponent(clientId)}&hours=200`);
      if (!res.ok) {
        setTreeError(`Não foi possível carregar a árvore (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json() as { campanhas: TreeNode[]; resumo: ArvoreResumo | null; generated_at: string | null; canais?: string[] };
      setTreeNodes(data.campanhas ?? []);
      setResumo(data.resumo);
      setGeneratedAt(data.generated_at);
      setCanais(data.canais ?? []);
      setSelectedId(null);
    } catch {
      setTreeError('Falha de rede ao carregar a árvore.');
    } finally {
      setTreeLoading(false);
    }
  }

  useEffect(() => { void loadTree(contaFiltro); }, [contaFiltro]);

  const flatNodes = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const selectedNode = useMemo(() => flatNodes.find((n) => n.rec_id === selectedId) ?? null, [flatNodes, selectedId]);
  const accountOptions = useMemo<AccountOption[]>(() => {
    const byId = new Map<string, AccountOption>();
    for (const conta of contas) {
      byId.set(conta.cliente_id, { ...conta, tem_analise: true });
    }
    for (const client of clients) {
      if (byId.has(client.id)) continue;
      byId.set(client.id, {
        cliente_id: client.id,
        cliente_nome: client.name,
        pior_severidade: 'ok',
        pendencias: 0,
        tem_analise: false,
      });
    }
    return Array.from(byId.values()).sort((a, b) => {
      if (a.tem_analise !== b.tem_analise) return a.tem_analise ? -1 : 1;
      return a.cliente_nome.localeCompare(b.cliente_nome, 'pt-BR');
    });
  }, [clients, contas]);
  const contaAtual = accountOptions.find((a) => a.cliente_id === contaFiltro) ?? null;

  // Seleciona automaticamente o item de maior prioridade ao carregar uma nova árvore — o painel
  // de detalhe nunca fica vazio à toa quando já existe algo urgente pra decidir.
  useEffect(() => {
    if (selectedId || flatNodes.length === 0) return;
    const porPrioridade = [...flatNodes].sort((a, b) => {
      const rank = (n: TreeNode) => (categoriaDoNode(n) === 'pausar' ? 0 : n.severidade === 'urgente' ? 1 : n.severidade === 'atencao' ? 2 : 3);
      return rank(a) - rank(b);
    });
    const top = porPrioridade.find((n) => n.texto_recomendacao.trim()) ?? null;
    if (top) setSelectedId(top.rec_id);
  }, [flatNodes]); // eslint-disable-line react-hooks/exhaustive-deps

  function jumpTo(recId: string) {
    setSelectedId(recId);
  }

  const autor = { autor_id: session?.userId ?? undefined, autor_nome: session?.name ?? undefined };

  function removeFromTree(ids: string[], newStatus: string, statusEntrega?: string) {
    function walk(nodes: TreeNode[]): TreeNode[] {
      return nodes.map((n) => ids.includes(n.rec_id)
        ? { ...n, status: newStatus, status_entrega: statusEntrega ?? n.status_entrega }
        : { ...n, filhos: walk(n.filhos as TreeNode[]) });
    }
    setTreeNodes((prev) => walk(prev));
  }

  async function doApply(rec: FilaRec, params: { novo_orcamento_diario?: number }) {
    const acao = rec.acao_estruturada;
    if (!acao) return;
    setBusy(true);
    try {
      const res = await fetch('/api/otimizador/executar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify({
          rec_id: rec.rec_id, analise_id: rec.analise_id, canal: rec.canal, client_id: rec.cliente_id,
          connection_id: rec.connection_id ?? '', account_id: rec.account_id ?? undefined,
          acao: acao.tipo, objeto_tipo: acao.objeto_tipo, objeto_id: acao.objeto_id, objeto_nome: rec.objeto_nome,
          parametros: { ...acao.parametros, ...params }, justificativa: rec.texto_recomendacao, ...autor,
        }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; pode_desfazer?: boolean };
      if (!res.ok || !data.ok) {
        setToast({ text: `Não foi possível aplicar: ${data.error ?? res.statusText}`, erro: true });
        return;
      }
      removeFromTree([rec.rec_id], 'aplicado', acao.tipo === 'PAUSAR' ? 'PAUSED' : acao.tipo === 'ATIVAR' ? 'ACTIVE' : undefined);
      const label = acao.tipo === 'PAUSAR' ? 'Pausado' : acao.tipo === 'ATIVAR' ? 'Ativado' : 'Orçamento ajustado';
      setToast({ text: `${label}. Você pode reverter agora.`, undo: data.pode_desfazer ? { rec_id: rec.rec_id, cliente_id: rec.cliente_id } : undefined });
    } catch {
      setToast({ text: 'Erro de rede ao aplicar.', erro: true });
    } finally {
      setBusy(false);
    }
  }

  function handleQuickPause(node: TreeNode) {
    if (busy) return;
    if (node.acao_estruturada?.tipo === 'PAUSAR' && node.aplicavel) {
      void doApply(node, {});
      return;
    }
    setSelectedId(node.rec_id);
  }

  async function doUndo() {
    const u = toast?.undo;
    if (!u) return;
    setToast(null);
    await fetch('/api/otimizador/desfazer', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
      body: JSON.stringify({ rec_id: u.rec_id, cliente_id: u.cliente_id, ...autor }),
    });
    await loadTree(contaFiltro);
  }

  async function fetchAnalysisResumo(clientId: string): Promise<string> {
    try {
      const res = await fetch(`/api/otimizador/analisar?clientId=${encodeURIComponent(clientId)}&hours=2`);
      if (!res.ok) return '';
      const data = await res.json() as {
        items?: Array<{ erro?: string | null; resultado?: { analise_campanhas?: Array<{ acao?: string; conjuntos?: Array<{ acao?: string; anuncios?: Array<{ acao?: string }> }> }> } }>;
      };
      const item = data.items?.[0];
      const camps = item?.resultado?.analise_campanhas ?? [];
      if (camps.length === 0) return 'Atenção: a IA não recebeu nenhuma campanha nesta análise — provável falha ao puxar os dados.';
      if (item?.erro) return `⚠️ Análise com problema: ${item.erro} Os ${camps.length} objeto(s) analisados podem não refletir a conta real — rode de novo antes de confiar no resultado.`;
      let conj = 0, ad = 0, acoes = 0;
      for (const c of camps) {
        if (c.acao?.trim()) acoes++;
        for (const cj of c.conjuntos ?? []) {
          conj++;
          if (cj.acao?.trim()) acoes++;
          for (const a of cj.anuncios ?? []) { ad++; if (a.acao?.trim()) acoes++; }
        }
      }
      return `Analisou ${camps.length} campanha(s), ${conj} conjunto(s) e ${ad} anúncio(s) — ${acoes} com recomendação de ação.`;
    } catch {
      return '';
    }
  }

  async function pollForFreshResult(clientId: string, priorTime: number): Promise<boolean> {
    try {
      const res = await fetch(`/api/otimizador/arvore?clientId=${encodeURIComponent(clientId)}&hours=1`);
      if (!res.ok) return false;
      const data = await res.json() as { generated_at: string | null };
      return !!data.generated_at && new Date(data.generated_at).getTime() > priorTime;
    } catch {
      return false;
    }
  }

  // Analisa TODOS os clientes de uma vez (ignora o rodízio por dia). O servidor processa em
  // paralelo dentro do orçamento de tempo; se não couber todo mundo numa chamada, roda de novo.
  async function runAnalysisAll() {
    if (!window.confirm('Analisar TODOS os clientes agora? Pode levar alguns minutos e consumir IA de cada conta. Não feche a página.')) return;
    setRunLoading(true);
    setDiagResult(null);
    setRunMessage('Analisando todos os clientes… isso pode levar alguns minutos. Não feche a página.');
    try {
      // Sem `period`: o servidor usa a janela padrão (últimos 7 dias) como primária — a IA
      // recebe SEMPRE o panorama 30/14/7/3 junto, então não há mais escolha de período na UI.
      const params = new URLSearchParams({ forceAi: '1', all: '1' });
      const res = await fetch(`/api/otimizador/weekly?${params.toString()}`, {
        method: 'POST', headers: { ...callerHeaders(), 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({})) as { results?: Array<{ status: string }>; error?: string };
      if (!res.ok) {
        setRunMessage(`Erro ao analisar todos: ${data.error || res.statusText || `HTTP ${res.status}`}`);
        return;
      }
      const results = data.results ?? [];
      const ok = results.filter((r) => r.status === 'ok').length;
      const semCamp = results.filter((r) => r.status === 'sem_campanhas_ativas').length;
      const semConexao = results.filter((r) => r.status === 'sem_conexao_meta').length;
      const erros = results.filter((r) => r.status === 'erro').length;
      setRunMessage(`Concluído: ${ok} analisada(s) · ${semCamp} sem campanha · ${semConexao} sem conexão · ${erros} com erro (de ${results.length}). Se faltou alguém, rode de novo.`);
      await Promise.all([loadOverview(), loadTree(contaFiltro)]);
    } catch (err) {
      setRunMessage(`Erro ao analisar todos: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunLoading(false);
    }
  }

  async function runAnalysisNow() {
    if (!contaFiltro) return;
    setRunLoading(true);
    setRunMessage(null);
    const priorTime = generatedAt ? new Date(generatedAt).getTime() : 0;
    const clientName = contas.find((c) => c.cliente_id === contaFiltro)?.cliente_nome ?? 'esta conta';
    try {
      const params = new URLSearchParams({ forceAi: '1', clientId: contaFiltro });
      setRunMessage(`Analisando ${clientName}… isso pode levar até 2 minutos. Não feche a página.`);
      const res = await fetch(`/api/otimizador/weekly?${params.toString()}`, {
        method: 'POST',
        headers: { ...callerHeaders(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setRunMessage(`Erro na análise: ${data.error || res.statusText || `HTTP ${res.status}`}`);
        return;
      }
      const data = await res.json().catch(() => ({})) as { results?: Array<{ clientId: string; status: string; error?: string }> };
      const outcome = data.results?.find((r) => r.clientId === contaFiltro);
      if (outcome && outcome.status !== 'ok') {
        const motivo = outcome.status === 'sem_conexao_meta' ? 'conta sem conexão Meta vinculada'
          : outcome.status === 'sem_campanhas_ativas' ? 'nenhuma campanha ativa com gasto no período'
          : outcome.error || outcome.status;
        setRunMessage(`Análise de ${clientName} não gerou resultado: ${motivo}.`);
        return;
      }
      await pollForFreshResult(contaFiltro, priorTime);
      await loadTree(contaFiltro);
      const resumoTxt = await fetchAnalysisResumo(contaFiltro);
      setRunMessage(`Análise de ${clientName} concluída. ${resumoTxt}`.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunMessage(`Erro: ${msg || 'falha de rede'} (a análise pode ter estourado o tempo — tente novamente).`);
    } finally {
      setRunLoading(false);
    }
  }

  // Revisão em lote: gestor bateu o olho na conta inteira e não achou nada que precise de
  // ação — marca todas as pendências como revisadas de uma vez (dot volta a "tudo certo" até
  // a próxima análise semanal gerar pendências novas).
  async function reviewAllPending() {
    if (!contaFiltro) return;
    const conta = accountOptions.find((a) => a.cliente_id === contaFiltro);
    if (!conta || conta.pendencias === 0) return;
    if (!window.confirm(`Marcar as ${conta.pendencias} pendência${conta.pendencias === 1 ? '' : 's'} de ${conta.cliente_nome} como revisadas? Elas só voltam a aparecer na próxima análise semanal.`)) return;
    setRunLoading(true);
    setRunMessage(null);
    try {
      const res = await fetch('/api/otimizador/revisar-tudo', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify({ cliente_id: contaFiltro, ...autor }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; revisados?: number; error?: string };
      if (!res.ok || !data.ok) {
        setRunMessage(`Erro ao marcar como revisado: ${data.error ?? res.statusText}`);
        return;
      }
      setRunMessage(`${data.revisados ?? 0} pendência(s) marcada(s) como revisada(s).`);
      await Promise.all([loadOverview(), loadTree(contaFiltro)]);
    } catch (err) {
      setRunMessage(`Erro de rede ao marcar como revisado: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunLoading(false);
    }
  }

  async function runDiagnostic() {
    if (!contaFiltro) return;
    setDiagLoading(true);
    setDiagResult(null);
    setRunMessage(null);
    try {
      const params = new URLSearchParams({ dryRun: '1', clientId: contaFiltro });
      const res = await fetch(`/api/otimizador/weekly?${params.toString()}`, {
        method: 'POST',
        headers: { ...callerHeaders(), 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({})) as { diagnostics?: ClientDiagnostic[]; error?: string };
      if (!res.ok) {
        setRunMessage(`Erro no diagnóstico: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      setDiagResult(data.diagnostics ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunMessage(`Erro no diagnóstico: ${msg || 'falha de rede'}`);
    } finally {
      setDiagLoading(false);
    }
  }

  const configClient = configClientId ? clients.find((c) => c.id === configClientId) ?? null : null;
  const temAnalise = !loading && !!contaFiltro && (treeNodes.length > 0 || !!resumo);

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-2.5 py-3.5" style={OTIMIZADOR_VARS}>
      {configClientId && configClient && (
        <ConfigModal clientId={configClientId} clientName={configClient.name} onClose={() => setConfigClientId(null)} />
      )}
      <ConfirmToast toast={toast} onUndo={doUndo} onClose={() => setToast(null)} />

      {/* Header */}
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <WandSparkles className="h-4 w-4" /> Otimizador de Campanhas
          </div>
          <h1 className="text-2xl font-bold tracking-normal text-foreground sm:text-3xl">Otimizador de Campanhas</h1>
          <p className="text-sm text-muted-foreground">Análises inteligentes e recomendações para melhorar seus resultados.</p>
        </div>
        <Link
          href="/otimizador/visao-geral"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 self-start rounded-[var(--radius)] border border-border bg-card px-3 text-sm font-medium text-foreground hover:border-primary/40 xl:self-auto"
          title="Ver todas as contas num olhar (visão de supervisão)"
        >
          <LayoutGrid className="h-4 w-4" /> Sala de guerra
        </Link>
      </header>

      {/* Rail de contas + ação principal. UM CTA verde só (regra do design system); Briefing/
          Apresentação são NAVEGAÇÃO (links discretos); ações raras de supervisão/admin vivem no
          menu "⋯". O seletor de período saiu: a IA sempre recebe o panorama 30/14/7/3 dias e a
          tela mostra a janela padrão (7 dias) — escolher período só gerava re-análise confusa. */}
      <section className="space-y-3 rounded-[var(--radius)] border border-primary/25 bg-primary/5 p-3">
        <AccountRail contas={accountOptions} value={contaFiltro} onChange={setContaFiltro} />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={runAnalysisNow} disabled={runLoading || diagLoading || !contaFiltro} size="sm" className="h-10 px-3 text-xs">
            {runLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {temAnalise ? 'Atualizar análise' : 'Fazer análise'}
          </Button>
          <span className="text-[11px] text-muted-foreground" title="Números da tela: últimos 7 dias. A IA compara as 4 janelas antes de recomendar qualquer ação.">
            semana em foco · IA vê 30/14/7/3 dias
          </span>

          <div className="ml-auto flex items-center gap-1">
            {temAnalise && contaAtual && contaAtual.pendencias > 0 && (
              <Link
                href={`/otimizador/briefing?clientId=${encodeURIComponent(contaFiltro)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-2.5 text-xs font-medium text-foreground hover:bg-background"
                title="Rodar o briefing guiado desta conta — decisão por decisão"
              >
                <ListChecks className="h-4 w-4" /> Briefing
              </Link>
            )}
            {temAnalise && (
              <Link
                href={`/otimizador/apresentacao?clientId=${encodeURIComponent(contaFiltro)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-2.5 text-xs font-medium text-foreground hover:bg-background"
                title="Abrir a visão limpa de apresentação (pra mostrar ao cliente)"
              >
                <Presentation className="h-4 w-4" /> Apresentação
              </Link>
            )}
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={() => setConfigClientId(contaFiltro || null)} disabled={!contaFiltro}
                className="h-9 w-9 p-0" title="Configurar este cliente (modo, limites, WhatsApp)">
                <Settings2 className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-foreground hover:bg-background disabled:opacity-50"
                title="Mais ações"
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void runAnalysisAll()} disabled={runLoading || diagLoading}>
                  <Users className="h-4 w-4" /> Analisar todos os clientes
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => void runDiagnostic()} disabled={runLoading || diagLoading || !contaFiltro}>
                    <Search className="h-4 w-4" /> Diagnosticar dados (sem IA)
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {runMessage && <p className="text-xs font-medium text-primary">{runMessage}</p>}
        {diagResult && (
          <div className="w-full space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Diagnóstico de dados (sem IA · sem custo)</span>
              <button onClick={() => setDiagResult(null)} className="text-xs text-muted-foreground hover:text-foreground">fechar</button>
            </div>
            {diagResult.length === 0 && <p className="text-xs text-muted-foreground">Nenhum cliente para diagnosticar.</p>}
            {diagResult.map((d, i) => {
              const ok = /DADOS OK/.test(d.veredito);
              const warn = /30 dias|período/.test(d.veredito);
              const tone = ok ? 'border-primary/40 bg-primary/5' : warn ? 'border-amber-500/40 bg-amber-500/5' : 'border-red-500/40 bg-red-500/5';
              return (
                <div key={i} className={`rounded-[var(--radius)] border ${tone} p-3 text-xs`}>
                  <p className="font-semibold text-foreground">{d.cliente}</p>
                  <p className="mt-1 text-muted-foreground">{d.veredito}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted-foreground sm:grid-cols-3">
                    <span>conexão: {d.conexao_resolvida ? 'sim' : 'NÃO'}</span>
                    <span>token: {d.token_ok ? 'ok' : '—'}</span>
                    <span>account_id: {d.account_id ?? '—'}</span>
                    <span>camp. 7d: {d.campanhas_7d ?? '—'}</span>
                    <span>camp. 30d: {d.campanhas_30d ?? '—'}</span>
                    <span>planejamento: {d.planejamento.tem_planejamento ? 'sim' : 'não'}</span>
                    <span>CPL meta: {d.planejamento.cpl_meta ?? '—'}</span>
                    <span>meta leads: {d.planejamento.volume_leads_meta ?? '—'}</span>
                    <span>objetivo: {d.planejamento.objetivo ?? '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando contas...
        </div>
      ) : !contaFiltro ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card p-6 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground" />
          <p className="font-semibold text-foreground">Nenhuma conta com análise ainda</p>
          <p className="text-sm text-muted-foreground">Selecione um cliente para rodar a primeira análise.</p>
        </div>
      ) : (
        <>
          <AccountHealthHero resumo={resumo} nodes={flatNodes} generatedAt={generatedAt} proximaAnalise={null} />
          <AccountKpiRow resumo={resumo} />

          {treeLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando análise...
            </div>
          ) : treeError ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 p-6 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{treeError}</p>
            </div>
          ) : flatNodes.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card p-6 text-center">
              <BadgeCheck className="h-8 w-8 text-primary" />
              <p className="font-semibold text-foreground">Nenhuma análise ainda para este cliente</p>
              <p className="max-w-md text-sm text-muted-foreground">Clique em <span className="font-semibold text-foreground">Fazer análise</span> para gerar o primeiro diagnóstico.</p>
            </div>
          ) : (
            <>
              <QuickDecisionCards nodes={flatNodes} active={categoriaFiltro} onSelect={setCategoriaFiltro} />
              {/* Master-detail: campanhas e recomendação sempre 50/50, mesma largura, sem exceção. */}
              <div className="grid items-start gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div
                  className="min-w-0 overflow-hidden"
                  style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border)', borderRadius: 12 }}
                >
                  <div
                    className="flex flex-wrap items-center justify-between gap-2"
                    style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--border)' }}
                  >
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
                      Campanhas{canais.length > 1 ? ' · Meta + Google' : ''}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <FilterChips nivel={nivelFiltro} onNivel={setNivelFiltro} apenasComAcao={apenasComAcao} onApenasComAcao={setApenasComAcao} />
                      {/* Ação em lote mora AO LADO da fila que ela encerra — não na barra global. */}
                      {contaAtual && contaAtual.pendencias > 0 && (
                        <button
                          onClick={() => void reviewAllPending()}
                          disabled={runLoading || diagLoading}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                          title="Marca todas as pendências desta conta como revisadas — voltam só na próxima análise semanal"
                        >
                          {runLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          Marcar tudo como revisado
                        </button>
                      )}
                    </div>
                  </div>
                  <CampaignTable
                    nodes={treeNodes}
                    selectedId={selectedId}
                    onSelect={(n) => setSelectedId(n.rec_id)}
                    onQuickPause={handleQuickPause}
                    filtroNivel={nivelFiltro}
                    filtroCategoria={categoriaFiltro}
                    apenasComAcao={apenasComAcao}
                    cplIdeal={resumo?.cruzamento_com_metas?.cpl_ideal ?? null}
                    cplMaximo={resumo?.cruzamento_com_metas?.cpl_maximo ?? null}
                  />
                </div>
                <div
                  className="min-w-0 overflow-hidden"
                  style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border)', borderRadius: 12 }}
                >
                  <div style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
                    Recomendação principal
                  </div>
                  {selectedNode ? (
                    <DecisionPanel node={selectedNode} busy={busy} onApply={doApply} onJump={jumpTo} />
                  ) : (
                    <div className="flex min-h-40 flex-col items-center justify-center gap-1 p-6 text-center">
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Clique em uma campanha, conjunto ou criativo na lista para ver o diagnóstico completo.</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
