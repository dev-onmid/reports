"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Loader2,
  MousePointerClick,
  Play,
  Presentation,
  Search,
  Settings2,
  WandSparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { callerHeaders, getAuthSession } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import type { Client } from '@/lib/mock-data';
import { OPTIMIZER_PERIODS } from '@/lib/optimizer';
import type { OptimizerPeriodKey } from '@/lib/optimizer';
import {
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
import { AccountHealthHero } from '@/components/otimizador/account-health-hero';
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
  // Canal exibido (conta mista Meta+Google tem análise separada por plataforma). `canais` = quais
  // têm análise recente; o toggle só aparece quando há os dois.
  const [canal, setCanal] = useState<'meta' | 'google' | null>(null);
  const [canais, setCanais] = useState<string[]>([]);

  // Admin: análise manual
  const [runLoading, setRunLoading] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<ClientDiagnostic[] | null>(null);
  const [manualPeriod, setManualPeriod] = useState<OptimizerPeriodKey>('last_7d');
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
      setContaFiltro((prev) => {
        const validIds = new Set([...filaContas.map((c) => c.cliente_id), ...activeClients.map((c) => c.id)]);
        if (prev && validIds.has(prev)) return prev;
        return filaContas[0]?.cliente_id ?? activeClients[0]?.id ?? '';
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadOverview(); }, []);

  async function loadTree(clientId: string, canalArg?: 'meta' | 'google' | null) {
    if (!clientId) { setTreeNodes([]); setResumo(null); setGeneratedAt(null); setCanais([]); return; }
    setTreeLoading(true);
    setTreeError(null);
    try {
      const canalQs = canalArg ? `&canal=${canalArg}` : '';
      const res = await fetch(`/api/otimizador/arvore?clientId=${encodeURIComponent(clientId)}&hours=200${canalQs}`);
      if (!res.ok) {
        setTreeError(`Não foi possível carregar a árvore (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json() as { campanhas: TreeNode[]; resumo: ArvoreResumo | null; generated_at: string | null; canal?: 'meta' | 'google' | null; canais?: string[] };
      setTreeNodes(data.campanhas ?? []);
      setResumo(data.resumo);
      setGeneratedAt(data.generated_at);
      setCanais(data.canais ?? []);
      if (data.canal === 'meta' || data.canal === 'google') setCanal(data.canal);
      setSelectedId(null);
    } catch {
      setTreeError('Falha de rede ao carregar a árvore.');
    } finally {
      setTreeLoading(false);
    }
  }

  // Troca de conta reseta o canal (pega a análise mais recente de qualquer plataforma).
  useEffect(() => { setCanal(null); void loadTree(contaFiltro, null); }, [contaFiltro]);

  function switchCanal(c: 'meta' | 'google') {
    if (c === canal) return;
    setCanal(c);
    void loadTree(contaFiltro, c);
  }

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

  async function runAnalysisNow() {
    if (!contaFiltro) return;
    setRunLoading(true);
    setRunMessage(null);
    const priorTime = generatedAt ? new Date(generatedAt).getTime() : 0;
    const clientName = contas.find((c) => c.cliente_id === contaFiltro)?.cliente_nome ?? 'esta conta';
    try {
      const params = new URLSearchParams({ period: manualPeriod, forceAi: '1', clientId: contaFiltro });
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
      const params = new URLSearchParams({ period: manualPeriod, dryRun: '1', clientId: contaFiltro });
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
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-3 p-3 sm:p-4 xl:p-5">
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
        <div className="hidden items-center gap-2 text-xs text-muted-foreground xl:flex">
          <CalendarClock className="h-4 w-4" />
          <span>Análise automática diária + revisão manual quando precisar.</span>
        </div>
      </header>

      {/* Rail de contas + Período + ação principal */}
      <section className="space-y-3 rounded-[var(--radius)] border border-primary/25 bg-primary/5 p-3">
        <AccountRail contas={accountOptions} value={contaFiltro} onChange={setContaFiltro} />
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Período</span>
            <select value={manualPeriod} onChange={(e) => setManualPeriod(e.target.value as OptimizerPeriodKey)} disabled={runLoading}
              className="h-10 w-44 rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
              {OPTIMIZER_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <Button onClick={runAnalysisNow} disabled={runLoading || diagLoading || !contaFiltro} size="sm" className="h-10 px-2.5 text-xs">
            {runLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {temAnalise ? 'Atualizar análise' : 'Fazer análise'}
          </Button>
          {temAnalise && (
            <Link
              href={`/otimizador/apresentacao?clientId=${encodeURIComponent(contaFiltro)}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius)] border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:border-primary/40"
              title="Abrir a visão limpa de apresentação (pra mostrar ao cliente)"
            >
              <Presentation className="h-4 w-4" /> Apresentação
            </Link>
          )}
          {contaAtual && contaAtual.pendencias > 0 && (
            <Button variant="outline" size="sm" onClick={reviewAllPending} disabled={runLoading || diagLoading} className="h-10 px-2.5 text-xs"
              title="Marca todas as pendências desta conta como revisadas — voltam só na próxima análise semanal">
              {runLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Marcar tudo como revisado
            </Button>
          )}
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={() => setConfigClientId(contaFiltro || null)} disabled={!contaFiltro} className="h-10 px-2.5 text-xs">
                <Settings2 className="h-4 w-4" /> Configurar
              </Button>
              <Button variant="outline" size="sm" onClick={runDiagnostic} disabled={runLoading || diagLoading || !contaFiltro} className="h-10 px-2.5 text-xs"
                title="Mostra de onde vêm os dados desta conta — sem gastar tokens de IA">
                {diagLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Diagnosticar
              </Button>
            </>
          )}
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
              <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FilterChips nivel={nivelFiltro} onNivel={setNivelFiltro} apenasComAcao={apenasComAcao} onApenasComAcao={setApenasComAcao} />
                    {canais.length > 1 && (
                      <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5" title="Este cliente tem análise de Meta e Google — alterne entre elas">
                        {(['meta', 'google'] as const).map((c) => (
                          <button
                            key={c}
                            onClick={() => switchCanal(c)}
                            className={cn(
                              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                              canal === c ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {c === 'meta' ? 'Meta Ads' : 'Google Ads'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <CampaignTable
                    nodes={treeNodes}
                    selectedId={selectedId}
                    onSelect={(n) => setSelectedId(n.rec_id)}
                    onQuickPause={handleQuickPause}
                    filtroNivel={nivelFiltro}
                    filtroCategoria={categoriaFiltro}
                    apenasComAcao={apenasComAcao}
                  />
                </div>
                {selectedNode ? (
                  <DecisionPanel node={selectedNode} busy={busy} onApply={doApply} onJump={jumpTo} />
                ) : (
                  <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border bg-card/70 p-6 text-center">
                    <MousePointerClick className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Clique em uma campanha, conjunto ou criativo na árvore para ver o diagnóstico completo.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
