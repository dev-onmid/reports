"use client";

// Bloco "Landing page" do dashboard: o que o GA4 das LPs conta (ver
// src/lib/ga4-landing.ts). Só apresentação — dados chegam prontos da rota
// /api/clients/[id]/ga4, já consolidados quando o cliente tem mais de uma LP.
//
// Uma rolagem só, de cima para baixo (nada escondido em abas — pedido do
// Matheus), organizada como painel de analytics e NÃO como planilha:
//   1. (sem rótulo) 4 KPIs (IndicadorCard) + faixa compacta (IndicadorMini)
//   2. Do clique ao contato — funil clique → sessão → engajada → contato, com
//      o connect rate (sessões ÷ cliques) em destaque, e a evolução diária
//   3. Campanhas na página — campanhas por custo por contato, palavras-chave
//      boas x candidatas a negativar, termos pesquisados recolhidos
//      (era "Tráfego pago", e confundia com a seção "Mídia paga" da página)
//   4. Audiência — donuts e barras horizontais, sem tabela
//   5. Comportamento — canais, páginas de entrada, rolagem, formulário
//
// ⚠️ NÃO há moldura externa: o painel devolve cards de topo (Superficie) que
// ficam direto sob o título de seção "Landing page" da página. A moldura
// única com cards aninhados fazia a LP parecer uma segunda página dentro da
// página. Listas longas cortam em 5 com "Ver mais".
// Bloco sem dado no período não aparece (nada de caixa vazia); eventos que
// faltam viram uma linha única no fim.
//
// ⚠️ "Contatos" por corte = eventos-chave de WhatsApp + formulário + telefone
// (juntaConversoes). Se a propriedade não tem evento-chave classificável, cai
// para todos os eventos-chave (`conversoes`). A série `diario` só tem
// eventos-chave (keyEvents), por isso o gráfico diário diz "eventos-chave".

import { useState, type ReactNode } from 'react';
import { ChevronDown, Globe, Activity, MessageCircle, Percent } from 'lucide-react';
import type { Ga4Celula, Ga4Consolidado, Ga4Linha, Ga4Seg, Ga4Totais } from '@/lib/ga4-landing';
import { EvolucaoDiaria } from './ga4-landing-graficos';
import { Donut } from './donut';
import { SUPERFICIE, CabecalhoCard, GrupoTitulo, useVerMais } from './superficie';
import { IndicadorCard, IndicadorMini, FaixaIndicadores } from './indicador-card';
import { COR_SECUNDARIA } from './grafico-estilo';
import { T } from '@/lib/dashboard-tipografia';

const cx = (...a: Array<string | false | undefined>) => a.filter(Boolean).join(' ');

const fmtN = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('pt-BR');
const fmtPct = (n: number, casas = 1) => `${((Number.isFinite(n) ? n : 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`;
const fmtBRL = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const div = (a: number, b: number) => (b > 0 ? a / b : 0);
function fmtTempo(seg: number) {
  const s = Math.round(Number.isFinite(seg) ? seg : 0);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Cores do design system
const VERDE = '#6cff2f';
const VERMELHO = '#ff5a5a';
const AMBAR = '#f5b83d';
/** Paleta das barras 100% empilhadas (dispositivo, novos x recorrentes). */
const PALETA = [VERDE, COR_SECUNDARIA, '#a78bfa', '#8a959b'];

// Tradução dos valores padrão do GA4
const CANAIS: Record<string, string> = {
  'Paid Search': 'Pesquisa paga', 'Paid Social': 'Social pago', 'Paid Other': 'Outros pagos', 'Paid Shopping': 'Shopping pago', 'Paid Video': 'Vídeo pago',
  'Cross-network': 'Performance Max / rede cruzada', 'Display': 'Display', 'Organic Search': 'Busca orgânica', 'Organic Social': 'Social orgânico',
  'Organic Shopping': 'Shopping orgânico', 'Organic Video': 'Vídeo orgânico', 'Direct': 'Direto', 'Referral': 'Outros sites', 'Email': 'E-mail',
  'SMS': 'SMS', 'AI Assistant': 'Assistentes de IA (ChatGPT etc.)', 'Unassigned': 'Não identificado', '(other)': 'Outros',
};
const DISPOSITIVOS: Record<string, string> = { mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet', 'smart tv': 'TV' };
const NOVOS: Record<string, string> = { new: 'Novos', returning: 'Recorrentes' };
const GENEROS: Record<string, string> = { female: 'Mulheres', male: 'Homens' };
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const traduz = (mapa: Record<string, string>) => (s: Ga4Seg): Ga4Seg => ({ ...s, valor: mapa[s.valor] ?? s.valor });

/** Contatos de um corte: WhatsApp + formulário + telefone; sem tipo classificável, todos os eventos-chave. */
const contatosSeg = (s: Ga4Seg) => s.whatsapp + s.formulario + s.telefone;
function contador(linhas: Ga4Seg[]) {
  const temTipo = linhas.some(s => contatosSeg(s) > 0);
  return (s: Ga4Seg) => (temTipo ? contatosSeg(s) : s.conversoes);
}

/** Connect rate (sessões ÷ cliques): quanto dos cliques pagos chegou na página. */
function statusConnect(r: number) {
  if (r >= 0.8) return { rotulo: 'Saudável', cor: VERDE };
  if (r >= 0.7) return { rotulo: 'Atenção', cor: AMBAR };
  return { rotulo: 'Perdendo cliques', cor: VERMELHO };
}


// ───────────────────────────── primitivos visuais ─────────────────────────────

/** Card de topo da seção — a MESMA superfície de todo o dashboard. */
function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx(SUPERFICIE, 'p-5', className)}>{children}</section>;
}

/** Título de card no padrão do dashboard, com descrição opcional e slot à direita. */
function Titulo({ children, dica, direita }: { children: ReactNode; dica?: string; direita?: ReactNode }) {
  return <CabecalhoCard titulo={children} sub={dica} direita={direita} />;
}

/** Chip de status colorido. */
function Chip({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.05em]"
      style={{ color: cor, borderColor: `${cor}55`, background: `${cor}1f` }}>
      {children}
    </span>
  );
}

/**
 * Variação vs período anterior para o IndicadorCard/IndicadorMini.
 * `pp` = taxa: diferença em pontos percentuais em vez de % relativo.
 * Sem base (anterior 0 em % relativo) = null → "—".
 */
function variacao(atual: number, anterior: number, pp = false): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return null;
  if (pp) return !anterior && !atual ? null : (atual - anterior) * 100;
  if (!anterior) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

type ItemBarra = { chave: string; rotulo: string; sub?: string; valor: number; direita: ReactNode; extra?: ReactNode; cor?: string };

/**
 * Lista de barras horizontais ordenadas: rótulo, número à direita e barra
 * proporcional ao maior. Mostra `limite` itens (5) e "Ver mais (N)" para o resto.
 */
function ListaBarras({ itens, cor = VERDE, limite = 5 }: { itens: ItemBarra[]; cor?: string; limite?: number }) {
  const { visiveis, botao } = useVerMais(itens, limite);
  if (itens.length === 0) return null;
  const max = Math.max(1, ...itens.map(i => i.valor));
  return (
    <>
      <ul className="space-y-2.5">
        {visiveis.map(i => (
          <li key={i.chave} className="text-xs">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-semibold text-[#dce4e8]" title={i.sub ? `${i.rotulo} · ${i.sub}` : i.rotulo}>
                {i.rotulo}
                {i.sub && <span className="ml-1.5 text-[10px] font-normal text-[#6c767c]">{i.sub}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{i.direita}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-white/[0.05]">
              <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (i.valor / max) * 100)}%`, background: i.cor ?? cor }} />
            </div>
            {i.extra && <div className="mt-0.5 text-[11px] text-[#7c868c]">{i.extra}</div>}
          </li>
        ))}
      </ul>
      {botao}
    </>
  );
}

/** Segmentos de qualidade (sessões + taxa de contato) como ListaBarras. */
function barrasSeg(linhas: Ga4Seg[], opts: { engaj?: boolean } = {}): ItemBarra[] {
  const cont = contador(linhas);
  return linhas.map(s => ({
    chave: `${s.valor}|${s.sub ?? ''}`,
    rotulo: s.valor || '(sem nome)',
    valor: s.sessoes,
    direita: (
      <>
        <span className="font-bold text-[#f4f7f8]">{fmtN(s.sessoes)}</span>
        <span className="ml-1 text-[11px] text-[#7c868c]">sessões</span>
      </>
    ),
    extra: (
      <>
        {opts.engaj && <>engajamento <b className="text-[#c7d0d5]">{fmtPct(div(s.engajadas, s.sessoes))}</b> · </>}
        {fmtN(cont(s))} contato(s) · converteu <b className="text-[#c7d0d5]">{fmtPct(div(s.sessoesConv, s.sessoes))}</b>
      </>
    ),
  }));
}

/** Donut (dispositivo, novos x recorrentes, gênero) com % e taxa de conversão de cada fatia. */
function Empilhada({ linhas }: { linhas: Ga4Seg[] }) {
  // Donut: parte do todo com 2–3 fatias é o caso ideal do gráfico de rosca.
  const total = linhas.reduce((t, s) => t + s.sessoes, 0);
  if (total <= 0) return null;
  const fatias = linhas.filter(s => s.sessoes > 0).sort((a, b) => b.sessoes - a.sessoes);
  const cor = (i: number) => PALETA[Math.min(i, PALETA.length - 1)];
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <Donut
        tamanho={130}
        espessura={22}
        fatias={fatias.map((s, i) => ({ label: s.valor, valor: s.sessoes, cor: cor(i) }))}
        centroTitulo="sessões"
        centroValor={fmtN(total)}
        formatar={(n) => `${fmtN(n)} sessões`}
      />
      <div className="grid w-full min-w-0 gap-2.5">
        {fatias.map((s, i) => (
          <div key={s.valor} className="min-w-0">
            <p className={cx('flex items-center gap-1.5 truncate', T.listaRotulo)}>
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: cor(i) }} />
              {s.valor}
              <span className={cx('ml-auto tabular-nums', T.miniValor)}>{fmtPct(s.sessoes / total, 0)}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-[#7c868c]">{fmtN(s.sessoes)} sessões · converte <b className="text-[#c7d0d5]">{fmtPct(div(s.sessoesConv, s.sessoes))}</b></p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── blocos ─────────────────────────────

/**
 * "Do clique ao contato": cliques no Google Ads → sessões pagas → engajadas →
 * contatos, com % entre etapas e o connect rate em destaque. Sem Google Ads,
 * cai para sessões → engajadas → contatos do total da LP.
 */
function FunilClique({ ads, atual }: { ads: Ga4Seg[]; atual: Ga4Totais }) {
  const cont = contador(ads);
  const cliques = ads.reduce((t, g) => t + (g.cliques ?? 0), 0);
  const comAds = ads.length > 0 && cliques > 0;
  const etapas = comAds
    ? [
      { rotulo: 'Cliques nos anúncios', sub: 'cliques Google Ads', n: cliques },
      { rotulo: 'Sessões pagas', sub: 'chegaram na página', n: ads.reduce((t, g) => t + g.sessoes, 0) },
      { rotulo: 'Sessões engajadas', sub: '+10s, 2+ páginas ou conversão', n: ads.reduce((t, g) => t + g.engajadas, 0) },
      { rotulo: 'Contatos', sub: 'WhatsApp + formulário + telefone', n: ads.reduce((t, g) => t + cont(g), 0) },
    ]
    : [
      { rotulo: 'Sessões', sub: 'todas as origens', n: atual.sessoes },
      { rotulo: 'Sessões engajadas', sub: '+10s, 2+ páginas ou conversão', n: atual.engajadas },
      { rotulo: 'Contatos', sub: 'WhatsApp + formulário + telefone', n: atual.contatos },
    ];
  if (etapas[0].n <= 0) return null;
  const max = Math.max(...etapas.map(e => e.n), 1);
  const connect = comAds ? div(etapas[1].n, cliques) : 0;
  const st = statusConnect(connect);
  const aCada100 = Math.round(connect * 100);

  return (
    <Card>
      <Titulo dica={comAds
        ? 'Campanhas do Google Ads: do clique pago até o contato. Cliques e custo vêm do Google Ads; o resto, do GA4.'
        : 'Sem dados do Google Ads vinculados — funil com todas as sessões da página.'}>
        {comAds ? 'Funil do anúncio (Google Ads)' : 'Funil da página'}
      </Titulo>

      {/* Connect rate: linha de destaque (fundo leve, sem borda — nada de card dentro do card). */}
      {comAds && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] bg-white/[0.02] px-4 py-3">
          <div>
            <p className={T.miniRotulo}>Connect rate</p>
            <p className={cx('mt-1 tabular-nums', T.kpiValor)} style={{ color: st.cor }}>{fmtPct(connect, 0)}</p>
          </div>
          <Chip cor={st.cor}>{st.rotulo}</Chip>
          <p className="min-w-[200px] flex-1 text-xs leading-snug text-[#c7d0d5]">
            De cada 100 cliques, <b className="text-[#f4f7f8]">{fmtN(aCada100)}</b> chegaram na página.
            <span className="mt-0.5 block text-[11px] text-[#7c868c]">Sessões ÷ cliques. Abaixo de 80% costuma ser página lenta, redirecionamento ou tag do GA4 fora do ar.</span>
          </p>
        </div>
      )}

      <ol className="space-y-1">
        {etapas.map((e, i) => {
          const passo = i > 0 ? div(e.n, etapas[i - 1].n) : 0;
          const largura = Math.max(3, Math.min(100, (e.n / max) * 100));
          const opac = 1 - i * (0.55 / Math.max(1, etapas.length - 1));
          return (
            <li key={e.rotulo}>
              {i > 0 && (
                <div className="flex items-center gap-2 py-1 pl-1 text-[11px] text-[#7c868c]">
                  <ChevronDown className="h-3 w-3" />
                  <span className="font-bold tabular-nums text-[#c7d0d5]">{fmtPct(passo)}</span>
                  <span>{i === 1 && comAds ? 'connect rate' : 'da etapa anterior'}</span>
                </div>
              )}
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <div className="w-full shrink-0 sm:w-[160px]">
                  <p className={T.listaRotulo}>{e.rotulo}</p>
                  <p className={T.nota}>{e.sub}</p>
                </div>
                <div className="relative h-9 flex-1 rounded-[8px] bg-white/[0.04]">
                  <div className="flex h-9 items-center rounded-[8px] px-3" style={{ width: `${largura}%`, background: `rgba(108,255,47,${0.18 + 0.6 * opac})` }}>
                    {largura >= 18 && <span className="font-heading text-lg leading-none text-[#071006] tabular-nums">{fmtN(e.n)}</span>}
                  </div>
                  {largura < 18 && (
                    <span className="absolute top-1/2 -translate-y-1/2 font-heading text-lg leading-none text-[#f4f7f8] tabular-nums" style={{ left: `calc(${largura}% + 8px)` }}>
                      {fmtN(e.n)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** Campanhas ranqueadas por custo, com connect rate e custo por contato; campanhas UTM (sem custo) abaixo, esmaecidas. */
function Campanhas({ ads, utm, semCusto }: { ads: Ga4Seg[]; utm: Ga4Seg[]; semCusto: boolean }) {
  const nomesAds = new Set(ads.map(a => a.valor));
  const outras = utm.filter(c => !/^google\s*\//i.test(c.sub ?? '') && !nomesAds.has(c.valor));
  if (ads.length + outras.length === 0) return null;
  const contAds = contador(ads);
  const contUtm = contador(outras);
  const ordenadas = [...ads].sort((a, b) => (b.custo ?? 0) - (a.custo ?? 0) || b.sessoes - a.sessoes);
  const maxCusto = Math.max(1, ...ordenadas.map(a => a.custo ?? 0));
  const th = cx('pb-2 pl-3 text-right whitespace-nowrap', T.tabelaCab);
  const td = 'py-2.5 pl-3 text-right tabular-nums whitespace-nowrap';

  return (
    <Card>
      <Titulo dica={semCusto
        ? 'Custo vazio: a propriedade GA4 não está vinculada ao Google Ads.'
        : 'Ordenado por custo. Connect rate = sessões ÷ cliques. Custo por contato = custo ÷ contatos (WhatsApp + formulário + telefone).'}>
        Campanhas: custo por contato
      </Titulo>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr>
              <th className={cx('pb-2 pr-2 text-left', T.tabelaCab)}>Campanha</th>
              <th className={th}>Custo</th>
              <th className={th}>Cliques</th>
              <th className={th}>Sessões</th>
              <th className={th}>Connect</th>
              <th className={th}>Contatos</th>
              <th className={th}>Custo/contato</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((c, i) => {
              const custo = c.custo ?? 0;
              const cliques = c.cliques ?? 0;
              const k = contAds(c);
              const conn = cliques > 0 ? div(c.sessoes, cliques) : null;
              const stc = conn !== null ? statusConnect(conn) : null;
              return (
                <tr key={c.valor} className="border-t border-white/[0.06] align-middle">
                  <td className="max-w-[280px] py-2.5 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-right font-heading text-sm text-[#6c767c]">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-[#dce4e8]" title={c.valor}>{c.valor}</div>
                        {custo > 0 && (
                          <div className="mt-1 h-1 rounded-full bg-white/[0.05]">
                            <div className="h-1 rounded-full bg-[#6cff2f]/70" style={{ width: `${(custo / maxCusto) * 100}%` }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className={cx(td, 'font-bold text-[#f4f7f8]')}>{custo ? fmtBRL(custo) : '—'}</td>
                  <td className={cx(td, 'text-[#9aa4aa]')}>{cliques ? fmtN(cliques) : '—'}</td>
                  <td className={cx(td, 'text-[#9aa4aa]')}>{fmtN(c.sessoes)}</td>
                  <td className={td} title="Connect rate: sessões ÷ cliques">{stc && conn !== null ? <span className="font-bold" style={{ color: stc.cor }}>{fmtPct(conn, 0)}</span> : <span className="text-[#6c767c]">—</span>}</td>
                  <td className={cx(td, 'font-bold text-[#dce4e8]')}>{fmtN(k)}</td>
                  <td className={td}>
                    {k > 0 && custo > 0
                      ? <span className="font-bold text-[#f4f7f8]">{fmtBRL(custo / k)}</span>
                      : custo > 0 ? <Chip cor={VERMELHO}>Sem contato</Chip> : <span className="text-[#6c767c]">—</span>}
                  </td>
                </tr>
              );
            })}
            {outras.length > 0 && (
              <tr>
                <td colSpan={7} className="pb-1 pt-4 text-[10px] font-black uppercase tracking-[0.08em] text-[#6c767c]">
                  Outras campanhas (UTM) · Meta Ads e demais origens, sem custo no GA4
                </td>
              </tr>
            )}
            {outras.map(c => (
              <tr key={`${c.valor}|${c.sub ?? ''}`} className="border-t border-white/[0.04] text-[#7c868c]">
                <td className="max-w-[280px] py-2 pr-2 pl-6">
                  <div className="truncate" title={c.valor}>{c.valor}</div>
                  {c.sub && <div className="truncate text-[10px] text-[#5c666c]">{c.sub}</div>}
                </td>
                <td className={td}>—</td>
                <td className={td}>—</td>
                <td className={td}>{fmtN(c.sessoes)}</td>
                <td className={td}>—</td>
                <td className={cx(td, 'text-[#a7b0b6]')}>{fmtN(contUtm(c))}</td>
                <td className={td}>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Palavras-chave: as que trouxeram contato x as que só gastam (candidatas a negativar). Termos pesquisados recolhidos. */
function PalavrasChave({ palavras, termos }: { palavras: Ga4Seg[]; termos: Ga4Seg[] }) {
  const [abrirTermos, setAbrirTermos] = useState(false);
  const cont = contador(palavras);
  const boas = palavras.filter(s => cont(s) > 0).sort((a, b) => cont(b) - cont(a) || b.sessoes - a.sessoes);
  const ruins = palavras.filter(s => cont(s) === 0 && s.sessoes >= 10).sort((a, b) => b.sessoes - a.sessoes);
  const contT = contador(termos);
  const termosOrd = [...termos].sort((a, b) => contT(b) - contT(a) || b.sessoes - a.sessoes);
  if (boas.length + ruins.length + termos.length === 0) return null;

  return (
    <>
      {boas.length + ruins.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <Titulo dica="Palavras-chave com mais contatos. Taxa = contatos ÷ sessões.">
              <span className="text-[#6cff2f]">●</span> Palavras que trouxeram contato
            </Titulo>
            {boas.length > 0 ? (
              <ListaBarras itens={boas.map(s => ({
                chave: s.valor, rotulo: s.valor, valor: cont(s),
                direita: <><span className="font-bold text-[#f4f7f8]">{fmtN(cont(s))}</span><span className="ml-1 text-[11px] text-[#7c868c]">contato(s)</span></>,
                extra: <>{fmtN(s.sessoes)} sessões · taxa <b className="text-[#c7d0d5]">{fmtPct(div(cont(s), s.sessoes))}</b></>,
              }))} />
            ) : <p className="text-xs text-[#7c868c]">Nenhuma palavra-chave trouxe contato no período.</p>}
          </Card>
          <Card>
            <Titulo dica="10+ sessões pagas e zero contato — revisar, pausar ou negativar.">
              <span className="text-[#ff5a5a]">●</span> Palavras que gastam sem contato
            </Titulo>
            {ruins.length > 0 ? (
              <ListaBarras cor={VERMELHO} itens={ruins.map(s => ({
                chave: s.valor, rotulo: s.valor, valor: s.sessoes,
                direita: <><span className="font-bold text-[#f4f7f8]">{fmtN(s.sessoes)}</span><span className="ml-1 text-[11px] text-[#7c868c]">sessões</span></>,
                extra: <>engajamento {fmtPct(div(s.engajadas, s.sessoes))} · tempo médio {fmtTempo(div(s.tempo, s.sessoes))}</>,
              }))} />
            ) : <p className="text-xs text-[#7c868c]">Nenhuma palavra com 10+ sessões sem contato.</p>}
          </Card>
        </div>
      )}
      {termosOrd.length > 0 && (
        <section className={SUPERFICIE}>
          <button type="button" onClick={() => setAbrirTermos(v => !v)}
            className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left">
            <span className={T.cardTitulo}>Termos pesquisados <span className={cx('ml-1 normal-case tracking-normal', T.cardSub)}>({fmtN(termosOrd.length)})</span></span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#9aa4aa] hover:text-[#6cff2f]">
              {abrirTermos ? 'Recolher' : 'Ver termos'}
              <ChevronDown className={cx('h-4 w-4 transition-transform', abrirTermos && 'rotate-180')} />
            </span>
          </button>
          {abrirTermos && (
            <div className="border-t border-white/[0.06] px-5 pb-5 pt-3">
              <p className="mb-2 text-[11px] text-[#7c868c]">O que a pessoa digitou no Google. O Google esconde termos de pouco volume e da Performance Max — a soma fica abaixo do total.</p>
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#0d1519]">
                    <tr className={T.tabelaCab}>
                      <th className="pb-1 text-left">Termo</th>
                      <th className="pb-1 pl-3 text-right">Sessões</th>
                      <th className="pb-1 pl-3 text-right">Contatos</th>
                      <th className="pb-1 pl-3 text-right">Taxa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termosOrd.map(t => (
                      <tr key={t.valor} className="border-t border-white/[0.05]">
                        <td className="max-w-[320px] truncate py-1.5 text-[#dce4e8]" title={t.valor}>{t.valor}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums text-[#9aa4aa]">{fmtN(t.sessoes)}</td>
                        <td className={cx('py-1.5 pl-3 text-right font-bold tabular-nums', contT(t) > 0 ? 'text-[#6cff2f]' : 'text-[#6c767c]')}>{fmtN(contT(t))}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums text-[#9aa4aa]">{fmtPct(div(contT(t), t.sessoes))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** Grade dia da semana × hora: cor = sessões ou conversões. */
function MapaSemanaHora({ celulas }: { celulas: Ga4Celula[] }) {
  const [modo, setModo] = useState<'sessoes' | 'conversoes'>('conversoes');
  if (celulas.length === 0) return null;
  const grade = new Map(celulas.map(c => [`${c.dia}|${c.hora}`, c]));
  const max = Math.max(1, ...celulas.map(c => c[modo]));
  const porHora = Array.from({ length: 24 }, (_, h) => celulas.filter(c => c.hora === h).reduce((s, c) => s + c[modo], 0));
  const pico = porHora.indexOf(Math.max(...porHora));
  return (
    <Card>
      <Titulo
        dica={`No fuso horário da propriedade GA4. Pico de ${modo === 'sessoes' ? 'visitas' : 'conversões'}: ${pico}h.`}
        direita={(
          <div className="flex overflow-hidden rounded-md border border-white/10 text-[10px] font-bold">
            {(['conversoes', 'sessoes'] as const).map(m => (
              <button key={m} type="button" onClick={() => setModo(m)} className={`px-2 py-1 ${modo === m ? 'bg-[#6cff2f] text-black' : 'text-[#9aa4aa]'}`}>{m === 'sessoes' ? 'Visitas' : 'Conversões'}</button>
            ))}
          </div>
        )}>
        Dia da semana e hora
      </Titulo>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: '32px repeat(24, minmax(0, 1fr))' }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[9px] text-[#6c767c]">{h % 3 === 0 ? h : ''}</div>)}
          {DIAS.map((d, dia) => (
            <div key={d} className="contents">
              <div className="text-[10px] leading-4 text-[#9aa4aa]">{d}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const c = grade.get(`${dia}|${h}`);
                const v = c?.[modo] ?? 0;
                return (
                  <div key={h} className="h-4 rounded-[2px]" title={`${d} ${h}h · ${fmtN(c?.sessoes ?? 0)} visitas · ${fmtN(c?.conversoes ?? 0)} conversões`}
                    style={{ background: v > 0 ? `rgba(108,255,47,${0.12 + 0.88 * (v / max)})` : 'rgba(255,255,255,0.04)' }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/**
 * Rolagem em FAIXA COMPACTA de largura total: só o marco de 90% (GA4 padrão)
 * vira um número + barra; com 25/50/75 vira degraus lado a lado.
 */
function Rolagem({ linhas, visitantes }: { linhas: Ga4Linha[]; visitantes: number }) {
  if (linhas.length === 0 || visitantes <= 0) return null;
  const soNoventa = linhas.every(l => Number(l.valor) === 90);
  if (soNoventa) {
    const pct = div(linhas.reduce((t, l) => t + l.n, 0), visitantes);
    return (
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[150px]">
          <h3 className={T.cardTitulo}>Rolagem da página</h3>
          <p className={cx('mt-1', T.cardSub)}>chegaram a 90% da página</p>
        </div>
        <p className={cx('tabular-nums', T.kpiValor)}>{fmtPct(pct, 0)}</p>
        <div className="h-2 min-w-[160px] flex-1 rounded-full bg-white/[0.05]"><div className="h-2 rounded-full bg-[#6cff2f]" style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>
        <p className="w-full text-[11px] leading-snug text-[#7c868c] xl:w-auto xl:max-w-[320px]">O GA4 padrão só mede 90%. Os marcos de 25/50/75% exigem o gatilho de profundidade de rolagem no GTM.</p>
      </Card>
    );
  }
  const passos = [...linhas].sort((a, b) => Number(a.valor) - Number(b.valor));
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="min-w-[150px]">
        <h3 className={T.cardTitulo}>Até onde rolam</h3>
        <p className={cx('mt-1', T.cardSub)}>% dos visitantes em cada ponto</p>
      </div>
      <div className="grid min-w-[260px] flex-1 gap-4" style={{ gridTemplateColumns: `repeat(${passos.length}, minmax(0, 1fr))` }}>
        {passos.map(l => {
          const p = Math.min(1, div(l.n, visitantes));
          return (
            <div key={l.valor} className="min-w-0">
              <p className="flex items-baseline justify-between gap-2">
                <span className={T.miniRotulo}>{l.valor}%</span>
                <span className={cx('tabular-nums', T.miniValor)}>{fmtPct(p, 0)}</span>
              </p>
              <div className="mt-1.5 h-2 rounded-full bg-white/[0.05]"><div className="h-2 rounded-full bg-[#6cff2f]" style={{ width: `${Math.max(2, p * 100)}%`, opacity: 0.35 + 0.65 * p }} /></div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FunilForm({ f }: { f: Ga4Consolidado['comportamento']['funil'] }) {
  if (f.formInicio + f.leadForm + f.leadConfirmado === 0) return null;
  const etapas = [
    { rotulo: 'Visitaram a página', n: f.visitantes },
    { rotulo: 'Começaram o formulário', n: f.formInicio },
    { rotulo: 'Enviaram', n: f.leadForm },
    ...(f.leadConfirmado > 0 ? [{ rotulo: 'Chegaram na página de obrigado', n: f.leadConfirmado }] : []),
  ];
  return (
    <Card>
      <Titulo dica="Pessoas (não cliques) em cada etapa do formulário.">Funil do formulário</Titulo>
      <ListaBarras itens={etapas.map((e, i) => ({
        chave: e.rotulo, rotulo: e.rotulo, valor: e.n,
        direita: <span className="font-bold text-[#f4f7f8]">{fmtN(e.n)}</span>,
        extra: i > 0 ? <>{fmtPct(div(e.n, etapas[i - 1].n))} da etapa anterior</> : undefined,
      }))} />
      {f.formErro > 0 && <p className="mt-2 text-[10px]" style={{ color: AMBAR }}>{fmtN(f.formErro)} pessoa(s) viram erro ao enviar.</p>}
    </Card>
  );
}

/** Lista simples de contagens (onde clicam, seções, vídeos) com % sobre um total. */
function BlocoContagem({ titulo, dica, linhas, total, rotulo }: { titulo: string; dica?: string; linhas: Ga4Linha[]; total: number; rotulo?: (v: string) => string }) {
  if (linhas.length === 0) return null;
  return (
    <Card>
      <Titulo dica={dica}>{titulo}</Titulo>
      <ListaBarras itens={linhas.map(l => ({
        chave: l.valor, rotulo: rotulo ? rotulo(l.valor) : l.valor, valor: l.n,
        direita: <><span className="font-bold text-[#f4f7f8]">{fmtN(l.n)}</span>{total > 0 && <span className="ml-1 text-[11px] text-[#7c868c]">{fmtPct(l.n / total)}</span>}</>,
      }))} />
    </Card>
  );
}

export function resumoTotais(t: Ga4Totais) {
  return `${fmtN(t.sessoes)} sessões · ${fmtN(t.contatos)} contatos · ${fmtPct(t.taxaContato)}`;
}

// ───────────────────────────── painel ─────────────────────────────

/**
 * Devolve os cards de topo da seção "Landing page" — sem moldura externa.
 * Quem chama coloca direto no fluxo da página (flex-col gap-4).
 */
export function Ga4LandingPanel({ dados, loading, aviso }: { dados: Ga4Consolidado | null; loading: boolean; aviso?: string }) {
  if (loading) return <Card><p className="text-xs text-[#9aa4aa]">Carregando Google Analytics…</p></Card>;
  if (!dados) return <Card><p className="text-xs text-[#9aa4aa]">{aviso ?? 'Sem propriedade GA4 vinculada a este cliente.'}</p></Card>;
  const { atual: a, anterior: b, pago, audiencia: au, comportamento: co } = dados;
  const semCusto = pago.googleAds.length > 0 && pago.googleAds.every(g => !g.custo);
  // Tem pesquisa paga mas nenhuma linha do Google Ads = propriedade sem vínculo com o Ads
  const semVinculoAds = pago.googleAds.length === 0 && pago.canais.some(c => c.valor === 'Paid Search' || c.valor === 'Cross-network');

  const serieSessoes = dados.diario.map(d => d.sessoes);
  const serieContatos = dados.diario.map(d => d.contatos);
  const engajA = div(a.engajadas, a.sessoes);
  const engajB = div(b.engajadas, b.sessoes);

  // Canais x origens: os dois dizem "de onde vem". Canais tem engajamento e
  // conversão por linha, então fica ele; origem/mídia só entra se não há canal.
  const canais = pago.canais.map(traduz(CANAIS));
  const origens = [...dados.origens].sort((x, y) => y.contatos - x.contatos || y.sessoes - x.sessoes);
  const origensTemConv = origens.some(o => o.contatos > 0);

  // Blocos de evento sem dado não desenham caixa vazia — viram uma linha no fim.
  const faltando = [
    dados.posicoes.length === 0 && 'onde clicam para falar (parâmetro posicao)',
    co.secoes.length === 0 && 'seções vistas (evento view_secao)',
    co.rolagem.length === 0 && 'rolagem (evento scroll)',
    ...dados.detalhes.filter(d => d.linhas.length === 0).map(d => d.rotulo.toLowerCase()),
  ].filter((x): x is string => Boolean(x));

  // Seção sem dado nenhum não aparece.
  const temPago = pago.googleAds.length + pago.campanhas.length + pago.palavras.length + pago.termos.length > 0 || semVinculoAds;
  const temAudiencia = au.dispositivos.length + au.cidades.length + au.novosRecorrentes.length + au.idades.length + au.generos.length + au.semanaHora.length > 0;
  const temOrigem = canais.length > 0 || origens.length > 0;
  const temEntrada = co.paginasEntrada.length > 0;
  const temForm = co.funil.formInicio + co.funil.leadForm + co.funil.leadConfirmado > 0;
  const temExtras = temForm || dados.posicoes.length > 0 || dados.detalhes.some(d => d.linhas.length > 0) || co.secoes.length > 0 || co.videos.length > 0;
  const temRolagem = co.rolagem.length > 0 && a.usuarios > 0;
  const temComportamento = temOrigem || temEntrada || temRolagem || temExtras;

  const rotuloForm = a.leadForm > 0 ? 'Formulário' : 'Cliques em botões';
  const comp = 'vs período anterior';

  return (
    <>
      {/* KPIs — mesmo IndicadorCard do topo da página */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <IndicadorCard rotulo="Sessões" icone={Globe} valor={fmtN(a.sessoes)} variacao={variacao(a.sessoes, b.sessoes)} comparacao={comp}
          nota={`${fmtN(a.usuarios)} usuários`} serie={serieSessoes} />
        <IndicadorCard rotulo="Taxa de engajamento" icone={Activity} valor={fmtPct(engajA)} variacao={variacao(engajA, engajB, true)} unidade=" p.p." comparacao={comp}
          nota="sessões com +10s, 2+ páginas ou conversão" dica="Sessões engajadas ÷ sessões (GA4)." />
        <IndicadorCard rotulo="Contatos" icone={MessageCircle} valor={fmtN(a.contatos)} variacao={variacao(a.contatos, b.contatos)} comparacao={comp} serie={serieContatos}
          nota="WhatsApp + telefone + formulário"
          dica="Soma dos EVENTOS de clique no WhatsApp, no telefone e de envio de formulário. Uma pessoa pode gerar mais de um. A linha mostra os eventos-chave por dia." />
        <IndicadorCard rotulo="Contatos por sessão" icone={Percent} valor={fmtPct(a.taxaContato)} variacao={variacao(a.taxaContato, b.taxaContato, true)} unidade=" p.p." comparacao={comp}
          nota="eventos de contato ÷ sessões"
          dica="Conta EVENTOS, não pessoas: quem clica no WhatsApp duas vezes conta dois — por isso pode passar de 100%." />
      </div>

      <FaixaIndicadores className="grid-cols-2 sm:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
        <IndicadorMini rotulo="Usuários" valor={fmtN(a.usuarios)} variacao={variacao(a.usuarios, b.usuarios)} />
        <IndicadorMini rotulo="Novos" valor={fmtPct(div(a.novos, a.usuarios), 0)} variacao={variacao(div(a.novos, a.usuarios), div(b.novos, b.usuarios), true)} unidade=" p.p."
          dica={`${fmtN(a.novos)} visitantes na primeira visita`} />
        <IndicadorMini rotulo="Páginas vistas" valor={fmtN(a.pageviews)} variacao={variacao(a.pageviews, b.pageviews)}
          dica={`${div(a.pageviews, a.sessoes).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por sessão`} />
        <IndicadorMini rotulo="Tempo médio" valor={fmtTempo(div(a.tempo, a.sessoes))} variacao={variacao(div(a.tempo, a.sessoes), div(b.tempo, b.sessoes))}
          dica="Tempo de engajamento médio por sessão (userEngagementDuration ÷ sessões)." />
        <IndicadorMini rotulo="WhatsApp" valor={fmtN(a.whatsapp)} variacao={variacao(a.whatsapp, b.whatsapp)} />
        <IndicadorMini rotulo={rotuloForm} valor={fmtN(a.leadForm > 0 ? a.leadForm : a.cta)} variacao={variacao(a.leadForm > 0 ? a.leadForm : a.cta, a.leadForm > 0 ? b.leadForm : b.cta)} />
        <IndicadorMini rotulo="Telefone" valor={fmtN(a.telefone)} variacao={variacao(a.telefone, b.telefone)} />
        {a.video > 0 && <IndicadorMini rotulo="Vídeos" valor={fmtN(a.video)} variacao={variacao(a.video, b.video)} dica="plays de vídeo" />}
      </FaixaIndicadores>

      {dados.propriedades.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {dados.propriedades.map(p => (
            <span key={p.propertyId} className="rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-[#a7b0b6]">
              <span className="font-bold text-[#dce4e8]">{p.nome}</span> · {resumoTotais(p.atual)}
            </span>
          ))}
        </div>
      )}

      {/* Do clique ao contato + evolução diária, lado a lado */}
      <GrupoTitulo titulo="Do clique ao contato" />
      <div className={cx('grid items-stretch gap-4', dados.diario.length > 1 && 'xl:grid-cols-2')}>
        <FunilClique ads={pago.googleAds} atual={a} />
        {dados.diario.length > 1 && (
          <Card>
            <Titulo dica="Sessões e contatos (eventos-chave do GA4) por dia no período. Eixos começam em 0.">Evolução diária</Titulo>
            <EvolucaoDiaria diario={dados.diario} />
          </Card>
        )}
      </div>

      {/* Campanhas na página (antes "Tráfego pago") */}
      {temPago && (
        <>
          <GrupoTitulo titulo="Campanhas na página" sub="o que o GA4 viu de cada campanha e palavra-chave" />
          {semVinculoAds && (
            <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: `${AMBAR}14`, color: AMBAR }}>
              Esta propriedade GA4 não está vinculada ao Google Ads: custo por campanha, palavras-chave e termos pesquisados não aparecem.
              Vincule em GA4 → Administrador → Vinculações de produtos → Google Ads.
            </p>
          )}
          <Campanhas ads={pago.googleAds} utm={pago.campanhas} semCusto={semCusto} />
          <PalavrasChave palavras={pago.palavras} termos={pago.termos} />
        </>
      )}

      {/* Audiência */}
      {temAudiencia && (
        <>
          <GrupoTitulo titulo="Audiência" />
          {(au.dispositivos.length > 0 || au.novosRecorrentes.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {au.dispositivos.length > 0 && (
                <Card>
                  <Titulo dica="Sessões por aparelho e % das sessões que converteram em cada um.">Dispositivo</Titulo>
                  <Empilhada linhas={au.dispositivos.map(traduz(DISPOSITIVOS))} />
                </Card>
              )}
              {au.novosRecorrentes.length > 0 && (
                <Card>
                  <Titulo dica="Recorrente convertendo mais = remarketing vale a pena.">Novos × recorrentes</Titulo>
                  <Empilhada linhas={au.novosRecorrentes.map(traduz(NOVOS))} />
                </Card>
              )}
            </div>
          )}
          {au.idades.length + au.generos.length + au.cidades.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {au.idades.length > 0 && (
                <Card><Titulo>Idade</Titulo><ListaBarras itens={barrasSeg(au.idades)} limite={8} /></Card>
              )}
              {au.generos.length > 0 && (
                <Card><Titulo>Gênero</Titulo><Empilhada linhas={au.generos.map(traduz(GENEROS))} /></Card>
              )}
              {au.cidades.length > 0 && (
                <Card><Titulo dica="Cidades com mais sessões.">Cidades</Titulo><ListaBarras itens={barrasSeg(au.cidades)} /></Card>
              )}
            </div>
          )}
          {au.idades.length + au.generos.length === 0 && (
            <p className="text-[11px] text-[#7c868c]">Idade e gênero não aparecem: o GA4 esconde com pouco volume ou sem Google Signals ligado.</p>
          )}
          <MapaSemanaHora celulas={au.semanaHora} />
        </>
      )}

      {/* Comportamento: origem | entrada lado a lado, rolagem em faixa, demais em grade */}
      {temComportamento && (
        <>
          <GrupoTitulo titulo="Comportamento" />
          {(temOrigem || temEntrada) && (
            <div className={cx('grid gap-4', temOrigem && temEntrada && 'md:grid-cols-2')}>
              {canais.length > 0 ? (
                <Card>
                  <Titulo dica="Engajamento mostra se o clique é de gente interessada; converteu = % das sessões com contato.">Qualidade por canal</Titulo>
                  <ListaBarras itens={barrasSeg(canais, { engaj: true })} />
                </Card>
              ) : origens.length > 0 && (
                <Card>
                  <Titulo dica={origensTemConv ? 'Conversões (eventos-chave do GA4) por origem / mídia.' : 'Sessões por origem / mídia.'}>
                    {origensTemConv ? 'De onde vêm as conversões' : 'De onde vêm as sessões'}
                  </Titulo>
                  <ListaBarras itens={origens.map(o => ({
                    chave: `${o.origem}/${o.midia}`, rotulo: o.origem, sub: o.midia,
                    valor: origensTemConv ? o.contatos : o.sessoes,
                    direita: origensTemConv
                      ? <><span className="font-bold text-[#f4f7f8]">{fmtN(o.contatos)}</span><span className="ml-1 text-[11px] text-[#7c868c]">conv.</span></>
                      : <><span className="font-bold text-[#f4f7f8]">{fmtN(o.sessoes)}</span><span className="ml-1 text-[11px] text-[#7c868c]">sessões</span></>,
                    extra: origensTemConv ? <>{fmtN(o.sessoes)} sessões</> : undefined,
                  }))} />
                </Card>
              )}
              {temEntrada && (
                <Card>
                  <Titulo dica="Páginas por onde mais gente entrou.">Página de entrada</Titulo>
                  <ListaBarras itens={barrasSeg(co.paginasEntrada, { engaj: true })} />
                </Card>
              )}
            </div>
          )}
          <Rolagem linhas={co.rolagem} visitantes={a.usuarios} />
          {temExtras && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <FunilForm f={co.funil} />
              <BlocoContagem titulo="Onde clicam para falar" linhas={dados.posicoes} total={a.contatos} />
              {dados.detalhes.map(d => (
                <BlocoContagem key={d.param} titulo={d.rotulo} linhas={d.linhas} total={d.param === 'cta_id' ? a.cta : a.whatsapp} />
              ))}
              <BlocoContagem titulo="Seções vistas" dica="% dos visitantes que viram cada seção." linhas={co.secoes} total={a.usuarios} />
              <BlocoContagem titulo="Vídeos assistidos" linhas={co.videos} total={a.video} />
            </div>
          )}
        </>
      )}

      {faltando.length > 0 && (
        <p className="text-[11px] text-[#7c868c]">
          Sem eventos configurados (ou sem disparo no período): {faltando.join(' · ')}.
        </p>
      )}
    </>
  );
}
