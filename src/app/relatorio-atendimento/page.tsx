'use client';

// Relatório de atendimento para imprimir/salvar em PDF: os piores, os
// intermediários e os melhores atendimentos do período, cada um com o trecho
// da conversa (o "print"), o porquê da nota e o ajuste. Fora do (dashboard)
// para sair limpo na impressão; os dados vêm da API, que exige sessão.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Msg = { d: 'in' | 'out'; em: string; t: string | null; autor?: string | null };
type Item = { id: string; nome: string | null; canal: string | null; status: string | null; nota: number; motivo: string | null; ajuste: string | null; trecho: Msg[]; quando: string | null };
type Plano = Partial<Record<'urgentes' | 'ajustes_script' | 'treinamento_time' | 'melhorias_processo' | 'ajustes_crm_automacoes', string[]>>;
type Dados = {
  cliente: string; from: string; to: string; total: number; media: number | null; distribuicao: number[];
  piores: Item[]; intermediarios: Item[]; melhores: Item[];
  auditoria: { nota_geral: number; classificacao: string; resumo: string; problemas: string[]; plano: Plano | null; criada_em: string } | null;
};

const dataBR = (iso: string) => iso.split('-').reverse().join('/');
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const COR = ['#dc2626', '#dc2626', '#ea580c', '#d97706', '#059669', '#059669'];

function Print({ trecho }: { trecho: Msg[] }) {
  return (
    <div className="rounded-lg p-3" style={{ background: '#efeae2' }}>
      {trecho.map((m, i) => (
        <div key={i} className={`mb-1.5 flex ${m.d === 'out' ? 'justify-end' : 'justify-start'}`}>
          <div className="max-w-[80%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug shadow-sm" style={{ background: m.d === 'out' ? '#d9fdd3' : '#ffffff', color: '#111b21' }}>
            <p className="mb-0.5 text-[10px] font-semibold" style={{ color: m.d === 'out' ? '#027a48' : '#6b7280' }}>
              {m.d === 'out' ? `Loja${m.autor ? ` · ${m.autor}` : ''}` : 'Cliente'}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.t || '[sem texto]'}</p>
            <p className="mt-0.5 text-right text-[9.5px]" style={{ color: '#667781' }}>{hora(m.em)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Caso({ item }: { item: Item }) {
  return (
    <article className="caso mb-5 rounded-xl border border-zinc-200 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-zinc-900">{item.nome || 'Lead sem nome'}</p>
          <p className="text-[11px] text-zinc-500">{[item.canal, item.status, item.quando ? hora(item.quando) : null].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="rounded-md px-2.5 py-1 text-sm font-black text-white" style={{ background: COR[item.nota] }}>{item.nota}/5</span>
      </header>
      <div className="grid gap-3 md:grid-cols-[1.15fr_1fr]">
        <Print trecho={item.trecho} />
        <div className="space-y-2.5 text-[13px] leading-relaxed text-zinc-800">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Por que esta nota</p>
            <p>{item.motivo}</p>
          </div>
          {item.ajuste && (
            <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">{item.nota >= 4 ? 'Para ficar ainda melhor' : 'O ajuste que eu faria'}</p>
              <p>{item.ajuste}</p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function Secao({ titulo, sub, cor, itens }: { titulo: string; sub: string; cor: string; itens: Item[] }) {
  if (!itens.length) return null;
  return (
    <section className="mb-8">
      <div className="mb-3 border-b-2 pb-1.5" style={{ borderColor: cor }}>
        <h2 className="text-lg font-black uppercase tracking-wide" style={{ color: cor }}>{titulo}</h2>
        <p className="text-xs text-zinc-500">{sub}</p>
      </div>
      {itens.map(i => <Caso key={i.id} item={i} />)}
    </section>
  );
}

function Relatorio() {
  const sp = useSearchParams();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const qs = sp.toString();

  useEffect(() => {
    let vivo = true;
    fetch(`/api/crm/attendance/relatorio?${qs}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || (r.status === 401 ? 'Entre no sistema para ver o relatório.' : 'Erro ao carregar.'));
        return j as Dados;
      })
      .then(d => { if (vivo) { setErro(null); setDados(d); } })
      .catch(e => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [qs]);

  if (erro) return <p className="p-10 text-center text-sm text-red-600">{erro}</p>;
  if (!dados) return <p className="p-10 text-center text-sm text-zinc-500">Montando o relatório…</p>;

  const a = dados.auditoria;
  const ajustes = [...(a?.plano?.urgentes ?? []), ...(a?.plano?.ajustes_script ?? []), ...(a?.plano?.treinamento_time ?? []), ...(a?.plano?.melhorias_processo ?? [])].slice(0, 8);
  const maxDist = Math.max(1, ...dados.distribuicao);

  return (
    <div className="mx-auto max-w-[900px] px-6 py-6 text-zinc-900">
      <div className="no-print mb-4 flex justify-end">
        <button onClick={() => window.print()} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700">
          Salvar em PDF
        </button>
      </div>

      <header className="mb-6 flex items-center justify-between rounded-xl px-6 py-5" style={{ background: '#0e0f14' }}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#55f52f' }}>Relatório de atendimento</p>
          <h1 className="mt-1 text-2xl font-black text-white">{dados.cliente}</h1>
          <p className="text-xs text-zinc-400">Atendimentos de {dataBR(dados.from)} a {dataBR(dados.to)}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/onmid-logo-white.png" alt="ONMID" className="h-7" />
      </header>

      {dados.total === 0 ? (
        <p className="rounded-xl border border-zinc-200 p-6 text-center text-sm text-zinc-600">
          Nenhum atendimento com nota neste período. As notas são dadas pela rotina diária a partir de hoje; escolha um período recente.
        </p>
      ) : (
        <>
          <section className="caso mb-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Média dos atendimentos</p>
              <p className="mt-1 text-4xl font-black">{dados.media?.toString().replace('.', ',')}<span className="text-lg text-zinc-400">/5</span></p>
              <p className="text-xs text-zinc-500">{dados.total} conversas avaliadas</p>
            </div>
            {a && (
              <div className="rounded-xl border border-zinc-200 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Nota geral da auditoria</p>
                <p className="mt-1 text-4xl font-black">{a.nota_geral}<span className="text-lg text-zinc-400">/100</span></p>
                <p className="text-xs text-zinc-500">{a.classificacao}</p>
              </div>
            )}
            <div className="rounded-xl border border-zinc-200 p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Distribuição das notas</p>
              {dados.distribuicao.map((n, nota) => (
                <div key={nota} className="mb-1 flex items-center gap-2 text-xs">
                  <span className="w-6 font-bold">{nota}</span>
                  <div className="h-2.5 flex-1 rounded bg-zinc-100">
                    <div className="h-full rounded" style={{ width: `${(n / maxDist) * 100}%`, background: COR[nota] }} />
                  </div>
                  <span className="w-6 text-right text-zinc-600">{n}</span>
                </div>
              ))}
            </div>
          </section>

          {a && (a.problemas.length > 0 || ajustes.length > 0) && (
            <section className="caso mb-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
                <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-red-700">Pontos de atenção</h2>
                <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-zinc-800">
                  {a.problemas.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-emerald-700">Ajustes recomendados</h2>
                <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-zinc-800">
                  {ajustes.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </section>
          )}

          <Secao titulo="Atendimentos que precisam de correção" sub="Notas 0 e 1: onde o lead foi perdido ou quase." cor="#dc2626" itens={dados.piores} />
          <Secao titulo="Atendimentos intermediários" sub="Notas 2 e 3: funcionaram, mas deixaram dinheiro na mesa." cor="#d97706" itens={dados.intermediarios} />
          <Secao titulo="Atendimentos de referência" sub="Notas 4 e 5: o padrão que o time deve repetir." cor="#059669" itens={dados.melhores} />

          <p className="mt-6 text-center text-[10px] text-zinc-400">
            Notas de 0 a 5 dadas pela rotina diária da ONMID lendo cada conversa do WhatsApp. Os trechos são cópias das mensagens no momento da avaliação.
          </p>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <div className="min-h-screen bg-white">
      <style>{`
        html, body { background: #fff !important; color-scheme: light; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          .no-print { display: none !important; }
          .caso { break-inside: avoid; page-break-inside: avoid; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
      <Suspense fallback={<p className="p-10 text-center text-sm text-zinc-500">Montando o relatório…</p>}>
        <Relatorio />
      </Suspense>
    </div>
  );
}
