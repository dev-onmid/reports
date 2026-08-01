"use client";

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, Check, FileUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Importação de pedidos retroativos por planilha.
 *
 * Existe porque a API do Anota AI **não tem consulta histórica** — só devolve
 * os pedidos do dia. Sem esta porta, o funil de recorrência de um cliente novo
 * levaria meses para ficar útil.
 *
 * O usuário MAPEIA as colunas em vez de o sistema adivinhar: o formato do
 * export do Anota AI não está documentado, e casar por nome de coluna
 * produziria importação silenciosamente errada — data no campo de valor, por
 * exemplo, passa despercebido até alguém questionar o faturamento.
 *
 * O arquivo é lido no browser (mesmo padrão do Leadlovers); só as linhas já
 * mapeadas vão para o servidor.
 */

type Campo = 'data' | 'telefone' | 'nome' | 'total' | 'status' | 'canal' | 'order_id';

const CAMPOS: { campo: Campo; label: string; obrigatorio?: boolean; ajuda: string }[] = [
  { campo: 'data', label: 'Data do pedido', obrigatorio: true, ajuda: 'Sem data o pedido não entra' },
  { campo: 'telefone', label: 'Telefone do cliente', ajuda: 'Sem ele o pedido vira receita, mas não alimenta o funil' },
  { campo: 'total', label: 'Valor total', ajuda: 'Aceita R$ 1.234,56' },
  { campo: 'nome', label: 'Nome do cliente', ajuda: 'Opcional' },
  { campo: 'status', label: 'Status', ajuda: 'Cancelado/negado não conta como venda' },
  { campo: 'canal', label: 'Canal de venda', ajuda: 'Ex: iFood, cardápio próprio' },
  { campo: 'order_id', label: 'Número do pedido', ajuda: 'Se existir, evita duplicar na reimportação' },
];

type Resultado = {
  recebidas: number; importadas: number; ignoradas: number;
  sem_data: number; sem_telefone: number; total_no_banco: number;
};

export function AnotaAiImportCard({ clientId, onImportado }: { clientId: string; onImportado?: () => void }) {
  const [colunas, setColunas] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<Record<string, unknown>[]>([]);
  const [mapa, setMapa] = useState<Partial<Record<Campo, string>>>({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function lerArquivo(file: File) {
    setErro(''); setResultado(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const aba = wb.Sheets[wb.SheetNames[0]];
      const dados = XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, { defval: '' });
      if (dados.length === 0) { setErro('A planilha está vazia.'); return; }

      const cols = Object.keys(dados[0]);
      setColunas(cols);
      setLinhas(dados);

      // Sugestão por nome, apenas como ponto de partida — o usuário confirma.
      // Sugerir é útil; decidir sozinho seria o erro.
      const sugerir = (re: RegExp) => cols.find(c => re.test(c.toLowerCase()));
      setMapa({
        data: sugerir(/data|dia|criado|pedido em/),
        telefone: sugerir(/telefone|fone|celular|whats|contato/),
        nome: sugerir(/nome|cliente/),
        total: sugerir(/total|valor|preço|preco/),
        status: sugerir(/status|situa/),
        canal: sugerir(/canal|origem|plataforma/),
        order_id: sugerir(/n[ºo°]|numero|número|pedido.*id|id.*pedido|código|codigo/),
      });
    } catch {
      setErro('Não foi possível ler o arquivo. Use .xlsx ou .csv.');
    }
  }

  async function importar() {
    if (!mapa.data) { setErro('Escolha qual coluna tem a data do pedido.'); return; }
    setEnviando(true); setErro('');
    try {
      const payload = linhas.map(l => {
        const pega = (c?: string) => (c ? l[c] : undefined);
        return {
          data: pega(mapa.data) as string,
          telefone: String(pega(mapa.telefone) ?? ''),
          nome: String(pega(mapa.nome) ?? ''),
          total: pega(mapa.total) as string | number,
          status: String(pega(mapa.status) ?? ''),
          canal: String(pega(mapa.canal) ?? ''),
          order_id: String(pega(mapa.order_id) ?? ''),
        };
      });

      const res = await fetch('/api/anotaai/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, linhas: payload }),
      });
      const json = await res.json() as Resultado & { error?: string };
      if (!res.ok) { setErro(json.error ?? 'Falha ao importar.'); return; }
      setResultado(json);
      setLinhas([]); setColunas([]);
      onImportado?.();
    } catch {
      setErro('Falha ao importar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <FileUp className="h-4 w-4 text-primary" />
        <h3 className="font-heading text-xl uppercase leading-none">Importar histórico (planilha)</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        A API do Anota AI só devolve os pedidos <strong>do dia</strong> — não há como buscar o
        passado por ela. Suba o export do painel do lojista para preencher o retroativo de uma vez;
        daí em diante a coleta é automática.
      </p>

      {colunas.length === 0 && !resultado && (
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border bg-surface-soft p-6 text-sm text-muted-foreground hover:border-primary/40">
          <FileUp className="h-4 w-4" />
          Escolher arquivo .xlsx ou .csv
          <input
            type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); }}
          />
        </label>
      )}

      {colunas.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {linhas.length} linha(s) lidas. Confira o de-para abaixo — sugeri pelo nome da coluna,
            mas quem confirma é você.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CAMPOS.map(c => (
              <label key={c.campo} className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {c.label}{c.obrigatorio && <span className="text-destructive"> *</span>}
                </span>
                <select
                  value={mapa[c.campo] ?? ''}
                  onChange={e => setMapa(m => ({ ...m, [c.campo]: e.target.value || undefined }))}
                  className="rounded-[var(--radius)] border border-border bg-surface-soft px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">— não importar —</option>
                  {colunas.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
                <span className="text-[10px] text-muted-foreground">{c.ajuda}</span>
              </label>
            ))}
          </div>

          {/* Prévia: é o que revela mapeamento trocado ANTES de gravar. */}
          {mapa.data && (
            <div className="rounded-[var(--radius)] border border-border bg-surface-soft p-2">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Prévia das 3 primeiras linhas
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-muted-foreground">
                      {CAMPOS.filter(c => mapa[c.campo]).map(c => (
                        <th key={c.campo} className="px-2 py-1 text-left font-normal">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.slice(0, 3).map((l, i) => (
                      <tr key={i} className="text-foreground">
                        {CAMPOS.filter(c => mapa[c.campo]).map(c => (
                          <td key={c.campo} className="px-2 py-1">
                            {String(l[mapa[c.campo] as string] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!mapa.telefone && (
            <div className="flex items-start gap-2 rounded-[var(--radius)] border border-yellow-400/30 bg-yellow-400/10 p-2 text-yellow-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="text-[11px]">
                Sem coluna de telefone, os pedidos entram como receita mas <strong>não alimentam o
                funil de recorrência</strong> — não há como saber que duas compras são da mesma pessoa.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button" disabled={enviando || !mapa.data} onClick={() => void importar()}
              className="rounded-[var(--radius)] bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-40"
            >
              {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Importar ${linhas.length} pedidos`}
            </button>
            <button
              type="button" onClick={() => { setColunas([]); setLinhas([]); setErro(''); }}
              className="rounded-[var(--radius)] border border-border px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}

      {resultado && (
        <div className={cn(
          'mt-3 flex items-start gap-2 rounded-[var(--radius)] border p-3',
          resultado.importadas > 0 ? 'border-primary/30 bg-primary/10 text-primary' : 'border-yellow-400/30 bg-yellow-400/10 text-yellow-400',
        )}>
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-xs">
            <p><strong>{resultado.importadas}</strong> de {resultado.recebidas} pedidos importados.</p>
            {resultado.sem_data > 0 && <p>{resultado.sem_data} sem data reconhecível foram ignorados.</p>}
            {resultado.sem_telefone > 0 && (
              <p>{resultado.sem_telefone} sem telefone entraram como receita, mas ficam fora do funil.</p>
            )}
            <p className="mt-1 opacity-80">Total agora: {resultado.total_no_banco} pedidos.</p>
          </div>
        </div>
      )}
    </div>
  );
}
