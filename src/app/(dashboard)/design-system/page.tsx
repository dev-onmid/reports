"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
  User,
  X,
  Zap,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="font-heading text-2xl text-foreground">{title}</h2>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Token({ name, value, cls }: { name: string; value: string; cls?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }
  return (
    <button
      onClick={copy}
      className="group flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 w-full"
    >
      {cls && <span className={`h-7 w-7 shrink-0 rounded-[var(--radius)] border border-border ${cls}`} />}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{name}</p>
        <p className="text-xs font-mono text-foreground mt-0.5 truncate">{value}</p>
      </div>
      {copied
        ? <Check className="h-3 w-3 text-primary shrink-0" />
        : <Copy className="h-3 w-3 text-muted-foreground/50 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-24 shrink-0 text-[11px] font-bold text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// ── Chart data ────────────────────────────────────────────────────────────────

const sparkData = [
  { name: "Jan", value: 4200 },
  { name: "Fev", value: 5100 },
  { name: "Mar", value: 4700 },
  { name: "Abr", value: 6300 },
  { name: "Mai", value: 5800 },
  { name: "Jun", value: 7200 },
  { name: "Jul", value: 8100 },
];

const barData = [
  { name: "Seg", meta: 2400, google: 800 },
  { name: "Ter", meta: 1800, google: 1200 },
  { name: "Qua", meta: 3200, google: 600 },
  { name: "Qui", meta: 2800, google: 1400 },
  { name: "Sex", meta: 4100, google: 2000 },
];

const pieData = [
  { name: "Meta ADS", value: 62 },
  { name: "Google ADS", value: 28 },
  { name: "TikTok ADS", value: 10 },
];

const PIE_COLORS = ["#55f52f", "#7b2cff", "#cccccc"];

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  delta,
  positive = true,
}: {
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-3 font-heading text-3xl text-foreground">{value}</p>
      {delta && (
        <div className={`mt-2 flex items-center gap-1 text-xs font-bold ${positive ? "text-primary" : "text-destructive"}`}>
          {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {delta}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DesignSystemPage() {
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="mx-auto max-w-5xl space-y-16 px-4 py-10">
      {/* Header */}
      <div className="border-b border-border pb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Design System</p>
        <h1 className="mt-2 font-heading text-5xl text-foreground">ON_REPORTS</h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Referência visual do sistema. Tokens, componentes e padrões que definem a identidade do produto.
          Angular, denso, orientado a dados.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>v1.0</Badge>
          <Badge variant="tag">Next.js 15</Badge>
          <Badge variant="secondary">Tailwind v4</Badge>
        </div>
      </div>

      {/* ── Colors ── */}
      <Section title="Cores" sub="Todos os tokens de cor disponíveis via CSS variables e classes Tailwind.">
        <div>
          <Label>Brand</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Token name="Primary" value="#55f52f" cls="bg-primary" />
            <Token name="Primary Dark" value="#3bc411" cls="bg-[#3bc411]" />
            <Token name="Secondary" value="#7b2cff" cls="bg-secondary" />
            <Token name="Destructive" value="#e52020" cls="bg-destructive" />
          </div>
        </div>

        <div>
          <Label>Superfícies</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Token name="Background" value="#0e0f14" cls="bg-background border-hairline" />
            <Token name="Card" value="#1a1a1a" cls="bg-card" />
            <Token name="Surface Soft" value="#1a1a1a" cls="bg-surface-soft" />
            <Token name="Surface Dark" value="#000000" cls="bg-surface-dark" />
            <Token name="Surface Elevated" value="#242424" cls="bg-surface-elevated" />
            <Token name="Popover" value="#1a1a1a" cls="bg-popover" />
          </div>
        </div>

        <div>
          <Label>Texto</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Token name="Foreground" value="#f5f5f5" cls="bg-foreground" />
            <Token name="Muted FG" value="#a0aec0" cls="bg-muted-foreground" />
            <Token name="Ink" value="#f5f5f5" cls="bg-ink" />
            <Token name="Mute" value="#a0aec0" cls="bg-mute" />
          </div>
        </div>

        <div>
          <Label>Bordas</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Token name="Border / Hairline" value="#2a2d3a" cls="bg-border" />
            <Token name="Hairline Strong" value="#5e5e5e" cls="bg-hairline-strong" />
            <Token name="Input" value="#2a2d3a" cls="bg-input" />
            <Token name="Ring" value="#55f52f" cls="bg-ring" />
          </div>
        </div>

        <div>
          <Label>Charts</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Token name="Chart 1" value="#55f52f" cls="bg-chart-1" />
            <Token name="Chart 2" value="#7b2cff" cls="bg-chart-2" />
            <Token name="Chart 3" value="#f5f5f5" cls="bg-chart-3" />
            <Token name="Chart 4" value="#2a2d3a" cls="bg-chart-4" />
            <Token name="Chart 5" value="#1a1a1a" cls="bg-chart-5" />
          </div>
        </div>
      </Section>

      {/* ── Typography ── */}
      <Section title="Tipografia" sub="Bebas Neue para grandes números e títulos. Inter para corpo e UI.">
        <div className="space-y-6">
          <div>
            <Label>Heading — Bebas Neue (font-heading)</Label>
            <div className="mt-3 space-y-2">
              {(["text-6xl", "text-5xl", "text-4xl", "text-3xl", "text-2xl", "text-xl"] as const).map((sz, i) => (
                <div key={sz} className="flex items-baseline gap-4">
                  <span className={`font-heading ${sz} text-foreground leading-none`}>
                    {["Display", "H1", "H2", "H3", "H4", "H5"][i]}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">{sz}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>Body — Inter (font-sans)</Label>
            <div className="mt-3 space-y-2">
              {(["text-xl", "text-lg", "text-base", "text-sm", "text-xs"] as const).map((sz, i) => (
                <div key={sz} className="flex items-baseline gap-4">
                  <span className={`${sz} text-foreground`}>
                    {["Large", "Lead", "Base", "Small", "Caption"][i]}
                    <span className="text-muted-foreground"> — Dados que geram decisão, não só dashboards.</span>
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{sz}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>Labels & caps</Label>
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Label uppercase — text-[10px] font-bold uppercase tracking-widest</p>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Label md — text-xs font-bold uppercase tracking-wider</p>
              <p className="font-mono text-xs text-muted-foreground">Mono label — font-mono text-xs</p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Spacing & Radius ── */}
      <Section title="Geometria" sub="Radius 2px — angular, denso, orientado a dados.">
        <div className="space-y-4">
          <Label>Radius Scale</Label>
          <div className="flex flex-wrap gap-4">
            {[
              { label: "none", cls: "rounded-none" },
              { label: "sm (1px)", cls: "rounded-[var(--radius-sm)]" },
              { label: "md (2px)", cls: "rounded-[var(--radius)]" },
              { label: "lg (3px)", cls: "rounded-[var(--radius-lg)]" },
              { label: "xl (4px)", cls: "rounded-[var(--radius-xl)]" },
              { label: "2xl (6px)", cls: "rounded-[var(--radius-2xl)]" },
              { label: "full", cls: "rounded-full" },
            ].map(({ label, cls }) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <div className={`h-10 w-10 border-2 border-primary bg-primary/20 ${cls}`} />
                <p className="text-[9px] font-mono text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <Label>Spacing</Label>
          <div className="flex flex-wrap items-end gap-4">
            {[1, 2, 3, 4, 6, 8, 10, 12, 16].map((n) => (
              <div key={n} className="flex flex-col items-center gap-2">
                <div className="w-4 bg-primary/40" style={{ height: `${n * 4}px` }} />
                <p className="text-[9px] font-mono text-muted-foreground">{n} ({n * 4}px)</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Buttons ── */}
      <Section title="Botões" sub="Todos os variants e tamanhos. Altura mínima 44px (WCAG AA).">
        <div className="space-y-5">
          <div>
            <Label>Variants</Label>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button>Default</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="outline-dark">Outline Dark</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>
          <div>
            <Label>Com ícones</Label>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button><Plus className="h-4 w-4" /> Adicionar</Button>
              <Button variant="outline"><Download className="h-4 w-4" /> Exportar</Button>
              <Button variant="ghost"><RefreshCw className="h-4 w-4" /> Atualizar</Button>
              <Button variant="destructive"><Trash2 className="h-4 w-4" /> Excluir</Button>
              <Button>Ver relatório <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
          <div>
            <Label>Tamanhos</Label>
            <Row label="lg">
              <Button size="lg">Large</Button>
            </Row>
            <Row label="default">
              <Button size="default">Default</Button>
            </Row>
            <Row label="sm">
              <Button size="sm">Small</Button>
            </Row>
            <Row label="xs">
              <Button size="xs">Micro</Button>
            </Row>
            <Row label="icon">
              <Button size="icon"><Settings /></Button>
              <Button size="icon-sm" variant="outline"><Filter /></Button>
              <Button size="icon-xs" variant="ghost"><X /></Button>
            </Row>
          </div>
        </div>
      </Section>

      {/* ── Badges ── */}
      <Section title="Badges" sub="Tags de categoria, status e labels de dados.">
        <div className="space-y-4">
          <div>
            <Label>Variants</Label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="tag">Tag</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="ghost">Ghost</Badge>
            </div>
          </div>
          <div>
            <Label>Com ícones</Label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge><Check className="h-3 w-3" /> Ativo</Badge>
              <Badge variant="destructive"><X className="h-3 w-3" /> Inativo</Badge>
              <Badge variant="secondary"><Zap className="h-3 w-3" /> Extra</Badge>
              <Badge variant="tag"><CircleDot className="h-3 w-3" /> Rascunho</Badge>
              <Badge variant="outline"><Star className="h-3 w-3" /> Destaque</Badge>
            </div>
          </div>
          <div>
            <Label>Uso em contexto</Label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>Meta ADS</Badge>
              <Badge variant="secondary">Google ADS</Badge>
              <Badge variant="tag">TikTok ADS</Badge>
              <Badge><TrendingUp className="h-3 w-3" />+23%</Badge>
              <Badge variant="destructive"><TrendingDown className="h-3 w-3" />-8%</Badge>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Cards & Surfaces ── */}
      <Section title="Cards & Superfícies" sub="Hierarquia de superfícies com hairlines, sem sombras.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">bg-card / border-border</p>
            <p className="mt-2 text-sm text-foreground">Card padrão — superfície principal para conteúdo e métricas.</p>
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-surface-soft p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">bg-surface-soft</p>
            <p className="mt-2 text-sm text-foreground">Linhas alternadas, sub-nav, breadcrumbs.</p>
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-surface-elevated p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">bg-surface-elevated</p>
            <p className="mt-2 text-sm text-foreground">Painéis aninhados dentro de seções escuras.</p>
          </div>
          <div className="rounded-[var(--radius)] border border-primary/30 bg-primary/10 p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Primary tint</p>
            <p className="mt-2 text-sm text-foreground">Destaque de ação, alertas positivos.</p>
          </div>
          <div className="rounded-[var(--radius)] border border-secondary/30 bg-secondary/10 p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Secondary tint</p>
            <p className="mt-2 text-sm text-foreground">Uso editorial, roxo Onmid.</p>
          </div>
          <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">Destructive tint</p>
            <p className="mt-2 text-sm text-foreground">Erros, alertas críticos, quedas.</p>
          </div>
        </div>
      </Section>

      {/* ── Metric Cards ── */}
      <Section title="Metric Cards" sub="Padrão de KPI — usado em dashboards e relatórios.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Faturamento" value="R$134.535" delta="+18,3% vs. mês anterior" positive />
          <MetricCard label="Pedidos" value="2.847" delta="+312 pedidos" positive />
          <MetricCard label="Ticket Médio" value="R$47,25" delta="-3,1% vs. anterior" positive={false} />
          <MetricCard label="Clientes Ativos" value="368" delta="+41 novos" positive />
        </div>
        <div className="mt-4 rounded-[var(--radius)] border border-border bg-card p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Anatomia</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li><span className="font-mono text-primary">label</span> — text-[10px] font-bold uppercase tracking-widest</li>
            <li><span className="font-mono text-primary">value</span> — font-heading text-3xl (Bebas Neue)</li>
            <li><span className="font-mono text-primary">delta</span> — text-xs font-bold text-primary / text-destructive</li>
          </ul>
        </div>
      </Section>

      {/* ── Forms ── */}
      <Section title="Formulários" sub="Inputs, selects e estados de validação.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Input padrão</label>
            <Input
              placeholder="Digite algo..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Com ícone</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar cliente..." className="pl-9" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Desabilitado</label>
            <Input placeholder="Campo desabilitado" disabled />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-destructive">Erro</label>
            <Input placeholder="Campo inválido" className="border-destructive focus-visible:ring-destructive/30" />
            <p className="text-xs text-destructive">Esse campo é obrigatório.</p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select nativo</label>
            <select className="h-11 w-full rounded-[var(--radius)] border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30">
              <option value="">Selecione um cliente...</option>
              <option>PicoLocos</option>
              <option>Burger King</option>
              <option>Domino&apos;s Pizza</option>
            </select>
          </div>
        </div>
      </Section>

      {/* ── Alerts / Feedback ── */}
      <Section title="Alertas & Feedback" sub="Banners informativos, warnings e confirmações.">
        <div className="space-y-3">
          {[
            { tone: "border-primary/30 bg-primary/10 text-primary", icon: <Check className="h-4 w-4 shrink-0 mt-0.5" />, label: "Sucesso", msg: "Relatório gerado com sucesso. O cliente já pode acessar." },
            { tone: "border-yellow-400/30 bg-yellow-400/10 text-yellow-400", icon: <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />, label: "Atenção", msg: "Saldo da conta Meta abaixo de R$100. Recarregue antes de amanhã." },
            { tone: "border-destructive/30 bg-destructive/10 text-destructive", icon: <X className="h-4 w-4 shrink-0 mt-0.5" />, label: "Erro", msg: "Falha ao conectar com a API do Meta. Verifique o token de acesso." },
            { tone: "border-border bg-surface-soft text-muted-foreground", icon: <Bell className="h-4 w-4 shrink-0 mt-0.5" />, label: "Info", msg: "O relatório de Junho estará disponível a partir de 5 de Julho." },
          ].map(({ tone, icon, label, msg }) => (
            <div key={label} className={`flex items-start gap-3 rounded-[var(--radius)] border p-4 ${tone}`}>
              {icon}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider">{label}</p>
                <p className="mt-0.5 text-sm">{msg}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Charts ── */}
      <Section title="Gráficos" sub="Recharts com as cores do design system. Fundo transparente, sem bordas desnecessárias.">
        <div className="grid gap-6 lg:grid-cols-3">

          {/* Area */}
          <div className="rounded-[var(--radius)] border border-border bg-card p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Area — Faturamento</p>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={sparkData}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#55f52f" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#55f52f" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#a0aec0" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2d3a", borderRadius: 2, fontSize: 11 }}
                  labelStyle={{ color: "#a0aec0" }}
                  itemStyle={{ color: "#55f52f" }}
                />
                <Area type="monotone" dataKey="value" stroke="#55f52f" strokeWidth={2} fill="url(#areaGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Bar */}
          <div className="rounded-[var(--radius)] border border-border bg-card p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Bar — Investimento por dia</p>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={barData} barSize={8} barGap={2}>
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#a0aec0" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2d3a", borderRadius: 2, fontSize: 11 }}
                  labelStyle={{ color: "#a0aec0" }}
                />
                <Bar dataKey="meta" fill="#55f52f" radius={[2, 2, 0, 0]} />
                <Bar dataKey="google" fill="#7b2cff" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie */}
          <div className="rounded-[var(--radius)] border border-border bg-card p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pie — Share de canal</p>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={28} outerRadius={44} dataKey="value" strokeWidth={0}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-bold text-foreground">{d.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Line */}
          <div className="rounded-[var(--radius)] border border-border bg-card p-4 lg:col-span-3">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Line — Comparativo mensal</p>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={sparkData}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#a0aec0" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#a0aec0" }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2d3a", borderRadius: 2, fontSize: 11 }}
                  labelStyle={{ color: "#a0aec0" }}
                  itemStyle={{ color: "#55f52f" }}
                  formatter={(v) => [`R$${Number(v).toLocaleString("pt-BR")}`, "Faturamento"]}
                />
                <Line type="monotone" dataKey="value" stroke="#55f52f" strokeWidth={2} dot={{ r: 3, fill: "#55f52f", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Section>

      {/* ── Status patterns ── */}
      <Section title="Padrões de Status" sub="Combinações recorrentes para estados de dados.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Ativo", color: "text-primary", bg: "bg-primary/10 border-primary/30", dot: "bg-primary" },
            { label: "Pendente", color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", dot: "bg-yellow-400" },
            { label: "Inativo", color: "text-muted-foreground", bg: "bg-muted border-border", dot: "bg-muted-foreground" },
            { label: "Em atraso", color: "text-destructive", bg: "bg-destructive/10 border-destructive/30", dot: "bg-destructive" },
          ].map(({ label, color, bg, dot }) => (
            <div key={label} className={`flex items-center gap-2.5 rounded-[var(--radius)] border px-3 py-2.5 ${bg}`}>
              <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
              <span className={`text-sm font-bold ${color}`}>{label}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Icon usage ── */}
      <Section title="Ícones" sub="Lucide React — tamanhos e contextos de uso.">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-6">
            {[
              { sz: "h-3 w-3", label: "12px — inline, badge" },
              { sz: "h-4 w-4", label: "16px — padrão UI" },
              { sz: "h-5 w-5", label: "20px — botão, nav" },
              { sz: "h-6 w-6", label: "24px — destaque" },
              { sz: "h-8 w-8", label: "32px — hero, card" },
            ].map(({ sz, label }) => (
              <div key={sz} className="flex flex-col items-center gap-1.5">
                <BarChart3 className={`${sz} text-primary`} />
                <p className="text-[9px] font-mono text-muted-foreground text-center">{label}</p>
              </div>
            ))}
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-surface-soft p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Ícones frequentes no produto</p>
            <div className="flex flex-wrap gap-4">
              {[BarChart3, User, Settings, Bell, ExternalLink, Download, Filter, Search, RefreshCw, Plus, Trash2, Star, Zap, Copy].map((Icon, i) => (
                <Icon key={i} className="h-5 w-5 text-muted-foreground hover:text-primary transition-colors cursor-default" />
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Usage rules ── */}
      <Section title="Regras de Uso" sub="Princípios que guiam as decisões de design.">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: "Angular, não arredondado", body: "radius-md = 2px. Formas orgânicas são reservadas para avatares e dots de status. Tudo mais é retangular." },
            { title: "Sem sombras, só bordas", body: "Hierarquia via cor de superfície e hairlines de 1px. box-shadow só em modais com overlay." },
            { title: "Verde como único CTA", body: "#55f52f (primary) carrega todos os call-to-actions. Roxo (#7b2cff) é uso editorial apenas." },
            { title: "Bebas para KPIs, Inter para o resto", body: "Números grandes e o logo ONMID usam Bebas Neue. Todo texto UI, label e corpo usa Inter." },
            { title: "Densidade sobre espaço", body: "Padding interno de cards: p-4 ou p-5. Gaps de grid: gap-4. Não use espaços decorativos." },
            { title: "Dados nunca inventados", body: "Nenhum dado no UI é placeholder se o usuário não estiver vendo isso como demo. Estado vazio explícito." },
          ].map(({ title, body }) => (
            <div key={title} className="rounded-[var(--radius)] border border-border bg-card p-4">
              <p className="text-sm font-bold text-foreground">{title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="border-t border-border pt-6 text-center">
        <p className="text-xs text-muted-foreground">ON_REPORTS Design System · atualizado automaticamente com o codebase</p>
      </div>
    </div>
  );
}
