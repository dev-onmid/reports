"use client";

import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DictateButton } from '@/components/ui/dictate-button';
import { callerHeaders } from '@/lib/auth-store';
import type { OptimizerModo } from '@/lib/optimizer';
import {
  ACOES_PRE_APROVADAS_OPCOES,
  DOW_LABELS,
  MODO_DESC,
  MODO_LABELS,
  type ClientConfig,
} from '@/lib/optimizer-ui';

export function ConfigModal({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  const [config, setConfig] = useState<ClientConfig>({
    cliente_id: clientId, modo_operacao: 'RECOMENDACAO_COM_APROVACAO',
    analise_dia_semana: 1, acoes_pre_aprovadas: [], min_dias_aprendizado: 7, orcamento_diario_maximo_conta: null,
    observacoes_fixas: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const observacaoItems = (config.observacoes_fixas ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const [newObservacao, setNewObservacao] = useState('');
  const [editingObsIndex, setEditingObsIndex] = useState<number | null>(null);
  const [editingObsText, setEditingObsText] = useState('');

  function setObservacaoItems(next: string[]) {
    setConfig((prev) => ({ ...prev, observacoes_fixas: next.length > 0 ? next.join('\n') : null }));
  }
  function addObservacao() {
    const t = newObservacao.trim();
    if (!t) return;
    setObservacaoItems([...observacaoItems, t]);
    setNewObservacao('');
  }
  function startEditObservacao(i: number) {
    setEditingObsIndex(i);
    setEditingObsText(observacaoItems[i]);
  }
  function saveEditObservacao(i: number) {
    const t = editingObsText.trim();
    if (!t) { removeObservacao(i); return; }
    const next = [...observacaoItems];
    next[i] = t;
    setObservacaoItems(next);
    setEditingObsIndex(null);
  }
  function removeObservacao(i: number) {
    setObservacaoItems(observacaoItems.filter((_, idx) => idx !== i));
    if (editingObsIndex === i) setEditingObsIndex(null);
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/otimizador/config/${encodeURIComponent(clientId)}`);
        if (res.ok) setConfig(await res.json() as ClientConfig);
      } finally { setLoading(false); }
    })();
  }, [clientId]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await fetch(`/api/otimizador/config/${encodeURIComponent(clientId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify(config),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  function toggleAcao(value: string) {
    setConfig((prev) => ({
      ...prev,
      acoes_pre_aprovadas: prev.acoes_pre_aprovadas.includes(value)
        ? prev.acoes_pre_aprovadas.filter((v) => v !== value)
        : [...prev.acoes_pre_aprovadas, value],
    }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[var(--radius)] border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold text-foreground">Config do Otimizador</h2>
            <p className="text-sm text-muted-foreground">{clientName}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {loading ? (
          <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5 p-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Modo de operação</label>
              <div className="space-y-2">
                {(Object.keys(MODO_LABELS) as OptimizerModo[]).map((modo) => (
                  <label key={modo} className="flex cursor-pointer items-start gap-3">
                    <input type="radio" name="modo" value={modo} checked={config.modo_operacao === modo}
                      onChange={() => setConfig((prev) => ({ ...prev, modo_operacao: modo }))} className="mt-0.5 accent-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{MODO_LABELS[modo]}</p>
                      <p className="text-xs text-muted-foreground">{MODO_DESC[modo]}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Dia da semana da análise</label>
              <select value={config.analise_dia_semana}
                onChange={(e) => setConfig((prev) => ({ ...prev, analise_dia_semana: Number(e.target.value) }))}
                className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                {Object.entries(DOW_LABELS).map(([day, label]) => (
                  <option key={day} value={Number(day)}>{label}</option>
                ))}
              </select>
            </div>
            {(config.modo_operacao === 'AUTOMATICO_PARCIAL' || config.modo_operacao === 'AUTOMATICO_TOTAL') && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Ações pré-aprovadas</label>
                <div className="space-y-1.5">
                  {ACOES_PRE_APROVADAS_OPCOES.map((op) => (
                    <label key={op.value} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={config.acoes_pre_aprovadas.includes(op.value)}
                        onChange={() => toggleAcao(op.value)} className="accent-primary" />
                      <span className="text-sm text-foreground">{op.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Mín. dias para pausar</label>
                <input type="number" min={1} max={90} value={config.min_dias_aprendizado}
                  onChange={(e) => setConfig((prev) => ({ ...prev, min_dias_aprendizado: Number(e.target.value) }))}
                  className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Orçamento máx. diário (R$)</label>
                <input type="number" min={0} placeholder="Sem limite" value={config.orcamento_diario_maximo_conta ?? ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, orcamento_diario_maximo_conta: e.target.value === '' ? null : Number(e.target.value) }))}
                  className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Peculiaridades deste cliente</label>
              <p className="text-[11px] text-muted-foreground">Contexto fixo que a IA considera em toda análise deste cliente, além de metas e performance. Cada item abaixo é uma peculiaridade — edite, remova ou adicione sem afetar as outras.</p>

              {observacaoItems.length > 0 && (
                <ul className="space-y-1.5">
                  {observacaoItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-[var(--radius)] border border-border bg-background px-3 py-2">
                      {editingObsIndex === i ? (
                        <>
                          <div className="relative flex-1">
                            <textarea
                              rows={2}
                              autoFocus
                              value={editingObsText}
                              onChange={(e) => setEditingObsText(e.target.value)}
                              className="w-full resize-none rounded border border-primary/50 bg-background px-2 py-1 pr-8 text-sm text-foreground outline-none"
                            />
                            <DictateButton
                              className="absolute bottom-1 right-1 h-6 w-6"
                              onTranscript={(text) => setEditingObsText((prev) => (prev ? `${prev} ${text}` : text))}
                            />
                          </div>
                          <div className="flex shrink-0 flex-col gap-1.5 pt-1">
                            <button type="button" onClick={() => saveEditObservacao(i)} title="Salvar" className="text-primary hover:text-primary/80">
                              <Check className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => setEditingObsIndex(null)} title="Cancelar" className="text-muted-foreground hover:text-foreground">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 whitespace-pre-wrap text-sm text-foreground">{item}</span>
                          <div className="flex shrink-0 gap-1.5 pt-0.5">
                            <button type="button" onClick={() => startEditObservacao(i)} title="Editar" className="text-muted-foreground hover:text-primary">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => removeObservacao(i)} title="Remover" className="text-muted-foreground hover:text-red-400">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="relative">
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder='Nova peculiaridade... ex: "Campanhas com [BOT] no nome são fluxo automatizado, têm lógica própria — nunca sugerir mover orçamento delas pra outra campanha."'
                  value={newObservacao}
                  onChange={(e) => setNewObservacao(e.target.value)}
                  className="w-full resize-none rounded-[var(--radius)] border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-primary"
                />
                <DictateButton
                  className="absolute bottom-2 right-2"
                  onTranscript={(text) => setNewObservacao((prev) => (prev ? `${prev} ${text}` : text))}
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addObservacao} disabled={!newObservacao.trim()}>
                <Plus className="h-3.5 w-3.5" />
                Adicionar peculiaridade
              </Button>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              {saved && <span className="text-xs text-primary">Configuração salva!</span>}
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
