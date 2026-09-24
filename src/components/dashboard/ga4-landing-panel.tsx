"use client";

// Bloco "Landing page" do dashboard: o que o GA4 das LPs conta (ver
// src/lib/ga4-landing.ts). Só apresentação — dados chegam prontos da rota
// /api/clients/[id]/ga4, já consolidados quando o cliente tem mais de uma LP.
//
// Uma rolagem só, de cima para baixo (nada escondido em abas — pedido do
// Matheus), organizada como painel de analytics e NÃO como planilha:
//   1. (sem rótulo) 4 KPIs + 7 mini-cards — layout do mock do Matheus (2026-09-24)
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

import { useMemo, useState, type ElementType, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, BarChart3, ChevronDown, ChevronRight, ChevronsUpDown, Clock, FileText, Info, MessageCircle, MessageSquare,
  MousePointerClick, Percent, Phone, Search, UserPlus, Users, Activity, Ban, Smartphone, MapPin, User,
} from 'lucide-react';
import type { Ga4Celula, Ga4Consolidado, Ga4Linha, Ga4Seg, Ga4Totais } from '@/lib/ga4-landing';
import { EvolucaoDiaria, type Granularidade } from './ga4-landing-graficos';
import { Donut } from './donut';
import { SUPERFICIE, CabecalhoCard, GrupoTitulo, useVerMais } from './superficie';
import { Sparkline } from './indicador-card';
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
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <Donut
        tamanho={148}
        espessura={26}
        fatias={fatias.map((s, i) => ({ label: s.valor, valor: s.sessoes, cor: cor(i) }))}
        centroTitulo="sessões"
        centroValor={fmtN(total)}
        formatar={(n) => `${fmtN(n)} sessões`}
      />
      <div className="grid w-full min-w-0 gap-3">
        {fatias.map((s, i) => (
          <div key={s.valor} className="flex min-w-0 items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: cor(i) }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#f4f7f8]">{s.valor}</p>
              <p className="mt-0.5 text-[11px] text-[#a7b0b6]">{fmtN(s.sessoes)} sessões · converte <b className="text-[#dce4e8]">{fmtPct(div(s.sessoesConv, s.sessoes))}</b></p>
            </div>
            <span className="shrink-0 font-heading text-[22px] leading-none text-[#f4f7f8] tabular-nums">{fmtPct(s.sessoes / total, 0)}</span>
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

/** Palavras-chave (mock): as que trouxeram contato x as que só gastam (candidatas a negativar), em listas ranqueadas; termos pesquisados recolhidos. */
function PalavrasChave({ palavras, termos }: { palavras: Ga4Seg[]; termos: Ga4Seg[] }) {
  const [abrirTermos, setAbrirTermos] = useState(false);
  const cont = contador(palavras);
  const boas = palavras.filter(s => cont(s) > 0).sort((a, b) => cont(b) - cont(a) || b.sessoes - a.sessoes);
  const ruins = palavras.filter(s => cont(s) === 0 && s.sessoes >= 10).sort((a, b) => b.sessoes - a.sessoes);
  const sessoesRuins = ruins.reduce((t, s) => t + s.sessoes, 0);
  const contT = contador(termos);
  const termosOrd = [...termos].sort((a, b) => contT(b) - contT(a) || b.sessoes - a.sessoes);
  if (boas.length + ruins.length + termos.length === 0) return null;

  const detalhe = (s: Ga4Seg) => (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      <span>sessões <b className="text-[#f4f7f8]">{fmtN(s.sessoes)}</b></span>
      <span>engajamento <b className="text-[#f4f7f8]">{fmtPct(div(s.engajadas, s.sessoes))}</b></span>
      <span>tempo médio <b className="text-[#f4f7f8]">{fmtTempo(div(s.tempo, s.sessoes))}</b></span>
      <span>WhatsApp <b className="text-[#f4f7f8]">{fmtN(s.whatsapp)}</b></span>
      <span>formulário <b className="text-[#f4f7f8]">{fmtN(s.formulario)}</b></span>
      <span>telefone <b className="text-[#f4f7f8]">{fmtN(s.telefone)}</b></span>
    </span>
  );

  return (
    <>
      {boas.length + ruins.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CabecalhoIcone
              icone={Search} redondo
              titulo="Palavras que trouxeram contato"
              sub="Palavras-chave com mais contatos. Taxa = contatos ÷ sessões."
              direita={boas.length > 0 ? <SeloContagem n={boas.length} cor={VERDE} texto="palavras geraram contato neste período" /> : undefined}
            />
            {boas.length > 0 ? (
              <ListaRanking itens={boas.map(s => ({
                chave: s.valor, rotulo: s.valor, valor: cont(s), numero: fmtN(cont(s)), unidade: cont(s) === 1 ? 'contato' : 'contatos',
                sub: <>{fmtN(s.sessoes)} sessões · taxa <b className="text-[#dce4e8]">{fmtPct(div(cont(s), s.sessoes))}</b></>,
                detalhe: detalhe(s),
              }))} />
            ) : <p className="text-xs text-[#7c868c]">Nenhuma palavra-chave trouxe contato no período.</p>}
          </Card>
          <Card>
            <CabecalhoIcone
              icone={Ban} cor={VERMELHO} redondo
              titulo="Palavras que gastam sem contato"
              sub="10+ sessões pagas e zero contato — revisar, pausar ou negativar."
              direita={ruins.length > 0 ? <SeloContagem n={sessoesRuins} cor={VERMELHO} texto="sessões sem contato" /> : undefined}
            />
            {ruins.length > 0 ? (
              <ListaRanking cor={VERMELHO} itens={ruins.map(s => ({
                chave: s.valor, rotulo: s.valor, valor: s.sessoes, numero: fmtN(s.sessoes), unidade: 'sessões',
                sub: <>engajamento {fmtPct(div(s.engajadas, s.sessoes))} · tempo médio {fmtTempo(div(s.tempo, s.sessoes))}</>,
                detalhe: detalhe(s),
              }))} />
            ) : <p className="text-xs text-[#7c868c]">Nenhuma palavra com 10+ sessões sem contato.</p>}
          </Card>
        </div>
      )}
      {termosOrd.length > 0 && (
        <section className={SUPERFICIE}>
          <div className="px-5 py-4">
            <CabecalhoIcone
              className="mb-0"
              icone={FileText}
              titulo={<>Termos pesquisados <span className={cx('ml-1 normal-case tracking-normal', T.cardSub)}>({fmtN(termosOrd.length)})</span></>}
              sub="Veja todos os termos que seus visitantes pesquisaram no site."
              direita={(
                <button
                  type="button"
                  onClick={() => setAbrirTermos(v => !v)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-4 text-xs font-semibold text-[#dce4e8] transition-colors hover:bg-white/[0.06]"
                >
                  {abrirTermos ? 'Recolher' : 'Ver termos'}
                  <ChevronDown className={cx('h-4 w-4 transition-transform', abrirTermos && 'rotate-180')} />
                </button>
              )}
            />
          </div>
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


// ───────────────────── layout do mock (2026-09-24) ─────────────────────
// Reprodução do mockup do Matheus para a seção Landing page: 4 KPIs com ícone
// à esquerda do rótulo, faixa de 7 mini-cards, funil do anúncio em SETAS
// (chevrons), evolução com seletor Diário/Semanal e a tabela "Desempenho por
// campanha / página". Só apresentação — mesmos dados de antes.

/** Ícone numa caixa verde à esquerda do rótulo (mock). */
function CaixaIcone({ icone: Icon, grande = false, cor = VERDE, redondo = false, tam }: {
  icone: ElementType; grande?: boolean; cor?: string; redondo?: boolean; /** lado em px (padrão 32; `grande` = 36) */ tam?: number;
}) {
  const lado = tam ?? (grande ? 36 : 32);
  const icone = Math.round(lado * 0.5);
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center', redondo ? 'rounded-full' : 'rounded-lg')}
      style={{ width: lado, height: lado, background: `${cor}22`, color: cor, boxShadow: `inset 0 0 0 1px ${cor}33` }}
    >
      <Icon style={{ width: icone, height: icone }} />
    </span>
  );
}

/** Cabeçalho de card do mock: caixa de ícone + título/sub + slot à direita (selo, botão). */
function CabecalhoIcone({ icone, cor = VERDE, redondo = false, titulo, sub, direita, className }: {
  icone: ElementType; cor?: string; redondo?: boolean; titulo: ReactNode; sub?: ReactNode; direita?: ReactNode; className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-3 md:flex-nowrap', className ?? 'mb-4')}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <CaixaIcone icone={icone} cor={cor} redondo={redondo} tam={44} />
        <div className="min-w-0">
          <h4 className={T.cardTitulo}>{titulo}</h4>
          {sub && <p className={cx('mt-0.5', T.cardSub)}>{sub}</p>}
        </div>
      </div>
      {direita && <div className="flex shrink-0 items-center gap-2">{direita}</div>}
    </div>
  );
}

/** Selo de contagem do mock: número grande colorido + explicação em duas linhas. */
function SeloContagem({ n, cor, texto }: { n: number; cor: string; texto: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="inline-flex h-10 min-w-10 items-center justify-center rounded-lg px-2 font-heading text-[22px] leading-none tabular-nums"
        style={{ background: `${cor}1f`, color: cor, boxShadow: `inset 0 0 0 1px ${cor}33` }}
      >
        {fmtN(n)}
      </span>
      <span className="max-w-[150px] text-[11px] leading-snug text-[#a7b0b6]">{texto}</span>
    </div>
  );
}

function BarraFina({ pct, cor }: { pct: number; cor: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-white/[0.06]">
      <div className="h-2 rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct * 100))}%`, background: cor }} />
    </div>
  );
}

type ItemRanking = {
  chave: string; rotulo: string; sub?: ReactNode; valor: number; numero: string; unidade: string;
  /** conteúdo que abre ao clicar na linha (o chevron do mock precisa de um destino) */
  detalhe?: ReactNode;
};

/**
 * Lista ranqueada do mock: caixa com a posição, rótulo + sub, barra proporcional ao
 * maior, número + unidade e chevron. `barraEmbaixo` (Cidades): número na linha do
 * rótulo, barra e sub embaixo. Mostra `limite` itens e "Ver mais (N)".
 */
function ListaRanking({ itens, cor = VERDE, limite = 5, barraEmbaixo = false }: {
  itens: ItemRanking[]; cor?: string; limite?: number; barraEmbaixo?: boolean;
}) {
  const { visiveis, botao } = useVerMais(itens, limite);
  const [aberto, setAberto] = useState<string | null>(null);
  if (itens.length === 0) return null;
  const max = Math.max(1, ...itens.map(i => i.valor));
  return (
    <>
      <ul className="space-y-2">
        {visiveis.map((i, idx) => {
          const abriu = aberto === i.chave;
          const clicavel = !!i.detalhe;
          const Tag = clicavel ? 'button' : 'div';
          return (
            <li key={i.chave} className={cx('rounded-xl border bg-white/[0.02] transition-colors', abriu ? 'border-white/[0.14] bg-white/[0.05]' : 'border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04]')}>
              <Tag
                type={clicavel ? 'button' : undefined}
                onClick={clicavel ? () => setAberto(v => (v === i.chave ? null : i.chave)) : undefined}
                className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left', clicavel && 'cursor-pointer')}
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-[#0b1114] text-sm font-bold text-[#f4f7f8] tabular-nums">{idx + 1}</span>
                {barraEmbaixo ? (
                  <span className="block min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-[#f4f7f8]" title={i.rotulo}>{i.rotulo}</span>
                      <span className="shrink-0 whitespace-nowrap"><b className="text-sm font-bold text-[#f4f7f8] tabular-nums">{i.numero}</b> <span className="text-xs text-[#a7b0b6]">{i.unidade}</span></span>
                    </span>
                    <span className="mt-1.5 block"><BarraFina pct={i.valor / max} cor={cor} /></span>
                    {i.sub && <span className="mt-1 block text-[11px] text-[#a7b0b6]">{i.sub}</span>}
                  </span>
                ) : (
                  <>
                    <span className="block min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#f4f7f8]" title={i.rotulo}>{i.rotulo}</span>
                      {i.sub && <span className="mt-0.5 block text-[11px] leading-snug text-[#a7b0b6]">{i.sub}</span>}
                    </span>
                    <span className="hidden w-[24%] shrink-0 sm:block"><BarraFina pct={i.valor / max} cor={cor} /></span>
                    <span className="min-w-[84px] shrink-0 whitespace-nowrap text-right"><b className="text-sm font-bold text-[#f4f7f8] tabular-nums">{i.numero}</b> <span className="text-xs text-[#a7b0b6]">{i.unidade}</span></span>
                    <ChevronRight className={cx('h-4 w-4 shrink-0 transition-transform', clicavel ? 'text-[#a7b0b6]' : 'text-[#4a5459]', abriu && 'rotate-90')} />
                  </>
                )}
              </Tag>
              {abriu && i.detalhe && <div className="border-t border-white/[0.06] px-3 py-2.5 text-[11px] text-[#c7d0d5]">{i.detalhe}</div>}
            </li>
          );
        })}
      </ul>
      {botao}
    </>
  );
}

/** Variação com seta (mock): verde sobe, vermelho desce, cinza sem base. */
function Delta({ v, unidade = '%', inverso = false }: { v: number | null; unidade?: '%' | ' p.p.'; inverso?: boolean }) {
  if (v === null || !Number.isFinite(v)) return <span className="text-xs text-[#7c868c]">—</span>;
  const arred = Math.round(v * 10) / 10;
  const bom = inverso ? arred <= 0 : arred >= 0;
  const cor = arred === 0 ? '#a7b0b6' : bom ? VERDE : VERMELHO;
  const Seta = arred < 0 ? ArrowDown : ArrowUp;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums" style={{ color: cor }}>
      {arred !== 0 && <Seta className="h-3 w-3" />}
      {arred > 0 ? '+' : ''}{arred.toFixed(1).replace('.', ',')}{unidade}
    </span>
  );
}

function KpiLp({ rotulo, icone, valor, variacao: v, unidade, dica, serie }: {
  rotulo: string; icone: ElementType; valor: string; variacao: number | null; unidade?: '%' | ' p.p.'; dica?: string; serie?: number[];
}) {
  return (
    <div className={cx(SUPERFICIE, 'flex flex-col p-5')}>
      <div className="flex items-center gap-3">
        <CaixaIcone icone={icone} grande />
        <span className="text-sm font-semibold text-[#e6ecef]">{rotulo}</span>
        {dica && <span title={dica}><Info className="h-3.5 w-3.5 text-[#7c868c]" /></span>}
      </div>
      <p className="mt-3 font-heading text-[40px] leading-none text-[#f4f7f8] tabular-nums">{valor}</p>
      <p className="mt-2 flex items-center gap-2">
        <Delta v={v} unidade={unidade} />
        <span className="text-xs text-[#a7b0b6]">vs. período anterior</span>
      </p>
      {serie && serie.length > 1 && (
        <div className="mt-3">
          <Sparkline valores={serie} cor={VERDE} altura={40} />
        </div>
      )}
    </div>
  );
}

function MiniLp({ rotulo, icone, valor, variacao: v, unidade, dica }: {
  rotulo: string; icone: ElementType; valor: string; variacao: number | null; unidade?: '%' | ' p.p.'; dica?: string;
}) {
  return (
    <div className={cx(SUPERFICIE, 'flex items-center gap-2.5 px-3 py-3')} title={dica}>
      <CaixaIcone icone={icone} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] leading-tight text-[#a7b0b6]">{rotulo}</p>
        <p className="mt-1 font-heading text-[22px] leading-none text-[#f4f7f8] tabular-nums">{valor}</p>
        <p className="mt-1 leading-none"><Delta v={v} unidade={unidade} /></p>
      </div>
    </div>
  );
}

/** Funil do anúncio em SETAS (chevrons), como no mock: ícone, rótulo, número; % embaixo. */
function FunilSetas({ ads, atual }: { ads: Ga4Seg[]; atual: Ga4Totais }) {
  const [detalhes, setDetalhes] = useState(false);
  const cont = contador(ads);
  const cliques = ads.reduce((t, g) => t + (g.cliques ?? 0), 0);
  const comAds = ads.length > 0 && cliques > 0;
  const etapas: Array<{ rotulo: string; icone: ElementType; n: number; sub: string }> = comAds
    ? [
      { rotulo: 'Cliques no anúncio', icone: MousePointerClick, n: cliques, sub: 'cliques Google Ads' },
      { rotulo: 'Sessões na página', icone: FileText, n: ads.reduce((t, g) => t + g.sessoes, 0), sub: 'chegaram na página' },
      { rotulo: 'Sessões engajadas', icone: Users, n: ads.reduce((t, g) => t + g.engajadas, 0), sub: '+10s, 2+ páginas ou conversão' },
      { rotulo: 'Contatos', icone: MessageSquare, n: ads.reduce((t, g) => t + cont(g), 0), sub: 'WhatsApp + formulário + telefone' },
    ]
    : [
      { rotulo: 'Sessões', icone: FileText, n: atual.sessoes, sub: 'todas as origens' },
      { rotulo: 'Sessões engajadas', icone: Users, n: atual.engajadas, sub: '+10s, 2+ páginas ou conversão' },
      { rotulo: 'Contatos', icone: MessageSquare, n: atual.contatos, sub: 'WhatsApp + formulário + telefone' },
    ];
  if (etapas[0].n <= 0) return null;
  const connect = comAds ? div(etapas[1].n, cliques) : 0;
  const st = statusConnect(connect);
  const topo = etapas[0].n;
  // % embaixo de cada seta: da etapa anterior (1ª = conversão do topo até o fim).
  const pctDe = (i: number) => (i === 0 ? div(etapas[etapas.length - 1].n, topo) : div(etapas[i].n, etapas[i - 1].n));
  const rotuloPct = (i: number) => (i === 0 ? `do topo até o contato` : i === 1 && comAds ? 'dos cliques (connect rate)' : `da etapa anterior`);
  const opacidades = [0.62, 0.48, 0.36, 0.26];

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CaixaIcone icone={BarChart3} grande />
          <div>
            <h4 className="text-[15px] font-bold text-[#f4f7f8]">{comAds ? 'Funil do anúncio (Google Ads)' : 'Funil da página'}</h4>
            <p className="mt-0.5 text-xs text-[#a7b0b6]">Veja quantas pessoas avançam de cada etapa, do clique no anúncio até o contato.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDetalhes(v => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-[#dce4e8] transition-colors hover:bg-white/[0.06]"
        >
          {detalhes ? 'Ocultar detalhes' : 'Ver detalhes'} <ChevronRight className={cx('h-3.5 w-3.5 transition-transform', detalhes && 'rotate-90')} />
        </button>
      </div>

      <div className="grid gap-0" style={{ gridTemplateColumns: `repeat(${etapas.length}, minmax(0, 1fr))` }}>
        {etapas.map((e, i) => {
          const primeira = i === 0;
          const clip = primeira
            ? 'polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%)'
            : 'polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%, 18px 50%)';
          const Icone = e.icone;
          return (
            <div key={e.rotulo} className={cx('min-w-0', !primeira && '-ml-3')}>
              <div
                className="relative flex min-h-[112px] flex-col justify-center pr-7 text-[#f4f7f8]"
                style={{ clipPath: clip, background: `linear-gradient(90deg, rgba(108,255,47,${opacidades[i] ?? 0.2}), rgba(108,255,47,${(opacidades[i] ?? 0.2) * 0.7}))`, paddingLeft: primeira ? 18 : 30 }}
                title={e.sub}
              >
                <Icone className="h-5 w-5 text-white/90" />
                <p className="mt-1.5 text-[12px] font-semibold leading-tight text-white/95">{e.rotulo}</p>
                <p className="font-heading text-[30px] leading-none tabular-nums" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>{fmtN(e.n)}</p>
              </div>
              <div className="mt-3" style={{ paddingLeft: primeira ? 18 : 30 }}>
                <p className="text-base font-bold tabular-nums" style={{ color: VERDE }}>{fmtPct(pctDe(i))}</p>
                <p className="text-[11px] text-[#a7b0b6]">{rotuloPct(i)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {detalhes && (
        <div className="mt-4 space-y-2 rounded-[10px] bg-white/[0.02] px-4 py-3 text-xs text-[#c7d0d5]">
          {comAds && (
            <p>
              <span className={T.miniRotulo}>Connect rate</span>{' '}
              <b className="tabular-nums text-[#f4f7f8]">{fmtPct(connect, 0)}</b>{' '}
              <Chip cor={st.cor}>{st.rotulo}</Chip>
              <span className="ml-2">De cada 100 cliques, <b className="text-[#f4f7f8]">{fmtN(Math.round(connect * 100))}</b> chegaram na página. Abaixo de 80% costuma ser página lenta, redirecionamento ou tag do GA4 fora do ar.</span>
            </p>
          )}
          <ul className="grid gap-1 sm:grid-cols-2">
            {etapas.map(e => <li key={e.rotulo}><b className="text-[#f4f7f8]">{e.rotulo}</b> — {e.sub}</li>)}
          </ul>
          {comAds && <p className="text-[11px] text-[#7c868c]">Cliques vêm do Google Ads; sessões, engajamento e contatos vêm do GA4.</p>}
        </div>
      )}
    </Card>
  );
}

type LinhaPagina = {
  chave: string; nome: string; sub?: string;
  sessoes: number; sessoesPrev: number | null;
  contatos: number; contatosPrev: number | null;
  tempo: number | null; cliques: number | null;
  whatsapp: number; whatsappPrev: number | null;
  telefone: number;
};
type ColunaPagina = 'sessoes' | 'contatos' | 'taxa' | 'tempo' | 'cliques' | 'whatsapp' | 'telefone';

type OrdemPagina = { col: ColunaPagina; desc: boolean };

/** Cabeçalho ordenável da tabela de páginas (módulo, não dentro do render — regra do compiler). */
function CabPagina({ col, children, className, ordem, onOrdenar }: {
  col: ColunaPagina; children: ReactNode; className?: string; ordem: OrdemPagina; onOrdenar: (col: ColunaPagina) => void;
}) {
  const ativa = ordem.col === col;
  return (
    <th className={cx('py-2.5 pr-3 text-right font-semibold', className)}>
      <button type="button" onClick={() => onOrdenar(col)}
        className={cx('inline-flex items-center gap-1 whitespace-nowrap hover:text-[#dce4e8]', ativa && 'text-[#f4f7f8]')}>
        {children}
        {ativa ? (ordem.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-50" />}
      </button>
    </th>
  );
}

/** Célula numérica com a variação ao lado (quando há período anterior). */
function NumPagina({ v, prev, pp = false, forte = false }: { v: number; prev?: number | null; pp?: boolean; forte?: boolean }) {
  return (
    <td className="whitespace-nowrap py-3 pr-3 text-right">
      <span className={cx('tabular-nums', forte ? 'text-sm font-bold text-[#f4f7f8]' : 'text-sm font-semibold text-[#e6ecef]')}>{pp ? fmtPct(v) : fmtN(v)}</span>
      {prev !== undefined && prev !== null && (
        <span className="ml-2 inline-block"><Delta v={variacao(v, prev, pp)} unidade={pp ? ' p.p.' : '%'} /></span>
      )}
    </td>
  );
}

/** "Desempenho por campanha / página" (mock): uma linha por LP (propriedade GA4) ou, com uma propriedade só, por página de entrada. */
function DesempenhoPaginas({ linhas }: { linhas: LinhaPagina[] }) {
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<OrdemPagina>({ col: 'sessoes', desc: true });
  const ordenar = (col: ColunaPagina) => setOrdem(o => ({ col, desc: o.col === col ? !o.desc : true }));
  const valorDe = (l: LinhaPagina, c: ColunaPagina): number => {
    switch (c) {
      case 'sessoes': return l.sessoes;
      case 'contatos': return l.contatos;
      case 'taxa': return div(l.contatos, l.sessoes);
      case 'tempo': return l.tempo ?? 0;
      case 'cliques': return l.cliques ?? 0;
      case 'whatsapp': return l.whatsapp;
      case 'telefone': return l.telefone;
    }
  };
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = q ? linhas.filter(l => `${l.nome} ${l.sub ?? ''}`.toLowerCase().includes(q)) : linhas;
    return [...base].sort((a, b) => (ordem.desc ? valorDe(b, ordem.col) - valorDe(a, ordem.col) : valorDe(a, ordem.col) - valorDe(b, ordem.col)));
  }, [linhas, busca, ordem]);
  if (linhas.length === 0) return null;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CaixaIcone icone={BarChart3} grande />
          <div>
            <h4 className="text-[15px] font-bold text-[#f4f7f8]">Desempenho por campanha / página</h4>
            <p className="mt-0.5 text-xs text-[#a7b0b6]">Compare o desempenho das suas campanhas e páginas de destino.</p>
          </div>
        </div>
        <label className="relative block w-full max-w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7c868c]" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar campanha ou página…"
            className="h-9 w-full rounded-lg border border-white/[0.1] bg-white/[0.03] pl-9 pr-3 text-xs text-[#f4f7f8] placeholder:text-[#7c868c] focus:border-[#6cff2f]/50 focus:outline-none"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-left">
          <thead className="border-b border-white/[0.08] text-[11px] text-[#a7b0b6]">
            <tr>
              <th className="py-2.5 pr-3 font-semibold">Campanha / Página</th>
              <CabPagina col="sessoes" ordem={ordem} onOrdenar={ordenar}>Sessões</CabPagina>
              <CabPagina col="contatos" ordem={ordem} onOrdenar={ordenar}>Contatos</CabPagina>
              <CabPagina col="taxa" ordem={ordem} onOrdenar={ordenar}>Taxa de conversão</CabPagina>
              <CabPagina col="tempo" ordem={ordem} onOrdenar={ordenar}>Tempo médio</CabPagina>
              <CabPagina col="cliques" ordem={ordem} onOrdenar={ordenar}>Cliques em botões</CabPagina>
              <CabPagina col="whatsapp" ordem={ordem} onOrdenar={ordenar}>WhatsApp</CabPagina>
              <CabPagina col="telefone" ordem={ordem} onOrdenar={ordenar}>Telefone</CabPagina>
              <th className="py-2.5 pr-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {filtradas.map(l => {
              const ativa = l.sessoes > 0;
              return (
                <tr key={l.chave} className="hover:bg-white/[0.02]">
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[11px] font-black uppercase text-[#dce4e8] ring-1 ring-white/[0.08]">
                        {l.nome.replace(/^.*?-\s*/, '').slice(0, 2)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#f4f7f8]" title={l.nome}>{l.nome}</p>
                        {l.sub && <p className="truncate text-[11px] text-[#7c868c]">{l.sub}</p>}
                      </div>
                    </div>
                  </td>
                  <NumPagina v={l.sessoes} prev={l.sessoesPrev} forte />
                  <NumPagina v={l.contatos} prev={l.contatosPrev} forte />
                  <NumPagina v={div(l.contatos, l.sessoes)} prev={l.sessoesPrev !== null && l.contatosPrev !== null ? div(l.contatosPrev, l.sessoesPrev) : undefined} pp />
                  <td className="whitespace-nowrap py-3 pr-3 text-right text-sm text-[#e6ecef] tabular-nums">{l.tempo !== null && l.sessoes > 0 ? fmtTempo(l.tempo) : '—'}</td>
                  <td className="whitespace-nowrap py-3 pr-3 text-right text-sm text-[#e6ecef] tabular-nums">{l.cliques !== null ? fmtN(l.cliques) : '—'}</td>
                  <NumPagina v={l.whatsapp} prev={l.whatsappPrev} />
                  <td className="whitespace-nowrap py-3 pr-3 text-right text-sm text-[#e6ecef] tabular-nums">{fmtN(l.telefone)}</td>
                  <td className="py-3 pr-3">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold"
                      style={ativa ? { background: `${VERDE}1f`, color: VERDE } : { background: 'rgba(255,255,255,0.06)', color: '#a7b0b6' }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ativa ? VERDE : '#7c868c' }} />
                      {ativa ? 'Ativa' : 'Sem tráfego'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtradas.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-xs text-[#7c868c]">Nada encontrado para &ldquo;{busca}&rdquo;.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
export type PeriodoLp = { de: string; ate: string; compDe?: string; compAte?: string };

export function Ga4LandingPanel({ dados, loading, aviso }: { dados: Ga4Consolidado | null; loading: boolean; aviso?: string }) {
  const [granularidade, setGranularidade] = useState<Granularidade>('dia');
  if (loading) return <Card><p className="text-xs text-[#9aa4aa]">Carregando Google Analytics…</p></Card>;
  if (!dados) return <Card><p className="text-xs text-[#9aa4aa]">{aviso ?? 'Sem propriedade GA4 vinculada a este cliente.'}</p></Card>;
  const { atual: a, anterior: b, pago, audiencia: au, comportamento: co } = dados;
  const semCusto = pago.googleAds.length > 0 && pago.googleAds.every(g => !g.custo);
  // Tem pesquisa paga mas nenhuma linha do Google Ads = propriedade sem vínculo com o Ads
  const semVinculoAds = pago.googleAds.length === 0 && pago.canais.some(c => c.valor === 'Paid Search' || c.valor === 'Cross-network');

  const serieSessoes = dados.diario.map(d => d.sessoes);
  const serieContatos = dados.diario.map(d => d.contatos);
  const serieEngaj = dados.diario.map(d => div(d.engajadas ?? 0, d.sessoes));
  const serieTaxa = dados.diario.map(d => div(d.contatos, d.sessoes));
  const engajA = div(a.engajadas, a.sessoes);
  const engajB = div(b.engajadas, b.sessoes);

  // Tabela do mock: com mais de uma propriedade, uma linha por LP (com o
  // período anterior para as variações); com uma só, uma linha por página de
  // entrada (o GA4 não dá o anterior por página — as variações ficam "—").
  const linhasPaginas: LinhaPagina[] = dados.propriedades.length > 1
    ? dados.propriedades.map(p => ({
      chave: p.propertyId, nome: p.nome,
      // `anterior` por propriedade nasceu em 2026-09-24 — resposta em cache/JSON antigo não tem.
      sessoes: p.atual.sessoes, sessoesPrev: p.anterior?.sessoes ?? null,
      contatos: p.atual.contatos, contatosPrev: p.anterior?.contatos ?? null,
      tempo: div(p.atual.tempo, p.atual.sessoes), cliques: p.atual.cta,
      whatsapp: p.atual.whatsapp, whatsappPrev: p.anterior?.whatsapp ?? null,
      telefone: p.atual.telefone,
    }))
    : co.paginasEntrada.map(pg => ({
      chave: pg.valor, nome: pg.valor.replace(/^https?:\/\/[^/]+/, '') || '/', sub: pg.sub,
      sessoes: pg.sessoes, sessoesPrev: null,
      contatos: contatosSeg(pg), contatosPrev: null,
      tempo: div(pg.tempo, pg.sessoes), cliques: null,
      whatsapp: pg.whatsapp, whatsappPrev: null,
      telefone: pg.telefone,
    }));

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

  return (
    <>
      {/* KPIs (mock): ícone à esquerda do rótulo, número grande, seta + variação, sparkline */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiLp rotulo="Sessões" icone={Users} valor={fmtN(a.sessoes)} variacao={variacao(a.sessoes, b.sessoes)} serie={serieSessoes}
          dica={`${fmtN(a.usuarios)} usuários no período`} />
        <KpiLp rotulo="Taxa de engajamento" icone={Activity} valor={fmtPct(engajA)} variacao={variacao(engajA, engajB, true)} unidade=" p.p." serie={serieEngaj}
          dica="Sessões engajadas ÷ sessões (GA4): +10s, 2+ páginas ou conversão." />
        <KpiLp rotulo="Contatos" icone={MessageCircle} valor={fmtN(a.contatos)} variacao={variacao(a.contatos, b.contatos)} serie={serieContatos}
          dica="Soma dos EVENTOS de clique no WhatsApp, no telefone e de envio de formulário. Uma pessoa pode gerar mais de um. A linha mostra os eventos-chave por dia." />
        <KpiLp rotulo="Conversão por sessão" icone={Percent} valor={fmtPct(a.taxaContato)} variacao={variacao(a.taxaContato, b.taxaContato, true)} unidade=" p.p." serie={serieTaxa}
          dica="Eventos de contato ÷ sessões. Conta EVENTOS, não pessoas: quem clica no WhatsApp duas vezes conta dois — por isso pode passar de 100%." />
      </div>

      {/* Faixa de mini-cards (mock): um card por métrica, ícone à esquerda */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MiniLp rotulo="Usuários" icone={Users} valor={fmtN(a.usuarios)} variacao={variacao(a.usuarios, b.usuarios)} />
        <MiniLp rotulo="Novos usuários" icone={UserPlus} valor={fmtPct(div(a.novos, a.usuarios), 0)} variacao={variacao(div(a.novos, a.usuarios), div(b.novos, b.usuarios), true)} unidade=" p.p."
          dica={`${fmtN(a.novos)} visitantes na primeira visita`} />
        <MiniLp rotulo="Páginas vistas" icone={FileText} valor={fmtN(a.pageviews)} variacao={variacao(a.pageviews, b.pageviews)}
          dica={`${div(a.pageviews, a.sessoes).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por sessão`} />
        <MiniLp rotulo="Tempo médio" icone={Clock} valor={fmtTempo(div(a.tempo, a.sessoes))} variacao={variacao(div(a.tempo, a.sessoes), div(b.tempo, b.sessoes))}
          dica="Tempo de engajamento médio por sessão (userEngagementDuration ÷ sessões)." />
        <MiniLp rotulo="WhatsApp" icone={MessageCircle} valor={fmtN(a.whatsapp)} variacao={variacao(a.whatsapp, b.whatsapp)} />
        <MiniLp rotulo={rotuloForm} icone={MousePointerClick} valor={fmtN(a.leadForm > 0 ? a.leadForm : a.cta)} variacao={variacao(a.leadForm > 0 ? a.leadForm : a.cta, a.leadForm > 0 ? b.leadForm : b.cta)} />
        <MiniLp rotulo="Telefone" icone={Phone} valor={fmtN(a.telefone)} variacao={variacao(a.telefone, b.telefone)} />
      </div>

      {/* Funil em setas + evolução, lado a lado (mock) */}
      <div className={cx('grid items-stretch gap-4', dados.diario.length > 1 && 'xl:grid-cols-[1.12fr_1fr]')}>
        <FunilSetas ads={pago.googleAds} atual={a} />
        {dados.diario.length > 1 && (
          <Card>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <CaixaIcone icone={BarChart3} grande />
                <div>
                  <h4 className="text-[15px] font-bold text-[#f4f7f8]">Evolução {granularidade === 'dia' ? 'diária' : 'semanal'}</h4>
                  <p className="mt-0.5 text-xs text-[#a7b0b6]">Sessões e contatos (eventos-chave do GA4) por {granularidade === 'dia' ? 'dia' : 'semana'} no período. Eixos começam em 0.</p>
                </div>
              </div>
              <label className="relative">
                <select
                  value={granularidade}
                  onChange={e => setGranularidade(e.target.value as Granularidade)}
                  className="h-8 appearance-none rounded-lg border border-white/[0.1] bg-white/[0.03] pl-3 pr-8 text-xs font-semibold text-[#dce4e8] focus:outline-none"
                >
                  <option value="dia">Diário</option>
                  <option value="semana">Semanal</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#a7b0b6]" />
              </label>
            </div>
            <EvolucaoDiaria diario={dados.diario} granularidade={granularidade} />
          </Card>
        )}
      </div>

      {/* Desempenho por campanha / página (mock) */}
      <DesempenhoPaginas linhas={linhasPaginas} />

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
          <CabecalhoIcone className="mb-0 mt-1" icone={Users} titulo="Audiência" sub="Entenda quem visita seu site e como eles se comportam." />
          {(au.dispositivos.length > 0 || au.novosRecorrentes.length > 0 || au.cidades.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {au.dispositivos.length > 0 && (
                <Card>
                  <CabecalhoIcone icone={Smartphone} titulo="Dispositivo" sub="Sessões por aparelho e % das sessões que converteram em cada um." />
                  <Empilhada linhas={au.dispositivos.map(traduz(DISPOSITIVOS))} />
                </Card>
              )}
              {au.novosRecorrentes.length > 0 && (
                <Card>
                  <CabecalhoIcone icone={User} titulo="Novos × recorrentes" sub="Recorrente convertendo mais = remarketing vale a pena." />
                  <Empilhada linhas={au.novosRecorrentes.map(traduz(NOVOS))} />
                </Card>
              )}
              {au.cidades.length > 0 && (
                <Card>
                  <CabecalhoIcone icone={MapPin} titulo="Cidades" sub="Cidades com mais sessões." />
                  <ListaRanking barraEmbaixo limite={3} itens={au.cidades.map(s => {
                    const c = contador(au.cidades)(s);
                    return {
                      chave: `${s.valor}|${s.sub ?? ''}`, rotulo: s.valor || '(sem nome)', valor: s.sessoes, numero: fmtN(s.sessoes), unidade: 'sessões',
                      sub: <>{fmtN(c)} contato(s) · converteu <b className="text-[#dce4e8]">{fmtPct(div(s.sessoesConv, s.sessoes))}</b></>,
                    };
                  })} />
                </Card>
              )}
            </div>
          )}
          {au.idades.length + au.generos.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {au.idades.length > 0 && (
                <Card><CabecalhoIcone icone={Users} titulo="Idade" /><ListaBarras itens={barrasSeg(au.idades)} limite={8} /></Card>
              )}
              {au.generos.length > 0 && (
                <Card><CabecalhoIcone icone={User} titulo="Gênero" /><Empilhada linhas={au.generos.map(traduz(GENEROS))} /></Card>
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
