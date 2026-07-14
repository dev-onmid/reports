"use client";

import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  PauseCircle,
  PlayCircle,
  Rocket,
  Search,
  Target,
  UserRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CreativeThumb } from '@/components/otimizador/creative-thumb';
import {
  CANAL_META,
  NIVEL_BADGE,
  NIVEL_LABEL,
  adManagerUrl,
  categoriaDoNode,
  criativosAfetados,
  deliveryDisplay,
  fatoValor,
  prioridadeDoNode,
  riscoDoNode,
  type FilaRec,
  type TreeNode,
} from '@/lib/optimizer-ui';

// prioridadeDoNode/riscoDoNode devolvem `tone` como classe Tailwind (ex: "text-red-300") — mapeia
// pra par bg/fg em CSS variable, mantendo o nível real (alto/médio/baixo) em vez de fixar a cor.
function toneToBadgeVars(tone: string): { bg: string; fg: string } {
  if (tone.includes('red')) return { bg: 'var(--bg-danger)', fg: 'var(--text-danger)' };
  if (tone.includes('amber')) return { bg: 'var(--bg-warning)', fg: 'var(--text-warning)' };
  return { bg: 'var(--bg-success)', fg: 'var(--text-success)' };
}

// Painel lateral de decisão — problema, motivos, ação recomendada, itens afetados, controles
// (Gerenciador + ligar/desligar) e a auditoria técnica ("por quê"). Sempre os mesmos 2 controles.
export function DecisionPanel({ node, busy, onApply, onJump }: {
  node: TreeNode;
  busy: boolean;
  onApply: (rec: FilaRec, params: { novo_orcamento_diario?: number }) => void;
  onJump: (recId: string) => void;
}) {
  const [why, setWhy] = useState(false);

  useEffect(() => {
    setWhy(false);
  }, [node.rec_id]);

  const cat = categoriaDoNode(node);
  const emAnalise = node.status === 'em_analise_humana';
  const link = adManagerUrl(node);
  const semAcao = !node.texto_recomendacao.trim() && cat === 'sem_diagnostico';
  const entrega = deliveryDisplay(node.status_entrega);

  // Único controle de execução do painel: liga/desliga o objeto direto, independente da
  // categoria/ação sugerida pela IA. Só desabilita quando o status não é Ativo nem Pausado
  // (ex: Arquivado) — ligar/desligar não se aplica nesses casos.
  const podeAlternar = entrega.label === 'Ativo' || entrega.label === 'Pausado';
  function handleManualToggle() {
    const tipo: 'PAUSAR' | 'ATIVAR' = entrega.label === 'Ativo' ? 'PAUSAR' : 'ATIVAR';
    onApply({ ...node, acao_estruturada: { tipo, objeto_tipo: node.nivel, objeto_id: node.objeto_id, objeto_nome: node.objeto_nome, parametros: {} } }, {});
  }

  // Decisão guiada: quando um CONJUNTO/CAMPANHA é selecionado, os criativos fracos dentro dele
  // viram "itens afetados" — o gestor pausa os criativos, não o objeto inteiro (o cerne do pedido).
  const afetados = (node.nivel === 'adset' || node.nivel === 'campaign') ? criativosAfetados(node) : [];
  const temAfetados = afetados.length > 0;
  const prioridade = prioridadeDoNode(node);
  const risco = riscoDoNode(node);

  // Título "decisão clara": específico sobre o que será pausado, nunca genérico.
  const nomeNivelFilho = node.nivel === 'campaign' ? 'conjunto/campanha' : 'conjunto';
  const tituloGuiado = temAfetados
    ? `Pausar ${afetados.length} criativo${afetados.length > 1 ? 's' : ''} fraco${afetados.length > 1 ? 's' : ''} dentro deste ${nomeNivelFilho}`
    : node.titulo;

  const critico = node.severidade === 'urgente' || cat === 'pausar';
  const iconBg = critico ? 'var(--bg-danger)' : cat === 'escalar' ? 'var(--bg-success)' : cat === 'revisar' ? 'var(--bg-warning)' : 'var(--bg-accent)';
  const iconColor = critico ? 'var(--text-danger)' : cat === 'escalar' ? 'var(--text-success)' : cat === 'revisar' ? 'var(--text-warning)' : 'var(--text-accent)';

  // Ação recomendada consolidada numa frase só (spec: uma caixa, não checklist).
  const acaoTexto = temAfetados
    ? `Pausar os ${afetados.length} criativo${afetados.length > 1 ? 's' : ''} listado${afetados.length > 1 ? 's' : ''} abaixo; manter os que já geram resultado. Não pausar o ${nomeNivelFilho} inteiro no momento.`
    : node.texto_recomendacao.trim() || 'Revisar este item antes de executar qualquer mudança.';

  return (
    <div style={{ padding: 12 }}>
      {/* Header: ícone + título + badges de prioridade/risco */}
      <div className="flex items-start gap-2" style={{ marginBottom: 10 }}>
        <span style={{ width: 28, height: 28, borderRadius: 7, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {cat === 'pausar' ? <PauseCircle className="h-4 w-4" /> : cat === 'escalar' ? <Rocket className="h-4 w-4" /> : cat === 'revisar' ? <Search className="h-4 w-4" /> : <Target className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4, color: 'var(--text-primary)' }}>{tituloGuiado}</p>
          <div className="flex flex-wrap items-center gap-1" style={{ marginTop: 4 }}>
            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: CANAL_META[node.canal].bg, color: CANAL_META[node.canal].color, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: CANAL_META[node.canal].color }} />
              {CANAL_META[node.canal].label}
            </span>
            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: toneToBadgeVars(prioridade.tone).bg, color: toneToBadgeVars(prioridade.tone).fg }}>Prioridade {prioridade.label.toLowerCase()}</span>
            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: toneToBadgeVars(risco.tone).bg, color: toneToBadgeVars(risco.tone).fg }}>Risco {risco.label.toLowerCase()}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold', NIVEL_BADGE[node.nivel])}>{NIVEL_LABEL[node.nivel]} · {entrega.label}</span>
          </div>
        </div>
      </div>

      {/* Mini KPIs: gasto / conversões / custo por conv. */}
      <div className="grid grid-cols-3" style={{ gap: 6, marginBottom: 10 }}>
        {[
          { label: 'Gasto', value: fatoValor(node, /gasto/i) },
          { label: 'Conversões', value: fatoValor(node, /convers|lead/i) },
          { label: 'CPL', value: fatoValor(node, /custo|cpl|cpa/i) },
        ].map((m) => (
          <div key={m.label} style={{ background: 'var(--surface-1)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '7px 9px' }}>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{m.label}</p>
            <p style={{ fontSize: 13, fontWeight: 500, marginTop: 2, color: 'var(--text-primary)' }}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Caminho: onde está o problema */}
      <div style={{ marginBottom: 10 }}>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span className={cn('shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold', NIVEL_BADGE.campaign)}>Campanha</span>
            <span className="truncate" style={{ color: 'var(--text-secondary)' }} title={node.campanha_nome}>{node.campanha_nome}</span>
          </div>
          {node.nivel !== 'campaign' && node.conjunto_nome && (
            <div className="flex items-center gap-1.5 text-xs" style={{ paddingLeft: 8 }}>
              <span className={cn('shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold', NIVEL_BADGE.adset)}>Conjunto</span>
              <span className="truncate" style={{ color: 'var(--text-secondary)' }} title={node.conjunto_nome}>{node.conjunto_nome}</span>
            </div>
          )}
          {node.nivel === 'ad' && (
            <div className="flex items-center gap-1.5 text-xs" style={{ paddingLeft: 16 }}>
              <span className={cn('shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold', NIVEL_BADGE.ad)}>Criativo</span>
              <span className="truncate" style={{ color: 'var(--text-secondary)' }} title={node.objeto_nome}>{node.objeto_nome}</span>
            </div>
          )}
        </div>
      </div>

      {/* O problema */}
      {(node.motivos.length > 0 || node.texto_recomendacao.trim()) && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 5 }}>O problema</p>
          {node.motivos.length > 0 ? (
            <ul>
              {node.motivos.map((m, i) => (
                <li key={i} className="flex gap-1.5" style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 3 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-muted)', flexShrink: 0, marginTop: 5 }} />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{node.texto_recomendacao}</p>
          )}
        </div>
      )}

      {/* Ação recomendada */}
      {!semAcao && (
        <div style={{ background: 'var(--surface-1)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Ação recomendada:</strong> {acaoTexto}
        </div>
      )}

      {/* Itens afetados */}
      {temAfetados && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 5 }}>Itens afetados ({afetados.length})</p>
          <div style={{ overflow: 'hidden', borderRadius: 8, border: '0.5px solid var(--border)' }}>
            {afetados.map((a, i) => (
              <button
                key={a.rec_id}
                onClick={() => onJump(a.rec_id)}
                className="flex w-full items-center gap-2 p-2 text-left hover:bg-surface-soft"
                style={{ borderBottom: i < afetados.length - 1 ? '0.5px solid var(--border)' : 'none' }}
              >
                <CreativeThumb tone="border-red-400/40" imageUrl={a.imagem_url} alt={a.objeto_nome} />
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--text-secondary)' }} title={a.objeto_nome}>{a.objeto_nome}</span>
                <span className="shrink-0" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fatoValor(a, /gasto/i)}</span>
                <span className="shrink-0" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fatoValor(a, /convers|lead/i)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {emAnalise && (
        <div className="flex items-center gap-2" style={{ borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--bg-pro)', padding: '8px 10px', fontSize: 10, color: 'var(--text-pro)', marginBottom: 10 }}>
          <UserRound className="h-3.5 w-3.5 shrink-0" /> Em análise humana{node.atribuido_a ? ` · ${node.atribuido_a}` : ''}
        </div>
      )}

      {/* Controles — sempre os mesmos dois: ver no Gerenciador e ligar/desligar o objeto. */}
      <div className="flex items-center" style={{ gap: 6 }}>
        <button
          onClick={handleManualToggle}
          disabled={busy || !podeAlternar}
          title={podeAlternar ? undefined : `Status "${entrega.label}" não permite ligar/desligar por aqui`}
          style={{
            padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 500, border: 'none',
            background: podeAlternar && entrega.label === 'Ativo' ? 'var(--text-danger)' : 'var(--fill-accent)',
            color: podeAlternar && entrega.label === 'Ativo' ? '#fff' : 'var(--on-accent)',
            display: 'inline-flex', alignItems: 'center', gap: 6, opacity: busy || !podeAlternar ? 0.5 : 1,
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : entrega.label === 'Ativo' ? <PauseCircle className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
          {entrega.label === 'Ativo' ? 'Desativar' : 'Ativar'}
        </button>
        {link && (
          <a
            href={link} target="_blank" rel="noopener noreferrer"
            style={{ padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 11, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ExternalLink className="h-3.5 w-3.5" /> Gerenciador
          </a>
        )}
        <button onClick={() => setWhy((w) => !w)} style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
          Por que essa recomendação? {why ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {semAcao && (
        <p style={{ marginTop: 10, borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--surface-1)', padding: 10, fontSize: 11, color: 'var(--text-secondary)' }}>
          Sem diagnóstico específico neste nó — os números estão dentro do esperado.
        </p>
      )}

      {/* Auditoria técnica */}
      {why && (
        <div className="space-y-1" style={{ marginTop: 8, borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--surface-1)', padding: 10 }}>
          {node.fatos.map((f, i) => (
            <div key={i} className="flex items-center justify-between gap-3" style={{ fontSize: 10 }}>
              <span style={{ color: 'var(--text-muted)' }}>{f.rotulo}</span>
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{f.valor}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3" style={{ fontSize: 10, borderTop: '0.5px solid var(--border)', paddingTop: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>Confiança da análise</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{node.confianca}</span>
          </div>
          {node.leitura && <p style={{ borderTop: '0.5px solid var(--border)', paddingTop: 4, fontSize: 10, fontStyle: 'italic', color: 'var(--text-muted)' }}>{node.leitura}</p>}
        </div>
      )}
    </div>
  );
}
