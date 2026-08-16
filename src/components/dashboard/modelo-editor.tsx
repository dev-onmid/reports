"use client";

// Modo edição do modelo do dashboard — arrastar, redimensionar, ocultar e
// renomear blocos.
//
// Escopo deliberado (decisão do Matheus): LAYOUT e TÍTULO. Cor, fonte e ícone
// continuam vindo do design system. Liberar estilo por bloco faria cada cliente
// ter um painel diferente e o "Verde Onmid como única cor de CTA" deixaria de
// valer — o editor personaliza o ARRANJO, não a identidade.
//
// O modelo é por SEGMENTO: salvar aqui muda o painel de todos os clientes
// daquele segmento. Por isso o botão de salvar é de administrador e o aviso
// aparece em tela.

import { useCallback, useEffect, useMemo, useState } from 'react';
import RGL, { WidthProvider, type Layout as RglLayout } from 'react-grid-layout';
import { Eye, EyeOff, GripVertical, Pencil, RotateCcw, Save, X, Check, SlidersHorizontal } from 'lucide-react';
import { Inspector } from './inspector';
import type { ElementoId, EstiloElemento, EstilosPorElemento } from '@/lib/dashboard-elementos';
import {
  blocosVisiveis, definicaoBloco, mesclarModelo, modeloPadrao, tituloDoBloco,
  type BlocoId, type BlocoNoModelo, type ModeloDashboard,
} from '@/lib/dashboard-modelo';
import type { SegmentoDashboard } from '@/lib/dashboard-segmento';
import { useIsMobile } from '@/lib/use-is-mobile';
import { cn } from '@/lib/utils';

const Grid = WidthProvider(RGL);
const COLS = 12;
const ROW_H = 56;

/** Carrega o modelo do segmento. Erro de rede cai no padrão — a tela nunca fica em branco. */
export function useModelo(segmento: SegmentoDashboard) {
  const [modelo, setModelo] = useState<ModeloDashboard | null>(null);

  useEffect(() => {
    let vivo = true;
    setModelo(null);
    fetch(`/api/dashboard/modelo?segmento=${segmento}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setModelo(j?.modelo ?? modeloPadrao(segmento)); })
      .catch(() => { if (vivo) setModelo(modeloPadrao(segmento)); });
    return () => { vivo = false; };
  }, [segmento]);

  return { modelo, setModelo };
}

type Props = {
  modelo: ModeloDashboard;
  /**
   * Conteúdo de cada bloco, como FUNÇÃO dos estilos — não um mapa pronto.
   * É o que dá pré-visualização ao vivo: mexer numa cor no inspetor precisa
   * refletir na hora, e um mapa fixo só mudaria depois de salvar.
   */
  render: (estilos: EstilosPorElemento) => Partial<Record<BlocoId, React.ReactNode>>;
  editando: boolean;
  onSair: () => void;
  onSalvou: (m: ModeloDashboard) => void;
};

export function ModeloEditor({ modelo, render, editando, onSair, onSalvou }: Props) {
  const isMobile = useIsMobile();
  const [rascunho, setRascunho] = useState<ModeloDashboard>(modelo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<BlocoId | null>(null);
  /** Bloco cujo inspetor de elementos está aberto. */
  const [inspecionando, setInspecionando] = useState<BlocoId | null>(null);

  // Aplica um patch de estilo a UM elemento, sem tocar nos demais — é o que
  // permite mexer no Faturamento sem alterar o Ticket médio.
  const mudarEstilo = (id: ElementoId, patch: Partial<EstiloElemento>) =>
    setRascunho((r) => ({
      ...r,
      estilos: { ...(r.estilos ?? {}), [id]: { ...(r.estilos?.[id] ?? {}), ...patch } },
    }));

  // Entrar em edição parte SEMPRE do modelo publicado — não de um rascunho
  // abandonado de uma sessão anterior.
  useEffect(() => { if (editando) setRascunho(modelo); }, [editando, modelo]);

  const atual = editando ? rascunho : modelo;
  const visiveis = useMemo(() => blocosVisiveis(atual), [atual]);

  // No modo edição TODOS os blocos aparecem (inclusive os ocultos, esmaecidos),
  // senão não haveria como trazer de volta um bloco escondido.
  const naGrade = editando ? atual.blocos : visiveis;

  const layout: RglLayout[] = naGrade.map((b) => {
    const d = definicaoBloco(b.id);
    return { i: b.id, x: b.x, y: b.y, w: b.w, h: b.h, minW: d?.minW ?? 2, minH: d?.minH ?? 2 };
  });

  const aoMudarLayout = useCallback((novo: RglLayout[]) => {
    if (!editando) return;
    setRascunho((r) => ({
      ...r,
      blocos: r.blocos.map((b) => {
        const l = novo.find((x) => x.i === b.id);
        return l ? { ...b, x: l.x, y: l.y, w: l.w, h: l.h } : b;
      }),
    }));
  }, [editando]);

  const alternarVisivel = (id: BlocoId) =>
    setRascunho((r) => ({ ...r, blocos: r.blocos.map((b) => (b.id === id ? { ...b, visivel: !b.visivel } : b)) }));

  const renomear = (id: BlocoId, titulo: string) =>
    setRascunho((r) => ({ ...r, blocos: r.blocos.map((b) => (b.id === id ? { ...b, titulo: titulo.trim() || null } : b)) }));

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/dashboard/modelo', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segmento: rascunho.segmento, modelo: rascunho }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'falha ao salvar');
      onSalvou(j.modelo ?? rascunho);
      onSair();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar');
    } finally {
      setSalvando(false);
    }
  }

  async function restaurarPadrao() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/dashboard/modelo?segmento=${rascunho.segmento}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'falha ao restaurar');
      const padrao = mesclarModelo(null, modeloPadrao(rascunho.segmento));
      onSalvou(padrao);
      setRascunho(padrao);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível restaurar');
    } finally {
      setSalvando(false);
    }
  }

  // Reconstruído a cada mudança do rascunho — é o que faz a cor escolhida no
  // inspetor aparecer na hora, sem precisar salvar.
  const mapa = render(atual.estilos ?? {});
  const conteudo = (b: BlocoNoModelo) => {
    const node = mapa[b.id];
    if (node) return node;
    // Bloco no modelo sem render correspondente: mostra o rótulo em vez de um
    // buraco silencioso, para o erro ser visível a quem edita.
    return (
      <div className="flex h-full items-center justify-center rounded-[var(--radius)] border border-dashed border-border text-[11px] text-muted-foreground">
        {tituloDoBloco(b)} — sem conteúdo
      </div>
    );
  };

  // Fora do modo edição em mobile o RGL empilha; manter o grid ali só
  // atrapalharia, então renderiza a pilha simples.
  if (!editando && isMobile) {
    return <div className="space-y-4">{visiveis.map((b) => <div key={b.id}>{conteudo(b)}</div>)}</div>;
  }

  return (
    <div>
      {editando && (
        <div className="sticky top-16 z-30 mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-primary/40 bg-primary/10 px-3 py-2">
          <GripVertical className="h-4 w-4 text-primary" />
          <span className="text-[12px] font-semibold text-foreground">
            Editando o modelo de <strong>{rascunho.segmento === 'food' ? 'Food / Delivery' : rascunho.segmento}</strong>
          </span>
          <span className="text-[11px] text-muted-foreground">
            · arraste para mover, puxe o canto para redimensionar · vale para TODOS os clientes deste segmento
          </span>
          {erro && <span className="text-[11px] font-semibold text-destructive">{erro}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={restaurarPadrao} disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão
            </button>
            <button type="button" onClick={onSair} disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50">
              <X className="h-3.5 w-3.5" /> Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-1 text-[11px] font-bold text-black disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {salvando ? 'Salvando…' : 'Salvar modelo'}
            </button>
          </div>
        </div>
      )}

      <Grid
        className="layout"
        layout={layout}
        cols={COLS}
        rowHeight={ROW_H}
        margin={[16, 16]}
        isDraggable={editando && !isMobile}
        isResizable={editando && !isMobile}
        draggableHandle=".arrastar"
        onLayoutChange={editando ? aoMudarLayout : undefined}
        compactType="vertical"
      >
        {naGrade.map((b) => (
          <div key={b.id} className={cn('relative', editando && !b.visivel && 'opacity-40')}>
            {editando && (
              <div className="absolute -top-2 right-1 z-20 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInspecionando(inspecionando === b.id ? null : b.id)}
                  title="Editar métricas deste bloco"
                  className={cn(
                    'rounded-[var(--radius)] border p-1',
                    inspecionando === b.id
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => setRenomeando(b.id)} title="Renomear"
                  className="rounded-[var(--radius)] border border-border bg-card p-1 text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => alternarVisivel(b.id)}
                  title={b.visivel ? 'Ocultar bloco' : 'Mostrar bloco'}
                  className="rounded-[var(--radius)] border border-border bg-card p-1 text-muted-foreground hover:text-foreground">
                  {b.visivel ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </button>
                <span className="arrastar cursor-move rounded-[var(--radius)] border border-border bg-card p-1 text-muted-foreground">
                  <GripVertical className="h-3 w-3" />
                </span>
              </div>
            )}

            {editando && renomeando === b.id && (
              <div className="absolute inset-x-2 top-4 z-30 flex items-center gap-1 rounded-[var(--radius)] border border-primary/40 bg-card p-1.5">
                <input
                  autoFocus
                  defaultValue={tituloDoBloco(b)}
                  maxLength={60}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { renomear(b.id, (e.target as HTMLInputElement).value); setRenomeando(null); }
                    if (e.key === 'Escape') setRenomeando(null);
                  }}
                  className="h-7 min-w-0 flex-1 rounded-[var(--radius)] border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                />
                <button type="button" title="Confirmar"
                  onClick={(e) => {
                    const input = (e.currentTarget.parentElement?.querySelector('input')) as HTMLInputElement | null;
                    if (input) renomear(b.id, input.value);
                    setRenomeando(null);
                  }}
                  className="rounded-[var(--radius)] bg-primary p-1 text-black">
                  <Check className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="h-full overflow-auto">{conteudo(b)}</div>
          </div>
        ))}
      </Grid>

      {editando && inspecionando && (
        <Inspector
          bloco={inspecionando}
          estilos={rascunho.estilos ?? {}}
          onChange={mudarEstilo}
          onFechar={() => setInspecionando(null)}
        />
      )}
    </div>
  );
}
