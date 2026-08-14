import React, { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  TrendingUp, TrendingDown, Download, Calendar, Wallet, Users, UserPlus,
  ShoppingBag, Target, Eye, MousePointerClick, Bookmark, Heart, Play,
  ArrowRight, ArrowUp, Filter, Megaphone, Flame, Clock, Receipt,
  Repeat, Zap, Store, BarChart3, CalendarClock,
} from "lucide-react";

/* ══════════════════════════════ TOKENS ══════════════════════════════ */
const C = {
  bg: "#0e0f14", card: "#1a1a1a", elev: "#242424", dark: "#000000",
  primary: "#55f52f", secondary: "#7b2cff", red: "#e52020", fg: "#f5f5f5",
  muted: "#a0aec0", border: "#2a2d3a", hair: "#5e5e5e",
  blue: "#0B84FF", orange: "#FF6B35", yellow: "#facc15",
  meta: "#0082FB", gBlue: "#4285F4", gYellow: "#FBBC04", gGreen: "#34A853", ig: "#D62976",
};
const R = "2px";

/* ══════════════════════ LOGOS DOS CANAIS (SVG) ══════════════════════ */
const MetaMark = ({ s = 22 }) => (
  <svg viewBox="0 0 64 40" style={{ width: s * 1.6, height: s }}>
    <defs><linearGradient id="metaG" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#0064E0" /><stop offset="55%" stopColor="#0082FB" /><stop offset="100%" stopColor="#0BB6FF" />
    </linearGradient></defs>
    <path d="M6 26c0-9 5-16 11-16 5 0 8 3 11 8l4 7c3 5 5 7 8 7 3 0 5-3 5-8s-2-9-5-9c-2 0-4 1-6 4l-4-6c3-4 6-6 10-6 7 0 12 7 12 17s-4 17-11 17c-5 0-8-3-12-9l-4-7c-3-5-4-6-6-6-3 0-5 3-5 8 0 4 1 7 3 8l-4 6C8 38 6 33 6 26Z" fill="url(#metaG)" />
  </svg>
);
const GoogleAdsMark = ({ s = 22 }) => (
  <svg viewBox="0 0 48 48" style={{ width: s, height: s }}>
    <g transform="rotate(-30 24 24)"><rect x="18" y="2" width="12" height="38" rx="6" fill="#FBBC04" /></g>
    <g transform="rotate(30 24 24)"><rect x="18" y="2" width="12" height="38" rx="6" fill="#4285F4" /></g>
    <circle cx="12" cy="36" r="7" fill="#34A853" />
  </svg>
);
const InstagramMark = ({ s = 22 }) => (
  <svg viewBox="0 0 48 48" style={{ width: s, height: s }}>
    <defs><linearGradient id="igG" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stopColor="#FEDA75" /><stop offset="25%" stopColor="#FA7E1E" /><stop offset="50%" stopColor="#D62976" />
      <stop offset="75%" stopColor="#962FBF" /><stop offset="100%" stopColor="#4F5BD5" />
    </linearGradient></defs>
    <rect x="4" y="4" width="40" height="40" rx="12" fill="none" stroke="url(#igG)" strokeWidth="4" />
    <circle cx="24" cy="24" r="9.5" fill="none" stroke="url(#igG)" strokeWidth="4" />
    <circle cx="35" cy="13" r="2.6" fill="url(#igG)" />
  </svg>
);

/* ══════════════════════════════ HELPERS ═════════════════════════════ */
const nf = new Intl.NumberFormat("pt-BR");
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (v) => "R$ " + nf2.format(v);
const brlK = (v) => (v >= 1000 ? "R$ " + nf.format(Math.round(v)) : "R$ " + nf2.format(v));
const int = (v) => nf.format(Math.round(v));
const pct = (v) => nf1.format(v) + "%";
const kNum = (v) => (v >= 1e6 ? nf1.format(v / 1e6) + "M" : v >= 1000 ? nf1.format(v / 1000) + "k" : int(v));

const rng = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const TODAY = new Date(2026, 7, 12);
const HIST = 420;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const brDate = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const DOWS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/* ══════════════════════════════ DADOS ═══════════════════════════════ */
function build() {
  const M = [1.18, 0.70, 0.76, 0.86, 1.02, 1.36, 1.44];
  const out = [];
  for (let i = HIST - 1; i >= 0; i--) {
    const date = addD(TODAY, -i), idx = HIST - 1 - i, r = rng(9137 + idx * 23);
    const mult = M[date.getDay()], grow = 1 + idx * 0.00085;
    const acessos = Math.round(1320 * mult * grow * (0.86 + 0.28 * r()));
    const viewItens = Math.round(acessos * (0.60 + 0.06 * r()));
    const carrinho = Math.round(viewItens * (0.51 + 0.07 * r()));
    const checkout = Math.round(carrinho * (0.58 + 0.08 * r()));
    const pedidos = Math.round(checkout * (0.64 + 0.09 * r()));
    const ticket = 62 + 16 * r() + idx * 0.012;
    const novos = Math.round(pedidos * (0.10 + 0.06 * r()));
    const metaSpend = 172 * mult * grow * (0.9 + 0.2 * r());
    const metaReach = Math.round(metaSpend * (88 + 24 * r()));
    const metaImpr = Math.round(metaReach * (1.5 + 0.5 * r()));
    const metaClicks = Math.round(metaImpr * (0.016 + 0.008 * r()));
    const gCost = 88 * mult * grow * (0.9 + 0.2 * r());
    const gImpr = Math.round(gCost * (34 + 12 * r()));
    const gClicks = Math.round(gImpr * (0.045 + 0.02 * r()));
    const gConv = Math.round(gClicks * (0.07 + 0.035 * r()));
    const base = 4180 + idx * 1.9;
    const ativos = Math.round(base * (0.265 + 0.035 * r()));
    const i3060 = Math.round(base * (0.20 + 0.02 * r()));
    const igReach = Math.round(3100 * mult * grow * (0.9 + 0.2 * r()));
    const igInter = Math.round(igReach * (0.055 + 0.03 * r()));
    out.push({
      date, key: iso(date), dow: date.getDay(),
      label: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      acessos, viewItens, carrinho, checkout, pedidos, receita: pedidos * ticket, novos,
      metaSpend, metaReach, metaImpr, metaClicks, gCost, gImpr, gClicks, gConv,
      ativos, i3060, i60: Math.round(base - ativos - i3060),
      seguidores: Math.round(11840 + idx * 9.4 + 60 * r()),
      igReach, igInter, igViews: Math.round(igReach * (1.7 + 0.6 * r())),
      igBio: Math.round(igReach * (0.013 + 0.008 * r())),
      igSaves: Math.round(igInter * (0.11 + 0.06 * r())),
      igVisits: Math.round(igReach * (0.032 + 0.014 * r())),
    });
  }
  return out;
}

const SUM = ["acessos","viewItens","carrinho","checkout","pedidos","receita","novos","metaSpend",
  "metaReach","metaImpr","metaClicks","gCost","gImpr","gClicks","gConv","igReach","igViews",
  "igBio","igInter","igSaves","igVisits"];

function agg(rows) {
  const t = Object.fromEntries(SUM.map((k) => [k, 0]));
  rows.forEach((r) => SUM.forEach((k) => (t[k] += r[k])));
  const L = rows[rows.length - 1] || {}, F = rows[0] || {};
  const inv = t.metaSpend + t.gCost;
  return {
    ...t, dias: rows.length,
    ticket: t.pedidos ? t.receita / t.pedidos : 0,
    ativos: L.ativos || 0, i3060: L.i3060 || 0, i60: L.i60 || 0,
    inativos: (L.i3060 || 0) + (L.i60 || 0),
    seguidores: L.seguidores || 0, novosSeg: (L.seguidores || 0) - (F.seguidores || 0),
    inv, cac: t.novos ? inv / t.novos : 0,
    metaCtr: t.metaImpr ? (t.metaClicks / t.metaImpr) * 100 : 0,
    metaCpc: t.metaClicks ? t.metaSpend / t.metaClicks : 0,
    metaFreq: t.metaReach ? t.metaImpr / t.metaReach : 0,
    gCtr: t.gImpr ? (t.gClicks / t.gImpr) * 100 : 0,
    gCpc: t.gClicks ? t.gCost / t.gClicks : 0,
    igEng: t.igReach ? (t.igInter / t.igReach) * 100 : 0,
    conv: t.acessos ? (t.pedidos / t.acessos) * 100 : 0,
  };
}

const FAIXAS = ["11–13h", "13–15h", "17–19h", "19–21h", "21–23h", "23–01h"];
const FAIXA_W = [0.13, 0.07, 0.16, 0.36, 0.20, 0.08];

const CRIATIVOS = [
  { id: "CR-118", nome: "Combo Duplo · 15s", tipo: "Vídeo",  ctr: 3.42, cpc: 0.68, roas: 6.1, v: 0 },
  { id: "CR-104", nome: "Promo Terça",       tipo: "Imagem", ctr: 2.87, cpc: 0.81, roas: 4.4, v: 1 },
  { id: "CR-127", nome: "Depoimento",        tipo: "Reels",  ctr: 2.19, cpc: 1.04, roas: 3.2, v: 2 },
];

const RECORRENCIA = [
  { nome: "Comprou 1 vez", qtd: 1842, cor: C.orange },
  { nome: "2 a 4 pedidos", qtd: 1396, cor: C.blue },
  { nome: "5 a 9 pedidos", qtd: 764, cor: C.secondary },
  { nome: "10 ou mais", qtd: 412, cor: C.primary },
];

/* ══════════════════════════ PRIMITIVOS UI ═══════════════════════════ */
const Label = ({ children, c }) => (
  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: c || C.muted }}>{children}</p>
);

const Card = ({ children, className = "", pad = "p-4", style }) => (
  <div className={`relative ${pad} ${className}`}
    style={{ borderRadius: R, border: `1px solid ${C.border}`, background: C.card, ...style }}>{children}</div>
);

const IconTile = ({ icon: Icon, color, size = 32 }) => (
  <div className="flex shrink-0 items-center justify-center"
    style={{ width: size, height: size, borderRadius: R, background: color + "1a", border: `1px solid ${color}40` }}>
    <Icon style={{ color, width: size * 0.45, height: size * 0.45 }} />
  </div>
);

const Delta = ({ v, invert, small }) => {
  const up = v >= 0, good = invert ? !up : up;
  const col = good ? C.primary : C.red, I = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${small ? "text-[10px]" : "text-xs"}`}
      style={{ color: col, background: col + "14", border: `1px solid ${col}40`, borderRadius: R, padding: "1px 5px" }}>
      <I className="h-3 w-3" />{(up ? "+" : "") + nf1.format(v) + "%"}
    </span>
  );
};

const Spark = ({ data, color, h = 30 }) => {
  if (!data || data.length < 2) return null;
  const w = 100, mn = Math.min(...data), mx = Math.max(...data), sp = mx - mn || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - mn) / sp) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const id = "s" + color.slice(1) + data.length + Math.round(mx);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.32} /><stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient></defs>
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

function Gauge({ value, max, color, unit, caption, size = 132 }) {
  const p = Math.max(0, Math.min(1, value / max));
  const A0 = Math.PI * 0.78, A1 = Math.PI * 2.22;
  const cx = size / 2, cy = size / 2, r = size / 2 - 11;
  const pt = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const arc = (a0, a1) => {
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }}>
      <path d={arc(A0, A1)} fill="none" stroke={C.border} strokeWidth="9" />
      <path d={arc(A0, A0 + (A1 - A0) * p)} fill="none" stroke={color} strokeWidth="9" style={{ filter: `drop-shadow(0 0 7px ${color}80)` }} />
      {[0.25, 0.5, 0.75].map((t) => {
        const a = A0 + (A1 - A0) * t, [x, y] = pt(a);
        return <line key={t} x1={x} y1={y} x2={cx + (r - 12) * Math.cos(a)} y2={cy + (r - 12) * Math.sin(a)} stroke={C.bg} strokeWidth="2" />;
      })}
      <text x={cx} y={cy + 3} textAnchor="middle" fontFamily="Bebas Neue, sans-serif" fontSize={size * 0.26} fill={C.fg}>{unit}</text>
      <text x={cx} y={cy + 19} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="7.5" letterSpacing="1.4" fill={C.muted}>{caption}</text>
    </svg>
  );
}

function Ring({ p, color, size = 46, children }) {
  const r = size / 2 - 3.5, cc = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth="3.5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3.5" strokeDasharray={`${cc * Math.min(1, p)} ${cc}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/* Bloco pequeno reaproveitado dentro dos cards — é o que mata o vazio */
const Mini = ({ label, value, sub, color = C.fg, icon: Icon, iconColor, className = "", big }) => (
  <div className={`flex items-center gap-2.5 ${big ? "p-4" : "p-2.5"} ${className}`} style={{ background: C.elev, borderRadius: R }}>
    {Icon && <IconTile icon={Icon} color={iconColor || color} size={big ? 38 : 28} />}
    <div className="min-w-0">
      <Label>{label}</Label>
      <p className={`font-heading ${big ? "text-3xl" : "text-lg"} leading-none`} style={{ color }}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[10px]" style={{ color: C.muted }}>{sub}</p>}
    </div>
  </div>
);

/* Stat compacto: valor e sparkline dividem a linha */
const Stat = ({ icon, color, label, value, delta, invert, spark, sub }) => (
  <Card pad="p-4">
    <div className="flex items-start gap-3">
      <IconTile icon={icon} color={color} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Label>{label}</Label>
          {typeof delta === "number" && <Delta v={delta} invert={invert} small />}
        </div>
        <div className="mt-1.5 flex items-end gap-3">
          <p className="font-heading text-2xl leading-none" style={{ color: C.fg }}>{value}</p>
          {spark && <div className="min-w-0 flex-1"><Spark data={spark} color={color} h={26} /></div>}
        </div>
        {sub && <p className="mt-1.5 text-[11px]" style={{ color: C.muted }}>{sub}</p>}
      </div>
    </div>
  </Card>
);

const tt = {
  contentStyle: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 2, fontSize: 11 },
  labelStyle: { color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em" },
  itemStyle: { color: C.fg, fontSize: 11 },
  cursor: { fill: "#ffffff08" },
};

const Chapter = ({ icon: Icon, title, sub, color = C.primary, right }) => (
  <div className="mb-4 flex flex-wrap items-end justify-between gap-4 pb-3" style={{ borderBottom: `1px solid ${C.border}` }}>
    <div className="flex items-center gap-3">
      <IconTile icon={Icon} color={color} size={36} />
      <div>
        <h2 className="font-heading text-3xl leading-none">{title}</h2>
        {sub && <p className="mt-0.5 text-[11px]" style={{ color: C.muted }}>{sub}</p>}
      </div>
    </div>
    {right}
  </div>
);

/* Tile do resumo de tráfego: ícone + label, valor grande, variação embaixo */
const Tile = ({ icon: Icon, iconColor = C.primary, label, value, delta, invert, note, noteColor }) => (
  <div className="min-w-0 p-2.5" style={{ background: C.elev, border: `1px solid ${C.border}`, borderRadius: R }}>
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 shrink-0" style={{ color: iconColor }} />
      <span className="truncate text-[9px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>{label}</span>
    </div>
    <p className="font-heading mt-1.5 text-2xl leading-none">{value}</p>
    {typeof delta === "number" && (
      <p className="mt-1 text-[11px] font-bold"
        style={{ color: (invert ? delta <= 0 : delta >= 0) ? C.primary : C.red }}>
        {(delta >= 0 ? "+" : "") + nf1.format(delta) + "%"}
      </p>
    )}
    {note && <p className="mt-1 text-[11px] font-semibold" style={{ color: noteColor || C.primary }}>{note}</p>}
  </div>
);

const Sub = ({ icon: Icon, title, sub, color = C.primary, right }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <div className="flex items-center gap-2.5">
      <IconTile icon={Icon} color={color} size={28} />
      <div>
        <h3 className="font-heading text-lg leading-none">{title}</h3>
        {sub && <p className="mt-0.5 text-[10px]" style={{ color: C.muted }}>{sub}</p>}
      </div>
    </div>
    {right}
  </div>
);

/* ══════════════════════════ FUNIL / HEATMAP ═════════════════════════ */
function FunnelSvg({ steps, big }) {
  const W = 340, H = 300, top = steps[0].value || 1, sh = H / steps.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: big ? 560 : 300 }}>
      {steps.map((s, i) => {
        const wTop = (s.value / top) * (W * 0.80);
        const next = steps[i + 1] ? (steps[i + 1].value / top) * (W * 0.80) : wTop * 0.9;
        const y = i * sh, y2 = y + sh - 5, cx = W * 0.44;
        const pts = [[cx - wTop / 2, y], [cx + wTop / 2, y], [cx + next / 2, y2], [cx - next / 2, y2]].map((p) => p.join(",")).join(" ");
        return (
          <g key={s.name}>
            <polygon points={pts} fill={s.color} fillOpacity="0.22" stroke={s.color} strokeWidth="1.5" />
            <text x={cx} y={y + sh / 2 - 2} textAnchor="middle" fontFamily="Bebas Neue, sans-serif" fontSize="12" fill={C.fg}>{int(s.value)}</text>
            <text x={cx} y={y + sh / 2 + 8} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="5.2" letterSpacing="0.7" fill={C.muted}>
              {s.name.toUpperCase()}
            </text>
            <text x={W - 2} y={y + sh / 2 + 2} textAnchor="end" fontFamily="Bebas Neue, sans-serif" fontSize="11" fill={s.color}>
              {pct((s.value / top) * 100)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Heatmap({ matrix, max }) {
  const [hov, setHov] = useState(null);
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: "44px repeat(7,1fr)" }}>
        <div />
        {DOWS.map((d) => <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>{d}</div>)}
        {FAIXAS.map((f, fi) => (
          <React.Fragment key={f}>
            <div className="flex items-center justify-end pr-1 text-[10px]" style={{ color: C.muted }}>{f}</div>
            {DOWS.map((_, di) => {
              const v = matrix[fi][di], a = v / max, on = hov && hov[0] === fi && hov[1] === di;
              return (
                <div key={di} className="relative h-8 cursor-pointer transition-transform"
                  onMouseEnter={() => setHov([fi, di])} onMouseLeave={() => setHov(null)}
                  style={{
                    borderRadius: R, background: `rgba(85,245,47,${(0.06 + a * 0.9).toFixed(3)})`,
                    border: `1px solid ${on ? C.primary : "transparent"}`,
                    transform: on ? "scale(1.06)" : "none", boxShadow: on ? `0 0 12px ${C.primary}66` : "none",
                  }}>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
                    style={{ color: a > 0.5 ? "#0b1508" : C.muted }}>{on ? int(v) : ""}</span>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: C.muted }}>Menos</span>
        {[0.1, 0.3, 0.5, 0.7, 0.95].map((a) => <span key={a} className="h-2.5 w-5" style={{ background: `rgba(85,245,47,${a})`, borderRadius: R }} />)}
        <span className="text-[10px] uppercase tracking-widest" style={{ color: C.muted }}>Mais</span>
      </div>
    </div>
  );
}

const CreativePreview = ({ v }) => {
  const t = [{ a: C.orange, b: C.secondary, p: "#2a1b12" }, { a: C.primary, b: C.blue, p: "#12220f" }, { a: C.blue, b: C.red, p: "#101a2a" }][v];
  return (
    <svg viewBox="0 0 200 200" className="block w-full">
      <defs><linearGradient id={`cg${v}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={t.a} stopOpacity="0.5" /><stop offset="100%" stopColor={t.b} stopOpacity="0.25" />
      </linearGradient></defs>
      <rect width="200" height="200" fill={t.p} /><rect width="200" height="200" fill={`url(#cg${v})`} />
      <circle cx="100" cy="82" r="38" fill="#000" opacity="0.3" />
      <circle cx="100" cy="80" r="34" fill="#fff" opacity="0.12" />
      <circle cx="100" cy="80" r="24" fill={t.a} opacity="0.5" />
      <rect x="30" y="140" width="100" height="8" fill="#fff" opacity="0.45" />
      <rect x="30" y="154" width="66" height="6" fill="#fff" opacity="0.25" />
      <rect x="30" y="172" width="64" height="18" fill={C.primary} />
      <text x="62" y="185" textAnchor="middle" fontFamily="Bebas Neue" fontSize="13" fill="#000">PEDIR</text>
    </svg>
  );
};

/* ══════════════════════════════ APP ═════════════════════════════════ */
const PRESETS = [{ id: "7", d: 7, l: "7d" }, { id: "15", d: 15, l: "15d" }, { id: "30", d: 30, l: "30d" }, { id: "90", d: 90, l: "90d" }];
const SECTIONS = [
  { id: "vendas", label: "Vendas", icon: BarChart3 },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "funil", label: "Funil", icon: Filter },
  { id: "trafego", label: "Tráfego", icon: Megaphone },
];

export default function App() {
  const series = useMemo(build, []);
  const [preset, setPreset] = useState("30");
  const [from, setFrom] = useState(iso(addD(TODAY, -29)));
  const [to, setTo] = useState(iso(TODAY));
  const [active, setActive] = useState("vendas");
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-40% 0px -55% 0px" });
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    const onScroll = () => setShowTop(window.scrollY > 700);
    window.addEventListener("scroll", onScroll);
    return () => { obs.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, []);

  const goTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const range = useMemo(() => {
    if (preset === "custom") return { from, to };
    const d = PRESETS.find((p) => p.id === preset).d;
    return { from: iso(addD(TODAY, -(d - 1))), to: iso(TODAY) };
  }, [preset, from, to]);

  const { rows, A, P } = useMemo(() => {
    const s = Math.max(0, series.findIndex((r) => r.key >= range.from));
    let e = series.length - 1;
    for (let i = series.length - 1; i >= 0; i--) if (series[i].key <= range.to) { e = i; break; }
    const rws = series.slice(s, e + 1), len = rws.length || 1;
    return { rows: rws, A: agg(rws), P: agg(series.slice(Math.max(0, s - len), s)) };
  }, [series, range]);

  const d = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const thin = (arr, n) => { const st = Math.max(1, Math.ceil(arr.length / n)); return arr.filter((_, i) => i % st === 0 || i === arr.length - 1); };

  const chart = useMemo(() => thin(rows, 40).map((r) => ({
    name: r.label, receita: Math.round(r.receita), pedidos: r.pedidos,
    conv: +((r.pedidos / r.acessos) * 100).toFixed(2), novos: r.novos, seguidores: r.seguidores,
    cac: +((r.metaSpend + r.gCost) / (r.novos || 1)).toFixed(2),
    meta: Math.round(r.metaSpend), google: Math.round(r.gCost),
  })), [rows]);


  const heat = useMemo(() => {
    const m = FAIXAS.map(() => Array(7).fill(0));
    rows.forEach((r) => {
      const rr = rng(r.pedidos * 31 + r.dow);
      FAIXA_W.forEach((w, fi) => { m[fi][r.dow] += r.pedidos * w * (0.82 + 0.36 * rr()); });
    });
    const cnt = Array(7).fill(0); rows.forEach((r) => cnt[r.dow]++);
    m.forEach((row, fi) => row.forEach((v, di) => (m[fi][di] = cnt[di] ? Math.round(v / cnt[di]) : 0)));
    return m;
  }, [rows]);
  const heatMax = Math.max(...heat.flat(), 1);

  const funil = [
    { name: "Acessos", value: A.acessos, color: C.blue, icon: Eye },
    { name: "Viu itens", value: A.viewItens, color: "#4aa8ff", icon: MousePointerClick },
    { name: "Carrinho", value: A.carrinho, color: C.secondary, icon: ShoppingBag },
    { name: "Checkout", value: A.checkout, color: C.orange, icon: Receipt },
    { name: "Pedidos", value: A.pedidos, color: C.primary, icon: Zap },
  ];

  const META_MES = 260000, saldoMeta = 2480, saldoGoogle = 1312.5;
  const runM = A.dias ? saldoMeta / (A.metaSpend / A.dias) : 0;
  const runG = A.dias ? saldoGoogle / (A.gCost / A.dias) : 0;
  const mes = new Date(range.to + "T12:00:00").getMonth();
  const diasMes = new Date(2026, mes + 1, 0).getDate();
  const baseTotal = A.ativos + A.inativos;
  const totRec = RECORRENCIA.reduce((s, x) => s + x.qtd, 0);

  return (
    <div className="min-h-screen font-sans" style={{ background: C.bg, color: C.fg }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap');
        .font-sans{font-family:Inter,ui-sans-serif,system-ui,sans-serif}
        .font-heading{font-family:'Bebas Neue',Impact,sans-serif;letter-spacing:.02em}
        html{scroll-behavior:smooth}
        section[id]{scroll-margin-top:126px}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(1);opacity:.5;cursor:pointer}
        ::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-thumb{background:#2a2d3a}::-webkit-scrollbar-track{background:#0e0f14}
        @keyframes flash{0%{box-shadow:0 0 4px 1px rgba(85,245,47,.6),0 0 12px 3px rgba(85,245,47,.3)}100%{box-shadow:none}}
        .neon:active{animation:flash .4s ease-out forwards}
      `}</style>

      {/* HEADER */}
      <header className="sticky top-0 z-40" style={{ background: C.dark, borderBottom: `1px solid ${C.hair}` }}>
        <div className="mx-auto flex h-13 max-w-[1560px] items-center gap-3 px-5 py-2.5">
          <span className="font-heading text-2xl leading-none" style={{ color: C.primary }}>ONMID</span>
          <span className="h-4 w-px" style={{ background: C.hair }} />
          <Store className="h-4 w-4" style={{ color: C.muted }} />
          <span className="text-sm font-semibold">Sabor &amp; Cia</span>
          <div className="ml-3 hidden items-center gap-1.5 xl:flex">
            {[<MetaMark key="m" s={13} />, <GoogleAdsMark key="g" s={13} />, <InstagramMark key="i" s={13} />].map((m, i) => (
              <span key={i} className="flex items-center gap-1 px-1.5 py-1" style={{ border: `1px solid ${C.border}`, borderRadius: R, background: C.card }}>
                {m}<span className="h-1.5 w-1.5 rounded-full" style={{ background: C.primary }} />
              </span>
            ))}
          </div>
          <nav className="ml-auto hidden items-center gap-1 lg:flex">
            {SECTIONS.map((s) => (
              <button key={s.id} onClick={() => goTo(s.id)}
                className="neon flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-widest"
                style={{
                  borderRadius: R, color: active === s.id ? C.primary : C.muted,
                  background: active === s.id ? C.primary + "14" : "transparent",
                  border: `1px solid ${active === s.id ? C.primary + "4d" : "transparent"}`,
                }}><s.icon className="h-3.5 w-3.5" />{s.label}</button>
            ))}
          </nav>
          <button className="neon ml-auto flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-widest lg:ml-2"
            style={{ border: `1px solid ${C.border}`, borderRadius: R }}>
            <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Exportar</span>
          </button>
        </div>

        <div style={{ background: C.card, borderTop: `1px solid ${C.border}` }}>
          <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-3 px-5 py-2">
            <Calendar className="h-3.5 w-3.5" style={{ color: C.muted }} />
            <div className="flex" style={{ border: `1px solid ${C.border}`, borderRadius: R }}>
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => setPreset(p.id)} className="neon px-3 py-1 text-[11px] font-bold uppercase tracking-widest"
                  style={{ background: preset === p.id ? C.primary : "transparent", color: preset === p.id ? "#000" : C.muted }}>{p.l}</button>
              ))}
              <button onClick={() => setPreset("custom")} className="neon px-3 py-1 text-[11px] font-bold uppercase tracking-widest"
                style={{ background: preset === "custom" ? C.primary : "transparent", color: preset === "custom" ? "#000" : C.muted, borderLeft: `1px solid ${C.border}` }}>Datas</button>
            </div>
            {preset === "custom" && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1 text-[11px]"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: R, color: C.fg }} />
                <ArrowRight className="h-3 w-3" style={{ color: C.muted }} />
                <input type="date" value={to} min={from} max={iso(TODAY)} onChange={(e) => setTo(e.target.value)} className="px-2 py-1 text-[11px]"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: R, color: C.fg }} />
              </div>
            )}
            {/* resumo sempre visível ao lado do seletor — aproveita a faixa inteira */}
            <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
              {[["Vendido", brlK(A.receita), C.primary], ["Pedidos", int(A.pedidos), C.blue],
                ["Ticket", brl(A.ticket), C.orange], ["ROAS", nf1.format(A.receita / (A.inv || 1)) + "x", C.fg]].map(([l, v, c]) => (
                <span key={l} className="flex items-baseline gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>{l}</span>
                  <span className="font-heading text-lg leading-none" style={{ color: c }}>{v}</span>
                </span>
              ))}
              <span className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: C.yellow, border: `1px solid ${C.yellow}4d`, background: C.yellow + "14", borderRadius: R, padding: "1px 6px" }}>Demo</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1560px] space-y-12 px-5 py-6">

        {/* ═══════ 01 VENDAS ═══════ */}
        <section id="vendas">
          <Card>
            <div className="grid grid-cols-3 gap-4">
              {/* 1 — Valor vendido */}
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center gap-3">
                  <IconTile icon={Wallet} color={C.primary} size={44} />
                  <div className="min-w-0">
                    <Label>Valor vendido</Label>
                    <div className="mt-1.5 flex flex-wrap items-end gap-2.5">
                      <p className="font-heading text-6xl leading-none">{brlK(A.receita)}</p>
                      <Delta v={d(A.receita, P.receita)} />
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid flex-1 grid-cols-2 items-stretch gap-3">
                  <Mini big className="h-full" label="Anterior" value={brlK(P.receita)} />
                  <Mini big className="h-full" label="Média/dia" value={brlK(A.receita / (A.dias || 1))} />
                </div>
              </div>

              {/* 2 — Velocímetro da meta */}
              <div className="flex min-w-0 flex-col items-center border-l pl-4" style={{ borderColor: C.border }}>
                <div className="mb-1 flex w-full items-center gap-2">
                  <IconTile icon={Target} color={C.primary} size={26} />
                  <div className="min-w-0">
                    <h3 className="truncate font-heading text-base leading-none">Meta de {MESES[mes]}</h3>
                    <p className="mt-0.5 text-[10px]" style={{ color: C.muted }}>
                      {diasMes - new Date(range.to + "T12:00:00").getDate()} dias restantes
                    </p>
                  </div>
                </div>
                <div className="flex flex-1 items-center">
                  <Gauge value={A.receita} max={META_MES} color={C.primary}
                    unit={Math.round((A.receita / META_MES) * 100) + "%"} caption="DA META" size={210} />
                </div>
              </div>

              {/* 3 — O que falta para bater a meta */}
              <div className="flex min-w-0 flex-col justify-center gap-2 border-l pl-4" style={{ borderColor: C.border }}>
                <Mini label="Meta" value={brlK(META_MES)} icon={Target} iconColor={C.primary} />
                <Mini label="Falta" value={brlK(Math.max(0, META_MES - A.receita))} icon={TrendingUp} iconColor={C.yellow} />
                <Mini label="Precisa/dia" value={brlK(Math.max(0, META_MES - A.receita) / Math.max(1, diasMes - new Date(range.to + "T12:00:00").getDate()))}
                  sub={`Ritmo atual: ${brlK(A.receita / (A.dias || 1))}`} icon={CalendarClock} iconColor={C.orange} />
              </div>
            </div>

            {/* Gráfico de faturamento ocupa a largura toda da box */}
            <div className="mt-4 h-[184px] pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 4, right: 0, left: -14, bottom: 0 }}>
                  <defs><linearGradient id="hero" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.primary} stopOpacity={0.32} /><stop offset="95%" stopColor={C.primary} stopOpacity={0} />
                  </linearGradient></defs>
                  <CartesianGrid stroke={C.border} strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={kNum} />
                  <Tooltip {...tt} formatter={(v) => brlK(v)} />
                  <Area type="monotone" dataKey="receita" stroke={C.primary} strokeWidth={2} fill="url(#hero)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={ShoppingBag} color={C.blue} label="Pedidos" value={int(A.pedidos)} delta={d(A.pedidos, P.pedidos)}
              spark={rows.map((r) => r.pedidos)} sub={`${nf1.format(A.pedidos / (A.dias || 1))} por dia`} />
            <Stat icon={Receipt} color={C.orange} label="Ticket médio" value={brl(A.ticket)} delta={d(A.ticket, P.ticket)}
              spark={rows.map((r) => r.receita / (r.pedidos || 1))} sub={`Anterior: ${brl(P.ticket)}`} />
            <Stat icon={UserPlus} color={C.secondary} label="Novos clientes" value={int(A.novos)} delta={d(A.novos, P.novos)}
              spark={rows.map((r) => r.novos)} sub={`${pct((A.novos / (A.pedidos || 1)) * 100)} dos pedidos`} />
            <Stat icon={Target} color={C.yellow} label="Custo por novo cliente" value={brl(A.cac)} delta={d(A.cac, P.cac)} invert
              spark={rows.map((r) => (r.metaSpend + r.gCost) / (r.novos || 1))} sub={`${brlK(A.inv)} ÷ ${int(A.novos)} novos`} />
          </div>

          <Card className="mt-4">
            <Sub icon={Flame} title="Mapa de calor de pedidos" color={C.orange} sub="Média por dia da semana e faixa de horário"
              right={<span className="flex items-center gap-1.5 text-[11px]" style={{ color: C.muted }}><Clock className="h-3.5 w-3.5" />Pico 19–21h</span>} />
            <Heatmap matrix={heat} max={heatMax} />
          </Card>
        </section>

        {/* ═══════ 02 CLIENTES ═══════ */}
        <section id="clientes">
          <Chapter icon={Users} title="Clientes" color={C.secondary} sub={`${int(baseTotal)} cadastrados na base`}
            right={<div className="flex gap-4">
              {[["Ativos", int(A.ativos), C.primary], ["Inativos", int(A.inativos), C.red], ["Novos no período", int(A.novos), C.secondary]].map(([l, v, c]) => (
                <div key={l} className="text-right"><Label>{l}</Label>
                  <p className="font-heading text-xl leading-none" style={{ color: c }}>{v}</p></div>
              ))}
            </div>} />

          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-6 flex flex-col">
              <Sub icon={Users} title="Composição da base" color={C.primary} sub="Foto do último dia do período" />
              <div className="flex flex-1 items-center gap-5">
                <Ring p={A.ativos / baseTotal} color={C.primary} size={140}>
                  <div className="text-center">
                    <p className="font-heading text-3xl leading-none">{pct((A.ativos / baseTotal) * 100).replace("%", "")}</p>
                    <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Ativos</p>
                  </div>
                </Ring>
                <div className="flex-1 space-y-2">
                  {[["Ativos ≤30d", A.ativos, C.primary], ["Inativos 30–60d", A.i3060, C.orange], ["Inativos +60d", A.i60, C.red]].map(([l, v, c]) => (
                    <div key={l}>
                      <div className="flex justify-between text-[11px]">
                        <span className="flex items-center gap-1.5" style={{ color: C.muted }}><span className="h-2 w-2" style={{ background: c }} />{l}</span>
                        <span className="font-bold">{int(v)}</span>
                      </div>
                      <div className="mt-1 h-1" style={{ background: C.border }}>
                        <div className="h-1" style={{ width: (v / baseTotal) * 100 + "%", background: c }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Mini label="Reativáveis" value={int(A.i3060)} sub="Pararam há pouco" color={C.orange} icon={Repeat} iconColor={C.orange} />
                <Mini label="Valor da base" value={brlK(baseTotal * A.ticket * 0.3)} sub="Potencial/mês" color={C.primary} icon={Wallet} iconColor={C.primary} />
              </div>
            </Card>

            <Card className="col-span-6">
              <Sub icon={Repeat} title="Recorrência" color={C.blue} sub="Pedidos por cliente na vida" />
              <div className="space-y-2.5">
                {RECORRENCIA.map((r) => (
                  <div key={r.nome}>
                    <div className="flex items-end justify-between">
                      <span className="text-[13px]">{r.nome}</span>
                      <span className="flex items-baseline gap-2">
                        <span className="text-[11px]" style={{ color: C.muted }}>{pct((r.qtd / totRec) * 100)}</span>
                        <span className="font-heading text-lg leading-none">{int(r.qtd)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2.5" style={{ background: C.border }}>
                      <div className="h-2.5" style={{ width: (r.qtd / totRec) * 100 + "%", background: r.cor, boxShadow: `0 0 10px ${r.cor}55` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2.5 p-2.5" style={{ borderRadius: R, border: `1px solid ${C.orange}4d`, background: C.orange + "12" }}>
                <Repeat className="mt-0.5 h-4 w-4 shrink-0" style={{ color: C.orange }} />
                <p className="text-[12px]">{pct((RECORRENCIA[0].qtd / totRec) * 100)} da base comprou só uma vez. A segunda compra é o crescimento mais barato.</p>
              </div>
            </Card>

            <Card className="col-span-12">
              <Sub icon={UserPlus} title="Aquisição" color={C.secondary} sub="Novos clientes e custo por cliente"
                right={<Delta v={d(A.cac, P.cac)} invert small />} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Novos por dia</Label>
                  <div className="mt-1 h-[118px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart} margin={{ top: 4, right: 0, left: -26, bottom: 0 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 8, fill: C.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9, fill: C.muted }} axisLine={false} tickLine={false} />
                        <Tooltip {...tt} />
                        <Bar dataKey="novos" fill={C.secondary} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <Label>Custo por cliente</Label>
                  <div className="mt-1 h-[118px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chart} margin={{ top: 4, right: 0, left: -26, bottom: 0 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 8, fill: C.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9, fill: C.muted }} axisLine={false} tickLine={false} />
                        <Tooltip {...tt} formatter={(v) => brl(v)} />
                        <Line type="monotone" dataKey="cac" stroke={C.yellow} strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Mini label="Novos no período" value={int(A.novos)} sub={`${nf1.format(A.novos / (A.dias || 1))} por dia`} color={C.secondary} />
                <Mini label="CAC médio" value={brl(A.cac)} sub={`Retorno em ${nf1.format(A.cac / A.ticket)} pedidos`} color={C.yellow} />
              </div>
            </Card>
          </div>

        </section>

        {/* ═══════ 03 FUNIL ═══════ */}
        <section id="funil">
          <Chapter icon={Filter} title="Funil do cardápio" color={C.blue} sub="Do acesso ao pedido concluído"
            right={<div className="flex gap-4">
              {[["Conversão geral", pct(A.conv), C.primary], ["Valor/acesso", brl(A.receita / (A.acessos || 1)), C.blue],
                ["Custo/acesso", brl(A.inv / (A.acessos || 1)), C.secondary]].map(([l, v, c]) => (
                <div key={l} className="text-right"><Label>{l}</Label>
                  <p className="font-heading text-xl leading-none" style={{ color: c }}>{v}</p></div>
              ))}
            </div>} />

          <Card>
            <div className="grid grid-cols-2 gap-6">
              <div className="flex items-center"><FunnelSvg steps={funil} big /></div>
              <div className="flex flex-col justify-center space-y-2.5">
                {funil.slice(1).map((s, i) => {
                  const prevS = funil[i], conv = (s.value / prevS.value) * 100, warn = conv < 55;
                  return (
                    <div key={s.name} className="flex items-center gap-3 p-3" style={{ background: C.elev, borderRadius: R }}>
                      <Ring p={conv / 100} color={warn ? C.red : s.color} size={52}>
                        <span className="font-heading text-[13px]">{Math.round(conv)}%</span>
                      </Ring>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold">{prevS.name} → {s.name}</p>
                        <p className="text-[11px]" style={{ color: warn ? C.red : C.muted }}>
                          {int(prevS.value - s.value)} saíram nesta etapa
                        </p>
                      </div>
                      <p className="font-heading text-2xl leading-none">{int(s.value)}</p>
                    </div>
                  );
                })}
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <Mini label="Carrinhos abandonados" value={int(A.carrinho - A.pedidos)} sub={`≈ ${brlK((A.carrinho - A.pedidos) * A.ticket)} na mesa`} color={C.red} icon={ShoppingBag} iconColor={C.red} />
                  <Mini label="Checkouts parados" value={int(A.checkout - A.pedidos)} sub="Recuperáveis no WhatsApp" color={C.orange} icon={Receipt} iconColor={C.orange} />
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* ═══════ 04 TRÁFEGO ═══════ */}
        <section id="trafego">
          <Chapter icon={Megaphone} title="Tráfego" color={C.blue} sub="Meta Ads · Google Ads"
            right={<div className="flex gap-4">
              {[["Investido", brlK(A.inv), C.fg], ["ROAS", nf1.format(A.receita / (A.inv || 1)) + "x", C.primary],
                ["Alcance", kNum(A.metaReach), C.orange]].map(([l, v, c]) => (
                <div key={l} className="text-right"><Label>{l}</Label>
                  <p className="font-heading text-xl leading-none" style={{ color: c }}>{v}</p></div>
              ))}
            </div>} />

          {/* RESUMO DE TRÁFEGO — painéis lado a lado */}
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest" style={{ color: C.fg }}>Resumo de tráfego</p>
          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-6">
              <div className="mb-3 flex items-center gap-2.5">
                <MetaMark s={18} />
                <h3 className="font-heading text-xl leading-none">Meta Ads</h3>
                <span className="text-[11px]" style={{ color: C.muted }}>Facebook + Instagram</span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <Tile icon={Wallet} iconColor={C.meta} label="Saldo Meta Ads" value={brl(saldoMeta)}
                  note={`${Math.floor(runM)} dias de fôlego`} noteColor={runM < 7 ? C.red : C.primary} />
                <Tile icon={Eye} iconColor={C.meta} label="Alcance" value={kNum(A.metaReach)} delta={d(A.metaReach, P.metaReach)} />
                <Tile icon={MousePointerClick} iconColor={C.primary} label="CTR" value={pct(A.metaCtr)} delta={d(A.metaCtr, P.metaCtr)} />
                <Tile icon={Zap} iconColor={C.orange} label="Cliques" value={int(A.metaClicks)} delta={d(A.metaClicks, P.metaClicks)} />
                <Tile icon={Target} iconColor={C.yellow} label="CPC médio" value={brl(A.metaCpc)} delta={d(A.metaCpc, P.metaCpc)} invert />
              </div>
            </Card>

            <Card className="col-span-6">
              <div className="mb-3 flex items-center gap-2.5">
                <GoogleAdsMark s={18} />
                <h3 className="font-heading text-xl leading-none">Google Ads</h3>
                <span className="text-[11px]" style={{ color: C.muted }}>Search + Performance Max</span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <Tile icon={Wallet} iconColor={C.gBlue} label="Saldo Google Ads" value={brl(saldoGoogle)}
                  note={`${Math.floor(runG)} dias de fôlego`} noteColor={runG < 7 ? C.red : C.primary} />
                <Tile icon={Eye} iconColor={C.gBlue} label="Impressões" value={kNum(A.gImpr)} delta={d(A.gImpr, P.gImpr)} />
                <Tile icon={MousePointerClick} iconColor={C.gYellow} label="Cliques" value={int(A.gClicks)} delta={d(A.gClicks, P.gClicks)} />
                <Tile icon={Target} iconColor={C.orange} label="CPC médio" value={brl(A.gCpc)} delta={d(A.gCpc, P.gCpc)} invert />
                <Tile icon={Zap} iconColor={C.gGreen} label="Conversões" value={int(A.gConv)} delta={d(A.gConv, P.gConv)} />
              </div>
            </Card>
          </div>

          <p className="mb-3 mt-8 text-[11px] font-bold uppercase tracking-widest" style={{ color: C.fg }}>Criativos</p>
          <Card>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MetaMark s={16} />
                  <Label>Melhores criativos</Label>
                </div>
                <span className="text-[10px] uppercase tracking-widest" style={{ color: C.muted }}>Por ROAS</span>
              </div>
              <div className="grid grid-cols-6 gap-3">
                {CRIATIVOS.map((cr, i) => (
                  <div key={cr.id} className="overflow-hidden" style={{ border: `1px solid ${C.border}`, borderRadius: R, background: C.elev }}>
                    <div className="relative">
                      <CreativePreview v={cr.v} />
                      {i === 0 && <span className="absolute left-1.5 top-1.5 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest"
                        style={{ background: C.primary, color: "#000", borderRadius: R }}>Top</span>}
                      {cr.tipo !== "Imagem" && (
                        <span className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center" style={{ background: "#000a", borderRadius: R }}>
                          <Play className="h-2.5 w-2.5" /></span>
                      )}
                    </div>
                    <div className="p-1.5">
                      <p className="truncate text-[10px] font-semibold">{cr.nome}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[9px]" style={{ color: C.muted }}>CTR {pct(cr.ctr)}</span>
                        <span className="font-heading text-sm" style={{ color: C.primary }}>{nf1.format(cr.roas)}x</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          </Card>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
          <p className="text-[11px] uppercase tracking-widest" style={{ color: C.muted }}>ON_Reports · Onmid — demonstração com dados fictícios</p>
          <p className="text-[11px]" style={{ color: C.muted }}>Atualizado em 12/08/2026 às 09:42</p>
        </footer>
      </main>

      {showTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="neon fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center"
          style={{ background: C.primary, color: "#000", borderRadius: R, boxShadow: `0 0 16px ${C.primary}66` }}>
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
