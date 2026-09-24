'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { corDaEtapa, ETAPAS_PADRAO, MODELO_PADRAO, type EtapaFunil } from '@/lib/funil-etapas';

export { MODELO_PADRAO };

export type FunilModelo = {
  id: string;
  nome: string;
  descricao: string | null;
  etapas: { label: string; color: string; etapa_funil: EtapaFunil }[];
  cliente_origem: string | null;
  created_at: string;
};

/** Fileira de chips com as colunas que o funil vai ter — a prévia do modelo. */
export function PreviaEtapas({ etapas }: { etapas: { label: string; etapa_funil: EtapaFunil }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {etapas.map((e, i) => {
        const cor = corDaEtapa(e.etapa_funil, e.label);
        return (
          <span
            key={`${e.label}-${i}`}
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none"
            style={{ background: `${cor}20`, color: cor }}
          >
            {e.label}
          </span>
        );
      })}
    </div>
  );
}

/** As etapas do padrão do sistema, no formato da prévia. */
export const ETAPAS_PADRAO_PREVIA = ETAPAS_PADRAO.map(e => ({ label: e.label, etapa_funil: e.etapa }));

/**
 * Lista de escolha do desenho do funil: "Padrão do sistema" + os modelos
 * salvos pela agência. Um só componente para os dois lugares onde a escolha
 * acontece — o modal "Novo funil" do CRM e o passo a passo de criar cliente.
 *
 * ⚠️ `onEscolher` recebe também o NOME do modelo: quem chama costuma querer
 * pré-preencher o nome do funil com ele, e sem isso cada tela reinventaria a
 * sugestão de um jeito diferente.
 */
export function SeletorModeloFunil({
  modeloId,
  onEscolher,
  permitirExcluir = false,
}: {
  modeloId: string;
  onEscolher: (id: string, nome: string) => void;
  permitirExcluir?: boolean;
}) {
  const [modelos, setModelos] = useState<FunilModelo[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    fetch('/api/crm/funil-modelos')
      .then(r => r.ok ? r.json() as Promise<FunilModelo[]> : [])
      .then(d => { if (vivo) setModelos(Array.isArray(d) ? d : []); })
      .catch(() => { if (vivo) setModelos([]); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  async function excluir(m: FunilModelo) {
    if (!window.confirm(`Excluir o modelo "${m.nome}"? Os funis já criados com ele continuam como estão.`)) return;
    const res = await fetch(`/api/crm/funil-modelos?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    if (res.ok) {
      setModelos(prev => prev.filter(x => x.id !== m.id));
      if (modeloId === m.id) onEscolher(MODELO_PADRAO, '');
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onEscolher(MODELO_PADRAO, '')}
        className={cn(
          'flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors',
          modeloId === MODELO_PADRAO ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30',
        )}
      >
        <span className="flex items-center gap-2">
          {modeloId === MODELO_PADRAO && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          <span className="text-xs font-bold text-foreground">Padrão do sistema</span>
          <span className="ml-auto text-[10px] text-muted-foreground">{ETAPAS_PADRAO_PREVIA.length} etapas</span>
        </span>
        <PreviaEtapas etapas={ETAPAS_PADRAO_PREVIA} />
      </button>

      {carregando && <p className="py-3 text-center text-xs text-muted-foreground">Carregando modelos…</p>}

      {!carregando && modelos.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted-foreground">
          Nenhum modelo salvo ainda. Monte o funil de um cliente do jeito que quer e clique em
          <strong className="text-foreground"> Salvar como modelo</strong> no editor — ele passa a aparecer aqui.
        </p>
      )}

      {modelos.map(m => (
        <div
          key={m.id}
          className={cn(
            'group flex w-full flex-col gap-1.5 rounded-lg border p-3 transition-colors',
            modeloId === m.id ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30',
          )}
        >
          <button type="button" onClick={() => onEscolher(m.id, m.nome)} className="flex w-full flex-col gap-1.5 text-left">
            <span className="flex items-center gap-2">
              {modeloId === m.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              <span className="min-w-0 truncate text-xs font-bold text-foreground">{m.nome}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{m.etapas.length} etapas</span>
            </span>
            {m.descricao && <span className="text-[11px] text-muted-foreground">{m.descricao}</span>}
            <PreviaEtapas etapas={m.etapas} />
          </button>
          {permitirExcluir && (
            <button
              type="button"
              onClick={() => void excluir(m)}
              className="self-start text-[10px] font-semibold text-muted-foreground opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            >
              Excluir modelo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
