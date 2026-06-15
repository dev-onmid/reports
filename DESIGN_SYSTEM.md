# ON_Reports — Design System

> Referência completa para geração de UI, componentes e slides de relatório.
> Angular, denso, orientado a dados. Sem sombras, sem orgânico.

---

## 1. Identidade

| Atributo | Valor |
|---|---|
| Produto | ON_Reports (agência Onmid) |
| Estilo | Data-dense · engineering-grade · dark-first |
| Framework | Next.js (App Router) + Tailwind CSS v4 + shadcn/ui |
| Fontes | **Bebas Neue** (headings / KPIs) · **Inter** (body / UI) |
| Modo padrão | Dark (`.dark` no `<html>`) |

---

## 2. Tokens de Cor

### Dark mode (padrão do produto)

| Token CSS | Hex | Tailwind class | Uso |
|---|---|---|---|
| `--background` | `#0e0f14` | `bg-background` | Canvas da página |
| `--card` | `#1a1a1a` | `bg-card` | Superfície de cards |
| `--surface-soft` | `#1a1a1a` | `bg-surface-soft` | Linhas alternadas, sub-nav |
| `--surface-dark` | `#000000` | `bg-surface-dark` | Hero, nav principal |
| `--surface-elevated` | `#242424` | `bg-surface-elevated` | Painéis aninhados no dark |
| `--primary` | `#55f52f` | `bg-primary` / `text-primary` | Verde Onmid — único CTA |
| `--primary-dark` | `#3bc411` | `bg-primary-dark` | Pressed state do primary |
| `--secondary` | `#7b2cff` | `bg-secondary` | Roxo — uso editorial apenas |
| `--destructive` | `#e52020` | `bg-destructive` | Erros, alertas críticos |
| `--foreground` | `#f5f5f5` | `text-foreground` | Texto principal |
| `--muted-foreground` | `#a0aec0` | `text-muted-foreground` | Metadata, labels |
| `--border` | `#2a2d3a` | `border-border` | Hairline padrão |
| `--hairline-strong` | `#5e5e5e` | `border-hairline-strong` | Divisor em seções dark |
| `--ring` | `#55f52f` | — | Focus ring |

### Cores extras usadas em slides/relatórios (constantes TypeScript)

```ts
const PRIMARY = '#55f52f'  // Verde Onmid
const CARD    = '#1a1a1a'
const BG      = '#0e0f14'
const BORDER  = '#2a2d3a'
const FG      = '#f5f5f5'
const MUTED   = '#a0aec0'
const RED     = '#e52020'
const BLUE    = '#0B84FF'  // Meta Ads / dados de campanha
const ORANGE  = '#FF6B35'  // Conversão / combos / 1x compra
```

### Cores de chart (Recharts)

```ts
chart-1: '#55f52f'  // primary — Meta Ads, faturamento
chart-2: '#7b2cff'  // secondary — Google Ads, roxo
chart-3: '#f5f5f5'  // foreground — linha neutra
chart-4: '#2a2d3a'  // border — fundo de barra
chart-5: '#1a1a1a'  // card — fill de área
```

---

## 3. Tipografia

### Regra principal
- **Bebas Neue** (`font-heading`) → grandes números, KPIs, títulos de slide, logo ONMID
- **Inter** (`font-sans`) → todo texto de UI, labels, corpo

### Escala de heading (Bebas Neue)

| Tailwind | Uso |
|---|---|
| `text-6xl font-heading` | Display — nome do cliente na capa |
| `text-5xl font-heading` | H1 — título de seção principal |
| `text-4xl font-heading` | H2 — título de slide (`secTitle`) |
| `text-3xl font-heading` | H3 — KPI value grande |
| `text-2xl font-heading` | H4 — subtítulo de painel |
| `text-xl font-heading` | H5 — valor de compact card |

### Escala de body (Inter)

| Tailwind | Uso |
|---|---|
| `text-xl` | Large — lead text |
| `text-base` | Base — corpo padrão |
| `text-sm` | Small — secundário |
| `text-xs` | Caption — metadados |
| `text-[11px]` | Micro — status, prefixos |
| `text-[10px] font-bold uppercase tracking-widest` | **Label padrão do DS** |

### Label padrão (mais usado)
```html
<p class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">LABEL</p>
```

---

## 4. Geometria

### Radius
Base: `--radius: 0.125rem` (2px) — angular, engineering-grade.

| Variável | Valor | Tailwind |
|---|---|---|
| `--radius-sm` | 1px | `rounded-[var(--radius-sm)]` |
| `--radius` (md) | 2px | `rounded-[var(--radius)]` |
| `--radius-lg` | 3px | `rounded-[var(--radius-lg)]` |
| `--radius-xl` | 4px | `rounded-[var(--radius-xl)]` |
| `--radius-2xl` | 6px | `rounded-[var(--radius-2xl)]` |

> Avatares e status dots usam `rounded-full`. Todo o resto é retangular.

### Padding de cards
- Card padrão: `p-5` (20px)
- Card compacto: `p-4` (16px)
- Gap de grid: `gap-4`

### Sem sombras
Hierarquia via cor de superfície + hairlines 1px. `box-shadow` só em modais com overlay.

---

## 5. Componentes React (shadcn/ui customizados)

### Button
```tsx
// Variants: default | outline | outline-dark | ghost | secondary | destructive | link
// Sizes: lg | default | sm | xs | icon | icon-sm | icon-xs
<Button>Default</Button>
<Button variant="outline"><Download className="h-4 w-4" /> Exportar</Button>
<Button variant="destructive"><Trash2 className="h-4 w-4" /> Excluir</Button>
```

### Badge
```tsx
// Variants: default | tag | secondary | destructive | outline | ghost
<Badge>Meta ADS</Badge>
<Badge variant="secondary">Google ADS</Badge>
<Badge variant="destructive"><TrendingDown className="h-3 w-3" />-8%</Badge>
```

### Input
```tsx
<Input placeholder="Buscar cliente..." />
// Com ícone:
<div className="relative">
  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  <Input placeholder="Buscar..." className="pl-9" />
</div>
```

---

## 6. Padrões de Card

### Anatomy — corner-square motif
Todo card de dados usa:
1. Barra colorida `h-0.5` no topo (`inset-x-0 top-0`)
2. Quadrado `h-3 w-3` no canto superior esquerdo (mesma cor)

```tsx
<div className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card p-5">
  <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: color }} />
  <div className="pointer-events-none absolute top-0 left-0 h-3 w-3" style={{ backgroundColor: color }} />
  {/* conteúdo */}
</div>
```

### MetricCard (simples)
```tsx
<div className="rounded-[var(--radius)] border border-border bg-card p-5">
  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">LABEL</p>
  <p className="mt-3 font-heading text-3xl text-foreground">R$134.535</p>
  <div className="mt-2 flex items-center gap-1 text-xs font-bold text-primary">
    <TrendingUp className="h-3 w-3" />+18,3% vs. mês anterior
  </div>
</div>
```

### KpiCard com sparkline + meta (dashboard)
```tsx
// Props: title, value, delta, positive, color, goalPct?
// Sparkline SVG inline (trend up/down/flat)
// Progress bar de meta no rodapé (verde ≥100%, amarelo ≥50%, vermelho <50%)
```

### CompactCard (menor)
```tsx
<div className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card p-4">
  {/* corner-square motif */}
  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
  <p className="mt-2 font-heading text-xl leading-none text-foreground">{value}</p>
</div>
```

### Superfícies tintadas (destaque)
```html
<!-- Primary tint — ação positiva -->
<div class="rounded-[var(--radius)] border border-primary/30 bg-primary/10 p-5">...</div>

<!-- Secondary tint — editorial roxo -->
<div class="rounded-[var(--radius)] border border-secondary/30 bg-secondary/10 p-5">...</div>

<!-- Destructive tint — erro/queda -->
<div class="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 p-5">...</div>
```

---

## 7. Alertas & Feedback

```html
<!-- Sucesso -->
<div class="flex items-start gap-3 rounded-[var(--radius)] border border-primary/30 bg-primary/10 text-primary p-4">
  <Check class="h-4 w-4 shrink-0 mt-0.5" />
  <div>
    <p class="text-xs font-bold uppercase tracking-wider">Sucesso</p>
    <p class="mt-0.5 text-sm">Mensagem de sucesso.</p>
  </div>
</div>

<!-- Atenção -->
border-yellow-400/30 bg-yellow-400/10 text-yellow-400

<!-- Erro -->
border-destructive/30 bg-destructive/10 text-destructive

<!-- Info (neutro) -->
border-border bg-surface-soft text-muted-foreground
```

---

## 8. Gráficos (Recharts)

### Estilo padrão dos tooltips
```tsx
<Tooltip
  contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2d3a", borderRadius: 2, fontSize: 11 }}
  labelStyle={{ color: "#a0aec0" }}
  itemStyle={{ color: "#55f52f" }}
/>
```

### Eixos padrão
```tsx
<XAxis dataKey="name" tick={{ fontSize: 9, fill: "#a0aec0" }} axisLine={false} tickLine={false} />
<YAxis tick={{ fontSize: 10, fill: "#a0aec0" }} axisLine={false} tickLine={false} />
```

### Area chart
```tsx
<defs>
  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%" stopColor="#55f52f" stopOpacity={0.3} />
    <stop offset="95%" stopColor="#55f52f" stopOpacity={0} />
  </linearGradient>
</defs>
<Area type="monotone" dataKey="value" stroke="#55f52f" strokeWidth={2} fill="url(#areaGrad)" dot={false} />
```

### Bar chart
```tsx
<Bar dataKey="meta" fill="#55f52f" radius={[2, 2, 0, 0]} />
<Bar dataKey="google" fill="#7b2cff" radius={[2, 2, 0, 0]} />
```

### Donut SVG nativo (sem Recharts)
Usado nos slides de relatório e no card de faixa etária da dashboard.
- Outer radius: `108`, Inner radius: `50` (para `240×240` viewBox)
- Stroke entre fatias: `rgba(0,0,0,0.35)` strokeWidth 1
- Hover: `scale(1.07)` + `drop-shadow(0 0 16px ${color}AA)`
- Centro: `fill-card` (cor do card)

---

## 9. Padrões de Status

```html
<!-- Ativo -->
<div class="flex items-center gap-2.5 rounded-[var(--radius)] border px-3 py-2.5 bg-primary/10 border-primary/30">
  <span class="h-2 w-2 rounded-full bg-primary shrink-0"></span>
  <span class="text-sm font-bold text-primary">Ativo</span>
</div>

<!-- Pendente   → bg-yellow-400/10 border-yellow-400/30 text-yellow-400 -->
<!-- Inativo    → bg-muted border-border text-muted-foreground -->
<!-- Em atraso  → bg-destructive/10 border-destructive/30 text-destructive -->
```

---

## 10. Slides de Relatório (HTML gerado por TypeScript)

Os relatórios são gerados como HTML estático (não React). Tamanho padrão: **1440×810px** por slide.

### Constantes TypeScript
```ts
const PRIMARY = '#55f52f'
const CARD    = '#1a1a1a'
const BG      = '#0e0f14'
const BORDER  = '#2a2d3a'
const FG      = '#f5f5f5'
const MUTED   = '#a0aec0'
const RED     = '#e52020'
const BLUE    = '#0B84FF'
const ORANGE  = '#FF6B35'
const INTER   = 'var(--font-inter), Inter, sans-serif'
const BEBAS   = 'var(--font-bebas), "Bebas Neue", sans-serif'
```

### wrapSlide — estrutura base de cada slide
```ts
function wrapSlide(body: string, idx: number, total: number, tag?: string): string {
  // Div 1440×810px com:
  // - Header 52px: logo "ONMID" (Bebas, primary) + contador "X / Y" + tag opcional
  // - Body: flex:1, padding 36px 48px 40px
  // - Background: BG (#0e0f14), border: BORDER
}
```

### secTitle — título de seção
```ts
function secTitle(title: string, sub: string): string {
  // Barra vertical 4px PRIMARY à esquerda
  // H2 Bebas 32px foreground
  // Sub: 11px Inter 700 uppercase MUTED
}
```

### kpi — card de métrica nos slides
```ts
function kpi(label: string, value: string, context: string, accentColor = PRIMARY): string {
  // border BORDER, bg CARD, padding 20px 22px
  // Barra 2px no topo + quadrado 12px no canto (accentColor)
  // Label: 10px 700 uppercase MUTED
  // Value: Bebas 38px FG
  // Context: 12px Inter MUTED
}
```

### kpiWithDelta — kpi com badge de variação
```ts
function kpiWithDelta(label, value, prevValue, delta): string {
  // Igual ao kpi + badge inline ↑↓ com cor PRIMARY/RED
  // prevValue exibido como "ant: R$XX.XXX"
}
```

### hbar — barra horizontal de ranking
```ts
function hbar(label: string, value: string, pct: number, hi: boolean): string {
  // Label + valor alinhados
  // Barra 6px: PRIMARY se hi, PRIMARY40 se não
  // Glow box-shadow no hi
}
```

### insight — box de insight com borda primary
```ts
function insight(title: string, text: string): string {
  // border: PRIMARY4D, bg: PRIMARY14
  // Título: 10px 700 uppercase PRIMARY
  // Texto: 13px Inter FG
}
```

### tableRow — linha de tabela zebrada
```ts
function tableRow(cells: {text, right?, bold?, color?}[], stripe: boolean): string
```

---

## 11. Slides do Relatório Delivery (9+3)

### Ordem dos slides
| # | Slide | Dados | Condicional |
|---|---|---|---|
| 1 | **Capa** | Nome cliente, período, KPIs resumidos, frase Claude | sempre |
| 2 | **Visão Geral** | Faturamento + pedidos + ticket c/ badges ↑↓ vs anterior | se fat>0 ou pedidos>0 |
| 3 | **Comportamento por Dia** | Barras seg–dom, insights dias fortes/fracos | se CSV pedidos |
| 4 | **Regiões** | Tabela bairros + cards "Fortalecer" e "Estimular" | se CRM bairros |
| 5 | **Base de Clientes** | Donut ativos/inativos/potenciais + distribuição 1x vs 2x+ | se clientes |
| 6 | **Inativos e Potenciais** | Faixas 30-59/60-89/90-179/180-364/365+ + porta de entrada | se inativos_faixas |
| 7 | **Produtos** | Ranking top-8 + grade 2×2 combos sugeridos | se produtos |
| 8 | **Meta Ads** | KPIs globais + cards campanha (badge CONVERSA/CONVERSÃO/TRÁFEGO) | se Meta vinculado |
| 9 | **Diagnóstico** | Texto Claude + pontos fortes/atenção + plano + thumbnails criativos | sempre |
| 10 | **Destaque de Campanhas** *(expandido)* | Cards por tipo com métricas completas + insights Claude | se campanhas Meta |
| 11 | **Diagnóstico Faturamento** *(expandido)* | 4 forças 2×2 + sidebar base/regiões | se dados |
| 12 | **Plano Detalhado** *(expandido)* | 5 cards com objetivo/público/mensagem + funil jornada | se plano Claude |

### CSV esperados (template Delivery)
| Arquivo | Tipo detectado | Dados extraídos |
|---|---|---|
| `ativos.csv` | ativos | count, faturamento, pedidos, 1x vs 2x+ |
| `inativos.csv` | inativos | count, faixas por último pedido |
| `potenciais.csv` | potenciais | count |
| `produtos.csv` | produtos | nome, qtd, total — top 10 |
| `pedidos.csv` | pedidos | data → distribui por dia da semana |
| `ant-*.csv` | anterior | **prefixo `ant-`** → mesmo parsing, usado como período anterior |

### DiagJson (JSON retornado pelo Claude para Delivery)
```ts
type DiagJson = {
  diagnostico:                string;           // 2-3 frases sobre o negócio
  forcas:                     Array<{ titulo: string; descricao: string }>;  // 4 forças
  pontos_fortes:              string[];
  pontos_atencao:             string[];
  plano:                      Array<{
    acao:     string;
    objetivo: string;         // resultado esperado
    publico:  string;         // quem recebe
    mensagem: string;         // texto de exemplo para disparo
  }>;
  insight_campanha_conversa:  string;
  insight_campanha_conversao: string;
  frase_fechamento:           string;           // frase motivacional 1 linha
  jornada:                    string[];         // ex: ["descoberta","primeira_compra","recompra","reativacao_leve","reativacao_forte"]
}
```

---

## 12. Slides do Relatório Performance (HTML gerado por IA)

O relatório Performance é gerado **inteiramente pelo Claude** (HTML + CSS inline). O Claude recebe os dados de Meta Ads, Google Ads e CRM, e retorna HTML com o mesmo design system.

### Fontes de dados
- **Meta Ads** (Graph API v21.0): spend, impressions, reach, clicks, actions, frequency, purchase_roas — atual + período anterior
- **Google Ads** (GAQL): cost_micros, impressions, clicks, conversions — atual + período anterior
- **CRM** (PostgreSQL `crm_leads`): faturamento, leads, bairros, segmentos — atual + anterior

### Período anterior
Calculado automaticamente via `calcPrevPeriod(from, to)` — mesma duração do período atual, imediatamente antes.

### Slides esperados (instrução ao Claude)
1. Capa — nome, período, KPIs Hero
2. Visão Executiva — comparativo atual vs anterior com variação %
3. Meta Ads — performance de campanhas
3B. Google Ads — performance (só se dados disponíveis)
4. Criativos — top peças com thumbnail (se Meta)
5. Comparativo de Período — tabela lado a lado (sempre gerado)
6. Diagnóstico e Plano de Ação
7. Apêndice / Notas (se agencyContext fornecido)

---

## 13. Micro-interações e Identidade

### Neon clicked (assinatura da marca)
```css
@keyframes accent-flash {
  0% { box-shadow: 0 0 4px 1px rgba(85,245,47,0.6), 0 0 12px 3px rgba(85,245,47,0.3); }
  100% { box-shadow: none; }
}
.neon-clicked { animation: accent-flash 0.4s ease-out forwards; }
```

### Corner square (motif decorativo)
```css
.corner-square::before {
  content: '';
  position: absolute; top: 0; left: 0;
  width: 12px; height: 12px;
  background-color: var(--primary);
}
```

---

## 14. Regras de Uso

| Regra | Detalhe |
|---|---|
| **Angular, não arredondado** | radius-md = 2px. Avatares e dots usam rounded-full. Resto: retangular |
| **Sem sombras, só bordas** | Hierarquia via cor de superfície + hairlines 1px |
| **Verde = único CTA** | `#55f52f` para todos os call-to-actions. Roxo `#7b2cff` = editorial only |
| **Bebas para KPIs, Inter para o resto** | Números grandes e logo ONMID = Bebas. Todo UI = Inter |
| **Densidade sobre espaço** | `p-4` / `p-5` em cards. `gap-4` em grids. Sem espaço decorativo |
| **Dados nunca inventados** | Estado vazio explícito. Nenhum placeholder em produção |
| **Dark first** | Todo componente é desenhado para dark mode. Light mode é suporte secundário |
| **BLUE para Meta Ads** | `#0B84FF` é a cor de acento de todos os dados de campanha Meta |
| **ORANGE para conversão** | `#FF6B35` para compras, combos, 1ª compra, conversão |

---

## 15. Stack Técnica

```
Next.js       App Router, server components + client components
React         19
TypeScript    strict
Tailwind      v4 com CSS variables via @theme inline
shadcn/ui     components customizados (Button, Badge, Input, etc.)
Recharts      gráficos no dashboard
Anthropic     claude-sonnet-4-6 para geração de relatórios
Meta API      Graph API v21.0 (ads insights, creative thumbnails)
Google Ads    GAQL v20 (OAuth2 sem SDK)
PostgreSQL    makeServerPool() — CRM, conexões, relatórios
Supabase      autenticação
```

---

*Design System ON_Reports — gerado a partir do codebase em 2026-06-12*
