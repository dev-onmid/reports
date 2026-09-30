"use client";

/**
 * Sites e landing pages que mandam lead direto para cá — aba Rastreio.
 *
 * Um cliente pode ter vários: LP de campanha, site institucional, página de
 * indicação. Cada um ganha URL própria, e o NOME viaja junto com o lead — sem
 * isso os leads das três páginas chegam indistinguíveis e não dá para saber
 * qual converte.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Globe, Loader2, Mail, Plus, RefreshCw, Search, Trash2, Table2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Origem = {
  id: string;
  nome: string;
  url: string | null;
  token: string;
  enabled: boolean;
  last_received_at: string | null;
  total_recebidos: number;
  notificar_emails: string[] | null;
  sheet_id: string | null;
  sheet_tab: string | null;
  url_receptora: string;
};

type LogEntry = {
  id: string;
  origem_nome: string | null;
  resultado: string;
  detalhe: string | null;
  lead_id: string | null;
  created_at: string;
};

const BADGE: Record<string, string> = {
  criado: 'bg-emerald-500/15 text-emerald-400',
  atualizado: 'bg-sky-500/15 text-sky-400',
  sem_contato: 'bg-yellow-500/15 text-yellow-400',
  origem_desativada: 'bg-muted text-muted-foreground',
  planilha_falhou: 'bg-[#FF6B35]/15 text-[#FF6B35]',
  erro: 'bg-red-500/15 text-red-400',
};
const LABEL: Record<string, string> = {
  criado: 'Lead criado',
  atualizado: 'Lead atualizado',
  sem_contato: 'Sem telefone/e-mail',
  origem_desativada: 'Origem desativada',
  planilha_falhou: 'Planilha falhou',
  erro: 'Erro',
};

function quando(iso: string | null) {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function LpOrigensCard({ clientId }: { clientId: string }) {
  const [origens, setOrigens] = useState<Origem[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  // rascunho do campo de e-mails por origem: o input é livre e só vira lista no blur
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [planilha, setPlanilha] = useState<Record<string, { id: string; aba: string }>>({});
  // Seletor de planilha: qual origem está escolhendo, o que foi digitado e o
  // que o Drive devolveu. Um de cada vez — dois abertos competiriam pelo foco.
  const [seletor, setSeletor] = useState<string | null>(null);
  const [buscaPl, setBuscaPl] = useState('');
  const [achadas, setAchadas] = useState<Array<{ id: string; nome: string; dono: string | null }>>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroPl, setErroPl] = useState<{ msg: string; reconectar?: boolean } | null>(null);
  // Abas por planilha, para o campo da aba virar menu em vez de digitação.
  const [abas, setAbas] = useState<Record<string, string[]>>({});
  const [titulos, setTitulos] = useState<Record<string, string>>({});
  const [salvoEmails, setSalvoEmails] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/lp-origens`);
      const d = await r.json();
      const lista: Origem[] = d.origens ?? [];
      setOrigens(lista);
      setEmails(Object.fromEntries(lista.map(o => [o.id, (o.notificar_emails ?? []).join(', ')])));
      setPlanilha(Object.fromEntries(lista.map(o => [o.id,
        { id: o.sheet_id ?? '', aba: o.sheet_tab ?? '' }])));
      setLog(d.log ?? []);
    } catch { /* deixa a tela como está */ }
    setCarregando(false);
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    const nome = novoNome.trim();
    if (!nome) return;
    setCriando(true); setErro(null);
    const r = await fetch(`/api/clients/${clientId}/lp-origens`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome }),
    });
    const d = await r.json();
    if (!r.ok) setErro(d.erro ?? 'Não foi possível criar');
    else { setNovoNome(''); await carregar(); }
    setCriando(false);
  }

  async function alternar(o: Origem) {
    setOrigens(os => os.map(x => x.id === o.id ? { ...x, enabled: !x.enabled } : x));
    await fetch(`/api/clients/${clientId}/lp-origens`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origemId: o.id, enabled: !o.enabled }),
    }).catch(() => {});
  }

  async function salvarEmails(o: Origem) {
    const texto = emails[o.id] ?? '';
    if (texto === (o.notificar_emails ?? []).join(', ')) return;   // nada mudou
    const r = await fetch(`/api/clients/${clientId}/lp-origens`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origemId: o.id, notificar_emails: texto }),
    }).catch(() => null);
    if (r?.ok) {
      setSalvoEmails(o.id);
      setTimeout(() => setSalvoEmails(c => (c === o.id ? null : c)), 2000);
      // recarrega para o campo mostrar a lista JÁ NORMALIZADA — endereço
      // inválido é descartado no servidor, e quem digitou precisa ver isso.
      await carregar();
    }
  }

  // Espelha o lead numa planilha do Google. Vazio = não espelha.
  /**
   * Grava planilha e aba com valores EXPLÍCITOS.
   *
   * ⚠️ Recebe os valores em vez de ler do estado: escolher no menu e salvar no
   * mesmo gesto lia o estado antes do React aplicar o setState, e gravava o
   * valor anterior. Quem chama já sabe o que quer gravar.
   */
  async function gravarPlanilha(o: Origem, valores: { id: string; aba: string }) {
    setPlanilha(m => ({ ...m, [o.id]: valores }));
    await fetch(`/api/clients/${clientId}/lp-origens`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origemId: o.id, sheet_id: valores.id, sheet_tab: valores.aba }),
    });
    setSalvoEmails(o.id);
    setTimeout(() => setSalvoEmails(null), 1500);
    void carregar();
  }

  /** Saída do campo digitado: só grava se mudou de verdade. */
  async function salvarPlanilha(o: Origem) {
    const atual = planilha[o.id] ?? { id: '', aba: '' };
    if (atual.id === (o.sheet_id ?? '') && atual.aba === (o.sheet_tab ?? '')) return;
    await gravarPlanilha(o, atual);
  }

  // Busca no Drive. Debounce curto porque é chamada externa por tecla digitada;
  // sem ele, "romanza" dispararia sete vezes.
  const buscarPlanilhas = useCallback(async (termo: string) => {
    setBuscando(true); setErroPl(null);
    try {
      const r = await fetch(`/api/google-planilhas?q=${encodeURIComponent(termo)}`);
      const d = await r.json();
      if (!r.ok) { setAchadas([]); setErroPl({ msg: d?.erro ?? 'Não consegui listar as planilhas.', reconectar: !!d?.reconectar }); }
      else { setAchadas(d.planilhas ?? []); }
    } catch {
      setAchadas([]); setErroPl({ msg: 'Não consegui falar com o Google.' });
    }
    setBuscando(false);
  }, []);

  useEffect(() => {
    if (!seletor) return;
    const t = setTimeout(() => void buscarPlanilhas(buscaPl), 350);
    return () => clearTimeout(t);
  }, [seletor, buscaPl, buscarPlanilhas]);

  // As abas saem do próprio Sheets, então funcionam mesmo sem o escopo de Drive.
  const carregarAbas = useCallback(async (sheetId: string) => {
    if (!sheetId || abas[sheetId]) return;
    try {
      const r = await fetch(`/api/google-planilhas?sheetId=${encodeURIComponent(sheetId)}`);
      const d = await r.json();
      if (r.ok && Array.isArray(d.abas)) {
        setAbas(m => ({ ...m, [sheetId]: d.abas }));
        if (d.titulo) setTitulos(m => ({ ...m, [sheetId]: d.titulo }));
      }
    } catch { /* o campo continua aceitando digitar */ }
  }, [abas]);

  useEffect(() => {
    for (const o of origens) if (o.sheet_id) void carregarAbas(o.sheet_id);
  }, [origens, carregarAbas]);

  /** Escolher no menu grava na hora — o gestor não deve caçar um botão salvar. */
  async function escolherPlanilha(o: Origem, sheetId: string) {
    setSeletor(null); setBuscaPl('');
    await gravarPlanilha(o, { id: sheetId, aba: planilha[o.id]?.aba ?? '' });
    void carregarAbas(sheetId);
  }

  /** Nome amigável da planilha escolhida, quando já sabemos (veio da busca ou do Sheets). */
  function nomeDaPlanilha(o: Origem): string | null {
    const id = planilha[o.id]?.id;
    if (!id) return null;
    return achadas.find(p => p.id === id)?.nome ?? titulos[id] ?? null;
  }

  async function remover(o: Origem) {
    if (!confirm(`Remover "${o.nome}"?\n\nA URL para de funcionar na hora. Os leads que já chegaram por ela ficam no CRM.`)) return;
    setOrigens(os => os.filter(x => x.id !== o.id));
    await fetch(`/api/clients/${clientId}/lp-origens?origemId=${o.id}`, { method: 'DELETE' }).catch(() => {});
    void carregar();
  }

  function copiar(texto: string, id: string) {
    void navigator.clipboard.writeText(texto);
    setCopiado(id);
    setTimeout(() => setCopiado(c => (c === id ? null : c)), 1800);
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Sites e landing pages</h3>
            <p className="text-xs text-muted-foreground">
              Recebem lead direto, com o rastreio completo do anúncio
            </p>
          </div>
        </div>
        <button onClick={() => void carregar()} className="text-muted-foreground hover:text-foreground"
                title="Atualizar">
          <RefreshCw className={cn('h-4 w-4', carregando && 'animate-spin')} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {/* criar */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void criar(); }}
            placeholder="Nome do site (ex.: LP Revenda)"
            className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          <button
            onClick={() => void criar()}
            disabled={criando || !novoNome.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Adicionar
          </button>
        </div>
        {erro && <p className="text-xs text-red-400">{erro}</p>}

        {/* lista */}
        {!origens.length && !carregando && (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Nenhum site cadastrado. Crie um acima e cole a URL gerada na página.
          </p>
        )}

        {origens.map(o => (
          <div key={o.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{o.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {o.total_recebidos} lead(s) · último: {quando(o.last_received_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void alternar(o)}
                  className={cn('rounded px-2 py-1 text-xs font-medium',
                    o.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground')}
                >
                  {o.enabled ? 'Ativa' : 'Desativada'}
                </button>
                <button onClick={() => void remover(o)} className="text-muted-foreground hover:text-red-400"
                        title="Remover">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted/40 px-2 py-1.5 text-[11px]">
                {o.url_receptora}
              </code>
              <button onClick={() => copiar(o.url_receptora, o.id)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs">
                {copiado === o.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copiado === o.id ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={emails[o.id] ?? ''}
                onChange={e => setEmails(m => ({ ...m, [o.id]: e.target.value }))}
                onBlur={() => void salvarEmails(o)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                placeholder="Avisar por e-mail (separe por vírgula)"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
              />
              {salvoEmails === o.id && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                  <Check className="h-3 w-3" /> salvo
                </span>
              )}
            </div>
            <div className="relative mt-2 flex items-center gap-2">
              <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

              {/* Gatilho: mostra a planilha escolhida ou convida a escolher. */}
              <button
                type="button"
                onClick={() => { setSeletor(seletor === o.id ? null : o.id); setBuscaPl(''); setAchadas([]); setErroPl(null); }}
                className="h-8 min-w-0 flex-[2] truncate rounded-md border border-border bg-background px-2 text-left text-xs hover:border-primary/50"
              >
                {planilha[o.id]?.id
                  ? <span className="text-foreground">{nomeDaPlanilha(o) ?? planilha[o.id].id}</span>
                  : <span className="text-muted-foreground">Escolher planilha (opcional)</span>}
              </button>

              {/* Aba vira menu quando sabemos quais existem; senão segue digitável. */}
              {planilha[o.id]?.id && (abas[planilha[o.id].id]?.length ?? 0) > 0 ? (
                <select
                  value={planilha[o.id]?.aba ?? ''}
                  onChange={e => void gravarPlanilha(o, { id: planilha[o.id]?.id ?? '', aba: e.target.value })}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs [color-scheme:dark]"
                >
                  <option value="">Primeira aba</option>
                  {abas[planilha[o.id].id].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              ) : (
                <input
                  value={planilha[o.id]?.aba ?? ''}
                  onChange={e => setPlanilha(m => ({ ...m, [o.id]: { ...(m[o.id] ?? { id: '', aba: '' }), aba: e.target.value } }))}
                  onBlur={() => void salvarPlanilha(o)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder="Aba"
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                />
              )}

              {planilha[o.id]?.id && (
                <button
                  type="button"
                  title="Parar de espelhar nesta planilha"
                  onClick={() => void gravarPlanilha(o, { id: '', aba: '' })}
                  className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                ><X className="h-3 w-3" /></button>
              )}

              {/* Menu de busca. Backdrop fecha — o Popover do Base UI não devolve
                  o foco ao campo em abertura por clique (lição do client-switcher). */}
              {seletor === o.id && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSeletor(null)} />
                  <div className="absolute left-5 top-9 z-50 w-[22rem] max-w-[calc(100%-1.25rem)] rounded-lg border border-border bg-card p-2 shadow-xl">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        autoFocus
                        value={buscaPl}
                        onChange={e => setBuscaPl(e.target.value)}
                        placeholder="Digite o nome da planilha"
                        className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs"
                      />
                    </div>

                    {erroPl && (
                      <p className="mt-2 text-[11px] leading-relaxed text-[#FF6B35]">
                        {erroPl.msg}
                        {erroPl.reconectar && ' Reconecte em Configurações › Integrações › Google Planilhas.'}
                      </p>
                    )}

                    <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
                      {buscando && <p className="px-1 py-2 text-[11px] text-muted-foreground">Procurando…</p>}
                      {!buscando && !erroPl && achadas.length === 0 && (
                        <p className="px-1 py-2 text-[11px] text-muted-foreground">
                          {buscaPl ? 'Nenhuma planilha com esse nome.' : 'Digite para procurar.'}
                        </p>
                      )}
                      {achadas.map(pl => (
                        <button
                          key={pl.id}
                          type="button"
                          onClick={() => void escolherPlanilha(o, pl.id)}
                          className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/40"
                        >
                          {pl.nome}
                          {pl.dono && <span className="ml-1 text-[10px] text-muted-foreground">· {pl.dono}</span>}
                        </button>
                      ))}
                    </div>

                    {/* ⚠️ Escape: planilha compartilhada de fora do Drive da conta
                        pode não aparecer na busca. Menu que não tem a opção vira
                        parede — o link colado continua valendo. */}
                    <div className="mt-2 border-t border-border pt-2">
                      <input
                        value={planilha[o.id]?.id ?? ''}
                        onChange={e => setPlanilha(m => ({ ...m, [o.id]: { ...(m[o.id] ?? { id: '', aba: '' }), id: e.target.value } }))}
                        onBlur={() => void salvarPlanilha(o)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); setSeletor(null); } }}
                        placeholder="ou cole o link da planilha"
                        className="h-7 w-full rounded-md border border-border bg-background px-2 text-[11px]"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        {/* log */}
        {log.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Últimas recepções</p>
            <div className="space-y-1">
              {log.slice(0, 8).map(l => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 rounded bg-muted/20 px-2 py-1.5 text-xs">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium',
                    BADGE[l.resultado] ?? 'bg-muted text-muted-foreground')}>
                    {LABEL[l.resultado] ?? l.resultado}
                  </span>
                  {l.origem_nome && <span className="text-muted-foreground">{l.origem_nome}</span>}
                  <span className="min-w-0 flex-1 truncate">{l.detalhe}</span>
                  <span className="text-muted-foreground">{quando(l.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
