'use client';

import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, X, FileSpreadsheet, ClipboardPaste, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { notificar } from '@/components/ui/toast';
import { normalizarTelefone, formatarTelefone } from '@/lib/discador';

/**
 * Importa uma lista para o discador a partir de planilha (CSV/XLSX — o Excel
 * do ON Prospecção entra direto) ou de texto colado. As colunas são
 * reconhecidas pelo cabeçalho e dá para corrigir à mão antes de criar.
 */

type Campo = 'empresa' | 'telefone' | 'telefone2' | 'nome_contato' | 'cidade' | 'segmento' | 'email' | 'cnpj';
const CAMPOS: Array<{ k: Campo; rotulo: string; obrigatorio?: boolean }> = [
  { k: 'empresa', rotulo: 'Empresa' },
  { k: 'telefone', rotulo: 'Telefone', obrigatorio: true },
  { k: 'telefone2', rotulo: 'Telefone 2' },
  { k: 'nome_contato', rotulo: 'Nome do contato' },
  { k: 'cidade', rotulo: 'Cidade' },
  { k: 'segmento', rotulo: 'Segmento' },
  { k: 'email', rotulo: 'E-mail' },
  { k: 'cnpj', rotulo: 'CNPJ' },
];

type Mapa = Partial<Record<Campo, number>>;

function semAcento(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Reconhece as colunas pelo nome. Prioridade: celular/WhatsApp antes de telefone fixo. */
function mapearCabecalho(headers: string[]): Mapa {
  const h = headers.map(semAcento);
  const acha = (testes: Array<(s: string) => boolean>, usados: Set<number>) => {
    for (const t of testes) {
      const i = h.findIndex((s, idx) => !usados.has(idx) && s && t(s));
      if (i >= 0) return i;
    }
    return undefined;
  };
  const usados = new Set<number>();
  const marca = (i: number | undefined) => { if (i !== undefined) usados.add(i); return i; };
  const naoTerceiro = (s: string) => !s.includes('terceir') && !s.includes('contador') && !s.includes('pessoal');
  const mapa: Mapa = {};
  mapa.telefone = marca(acha([
    s => (s.includes('celular') || s.includes('whats')) && naoTerceiro(s),
    s => (s.includes('telefone') || s.includes('fone') || s === 'phone' || s.includes('numero')) && naoTerceiro(s),
  ], usados));
  mapa.telefone2 = marca(acha([
    s => (s.includes('telefone') || s.includes('fone') || s.includes('celular') || s.includes('whats') || s === 'phone') && naoTerceiro(s),
  ], usados));
  mapa.empresa = marca(acha([
    s => s.includes('fantasia'),
    s => s.includes('empresa') || s.includes('estabelecimento'),
    s => s === 'nome' || s.startsWith('nome ') && !s.includes('contato') && !s.includes('respons'),
    s => s.includes('razao'),
  ], usados));
  mapa.nome_contato = marca(acha([
    s => s.includes('contato') || s.includes('respons') || s.includes('proprietar') || s.includes('socio') || s.includes('decisor'),
  ], usados));
  mapa.cidade = marca(acha([s => s.includes('cidade') || s.includes('municipio')], usados));
  mapa.segmento = marca(acha([s => s.includes('segmento') || s.includes('categoria') || s.includes('cnae') || s.includes('atividade') || s.includes('ramo')], usados));
  mapa.email = marca(acha([s => (s.includes('e-mail') || s.includes('email')) && naoTerceiro(s)], usados));
  mapa.cnpj = marca(acha([s => s.includes('cnpj')], usados));
  return mapa;
}

const RE_TELEFONE = /(?:\+?55\s?)?\(?0?\d{2}\)?\s?\d{4,5}[-.\s]?\d{4}/g;

/** Texto colado: acha os telefones em cada linha; o que sobra é o nome da empresa. */
function parsearColado(texto: string): { headers: string[]; linhas: string[][] } {
  const linhas: string[][] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const l = bruta.trim();
    if (!l) continue;
    const tels = (l.match(RE_TELEFONE) ?? []).map(t => t.trim());
    if (tels.length === 0) continue;
    let resto = l;
    for (const t of tels) resto = resto.replace(t, ' ');
    const empresa = resto.replace(/[\t;,|]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    linhas.push([empresa, tels[0], tels[1] ?? '']);
  }
  return { headers: ['Empresa', 'Telefone', 'Telefone 2'], linhas };
}

function escolherPlanilha(wb: XLSX.WorkBook): { headers: string[]; linhas: string[][] } {
  let melhor: { headers: string[]; linhas: string[][]; pontos: number } | null = null;
  for (const nome of wb.SheetNames) {
    const ws = wb.Sheets[nome];
    const grade = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' })
      .map(r => (Array.isArray(r) ? r.map(c => String(c ?? '').trim()) : []));
    // Cabeçalho = primeira linha com 2+ células preenchidas.
    const iCab = grade.findIndex(r => r.filter(Boolean).length >= 2);
    if (iCab < 0) continue;
    const headers = grade[iCab];
    const linhas = grade.slice(iCab + 1).filter(r => r.some(Boolean));
    const comTelefone = linhas.filter(r => r.some(c => normalizarTelefone(c))).length;
    const pontos = comTelefone * 10 + linhas.length;
    if (!melhor || pontos > melhor.pontos) melhor = { headers, linhas, pontos };
  }
  return melhor ?? { headers: [], linhas: [] };
}

export function ImportarLista({
  clients, onClose, onCriada,
}: {
  clients: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCriada: (listaId: string) => void;
}) {
  const [nome, setNome] = useState('');
  // Sem escolha explícita, vale a ONMID (é quem prospecta); `null` = o usuário escolheu "não mandar".
  const [clientEscolhido, setClientEscolhido] = useState<string | null | undefined>(undefined);
  const clientPadrao = useMemo(() => clients.find(c => /onmid/i.test(c.name))?.id ?? '', [clients]);
  const clientId = clientEscolhido === undefined ? clientPadrao : (clientEscolhido ?? '');
  const [modo, setModo] = useState<'arquivo' | 'colar'>('arquivo');
  const [arquivoNome, setArquivoNome] = useState('');
  const [colado, setColado] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<string[][]>([]);
  const [mapa, setMapa] = useState<Mapa>({});
  const [pularRepetidos, setPularRepetidos] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function lerArquivo(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', codepage: 65001 });
      const { headers: h, linhas: l } = escolherPlanilha(wb);
      if (l.length === 0) { notificar('Não achei linhas com telefone nesse arquivo.', 'aviso'); return; }
      setHeaders(h); setLinhas(l); setMapa(mapearCabecalho(h)); setArquivoNome(file.name);
      if (!nome) setNome(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120));
    } catch {
      notificar('Não consegui ler o arquivo. Use CSV ou Excel (.xlsx).', 'erro');
    }
  }

  function aplicarColado(texto: string) {
    setColado(texto);
    const { headers: h, linhas: l } = parsearColado(texto);
    setHeaders(h); setLinhas(l); setMapa({ empresa: 0, telefone: 1, telefone2: 2 });
  }

  const contatos = useMemo(() => {
    const pega = (r: string[], k: Campo) => (mapa[k] === undefined ? '' : (r[mapa[k] as number] ?? ''));
    return linhas.map(r => {
      // "(43) 3322-1100 ; (43) 99999-8888" na mesma célula: o 1º é o principal, o 2º vira telefone 2.
      const partes = pega(r, 'telefone').split(/\s*;\s*/).filter(Boolean);
      const tel2 = pega(r, 'telefone2').split(/\s*;\s*/).filter(Boolean)[0] ?? partes[1] ?? '';
      return {
        empresa: pega(r, 'empresa'),
        nome_contato: pega(r, 'nome_contato'),
        telefone: partes[0] ?? '',
        telefone2: tel2,
        cidade: pega(r, 'cidade'),
        segmento: pega(r, 'segmento'),
        email: pega(r, 'email'),
        cnpj: pega(r, 'cnpj'),
      };
    });
  }, [linhas, mapa]);

  const comTelefone = useMemo(
    () => contatos.filter(c => normalizarTelefone(c.telefone) || normalizarTelefone(c.telefone2)).length,
    [contatos],
  );
  const previa = useMemo(() => contatos.filter(c => normalizarTelefone(c.telefone) || normalizarTelefone(c.telefone2)).slice(0, 5), [contatos]);

  async function criar() {
    if (!nome.trim()) { notificar('Dê um nome à lista.', 'aviso'); return; }
    if (mapa.telefone === undefined) { notificar('Diga qual coluna tem o telefone.', 'aviso'); return; }
    if (comTelefone === 0) { notificar('Nenhuma linha com telefone válido.', 'aviso'); return; }
    setEnviando(true);
    try {
      const res = await fetch('/api/discador/listas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), client_id: clientId || null, contatos, pular_repetidos: pularRepetidos }),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string; lista?: { id: string }; inseridos?: number; sem_telefone?: number;
        repetidos_no_arquivo?: number; ja_em_outra_lista?: number;
      };
      if (!res.ok || !data.lista) { notificar(data.error ?? 'Não foi possível criar a lista.', 'erro'); return; }
      const avisos = [
        data.repetidos_no_arquivo ? `${data.repetidos_no_arquivo} repetidos no arquivo` : null,
        data.ja_em_outra_lista ? `${data.ja_em_outra_lista} já estavam em outra lista` : null,
        data.sem_telefone ? `${data.sem_telefone} sem telefone` : null,
      ].filter(Boolean).join(' · ');
      notificar(`Lista criada com ${data.inseridos} contatos${avisos ? ` (${avisos})` : ''}.`, 'ok');
      onCriada(data.lista.id);
    } catch {
      notificar('Falha de rede ao criar a lista.', 'erro');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-2xl rounded-[var(--radius)] border border-border bg-card p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Nova lista para ligar</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome da lista *</label>
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Dentistas Londrina — outubro"
                className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quem atendeu vira lead no CRM de</label>
              <select value={clientId} onChange={e => setClientEscolhido(e.target.value || null)}
                className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="">— não mandar para o CRM —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-1 rounded-[var(--radius)] border border-border bg-background p-0.5 text-xs font-semibold">
            <button onClick={() => setModo('arquivo')} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] px-3 py-1.5', modo === 'arquivo' ? 'bg-primary text-black' : 'text-muted-foreground')}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Planilha (CSV / Excel)
            </button>
            <button onClick={() => setModo('colar')} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] px-3 py-1.5', modo === 'colar' ? 'bg-primary text-black' : 'text-muted-foreground')}>
              <ClipboardPaste className="h-3.5 w-3.5" /> Colar texto
            </button>
          </div>

          {modo === 'arquivo' ? (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void lerArquivo(f); }}
              className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border bg-background/60 px-4 py-6 text-center"
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm">{arquivoNome ? <span className="font-semibold text-foreground">{arquivoNome}</span> : 'Arraste a planilha aqui ou'}</p>
              <button onClick={() => fileRef.current?.click()} className="rounded-[var(--radius)] border border-primary px-3 py-1.5 text-xs font-bold text-foreground hover:bg-primary/10">
                {arquivoNome ? 'Trocar arquivo' : 'Escolher arquivo'}
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); e.target.value = ''; }} />
              <p className="text-[11px] text-muted-foreground">O Excel exportado do ON Prospecção entra direto — as colunas são reconhecidas pelo nome.</p>
            </div>
          ) : (
            <div>
              <textarea value={colado} onChange={e => aplicarColado(e.target.value)} rows={6}
                placeholder={'Uma linha por contato. Ex.:\nClínica Sorriso  (43) 99999-8888\nPadaria Central 43 3322-1100'}
                className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary" />
              <p className="mt-1 text-[11px] text-muted-foreground">Basta ter o telefone na linha; o resto vira o nome da empresa.</p>
            </div>
          )}

          {headers.length > 0 && (
            <>
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Colunas</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CAMPOS.map(c => (
                    <label key={c.k} className="text-xs">
                      <span className={cn('mb-0.5 block text-[11px]', c.obrigatorio ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{c.rotulo}{c.obrigatorio ? ' *' : ''}</span>
                      <select
                        value={mapa[c.k] ?? ''}
                        onChange={e => setMapa(m => ({ ...m, [c.k]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full rounded-[var(--radius)] border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                      >
                        <option value="">—</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `coluna ${i + 1}`}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-[var(--radius)] border border-border bg-background/60">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
                  <span><strong className="text-foreground">{comTelefone}</strong> de {linhas.length} linhas com telefone válido</span>
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    <input type="checkbox" checked={pularRepetidos} onChange={e => setPularRepetidos(e.target.checked)} className="accent-[var(--primary)]" />
                    pular telefone que já está em outra lista
                  </label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="px-3 py-1.5 text-left">Empresa</th><th className="px-3 py-1.5 text-left">Telefone</th><th className="px-3 py-1.5 text-left">Cidade</th><th className="px-3 py-1.5 text-left">Segmento</th></tr>
                    </thead>
                    <tbody>
                      {previa.map((c, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="px-3 py-1.5">{c.empresa || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-3 py-1.5 font-mono">{formatarTelefone(normalizarTelefone(c.telefone) ?? normalizarTelefone(c.telefone2))}</td>
                          <td className="px-3 py-1.5">{c.cidade}</td>
                          <td className="px-3 py-1.5">{c.segmento}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-[var(--radius)] px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
            <button onClick={() => void criar()} disabled={enviando || comTelefone === 0}
              className="flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-[var(--primary-dark)] disabled:opacity-40">
              <Check className="h-4 w-4" /> {enviando ? 'Criando…' : `Criar lista com ${comTelefone}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
