"use client";

// Modo edição do modelo do dashboard.
//
// ⚠️ A grade é por ELEMENTO, não por bloco. Enquanto cada bloco era um item do
// react-grid-layout, arrastar "Vendas" levava junto as 4 métricas de dentro —
// era impossível mover só o Faturamento. Agora cada métrica, título e gráfico é
// um item próprio: move, redimensiona e some sozinho.
//
// ⚠️ E os controles de estilo vivem NO PRÓPRIO elemento (barra que aparece no
// hover + popover ancorado), não num inspetor lateral. Pedido do Matheus:
// "passar o mouse em cima do título e decidir ali o que quero fazer com ele".
//
// O modelo é por SEGMENTO: salvar aqui muda o painel de todos os clientes
// daquele segmento. Por isso o botão de salvar é de administrador e o aviso
// aparece em tela.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RGL, { WidthProvider, type Layout as RglLayout } from 'react-grid-layout';
import { Eye, EyeOff, GripVertical, RotateCcw, Save, X, SlidersHorizontal } from 'lucide-react';
import { notificar } from '@/components/ui/toast';
import { ControlesElemento } from './controles-elemento';
import {
  definicaoElemento, type ElementoId, type EstiloElemento, type EstilosPorElemento,
} from '@/lib/dashboard-elementos';
import {
  caminhoDoElemento, elementosVisiveis, mesclarModelo, modeloPadrao,
  type ElementoNoModelo, type ModeloDashboard,
} from '@/lib/dashboard-modelo';
import { perfilDoSegmento, type SegmentoDashboard } from '@/lib/dashboard-segmento';
import { useIsMobile } from '@/lib/use-is-mobile';
import { cn } from '@/lib/utils';

const Grid = WidthProvider(RGL);
const COLS = 12;
const ROW_H = 56;

/** Carrega o modelo do segmento. Erro de rede cai no padrão — a tela nunca fica em branco. */
export function useModelo(segmento: SegmentoDashboard) {
  // ⚠️ Começa no PADRÃO, nunca em null. Com null, a tela caía no layout de
  // lead-gen enquanto o modelo carregava (e para sempre, se a rota falhasse) —
  // dava a impressão de que o modo food e o editor não existiam.
  const [modelo, setModelo] = useState<ModeloDashboard>(() => modeloPadrao(segmento));

  useEffect(() => {
    let vivo = true;
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
   * Conteúdo de cada elemento, como FUNÇÃO dos estilos — não um mapa pronto.
   * É o que dá pré-visualização ao vivo: mexer numa cor precisa refletir na
   * hora, e um mapa fixo só mudaria depois de salvar.
   */
  render: (estilos: EstilosPorElemento) => Partial<Record<ElementoId, React.ReactNode>>;
  editando: boolean;
  onSair: () => void;
  onSalvou: (m: ModeloDashboard) => void;
};

export function ModeloEditor({ modelo, render, editando, onSair, onSalvou }: Props) {
  const isMobile = useIsMobile();
  const [rascunho, setRascunho] = useState<ModeloDashboard>(modelo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Elemento com o painel de controles aberto. */
  const [aberto, setAberto] = useState<ElementoId | null>(null);
  // "Restaurar padrão" em DOIS cliques: o 1º arma ("Confirmar restauração?" por ~4s), o 2º executa.
  const [confirmandoRestaurar, setConfirmandoRestaurar] = useState(false);
  const restaurarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Entrar em edição parte SEMPRE do modelo publicado — não de um rascunho
  // abandonado de uma sessão anterior.
  useEffect(() => { if (editando) { setRascunho(modelo); setAberto(null); setConfirmandoRestaurar(false); } }, [editando, modelo]);

  // Aplica um patch de estilo a UM elemento, sem tocar nos demais — é o que
  // permite mexer no Faturamento sem alterar o Ticket médio.
  const mudarEstilo = useCallback((id: ElementoId, patch: Partial<EstiloElemento>) =>
    setRascunho((r) => ({
      ...r,
      estilos: { ...(r.estilos ?? {}), [id]: { ...(r.estilos?.[id] ?? {}), ...patch } },
    })), []);

  const limparEstilo = useCallback((id: ElementoId) =>
    setRascunho((r) => {
      const estilos = { ...(r.estilos ?? {}) };
      delete estilos[id];
      return { ...r, estilos };
    }), []);

  const atual = editando ? rascunho : modelo;
  const estilos = useMemo(() => atual.estilos ?? {}, [atual.estilos]);

  // Reconstruído a cada mudança do rascunho — é o que faz a cor escolhida
  // aparecer na hora, sem precisar salvar.
  const mapa = render(estilos);

  // Fora do modo edição, elemento OCULTO ou SEM CONTEÚDO não entra na grade.
  // "Sem conteúdo" acontece de verdade: `ritmo.saldos` só existe com conta de
  // anúncio vinculada, e o medidor da base só com base sincronizada. Deixar a
  // célula vazia abriria um buraco na tela publicada.
  // Em edição TODOS aparecem — inclusive os ocultos, esmaecidos —, senão não
  // haveria como trazer de volta o que foi escondido.
  const naGrade: ElementoNoModelo[] = editando
    ? atual.elementos
    : elementosVisiveis(atual).filter((e) => mapa[e.id]);

  const layout: RglLayout[] = naGrade.map((e) => {
    const d = definicaoElemento(e.id);
    return { i: e.id, x: e.x, y: e.y, w: e.w, h: e.h, minW: d?.minW ?? 2, minH: d?.minH ?? 1 };
  });

  const aoMudarLayout = useCallback((novo: RglLayout[]) => {
    if (!editando) return;
    setRascunho((r) => ({
      ...r,
      elementos: r.elementos.map((e) => {
        const l = novo.find((x) => x.i === e.id);
        return l ? { ...e, x: l.x, y: l.y, w: l.w, h: l.h } : e;
      }),
    }));
  }, [editando]);

  const alternarVisivel = (id: ElementoId) =>
    setRascunho((r) => ({
      ...r,
      elementos: r.elementos.map((e) => (e.id === id ? { ...e, visivel: !e.visivel } : e)),
    }));

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
    setConfirmandoRestaurar(false);
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/dashboard/modelo?segmento=${rascunho.segmento}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'falha ao restaurar');
      const padrao = mesclarModelo(null, modeloPadrao(rascunho.segmento));
      onSalvou(padrao);
      setRascunho(padrao);
      setAberto(null);
      notificar('Modelo restaurado ao padrão.', 'ok');
      onSair();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível restaurar';
      setErro(msg);
      notificar(msg, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  const conteudo = (e: ElementoNoModelo) => {
    const node = mapa[e.id];
    if (node) return node;
    // Só acontece em edição (fora dela o elemento é filtrado): espaço reservado
    // para o elemento continuar posicionável mesmo sem dado no período.
    return (
      <div className="flex h-full items-center justify-center rounded-[12px] border border-dashed border-white/[0.14] px-2 text-center text-[10px] leading-tight text-[#6b7478]">
        {definicaoElemento(e.id)?.rotulo ?? e.id}
        <br />sem dado no período
      </div>
    );
  };

  // Fora do modo edição em mobile o RGL empilha; manter o grid ali só
  // atrapalharia, então renderiza a pilha simples.
  if (!editando && isMobile) {
    return <div className="space-y-4">{naGrade.map((e) => <div key={e.id}>{conteudo(e)}</div>)}</div>;
  }

  return (
    <div>
      {editando && (
        <div className="sticky top-16 z-[80] mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-primary/40 bg-primary/10 px-3 py-2">
          <GripVertical className="h-4 w-4 text-primary" />
          <span className="text-[12px] font-semibold text-foreground">
            Editando o modelo de <strong>{perfilDoSegmento(rascunho.segmento).rotuloSegmento}</strong>
          </span>
          <span className="text-[11px] text-muted-foreground">
            · passe o mouse sobre qualquer métrica para mover, editar ou ocultar · vale para TODOS os clientes deste segmento
          </span>
          {erro && <span className="text-[11px] font-semibold text-destructive">{erro}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" disabled={salvando}
              onClick={() => {
                if (restaurarTimer.current) clearTimeout(restaurarTimer.current);
                if (confirmandoRestaurar) { void restaurarPadrao(); return; }
                setConfirmandoRestaurar(true);
                restaurarTimer.current = setTimeout(() => setConfirmandoRestaurar(false), 4000);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50',
                confirmandoRestaurar
                  ? 'border-destructive/60 bg-destructive/10 text-destructive'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}>
              <RotateCcw className="h-3.5 w-3.5" /> {confirmandoRestaurar ? 'Confirmar restauração?' : 'Restaurar padrão'}
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
        {naGrade.map((e) => {
          const ativo = aberto === e.id;
          return (
            <div
              key={e.id}
              // O item que está sendo editado sobe: sem isso o painel de
              // controles fica ATRÁS dos elementos vizinhos da grade.
              style={ativo ? { zIndex: 60 } : undefined}
              className={cn('group relative', editando && !e.visivel && 'opacity-40')}
            >
              {editando && (
                <div
                  className={cn(
                    'absolute -top-2.5 right-1 z-[65] flex items-center gap-0.5 rounded-[8px] border border-white/[0.14] bg-[#0d1519] p-0.5 shadow-[0_6px_20px_rgba(0,0,0,0.5)]',
                    // Some quando não há foco nem hover: a barra em cima de TODOS
                    // os 25 elementos ao mesmo tempo esconderia a própria tela.
                    ativo ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                  )}
                >
                  <span
                    className="arrastar cursor-move rounded p-1 text-[#9aa4aa] hover:text-white"
                    title={`Mover ${caminhoDoElemento(e.id)}`}
                  >
                    <GripVertical className="h-3 w-3" />
                  </span>
                  <button
                    type="button"
                    onClick={() => setAberto(ativo ? null : e.id)}
                    title="Editar este elemento"
                    className={cn('rounded p-1', ativo ? 'bg-primary/20 text-primary' : 'text-[#9aa4aa] hover:text-white')}
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => alternarVisivel(e.id)}
                    title={e.visivel ? 'Ocultar' : 'Mostrar'}
                    className="rounded p-1 text-[#9aa4aa] hover:text-white"
                  >
                    {e.visivel ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </button>
                </div>
              )}

              {editando && ativo && (
                <ControlesElemento
                  id={e.id}
                  estilo={estilos[e.id] ?? {}}
                  onChange={(patch) => mudarEstilo(e.id, patch)}
                  onLimpar={() => limparEstilo(e.id)}
                  onFechar={() => setAberto(null)}
                  // Encostado na metade direita, o painel abriria para fora da tela.
                  alinhar={e.x + e.w > COLS - 3 ? 'direita' : 'esquerda'}
                />
              )}

              <div className="h-full">{conteudo(e)}</div>
            </div>
          );
        })}
      </Grid>
    </div>
  );
}
