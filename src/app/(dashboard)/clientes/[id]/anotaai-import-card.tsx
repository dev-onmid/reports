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

type Campo = 'data' | 'telefone' | 'nome' | 'total' | 'status' | 'canal' | 'order_id' | 'como_conheceu';

const CAMPOS: { campo: Campo; label: string; obrigatorio?: boolean; ajuda: string }[] = [
  { campo: 'data', label: 'Data do pedido', obrigatorio: true, ajuda: 'Sem data o pedido não entra' },
  { campo: 'telefone', label: 'Telefone do cliente', ajuda: 'Sem ele o pedido vira receita, mas não alimenta o funil' },
  { campo: 'total', label: 'Valor total', ajuda: 'Aceita R$ 1.234,56' },
  { campo: 'nome', label: 'Nome do cliente', ajuda: 'Opcional' },
  { campo: 'status', label: 'Status', ajuda: 'Cancelado/negado não conta como venda' },
  { campo: 'canal', label: 'Canal de venda', ajuda: 'Ex: iFood, cardápio próprio' },
  { campo: 'order_id', label: 'Número do pedido', ajuda: 'Se existir, evita duplicar na reimportação' },
  { campo: 'como_conheceu', label: 'Como nos conheceu', ajuda: 'Só origens digitais entram nos números — o resto fica de fora' },
];

type Resultado = {
  recebidas: number; importadas: number; ignoradas: number;
  sem_data: number; sem_telefone: number; total_no_banco: number;
  duplicadas_no_lote: number; ja_existiam: number; fora_da_allowlist: number;
  exemplos_duplicados: { chave: string; vezes: number }[];
};

export function AnotaAiImportCard({ clientId, onImportado }: { clientId: string; onImportado?: () => void }) {
  const [colunas, setColunas] = useState<string[]>([]);
  const [arquivos, setArquivos] = useState<{ nome: string; linhas: number }[]>([]);
  const [linhas, setLinhas] = useState<Record<string, unknown>[]>([]);
  const [mapa, setMapa] = useState<Partial<Record<Campo, string>>>({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function lerArquivos(files: FileList) {
    setErro(''); setResultado(null);
    try {
      const lidos: { nome: string; linhas: Record<string, unknown>[]; cols: string[] }[] = [];
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { cellDates: true });
        const aba = wb.Sheets[wb.SheetNames[0]];
        const dados = XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, { defval: '' });
        if (dados.length === 0) continue;
        lidos.push({ nome: file.name, linhas: dados, cols: Object.keys(dados[0]) });
      }
      if (lidos.length === 0) { setErro('Nenhuma das planilhas tem linhas.'); return; }

      // Um mapeamento só para todos os arquivos. Planilha com cabeçalho
      // diferente é recusada em vez de importada torto: aplicar o mapeamento de
      // um arquivo em outro colocaria data na coluna de valor sem avisar.
      const base = lidos[0].cols.join('|');
      const divergentes = lidos.filter(l => l.cols.join('|') !== base).map(l => l.nome);
      if (divergentes.length > 0) {
        setErro(
          `Estas planilhas têm colunas diferentes de "${lidos[0].nome}": ${divergentes.join(', ')}. ` +
          'Importe cada formato separadamente.',
        );
        return;
      }

      const dados = lidos.flatMap(l => l.linhas);
      const cols = lidos[0].cols;
      setArquivos(lidos.map(l => ({ nome: l.nome, linhas: l.linhas.length })));
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
        // "como nos conheceu" primeiro que "origem": num export com as duas
        // colunas, a específica é a certa.
        como_conheceu: sugerir(/como.*conhec|conheceu|como.*chegou|indica/) ?? sugerir(/^origem$/),
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
          como_conheceu: String(pega(mapa.como_conheceu) ?? ''),
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
          Escolher planilhas .xlsx ou .csv (pode selecionar várias)
          <input
            type="file" accept=".xlsx,.xls,.csv" className="hidden" multiple
            onChange={e => { const f = e.target.files; if (f && f.length) void lerArquivos(f); }}
          />
        </label>
      )}

      {colunas.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {linhas.length} linha(s) de {arquivos.length} arquivo(s). Confira o de-para abaixo —
            sugeri pelo nome da coluna, mas quem confirma é você.
          </p>
          {arquivos.length > 1 && (
            <ul className="flex flex-wrap gap-1.5">
              {arquivos.map(a => (
                <li key={a.nome} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {a.nome} · {a.linhas}
                </li>
              ))}
            </ul>
          )}
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
            {resultado.duplicadas_no_lote > 0 && (
              <p>
                <strong>{resultado.duplicadas_no_lote}</strong> linha(s) duplicada(s) entre as
                planilhas — contadas uma vez só.
              </p>
            )}
            {resultado.ja_existiam > 0 && (
              <p>{resultado.ja_existiam} já estavam no sistema de uma importação anterior.</p>
            )}
            {resultado.fora_da_allowlist > 0 && (
              <p>
                {resultado.fora_da_allowlist} de origem não atribuível (panfleto, indicação e
                afins) — gravadas, mas fora dos números do painel.
              </p>
            )}
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
