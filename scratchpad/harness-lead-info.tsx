// Harness do modal de lead (cidade + respostas) e do painel agregado.
//   npx esbuild scratchpad/harness-lead-info.tsx --bundle --outfile=public/__lead_test/app.js \
//     --format=iife --loader:.tsx=tsx --define:process.env.NODE_ENV='"development"' --alias:@=./src --log-level=warning
//   npx @tailwindcss/cli -i src/app/globals.css -o public/__lead_test/app.css --minify
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { MapPin, ClipboardList } from 'lucide-react';
import { localDoLead, extrairRespostas, type RespostaFormulario } from '../src/lib/lead-formulario';

const BAR = ['#6cff2f', '#0ea5e9', '#7b2cff', '#f97316', '#ec4899', '#f59e0b'];

// raw REAL medido em produção
const RAW_META = {
  ad_id: '120247949343020601', form_id: '1092513873432444', page_id: '108128822284776',
  leadgen_id: '1073698285516469', created_time: '2026-09-14T01:08:08+0000',
  field_data: [
    { name: 'qual_procedimento_você_está_interessado_', values: ['implante_unitário_'] },
    { name: 'qual_o_melhor_horário_para_você_realizar_sua_avaliação?', values: ['tarde_—_das_14h_às_18h'] },
    { name: 'full_name', values: ['Wanesa Francis Palmeira Luz'] },
    { name: 'phone_number', values: ['+5534991473484'] },
  ],
};

// Réplica fiel do bloco do modal do CRM
function PainelLead({ lead, respostas, titulo }: { lead: Record<string, unknown>; respostas: RespostaFormulario[]; titulo: string }) {
  const local = localDoLead(lead as never);
  return (
    <div className="w-[420px] space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-primary">{titulo}</p>
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Fonte de captura</p>
        {local && (
          <div className="rounded border border-border/60 bg-card px-2 py-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <MapPin className="h-3 w-3" /> {local.rotulo}
            </span>
            <span className="mt-0.5 block text-xs font-semibold text-foreground">{local.texto}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">{local.detalhe}</span>
          </div>
        )}
        {!local && <p className="text-[11px] italic text-muted-foreground/60">(sem localização — o bloco não renderiza)</p>}
      </div>
      {respostas.length > 0 && (
        <div className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-3.5 w-3.5 text-primary" />
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Respostas do formulário</p>
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Formulário Meta · 14/09/2026</p>
          {respostas.map((r, j) => (
            <div key={j} className="rounded border border-border/60 bg-card px-2 py-1.5">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{r.pergunta}</span>
              <span className="mt-0.5 block text-xs font-semibold text-foreground">{r.resposta}</span>
            </div>
          ))}
        </div>
      )}
      {respostas.length === 0 && <p className="text-[11px] italic text-muted-foreground/60">(sem respostas — o bloco não renderiza)</p>}
    </div>
  );
}

function PainelAgregado({ formulario }: { formulario: Array<{ pergunta: string; total: number; respostas: Array<{ resposta: string; count: number }> }> }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Respostas de formulário</p>
      <p className="mt-1 text-xs text-muted-foreground">O que os leads responderam nos formulários do período.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {formulario.map(bloco => (
          <div key={bloco.pergunta} className="rounded-xl border border-border bg-background/40 p-4">
            <p className="text-xs font-bold text-foreground">{bloco.pergunta}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {bloco.total} {bloco.total === 1 ? 'resposta' : 'respostas'}
            </p>
            <div className="mt-3 space-y-1.5">
              {bloco.respostas.map((r, i) => {
                const max = bloco.respostas[0]?.count || 1;
                const cor = BAR[i % BAR.length];
                return (
                  <div key={r.resposta}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold" title={r.resposta}>{r.resposta}</span>
                      <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: cor }}>{r.count}</span>
                    </div>
                    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted/40">
                      <div className="h-full rounded-full" style={{ width: `${Math.round((r.count / max) * 100)}%`, background: cor }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [agregado, setAgregado] = useState<never[]>([]);
  useEffect(() => {
    // Agregação idêntica à da rota, sobre raws reais
    const raws = [RAW_META,
      { field_data: [{ name: 'qual_procedimento_você_está_interessado_', values: ['prótese_'] }, { name: 'qual_o_melhor_horário_para_você_realizar_sua_avaliação?', values: ['manhã_—_das_08h_às_11h30'] }] },
      { field_data: [{ name: 'qual_procedimento_você_está_interessado_', values: ['implante_unitário_'] }] },
      { field_data: [{ name: 'quantas_unidades_está_pensando_em_adquirir?', values: ['50'] }, { name: 'qual_nome_da_empresa?', values: ['Restaurante'] }] },
    ];
    const porPergunta = new Map<string, Map<string, number>>();
    for (const raw of raws) for (const { pergunta, resposta } of extrairRespostas(raw)) {
      const m = porPergunta.get(pergunta) ?? new Map<string, number>();
      m.set(resposta, (m.get(resposta) ?? 0) + 1); porPergunta.set(pergunta, m);
    }
    setAgregado([...porPergunta.entries()].map(([pergunta, r]) => ({
      pergunta, total: [...r.values()].reduce((s, n) => s + n, 0),
      respostas: [...r.entries()].map(([resposta, count]) => ({ resposta, count })).sort((a, b) => b.count - a.count),
    })).sort((a, b) => b.total - a.total) as never[]);
  }, []);

  return (
    <div className="min-h-screen space-y-6 bg-background p-6 text-foreground">
      <div className="flex flex-wrap gap-6">
        <PainelLead titulo="Formulário Meta (cidade declarada)"
          lead={{ city: 'Londrina', regiao_uf: 'PR', regiao_cidade: 'Londrina', regiao_fonte: 'form' }}
          respostas={extrairRespostas(RAW_META)} />
        <PainelLead titulo="Lead de WhatsApp (só DDD)"
          lead={{ regiao_cidade: 'Bauru / Marília', regiao_uf: 'SP', regiao_fonte: 'ddd' }}
          respostas={[]} />
        <PainelLead titulo="Lead sem nada"
          lead={{}} respostas={[]} />
      </div>
      <PainelAgregado formulario={agregado} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
