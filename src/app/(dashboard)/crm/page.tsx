"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useAbaPersistida } from '@/lib/aba-persistida';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useSortable, SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import {
  Plus, Search, MoreVertical, RefreshCw,
  Users, CalendarDays, HeartHandshake, CircleDollarSign,
  ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal,
  Trash2, Pencil, Sparkles, Clock3, LayoutGrid, List, ArrowUpDown,
  BarChart3, UserRound, MessageCircle, X, Send, GripVertical, Layers, WifiOff, Link2,
  Clapperboard, Info, MapPin, ClipboardList, BadgeCheck, BookmarkPlus, Check, Star } from 'lucide-react';
import { ChatView } from './chat-view';
import { ConectarWhatsappModal } from './conectar-whatsapp';
import { LeadChatPanel } from './lead-chat-panel';
import { CamposAtendimento, HistoricoLead, NovoLeadModal, opcoesDeOrigem } from './lead-operacao';
import { ModoClienteContext, useEhGestorCliente, useEhUsuarioCliente, useMeuNome, useModoCliente } from '@/lib/modo-cliente';
import { EquipeCliente } from './cliente-gestor';
import { AcessosClienteModal } from './acessos-cliente-modal';
import { SeletorModeloFunil } from '@/components/crm/seletor-modelo-funil';
import { AplicarModeloFunil } from '@/components/crm/aplicar-modelo-funil';
import { FollowupTab, useActiveFollowups, FollowupBadge } from './followup-tab';
import Link from 'next/link';
import { CreativeLibrary } from '@/components/creative-library';
import { useClients } from '@/lib/client-store';
import { ClientAvatar, fetchClientPicture } from '@/components/client-avatar';
import { DictateButton } from '@/components/ui/dictate-button';
import { notificar } from '@/components/ui/toast';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import AnaliseIaModal from './analise-ia-modal';
import MotivoPerdaModal from './motivo-perda-modal';
import { rotuloMotivo, type MotivoPerdaId } from '@/lib/motivo-perda';
import { localDoLead, type RespostaFormulario } from '@/lib/lead-formulario';
import type { Client } from '@/lib/mock-data';
import type { AttendanceAudit, ItemHistoricoAuditoria } from '@/lib/crm-attendance-audit';
import type { MesAtendimento, TentativasContato } from '@/lib/crm-atendimento-evolucao';
import { classificarEtapa, corDaEtapa, MODELO_PADRAO, OPCOES_EDITOR, opcaoDoValor, ROTULOS_ETAPA, valorOpcaoEditor, type EtapaFunil, type SituacaoStage } from '@/lib/funil-etapas';

// ── Busca de lead ────────────────────────────────────────────────────────────
// Sem acento e sem formatação: "joao" acha "João" e "(43) 99975-3604" acha
// "554399753604". Número também casa com e sem o nono dígito, porque o WhatsApp
// grava muitos números SEM ele e o gestor digita COM.
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
type Busca = { texto: string; numeros: string[] };
function prepararBusca(q: string): Busca | null {
  const texto = semAcento(q.trim());
  if (!texto) return null;
  const d = q.replace(/\D/g, '');
  const numeros: string[] = [];
  if (d.length >= 4) {
    numeros.push(d);
    const local = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;   // tira o 55
    if (local !== d) numeros.push(local);
    if (local.length === 11 && local[2] === '9') numeros.push(local.slice(0, 2) + local.slice(3)); // sem o nono dígito
    if (local.length === 10) numeros.push(local.slice(0, 2) + '9' + local.slice(2));               // com o nono dígito
  }
  return { texto, numeros };
}
function leadCasaBusca(l: { nome: string | null; numero: string | null; canal: string | null; bairro: string | null; observacao: string | null; email?: string | null }, b: Busca) {
  if (b.numeros.length) {
    const n = (l.numero ?? '').replace(/\D/g, '');
    if (n && b.numeros.some(x => n.includes(x))) return true;
  }
  return [l.nome, l.canal, l.bairro, l.observacao, l.email].some(v => v && semAcento(v).includes(b.texto));
}

/** Mensagens copiadas da conversa que provam a nota (o "print"). */
type TrechoAtendimento = { d: 'in' | 'out'; em: string; t: string | null; autor?: string | null };

type CrmLead = {
  id: string; client_id: string; mes: string | null; data: string | null;
  link_criativo: string | null; nome: string | null; numero: string | null;
  canal: string | null; origin?: string | null; emoji: string | null;
  dia1: boolean; dia2: boolean; dia3: boolean; dia4: boolean;
  status: string | null; data_agendada: string | null;
  video_dra: boolean; compareceu: boolean; observacao: string | null;
  orcamento: number | string | null; fechou: boolean; valor_rs: number | string | null;
  /** Estimativa do negócio em ABERTO. Nunca é receita — ver `valorDoLead`. */
  valor_negocio?: number | string | null;
  pagamento: string | null; analise_credito: boolean;
  data_nasc: string | null; bairro: string | null;
  motivacoes: string | null; dores: string | null;
  qualificado?: boolean;
  engajado?: boolean;
  temperatura?: 'quente' | 'morno' | 'frio' | null;
  temperatura_atualizada_em?: string | null;
  ia_ultimo_analise?: string | null;
  ia_confianca_ultimo?: number | null;
  /** Nota 0–5 do ATENDIMENTO deste lead (rotina diária). null = ainda sem nota ou não é lead. */
  nota_atendimento?: number | null;
  nota_atendimento_motivo?: string | null;
  nota_atendimento_ajuste?: string | null;
  nota_atendimento_trecho?: TrechoAtendimento[] | null;
  nota_atendimento_em?: string | null;
  time_interno?: boolean;
  ctwa_clid?: string | null;
  source_id?: string | null;
  source_url?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  campaign_name?: string | null;
  adset_name?: string | null;
  ad_name?: string | null;
  creative_name?: string | null;
  first_origin_at?: string | null;
  instance_id?: string | null;
  email?: string | null;
  city?: string | null;
  regiao_cidade?: string | null;
  regiao_uf?: string | null;
  regiao_fonte?: string | null;
  last_contact_at?: string | null;
  whatsapp_last_message_at?: string | null;
  whatsapp_last_message_text?: string | null;
  whatsapp_last_direction?: 'in' | 'out' | null;
  updated_at?: string | null;
  /** Quem cuida do lead. Definido à mão (`responsavel_manual`) vence a integração. */
  responsavel?: string | null;
  responsavel_manual?: boolean;
  /** 'HH:MM' — separado de `data_agendada` (DATE) de propósito; ver crm-eventos.ts. */
  hora_agendada?: string | null;
  proxima_acao?: string | null;
  proxima_acao_em?: string | null;
  created_at: string | null;
};

type Draft = Partial<Omit<CrmLead, 'id' | 'client_id' | 'created_at'>>;

type CrmFunnel = { id: string; name: string; created_at: string };
type CrmStage  = { id: string; label: string; color: string; position: number; etapa_funil?: EtapaFunil | null; situacao?: SituacaoStage | null };
type LocalStage = CrmStage & { _isNew?: boolean };
type CrmTab = 'leads' | 'chat' | 'followup' | 'attendance' | 'disparos' | 'ads' | 'resultados' | 'equipe';
// ⚠️ 'capture' saiu daqui: Fontes de Captura virou sub-aba de Integrações do
// cliente (`?tab=rastreio&sub=captura`), junto das demais integrações. Quem
// tiver 'capture' salvo no localStorage cai no fallback 'leads'.
const ABAS_CRM = ['leads', 'chat', 'followup', 'attendance', 'disparos', 'ads', 'resultados', 'equipe'] as const;
type DatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'last15' | 'last14' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

type AttendanceMetrics = {
  summary: {
    total_leads: number;
    active_conversations: number;
    inbound_messages: number;
    outbound_messages: number;
    avg_response_seconds: number | null;
    avg_first_response_seconds: number | null;
    unanswered_chats: number;
    max_waiting_seconds: number | null;
    under_5: number;
    under_15: number;
    under_60: number;
    over_60: number;
  };
  /** Mesmo recorte, janela anterior de igual duração. Null em "todo o período". */
  previous?: AttendanceMetrics['summary'] | null;
  previousPeriod?: { from: string; to: string } | null;
  /** Estado de cada conversa — partição, soma = total de leads. */
  classification?: {
    encerrado: number; sem_conversa: number; sem_resposta: number;
    aguardando_retorno: number; em_atendimento: number;
  };
  /** Últimos 7 dias, medidos de `crm_messages` em BRT. */
  daily?: Array<{ dia: string; avg_response_seconds: number | null; respostas: number; sem_resposta: number }>;
  /** Só quem enviou PELA TELA tem autoria; follow-up/disparo/webhook ficam fora. */
  atendentes?: Array<{
    autor_nome: string; enviadas: number; leads_atendidos: number; respostas: number;
    avg_response_seconds: number | null; ate_5min: number; mais_1h: number;
  }>;
  motivosPerda?: Array<{ motivo: string | null; total: number; detalhes: string[] }>;
  perdidosSemMotivo?: number;
  /** Mensagem nossa após ≥48h de silêncio, e quantas trouxeram resposta. */
  retomada?: { enviadas: number; responderam: number };
  /** Últimos 6 meses, pelo mês da MENSAGEM (não do lead). */
  mensal?: MesAtendimento[];
  /** Quem tentamos alcançar no período e quantas tentativas (dias) fizemos. */
  tentativas?: TentativasContato | null;
  sources: Array<{ canal: string | null; total: number }>;
  waiting: Array<{
    id: string;
    nome: string | null;
    numero: string | null;
    status: string | null;
    temperatura: string | null;
    canal: string | null;
    last_message_at: string;
    waiting_seconds: number;
  }>;
};

// "Comprou" saiu (fundido em "Fechado" — um ganho só; ver crm-saneamento.ts).
const STATUS_OPTIONS = ['Em Atendimento', 'Agendado', 'Reagendado', 'Fechado', 'Paciente', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];



const STATUS_KANBAN_COLOR: Record<string, string> = {
  'Em Atendimento': '#0ea5e9',
  'Agendado':       '#3b82f6',
  'Reagendado':     '#7dd3fc',
  'Fechado':        '#10b981',
  'Comprou':        '#34d399',
  'Paciente':       '#a1a1aa',
  'Não Retorna':    '#71717a',
  'Distante':       '#f97316',
  'Sem Interesse':  '#ef4444',
  'Desqualificado': '#dc2626',
};

const TEMPERATURE_LABEL: Record<string, string> = {
  quente: 'Quente',
  morno: 'Morno',
  frio: 'Frio',
};

const TEMPERATURE_BADGE: Record<string, string> = {
  quente: 'border-red-500/30 bg-red-500/15 text-red-300',
  morno: 'border-orange-500/30 bg-orange-500/15 text-orange-300',
  frio: 'border-blue-500/30 bg-blue-500/15 text-blue-300',
};

type ChannelMatch = {
  id: string;
  label: string;
  bg: string;
  icon: React.ReactNode;
  keywords: string[];
};

function IconWhatsapp() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path fill="currentColor" d="M10 2.4A7.2 7.2 0 0 0 3.8 13.2l-.9 3.3 3.4-.9A7.2 7.2 0 1 0 10 2.4Zm3.9 10.4c-.2.5-1.1.9-1.5 1-.4.1-.9.2-2.8-.6-2.3-1-3.8-3.4-3.9-3.6-.1-.1-.9-1.2-.9-2.3s.6-1.7.8-1.9c.2-.2.4-.3.6-.3h.4c.1 0 .3 0 .4.3.1.3.5 1.3.6 1.4 0 .1.1.3 0 .5l-.3.4c-.1.1-.2.3-.1.4.1.2.5.9 1.1 1.4.8.7 1.4.9 1.6 1 .1.1.3.1.4 0 .1-.2.5-.6.6-.8.2-.2.3-.2.5-.1l1.4.7c.3.1.4.2.5.3.1 0 .1.6-.1 1.1Z" />
    </svg>
  );
}

function IconFacebook() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path fill="currentColor" d="M11 5H9.6C8.7 5 8 5.7 8 6.6V8H6v2.5h2V17h3v-6.5h2.4L14 8h-3V6.8c0-.4.2-.6.6-.6H14V5h-3Z" />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14.2" cy="5.8" r="1" fill="currentColor" />
    </svg>
  );
}

function IconGoogleChannel() {
  return <span className="text-[12px] font-black leading-none">G</span>;
}

function IconText({ value }: { value: string }) {
  return <span className="text-[9px] font-black uppercase leading-none">{value}</span>;
}

const CHANNEL_MATCHES: ChannelMatch[] = [
  { id: 'whatsapp',  label: 'WhatsApp',  bg: 'bg-[#25D366]', icon: <IconWhatsapp />,      keywords: ['whatsapp', 'whats', 'zap', 'wpp', 'whats principal'] },
  { id: 'facebook',  label: 'Facebook',  bg: 'bg-[#1877F2]', icon: <IconFacebook />,      keywords: ['facebook', 'face', 'fb'] },
  { id: 'instagram', label: 'Instagram', bg: 'bg-[#E1306C]', icon: <IconInstagram />,     keywords: ['instagram', 'insta', 'ig'] },
  { id: 'google',    label: 'Google',    bg: 'bg-[#4285F4]', icon: <IconGoogleChannel />, keywords: ['google', 'adwords', 'pesquisa', 'gmb', 'google ads'] },
  { id: 'fachada',   label: 'Fachada',   bg: 'bg-slate-500', icon: <IconText value="fc" />, keywords: ['fachada', 'passou em frente', 'frente', 'placa', 'loja'] },
  { id: 'indicacao', label: 'Indicação', bg: 'bg-violet-600', icon: <IconText value="in" />, keywords: ['indicacao', 'indicação', 'indicado', 'recomendacao', 'recomendação'] },
  { id: 'site',      label: 'Site',      bg: 'bg-cyan-600',  icon: <IconText value="www" />, keywords: ['site', 'website', 'landing', 'lp'] },
  { id: 'tiktok',    label: 'TikTok',    bg: 'bg-zinc-900',  icon: <IconText value="tk" />, keywords: ['tiktok', 'tik tok'] },
  { id: 'youtube',   label: 'YouTube',   bg: 'bg-red-600',   icon: <IconText value="yt" />, keywords: ['youtube', 'you tube'] },
];


function toD(v: string | null | undefined) { return v ? String(v).split('T')[0] : ''; }
function monthFromDate(v: string | null | undefined) { return toD(v).slice(0, 7); }
function isDateInRange(v: string | null | undefined, from: string, to: string) {
  const date = toD(v);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
function fmtD(v: string | null) {
  const s = toD(v); if (!s) return '';
  const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`;
}
function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function presetDateRange(preset: DatePreset) {
  const today = new Date();
  const startThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const startLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

  if (preset === 'today') return { from: localDateString(today), to: localDateString(today) };
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return { from: localDateString(yesterday), to: localDateString(yesterday) };
  }
  if (preset === 'last7') return { from: localDateString(addDays(today, -6)), to: localDateString(today) };
  if (preset === 'last14') return { from: localDateString(addDays(today, -13)), to: localDateString(today) };
  if (preset === 'last15') return { from: localDateString(addDays(today, -14)), to: localDateString(today) };
  if (preset === 'last30') return { from: localDateString(addDays(today, -29)), to: localDateString(today) };
  if (preset === 'last90') return { from: localDateString(addDays(today, -89)), to: localDateString(today) };
  if (preset === 'thisYear') {
    return {
      from: localDateString(new Date(today.getFullYear(), 0, 1)),
      to: localDateString(new Date(today.getFullYear(), 11, 31)),
    };
  }
  if (preset === 'thisMonth') return { from: localDateString(startThisMonth), to: localDateString(endThisMonth) };
  if (preset === 'lastMonth') return { from: localDateString(startLastMonth), to: localDateString(endLastMonth) };
  return { from: '', to: '' };
}
function shortDateLabel(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
}
function periodLabel(preset: DatePreset, from: string, to: string) {
  const labels: Record<DatePreset, string> = {
    all: 'Todo período',
    today: 'Hoje',
    yesterday: 'Ontem',
    last7: 'Últimos 7d',
    last14: 'Últimos 14 dias',
    last15: 'Últimos 15d',
    last30: 'Últimos 30d',
    last90: 'Últimos 90d',
    thisMonth: 'Mês atual',
    lastMonth: 'Mês passado',
    thisYear: 'Este ano',
    custom: from || to ? `${from ? shortDateLabel(from) : 'Início'} até ${to ? shortDateLabel(to) : 'Hoje'}` : 'Personalizado',
  };
  return labels[preset];
}
function fmtTime(v: string | null) {
  if (!v) return '';
  try { return new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function toMoneyNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = value
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function fmtN(v: number | string | null) {
  const value = toMoneyNumber(v);
  return value ? formatCurrencyBRL(value) : '';
}
function normalizeChannelText(v: string) {
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
function detectChannels(value: string | null | undefined) {
  const normalized = normalizeChannelText(value ?? '');
  if (!normalized.trim()) return [];
  return CHANNEL_MATCHES.filter(channel => (
    channel.keywords.some(keyword => normalized.includes(normalizeChannelText(keyword)))
  ));
}
function originLabel(value: string | null | undefined) {
  const normalized = normalizeChannelText(value ?? '');
  if (!normalized) return null;
  if (normalized.includes('meta')) return 'Facebook';
  if (normalized.includes('google')) return 'Google';
  if (normalized.includes('instagram')) return 'Instagram';
  if (normalized.includes('tiktok')) return 'TikTok';
  if (normalized.includes('youtube')) return 'YouTube';
  if (normalized.includes('indicacao')) return 'Indicação';
  if (normalized.includes('organic')) return 'WhatsApp orgânico';
  if (normalized.includes('cliente')) return 'WhatsApp';
  return value;
}
function leadOriginPreview(lead: CrmLead) {
  const sourceText = [lead.canal, originLabel(lead.origin)].filter(Boolean).join(' ');
  const channels = detectChannels(sourceText);
  return {
    label: channels[0]?.label ?? lead.canal ?? originLabel(lead.origin) ?? 'Origem indefinida',
    channels,
  };
}
function hasValue(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}
function leadTrackingStatus(lead: CrmLead) {
  if (hasValue(lead.ctwa_clid) || hasValue(lead.source_id) || hasValue(lead.campaign_name) || hasValue(lead.adset_name) || hasValue(lead.ad_name)) {
    return {
      label: 'Meta Click-to-WhatsApp',
      detail: 'A Evolution enviou contexto do anúncio.',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    };
  }
  if (hasValue(lead.utm_source) || hasValue(lead.utm_campaign) || hasValue(lead.utm_content) || hasValue(lead.utm_medium)) {
    return {
      label: 'Link rastreável',
      detail: 'Origem identificada pelas UTMs do link.',
      className: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    };
  }
  if (normalizeChannelText(lead.origin ?? '').includes('organic')) {
    return {
      label: 'Orgânico',
      detail: 'Lead sem campanha/anúncio detectado.',
      className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
    };
  }
  return {
    label: 'Sem rastreio',
    detail: 'Nenhum dado de campanha chegou neste lead.',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  };
}
function trackingRows(lead: CrmLead) {
  return [
    ['Canal', lead.canal],
    ['Origem', originLabel(lead.origin) ?? lead.origin],
    ['Campanha', lead.campaign_name ?? lead.utm_campaign],
    // ⚠️ `utm_medium` é o MEIO (paid, cpc, organic) — nunca o conjunto. Estava
    // aqui como fallback e fazia a linha "Conjunto" exibir "paid".
    ['Conjunto', lead.adset_name],
    ['Anúncio', lead.ad_name ?? lead.utm_content],
    ['Meio', lead.utm_medium],
    ['Criativo', lead.creative_name],
    ['UTM source', lead.utm_source],
    ['UTM term', lead.utm_term],
    ['Click ID Meta', lead.ctwa_clid],
    ['Source ID', lead.source_id],
    ['Instância', lead.instance_id],
    ['Primeira captura', lead.first_origin_at ? fmtD(lead.first_origin_at) : null],
  ] as const;
}
/**
 * O valor que o Kanban mostra para um lead.
 *
 * ⚠️ São DOIS campos de propósito, e misturá-los no banco já inflou a dashboard
 * da Incorpast em agosto: `valor_rs` é receita de venda FECHADA (o sistema todo
 * lê "tem valor_rs = vendeu") e `valor_negocio` é a estimativa do negócio em
 * ABERTO. Aqui eles só se encontram na EXIBIÇÃO: quem fechou mostra a receita,
 * quem não fechou mostra a negociação. Como cada coluna do board é de um estado
 * só, o total do cabeçalho nunca soma as duas coisas na mesma caixa — e é a
 * própria coluna que diz qual dos dois é, sem precisar de símbolo no número.
 * ⚠️ Nada de prefixo ("~", "≈"): num valor em reais isso é lido como desconto
 * ou débito, e oportunidade não é dívida.
 */
function valorDoLead(lead: CrmLead): { valor: number; emAberto: boolean } {
  const receita = toMoneyNumber(lead.valor_rs);
  if (lead.fechou || receita > 0) return { valor: receita, emAberto: false };
  return { valor: toMoneyNumber(lead.valor_negocio), emAberto: true };
}

function inferLeadAiTag(lead: CrmLead) {
  const value = toMoneyNumber(lead.valor_rs);
  const text = normalizeChannelText([
    lead.observacao,
    lead.motivacoes,
    lead.dores,
    lead.pagamento,
    lead.bairro,
  ].filter(Boolean).join(' '));

  if (lead.fechou) return 'Convertido';
  if (value > 0) return 'Orçamento enviado';
  if (lead.data_agendada) return 'Agendamento ativo';
  if (/preco|valor|quanto|orcamento|orçamento|parcel/.test(text)) return 'Sensível a preço';
  if (/dor|incomoda|problema|urgente|preciso|necessito/.test(text)) return 'Dor mapeada';
  if (lead.dia1 || lead.dia2 || lead.dia3 || lead.dia4) return 'Em nutrição';
  if (lead.analise_credito) return 'Análise de crédito';
  return 'IA: qualificar';
}
function temperatureBadgeClass(value: string | null | undefined) {
  return value ? TEMPERATURE_BADGE[value] ?? 'border-border bg-muted text-muted-foreground' : 'border-border bg-muted text-muted-foreground';
}
function relativeAnalysisTime(iso: string | null | undefined) {
  if (!iso) return 'Nunca analisado';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return 'Nunca analisado';
  const mins = Math.max(0, Math.floor(diff / 60_000));
  if (mins < 1) return 'Última análise agora';
  if (mins < 60) return `Última análise há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Última análise há ${hours}h`;
  return `Última análise há ${Math.floor(hours / 24)}d`;
}

/** Mais recente primeiro (lead sem data no topo, como sempre foi). */
function ordemPorData(a: CrmLead, b: CrmLead): number {
  const t = (l: CrmLead) => { const x = l.data ? new Date(l.data).getTime() : NaN; return Number.isFinite(x) ? x : null; };
  const ta = t(a), tb = t(b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return -1;
  if (tb === null) return 1;
  return tb - ta;
}

/**
 * Respostas do formulário que o lead preencheu. Busca sob demanda (o modal já
 * faz o mesmo com a análise da IA) porque o dado mora no histórico de toques,
 * não numa coluna do lead — carregá-lo na lista seria um JSONB por linha.
 */
function RespostasFormulario({ leadId }: { leadId: string }) {
  type Envio = { canal: string | null; recebidoEm: string | null; respostas: RespostaFormulario[] };
  const [envios, setEnvios] = useState<Envio[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/crm/${leadId}/formulario`)
      .then(r => r.ok ? r.json() as Promise<{ envios: Envio[] }> : null)
      .then(d => { if (vivo && d?.envios?.length) setEnvios(d.envios); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [leadId]);

  // Sem resposta o bloco NÃO aparece — lead de WhatsApp não preencheu nada, e
  // uma caixa dizendo "nenhuma resposta" só ocuparia o modal.
  if (envios.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-3.5 w-3.5 text-primary" />
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Respostas do formulário</p>
      </div>
      {envios.map((envio, i) => (
        <div key={i} className="space-y-1.5">
          {(envio.canal || envio.recebidoEm) && (
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {[envio.canal, envio.recebidoEm ? fmtD(envio.recebidoEm) : null].filter(Boolean).join(' · ')}
            </p>
          )}
          {envio.respostas.map((r, j) => (
            <div key={j} className="rounded border border-border/60 bg-card px-2 py-1.5">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{r.pergunta}</span>
              <span className="mt-0.5 block text-xs font-semibold text-foreground">{r.resposta}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Nota 0–5 do atendimento do lead, dada pela rotina diária lendo a conversa.
// Vermelho até 1, laranja 2, âmbar 3, verde 4–5: os ruins saltam no board.
function notaClasse(n: number) {
  return n <= 1 ? 'bg-red-500/15 text-red-400 ring-red-500/30'
    : n === 2 ? 'bg-orange-500/15 text-orange-400 ring-orange-500/30'
    : n === 3 ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30'
    : 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30';
}

function temNota(lead: CrmLead): lead is CrmLead & { nota_atendimento: number } {
  return typeof lead.nota_atendimento === 'number' && lead.nota_atendimento >= 0 && lead.nota_atendimento <= 5;
}

function NotaAtendimentoBadge({ lead }: { lead: CrmLead }) {
  if (!temNota(lead)) return null;
  const n = lead.nota_atendimento;
  return (
    <span
      title={`Atendimento ${n}/5${lead.nota_atendimento_motivo ? ` — ${lead.nota_atendimento_motivo}` : ''}`}
      className={cn('inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[10px] font-bold leading-tight ring-1 ring-inset', notaClasse(n))}
    >
      <Star className="h-2.5 w-2.5 fill-current" />{n}/5
    </span>
  );
}

function NotaAtendimentoPanel({ lead }: { lead: CrmLead }) {
  if (!temNota(lead)) return null;
  const n = lead.nota_atendimento;
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Nota do atendimento</p>
        <span className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold ring-1 ring-inset', notaClasse(n))}>
          <Star className="h-3 w-3 fill-current" />{n} de 5
        </span>
      </div>
      {lead.nota_atendimento_motivo && <p className="mt-2 text-xs text-foreground/85"><span className="font-semibold">Por quê:</span> {lead.nota_atendimento_motivo}</p>}
      {lead.nota_atendimento_ajuste && <p className="mt-1 text-xs text-foreground/85"><span className="font-semibold text-primary">Ajuste:</span> {lead.nota_atendimento_ajuste}</p>}
      {!!lead.nota_atendimento_trecho?.length && (
        <div className="mt-2 space-y-1 rounded border border-border/60 bg-card p-2">
          {lead.nota_atendimento_trecho.map((m, i) => (
            <div key={i} className={cn('flex', m.d === 'out' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-md px-2 py-1 text-[11px] leading-snug', m.d === 'out' ? 'bg-primary/15 text-foreground' : 'bg-muted text-foreground')}>
                <span className="whitespace-pre-wrap break-words">{m.t || '[sem texto]'}</span>
                <span className="ml-1.5 text-[9px] text-muted-foreground">{new Date(m.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {lead.nota_atendimento_em && (
        <p className="mt-1 text-[10px] text-muted-foreground">Avaliado em {new Date(lead.nota_atendimento_em).toLocaleDateString('pt-BR')} pela rotina diária</p>
      )}
    </div>
  );
}

function TrackingSourcePanel({ lead }: { lead: CrmLead }) {
  const status = leadTrackingStatus(lead);
  const rows = trackingRows(lead);
  const sourceUrl = lead.source_url;
  const local = localDoLead(lead);

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Fonte de captura</p>
          <p className="mt-1 text-xs text-muted-foreground">{status.detail}</p>
        </div>
        <span className={cn('rounded-full border px-2 py-1 text-[10px] font-bold', status.className)}>
          {status.label}
        </span>
      </div>
      {local && (
        <div className="rounded border border-border/60 bg-card px-2 py-1.5">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <MapPin className="h-3 w-3" /> {local.rotulo}
          </span>
          <span className="mt-0.5 block text-xs font-semibold text-foreground">{local.texto}</span>
          {/* ⚠️ A fonte fica visível de propósito: região de DDD não é endereço. */}
          <span className="mt-0.5 block text-[10px] text-muted-foreground">{local.detalhe}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded border border-border/60 bg-card px-2 py-1.5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
            <span className={cn('mt-0.5 block truncate text-xs font-semibold', hasValue(value) ? 'text-foreground' : 'text-muted-foreground')}>
              {hasValue(value) ? String(value) : 'Não recebido'}
            </span>
          </div>
        ))}
      </div>
      {hasValue(sourceUrl) && (
        <a
          href={String(sourceUrl)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded border border-border/60 bg-card px-2 py-2 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
        >
          <Link2 className="h-3.5 w-3.5" />
          Abrir URL de origem
        </a>
      )}
    </div>
  );
}


// ── Styled select with icon ──────────────────────────────────────────────
function IconSelect({ icon: Icon, value, onChange, placeholder, children, className }: {
  icon: React.ElementType; value: string; onChange: (v: string) => void;
  placeholder?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-8 pr-8 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary w-full"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children}
      </select>
    </div>
  );
}

const ONMID_GREEN = '#55F52F';

function clientTheme(clientId: string) {
  void clientId;
  return {
    accent: ONMID_GREEN,
    glow: 'rgba(85,245,47,0.14)',
    bg: 'from-emerald-950/35 via-card to-card',
  };
}

// ── Quick Edit Modal (Kanban) ────────────────────────────────────────────────
type LeadChatMessage = {
  id: string;
  direction: 'in' | 'out';
  text: string;
  tipo: string;
  created_at: string;
};

function ChatPreviewPanel({ leadId, onOpenChat }: { leadId: string; onOpenChat: () => void }) {
  const [messages, setMessages] = useState<LeadChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/crm/${leadId}/messages`)
      .then(r => r.ok ? r.json() as Promise<{ messages?: LeadChatMessage[] }> : null)
      .then(data => { if (!cancelled) setMessages((data?.messages ?? []).slice(-10)); })
      .catch(() => { if (!cancelled) setMessages([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leadId]);

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-3.5 w-3.5 text-primary" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Conversa recente</p>
        </div>
        <button type="button" onClick={onOpenChat} className="text-[11px] font-semibold text-primary hover:underline shrink-0">
          Ver conversa completa
        </button>
      </div>
      {loading ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Carregando mensagens…</p>
      ) : messages.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Nenhuma mensagem encontrada para este lead.</p>
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {messages.map(m => (
            <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs',
                m.direction === 'out' ? 'bg-primary/15 text-foreground' : 'bg-muted text-foreground',
              )}>
                <p className="whitespace-pre-wrap break-words">
                  {m.tipo && m.tipo !== 'texto' ? `[${m.tipo}]${m.text ? ' ' + m.text : ''}` : (m.text || '—')}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{fmtTime(m.created_at)} · {fmtD(m.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickEditModal({
  lead, onSave, onClose, onDelete, statusOptions, onOpenChat, clientId,
}: {
  lead: CrmLead;
  onSave: (data: Draft) => Promise<void>;
  onClose: () => void;
  onDelete: () => void;
  statusOptions: string[];
  onOpenChat: (leadId: string) => void;
  clientId?: string;
}) {
  // Conversa ao lado do formulário — some em telas estreitas (aí vale o preview
  // + "ver conversa completa", que continua levando pro inbox).
  const [showChat, setShowChat] = useState(true);
  const [draft, setDraft] = useState<Draft>({ ...lead });
  const [saving, setSaving] = useState(false);
  const [aiInfo, setAiInfo] = useState<{ motivo?: string; created_at?: string; confianca?: number } | null>(null);
  const [, setNowTick] = useState(0);
  const [dealCheck, setDealCheck] = useState<'idle' | 'checking' | 'found' | 'empty'>('idle');
  const [dealSuggestion, setDealSuggestion] = useState<{ valor: number; trecho: string | null } | null>(null);
  const modoCliente = useModoCliente();
  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft(prev => ({ ...prev, [k]: v })); }

  function toggleFechou(checked: boolean) {
    set('fechou', checked);
    // A sugestão de valor lê a conversa com IA (custo) — fica com a agência.
    if (checked && !lead.fechou && !modoCliente) {
      setDealCheck('checking');
      setDealSuggestion(null);
      fetch(`/api/crm/${lead.id}/extract-value`, { method: 'POST' })
        .then(r => r.ok ? r.json() as Promise<{ valor: number | null; trecho: string | null }> : null)
        .then(data => {
          if (data?.valor) { setDealSuggestion({ valor: data.valor, trecho: data.trecho }); setDealCheck('found'); }
          else setDealCheck('empty');
        })
        .catch(() => setDealCheck('empty'));
    } else {
      setDealCheck('idle');
      setDealSuggestion(null);
    }
  }

  useEffect(() => {
    if (modoCliente) return;
    fetch(`/api/crm/ai/lead/${lead.id}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { last?: { motivo_ia?: string; created_at?: string; confianca?: number } } | null) => {
        if (data?.last) setAiInfo({
          motivo: data.last.motivo_ia,
          created_at: data.last.created_at,
          confianca: data.last.confianca,
        });
      })
      .catch(() => {});
  }, [lead.id, modoCliente]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(v => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSave() {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={cn(
        'bg-card border border-border rounded-2xl shadow-2xl w-full max-h-[90vh] flex flex-col overflow-hidden',
        showChat ? 'max-w-lg lg:max-w-5xl lg:h-[88vh]' : 'max-w-lg',
      )} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold">Editar Lead</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowChat(v => !v)}
              title={showChat ? 'Esconder conversa' : 'Mostrar conversa'}
              className={cn(
                'hidden lg:flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors',
                showChat ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" /> Conversa
            </button>
            <button onClick={onClose} className="ml-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex flex-1 min-h-0">
        <div className={cn(
          'flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-3',
          showChat && 'lg:max-w-[460px] lg:shrink-0 lg:border-r lg:border-border',
        )}>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome</span>
              <input type="text" value={draft.nome ?? ''} onChange={e => set('nome', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Número</span>
              <input type="text" value={draft.numero ?? ''} onChange={e => set('numero', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Origem</span>
              {/* Valor fora da lista (vindo de integração) aparece como opção em vez de "—". */}
              <select value={draft.canal ?? ''} onChange={e => set('canal', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">—</option>
                {opcoesDeOrigem(draft.canal).map(o => <option key={o}>{o}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</span>
              <select value={draft.status ?? ''} onChange={e => set('status', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                {statusOptions.map(o => <option key={o}>{o}</option>)}
              </select>
            </label>
          </div>
          <CamposAtendimento
            draft={draft}
            set={(k, v) => set(k as keyof Draft, v as never)}
            clientId={clientId}
          />
          {!modoCliente && <NotaAtendimentoPanel lead={lead} />}
          {!modoCliente && <TrackingSourcePanel lead={lead} />}
          <RespostasFormulario leadId={lead.id} />
          <div className={cn(showChat && 'lg:hidden')}>
            <ChatPreviewPanel leadId={lead.id} onOpenChat={() => { onOpenChat(lead.id); onClose(); }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Valor (R$)</span>
              <input type="number" step="0.01" value={draft.valor_rs ?? ''}
                onChange={e => set('valor_rs', e.target.value ? parseFloat(e.target.value) : null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
            {/* Data de ENTRADA do lead: mexer nela desloca o lead entre meses nos
                relatórios. Para quem atende, só leitura. */}
            {modoCliente ? (
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Entrou em</span>
                <p className="px-1 py-2 text-sm text-muted-foreground">{fmtD(draft.data ?? lead.created_at)}</p>
              </div>
            ) : (
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Data</span>
              <input type="date" value={toD(draft.data)} onChange={e => set('data', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
            )}
          </div>
          <label className="flex items-center gap-3 cursor-pointer py-1">
            <input type="checkbox" checked={!!draft.fechou} onChange={e => toggleFechou(e.target.checked)} className="h-4 w-4 accent-primary" />
            <span className="text-sm font-semibold">Fechou negócio</span>
          </label>
          {dealCheck === 'checking' && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
              IA lendo a conversa pra identificar o valor combinado…
            </div>
          )}
          {dealCheck === 'found' && dealSuggestion && (
            <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                IA identificou {formatCurrencyBRL(dealSuggestion.valor)} nesta conversa
              </div>
              {dealSuggestion.trecho && (
                <p className="text-muted-foreground italic">&ldquo;{dealSuggestion.trecho}&rdquo;</p>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button"
                  onClick={() => { set('valor_rs', dealSuggestion.valor); setDealCheck('idle'); setDealSuggestion(null); }}
                  className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90">
                  Usar este valor
                </button>
                <button type="button"
                  onClick={() => { setDealCheck('idle'); setDealSuggestion(null); }}
                  className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                  Ignorar
                </button>
              </div>
            </div>
          )}
          {dealCheck === 'empty' && (
            <div className="rounded-lg border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
              IA não conseguiu identificar um valor na conversa — preencha manualmente.
            </div>
          )}
          {!modoCliente && (
          <div className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Inteligência IA</p>
                <p className="mt-1 text-xs text-muted-foreground">{relativeAnalysisTime(draft.ia_ultimo_analise ?? aiInfo?.created_at)}</p>
              </div>
              <span className={cn('rounded-full border px-2 py-1 text-[10px] font-bold', temperatureBadgeClass(draft.temperatura))}>
                {draft.temperatura ? TEMPERATURE_LABEL[draft.temperatura] : 'Sem classificação'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border/60 bg-card px-2 py-1.5">
                <span className="text-muted-foreground">Confiança</span>
                <p className="font-semibold">{draft.ia_confianca_ultimo ?? aiInfo?.confianca ?? 0}%</p>
              </div>
              <div className="rounded border border-border/60 bg-card px-2 py-1.5">
                <span className="text-muted-foreground">Temperatura</span>
                <p className="font-semibold">{draft.temperatura ? TEMPERATURE_LABEL[draft.temperatura] : 'Não definida'}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Motivo:</span> {aiInfo?.motivo ?? 'Aguardando próxima análise automática.'}
            </p>
            <label className="flex items-start gap-3 rounded border border-border/60 bg-card p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!draft.time_interno}
                onChange={e => {
                  if (e.target.checked) {
                    const ok = window.confirm('Ao marcar como Time Interno, nenhuma automação será executada para este contato. Tem certeza?');
                    if (!ok) return;
                  }
                  set('time_interno', e.target.checked);
                }}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-semibold">Time Interno</span>
                <span className="block text-xs text-muted-foreground">Todas as automações ficam desativadas para este contato</span>
              </span>
            </label>
          </div>
          )}
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Observação</span>
            <div className="relative">
              <textarea value={draft.observacao ?? ''} onChange={e => set('observacao', e.target.value || null)} rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
              <DictateButton className="absolute bottom-2 right-2" onTranscript={(text) => set('observacao', draft.observacao ? `${draft.observacao} ${text}` : text)} />
            </div>
          </label>
          <HistoricoLead leadId={lead.id} />
        </div>
        {showChat && (
          <div className="hidden lg:flex flex-1 min-w-0">
            <LeadChatPanel
              leadId={lead.id}
              nome={lead.nome}
              numero={lead.numero}
              clientId={clientId}
              onOpenFullChat={() => { onOpenChat(lead.id); onClose(); }}
            />
          </div>
        )}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onDelete} className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Kanban Card (draggable) ──────────────────────────────────────────────────
function KanbanCard({
  lead, onEdit, onDelete, onToggleInternal, onToggleQualificado, isDragOverlay, hasActiveFollowup,
}: {
  lead: CrmLead;
  onEdit: (lead: CrmLead) => void;
  onDelete: (id: string) => void;
  onToggleInternal: (lead: CrmLead) => void;
  onToggleQualificado: (lead: CrmLead) => void;
  isDragOverlay?: boolean;
  hasActiveFollowup?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const channels = detectChannels(lead.canal);
  const origin = leadOriginPreview(lead);
  const aiTag = inferLeadAiTag(lead);
  const trackingStatus = leadTrackingStatus(lead);
  const { valor: value, emAberto: valorEmAberto } = valorDoLead(lead);
  const modoCliente = useModoCliente();
  const agenda = rotuloAgenda(lead);
  const acao = rotuloProximaAcao(lead);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  // Temperatura vira a borda esquerda do card (sinal visual sem gastar espaço com pill)
  const tempColor = lead.temperatura ? ({ frio: '#60a5fa', morno: '#f59e0b', quente: '#f87171' } as const)[lead.temperatura] : undefined;
  const trackingShort = trackingStatus.label === 'Meta Click-to-WhatsApp' ? 'Meta'
    : trackingStatus.label === 'Link rastreável' ? 'UTM'
    : trackingStatus.label;

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={{
        ...(isDragOverlay ? {} : style),
        ...(tempColor ? { borderLeft: `3px solid ${tempColor}` } : {}),
      }}
      {...(isDragOverlay ? {} : { ...attributes, ...listeners })}
      onClick={() => !isDragging && onEdit(lead)}
      title={lead.temperatura ? `Temperatura: ${TEMPERATURE_LABEL[lead.temperatura]}` : undefined}
      className={cn(
        "group relative rounded-md border border-border bg-card px-2.5 py-2 hover:border-primary/40 hover:shadow-md transition-all cursor-grab select-none",
        isDragging && "opacity-30",
        isDragOverlay && "cursor-grabbing shadow-2xl ring-2 ring-primary/40",
      )}
    >
      {/* Ações (aparecem no hover, sobrepostas — não gastam altura) */}
      {/* max-md: no celular não existe hover — as ações ficam sempre visíveis. */}
      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-md bg-card/95 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity">
        <button
          type="button"
          title={lead.qualificado ? 'Desmarcar como qualificado' : modoCliente ? 'Marcar como qualificado' : 'Marcar como QUALIFICADO (vai para o Meta otimizar)'}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onToggleQualificado(lead); }}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded transition-colors',
            lead.qualificado
              ? 'text-primary hover:bg-primary/10'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <BadgeCheck className="h-3 w-3" />
        </button>
        {!modoCliente && (
        <button
          type="button"
          title={lead.time_interno ? 'Remover de time interno' : 'Marcar como time interno'}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onToggleInternal(lead); }}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
            lead.time_interno && 'text-zinc-200',
          )}
        >
          <UserRound className="h-3 w-3" />
        </button>
        )}
        <div className="relative" ref={menuRef}>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <MoreVertical className="h-3 w-3" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-50 min-w-[130px] rounded-lg border border-border bg-popover shadow-xl py-1">
              <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(lead); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
              <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(lead.id); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Linha 1: nome + valor */}
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{lead.nome ?? lead.numero ?? '—'}</p>
        {!modoCliente && <NotaAtendimentoBadge lead={lead} />}
        {value > 0 && (
          <span
            title={valorEmAberto ? 'Em negociação (ainda não fechado)' : 'Venda fechada'}
            className={cn('shrink-0 text-[10px] font-bold', valorEmAberto ? 'text-foreground/55' : 'text-primary')}
          >
            {fmtN(value)}
          </span>
        )}
      </div>

      {/* Linha 2: número + data */}
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] text-muted-foreground">{lead.numero ?? '—'}</p>
        <span className="shrink-0 text-[10px] text-muted-foreground/70">{fmtD(lead.data ?? lead.created_at)}</span>
      </div>

      {/* Linha 3: canal + pills essenciais (uma linha só, truncada) */}
      <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
        {channels.slice(0, 2).map(ch => (
          <span key={ch.id} className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white ring-1 ring-white/10 [&_svg]:h-2.5 [&_svg]:w-2.5', ch.bg)} title={origin.label}>
            {ch.icon}
          </span>
        ))}
        {/* Rastreio de anúncio e o rótulo "IA" são leitura da agência; para quem
            atende, o card mostra agenda, próxima ação e responsável. */}
        {!modoCliente && (
        <span
          className={cn('inline-flex shrink-0 rounded px-1 py-px text-[9px] font-bold leading-tight opacity-80', trackingStatus.className)}
          title={`${trackingStatus.label}: ${trackingStatus.detail}`}
        >
          {trackingShort}
        </span>
        )}
        {!modoCliente && (
        <span className="inline-flex min-w-0 items-center gap-0.5 truncate rounded bg-primary/5 px-1 py-px text-[9px] font-semibold leading-tight text-primary/75" title={aiTag}>
          <Sparkles className="h-2 w-2 shrink-0" />
          <span className="truncate">{aiTag}</span>
        </span>
        )}
        {modoCliente && lead.canal && (
          <span className="min-w-0 truncate text-[9px] text-muted-foreground">{lead.canal}</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {lead.time_interno && (
            <span className="rounded bg-zinc-500/15 px-1 py-px text-[9px] font-bold leading-tight text-zinc-300/80">Interno</span>
          )}
          <FollowupBadge active={!!hasActiveFollowup} />
          {lead.fechou && (
            <span className="rounded bg-emerald-500/15 px-1 py-px text-[9px] font-bold leading-tight text-emerald-400">Fechou</span>
          )}
        </div>
      </div>

      {/* Linha 4 (só quando há): agenda, próxima ação e responsável */}
      {(agenda || acao || lead.responsavel) && (
        <div className="mt-1 flex items-center gap-1 overflow-hidden">
          {agenda && (
            <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold leading-tight', agenda.classe)} title={agenda.titulo}>
              <CalendarDays className="h-2.5 w-2.5" />{agenda.texto}
            </span>
          )}
          {acao && (
            <span className={cn('inline-flex min-w-0 items-center gap-0.5 truncate rounded px-1 py-px text-[9px] font-semibold leading-tight', acao.classe)} title={acao.titulo}>
              <Clock3 className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{acao.texto}</span>
            </span>
          )}
          {lead.responsavel && (
            <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-sky-500/20 px-1 text-[8px] font-bold text-sky-200" title={`Responsável: ${lead.responsavel}`}>
              {iniciais(lead.responsavel)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const semAcentoMin = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Atalhos da barra: "Meus leads", "Agenda de hoje" e "Ações atrasadas". */
function passaAtalho(l: CrmLead, atalho: 'meus' | 'hoje' | 'atrasados', meuNome: string): boolean {
  if (atalho === 'meus') return !!meuNome && !!l.responsavel && semAcentoMin(l.responsavel) === semAcentoMin(meuNome);
  if (atalho === 'hoje') return !!l.data_agendada && String(l.data_agendada).slice(0, 10) === diaLocal(new Date());
  return !!l.proxima_acao_em && new Date(l.proxima_acao_em).getTime() < Date.now();
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase() || '?';
}

function diaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Agendamento no card: hoje/amanhã por extenso, passado sem "compareceu" em âmbar. */
function rotuloAgenda(lead: CrmLead): { texto: string; titulo: string; classe: string } | null {
  if (!lead.data_agendada) return null;
  const dia = String(lead.data_agendada).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const hoje = diaLocal(new Date());
  const amanha = diaLocal(new Date(Date.now() + 86_400_000));
  const hora = lead.hora_agendada ? ` ${lead.hora_agendada}` : '';
  const texto = dia === hoje ? `Hoje${hora}` : dia === amanha ? `Amanhã${hora}` : `${dia.slice(8, 10)}/${dia.slice(5, 7)}${hora}`;
  const passou = dia < hoje;
  const classe = lead.compareceu ? 'bg-emerald-500/15 text-emerald-300'
    : passou ? 'bg-amber-500/15 text-amber-300'
    : dia === hoje ? 'bg-sky-500/25 text-sky-200'
    : 'bg-sky-500/10 text-sky-300';
  const titulo = lead.compareceu ? 'Compareceu' : passou ? 'Agendamento passou sem registro de comparecimento' : 'Agendado';
  return { texto, titulo, classe };
}

function rotuloProximaAcao(lead: CrmLead): { texto: string; titulo: string; classe: string } | null {
  if (!lead.proxima_acao && !lead.proxima_acao_em) return null;
  const quando = lead.proxima_acao_em ? new Date(lead.proxima_acao_em) : null;
  const atrasada = !!quando && quando.getTime() < Date.now();
  const data = quando ? quando.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  return {
    texto: atrasada ? `Atrasada · ${lead.proxima_acao ?? data}` : (lead.proxima_acao ?? data),
    titulo: [lead.proxima_acao, data].filter(Boolean).join(' — '),
    classe: atrasada ? 'bg-red-500/15 text-red-300' : 'bg-muted text-muted-foreground',
  };
}

// ── Kanban Column (droppable) ────────────────────────────────────────────────
const CARDS_POR_COLUNA = 50;

function KanbanColumn({
  status, color, leads, onEdit, onDelete, onToggleInternal, onToggleQualificado, activeLead, activeFollowupIds,
}: {
  status: string;
  color: string;
  leads: CrmLead[];
  onEdit: (lead: CrmLead) => void;
  onDelete: (id: string) => void;
  onToggleInternal: (lead: CrmLead) => void;
  onToggleQualificado: (lead: CrmLead) => void;
  activeLead: CrmLead | null;
  activeFollowupIds: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  // Receita quando a coluna é de ganho; negociação em aberto nas demais.
  const total = leads.reduce((s, l) => s + valorDoLead(l).valor, 0);
  const totalEmAberto = leads.every(l => valorDoLead(l).emAberto);
  // Etapa sem lead no período vira uma faixa de 44px: num funil de 10+ colunas
  // as vazias comiam a largura do board e empurravam pra fora da tela justo as
  // que têm lead. Clicar abre de novo — a coluna não some, só encolhe.
  const [expandida, setExpandida] = useState(false);
  const recolhida = leads.length === 0 && !expandida;
  // ⚠️ Coluna com milhares de leads (Entrada da Atmos: 3.446) desenhava todos os
  // cards, cada um arrastável — pegar um card fazia o dnd-kit mexer em milhares.
  // Mostra 50 por vez; o número da coluna continua sendo o total.
  const [limite, setLimite] = useState(CARDS_POR_COLUNA);
  const visiveis = leads.length > limite ? leads.slice(0, limite) : leads;

  if (recolhida) {
    return (
      <button
        type="button"
        ref={setNodeRef}
        onClick={() => setExpandida(true)}
        title={`${status} — nenhum lead no período. Clique para abrir.`}
        className={cn(
          'flex max-h-full w-[44px] shrink-0 flex-col items-center gap-2 rounded-lg border border-border bg-card/40 py-2 transition-colors hover:bg-card',
          // ⚠️ Recolhida CONTINUA sendo alvo de drop: arrastar um lead pra uma
          // etapa vazia é caso normal, e a faixa é estreita mas tem a altura
          // toda. O realce é o que diz que vai cair ali.
          isOver && 'border-primary/40 bg-primary/10',
        )}
        style={{ borderTop: `3px solid ${color}` }}
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
          style={{ background: `${color}25`, color }}
        >
          0
        </span>
        {/* `vertical-rl` + `rotate-180` faz o nome subir (lê de baixo pra cima) */}
        <span className="min-h-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl] rotate-180">
          {status}
        </span>
      </button>
    );
  }

  return (
    <div className="flex max-h-full w-[232px] shrink-0 flex-col">
      <div className="shrink-0 rounded-t-lg border border-b-0 border-border bg-card px-2.5 py-1.5" style={{ borderTop: `3px solid ${color}` }}>
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-wide text-foreground leading-tight" title={status}>{status}</span>
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none" style={{ background: `${color}25`, color }}>
            {leads.length}
          </span>
          {leads.length === 0 && (
            <button
              type="button"
              onClick={() => setExpandida(false)}
              title="Recolher etapa vazia"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <span
            title={totalEmAberto ? 'Soma das negociações em aberto nesta etapa' : 'Soma das vendas fechadas nesta etapa'}
            className="ml-auto shrink-0 text-[10px] font-semibold text-muted-foreground"
          >
            {total > 0 ? formatCurrencyBRL(total) : ''}
          </span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 min-h-[90px] flex-col gap-1.5 rounded-b-lg border border-t-0 border-border bg-muted/10 p-1.5 overflow-y-auto transition-colors",
          isOver && "bg-primary/5 border-primary/30",
        )}
      >
        {visiveis.map(lead => (
          <KanbanCard
            key={lead.id}
            lead={lead}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleInternal={onToggleInternal}
            onToggleQualificado={onToggleQualificado}
            hasActiveFollowup={activeFollowupIds.has(lead.id)}
          />
        ))}
        {leads.length > visiveis.length && (
          <button
            type="button"
            onClick={() => setLimite(v => v + CARDS_POR_COLUNA)}
            className="shrink-0 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            Mostrar mais {Math.min(CARDS_POR_COLUNA, leads.length - visiveis.length)} · faltam {(leads.length - visiveis.length).toLocaleString('pt-BR')}
          </button>
        )}
        {leads.length === 0 && (
          <div className="flex items-center justify-center py-6">
            <p className="text-[10px] text-muted-foreground/40 italic">
              {isOver && activeLead ? 'Soltar aqui' : 'Vazio'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Kanban View ──────────────────────────────────────────────────────────────
function KanbanView({
  leads, stages, onEdit, onDelete, onStatusChange, onToggleInternal, onToggleQualificado, activeFollowupIds, onArrasteMudou,
}: {
  leads: CrmLead[];
  stages: CrmStage[];
  onArrasteMudou?: (arrastando: boolean) => void;
  onEdit: (lead: CrmLead) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onToggleInternal: (lead: CrmLead) => void;
  onToggleQualificado: (lead: CrmLead) => void;
  activeFollowupIds: Set<string>;
}) {
  const [activeLead, setActiveLead] = useState<CrmLead | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const statusOptions = stages.map(s => s.label);

  const grouped = useMemo(() => {
    const map = new Map<string, CrmLead[]>();
    stages.forEach(s => map.set(s.label, []));
    leads.forEach(lead => {
      const s = lead.status ?? stages[0]?.label ?? 'Em Atendimento';
      if (map.has(s)) map.get(s)!.push(lead);
      else map.set(s, [lead]);
    });
    return map;
  }, [leads, stages]);

  function handleDragStart(event: DragStartEvent) {
    const lead = leads.find(l => l.id === event.active.id);
    setActiveLead(lead ?? null);
    onArrasteMudou?.(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    onArrasteMudou?.(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const targetStatus = String(over.id);
    if (statusOptions.includes(targetStatus)) {
      onStatusChange(String(active.id), targetStatus);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveLead(null); onArrasteMudou?.(false); }}>
      <div className="flex h-full min-h-0 flex-1 items-stretch gap-2.5 overflow-x-auto pb-1">
        {stages.map(stage => (
          <KanbanColumn
            key={stage.label}
            status={stage.label}
            color={corDaEtapa(stage.etapa_funil, stage.label)}
            leads={grouped.get(stage.label) ?? []}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleInternal={onToggleInternal}
            onToggleQualificado={onToggleQualificado}
            activeLead={activeLead}
            activeFollowupIds={activeFollowupIds}
          />
        ))}
      </div>
      <DragOverlay>
        {activeLead && (
          <KanbanCard
            lead={activeLead}
            onToggleQualificado={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onToggleInternal={() => {}}
            isDragOverlay
            hasActiveFollowup={activeFollowupIds.has(activeLead.id)}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins < 1) return '<1min';
  if (mins < 60) return `${mins}min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function AttendanceView({
  clientId,
  month,
  from,
  to,
}: {
  clientId: string;
  month: string;
  from: string;
  to: string;
}) {
  const [data, setData] = useState<AttendanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState<{ result: AttendanceAudit; periodFrom: string; periodTo: string; createdAt: string } | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditGenerating, setAuditGenerating] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [historico, setHistorico] = useState<ItemHistoricoAuditoria[]>([]);
  const [leadNomes, setLeadNomes] = useState<Record<string, string>>({});
  // Gestor do CLIENTE vê a nota, a auditoria e exporta o PDF; gerar auditoria
  // nova gasta IA e fica com a rotina da agência (a rota POST nem é liberada).
  const somenteLeitura = useEhUsuarioCliente();

  useEffect(() => {
    const params = new URLSearchParams({ clientId });
    if (month) params.set('month', month);
    if (!month && from) params.set('from', from);
    if (!month && to) params.set('to', to);

    setLoading(true);
    fetch(`/api/crm/attendance?${params.toString()}`)
      .then(r => r.ok ? r.json() as Promise<AttendanceMetrics> : null)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [clientId, month, from, to]);

  useEffect(() => {
    setAuditLoading(true);
    fetch(`/api/crm/attendance/audit?${new URLSearchParams({ clientId })}`)
      .then(r => r.ok ? r.json() : { audit: null })
      .then(json => {
        setAudit(json.audit ?? null);
        setHistorico(json.historico ?? []);
        setLeadNomes(json.leadNomes ?? {});
      })
      .catch(() => setAudit(null))
      .finally(() => setAuditLoading(false));
  }, [clientId]);

  function irParaAuditoria() {
    requestAnimationFrame(() => document.getElementById('auditoria-completa')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function generateAudit() {
    setAuditGenerating(true);
    setAuditError(null);
    try {
      const body: Record<string, string> = { clientId };
      if (month) body.month = month;
      if (!month && from) body.from = from;
      if (!month && to) body.to = to;
      const res = await fetch('/api/crm/attendance/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Erro ao gerar auditoria.');
      setAudit(json.audit);
      setHistorico(json.historico ?? []);
      setLeadNomes(json.leadNomes ?? {});
      irParaAuditoria();
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Erro ao gerar auditoria.');
    } finally {
      setAuditGenerating(false);
    }
  }

  const summary = data?.summary;
  const responseTotal = (summary?.under_5 ?? 0) + (summary?.under_15 ?? 0) + (summary?.under_60 ?? 0) + (summary?.over_60 ?? 0);
  const answeredUnderOneHour = (summary?.under_5 ?? 0) + (summary?.under_15 ?? 0) + (summary?.under_60 ?? 0);
  const responseRate = responseTotal + (summary?.unanswered_chats ?? 0) > 0
    ? Math.round((responseTotal / (responseTotal + (summary?.unanswered_chats ?? 0))) * 100)
    : 0;
  const slaRate = responseTotal > 0 ? Math.round((answeredUnderOneHour / responseTotal) * 100) : 0;
  const avgHours = summary?.avg_response_seconds ? Math.max(0.2, summary.avg_response_seconds / 3600) : 0;
  // ⚠️ O card e o donut têm de mostrar o MESMO número. `unanswered_chats` conta
  // toda conversa cuja última mensagem é do cliente — inclusive de quem já
  // comprou ou já foi perdido, que não é pendência de ninguém. A classificação
  // tira esses, e é ela que manda aqui. A TAXA de resposta segue usando o bruto:
  // ali o que se mede é o atendimento, não a pendência em aberto.
  const unanswered = data?.classification?.sem_resposta ?? summary?.unanswered_chats ?? 0;
  const totalLeads = summary?.total_leads ?? 0;
  const activeConversations = summary?.active_conversations ?? 0;
  // Real score comes from the AI audit (crm_attendance_audit) — no audit generated
  // yet means no score to show, not a guessed number.
  const aiScore = audit?.result.nota_geral ?? null;
  const aiStatus = audit?.result.classificacao ?? 'Sem auditoria';
  const aiStatusTone = aiScore !== null && aiScore >= 65 ? 'bg-primary/15 text-primary' : aiScore !== null ? 'bg-amber-400/15 text-amber-300' : 'bg-white/10 text-zinc-300';
  const slaRows = [
    { label: 'Até 5 min', value: summary?.under_5 ?? 0, color: '#32E843' },
    { label: 'Até 15 min', value: summary?.under_15 ?? 0, color: '#A3E635' },
    { label: 'Até 1h', value: summary?.under_60 ?? 0, color: '#FACC15' },
    { label: '+1h', value: summary?.over_60 ?? 0, color: '#EF4444' },
  ];
  // ⚠️ Estas séries e a classificação JÁ FORAM NÚMEROS INVENTADOS: fatores fixos
  // multiplicando a média, datas "12 Mai" escritas no código e "Encerrados" como
  // 4% do total. Agora vêm medidos de `crm_messages`; sem dado, a seção some em
  // vez de desenhar uma linha bonita que ninguém pode conferir.
  const diaCurto = (iso: string) => {
    const [, m, d] = iso.split('-');
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${d} ${meses[Number(m) - 1] ?? ''}`;
  };
  const daily = data?.daily ?? [];
  const responseTrend = daily
    .filter(d => d.avg_response_seconds !== null)
    .map(d => ({ label: diaCurto(d.dia), value: (d.avg_response_seconds ?? 0) / 3600 }));
  const riskTrend = daily.map(d => ({ label: diaCurto(d.dia), value: d.sem_resposta }));
  const retomada = data?.retomada;
  const followupRate = retomada && retomada.enviadas > 0
    ? Math.round((retomada.responderam / retomada.enviadas) * 100)
    : null;
  // Variação REAL contra a janela anterior. Antes estes selos eram literais
  // escritos no código ("+18% vs. período anterior"), independentes do dado.
  const prev = data?.previous ?? null;
  const variacao = (atual: number | null | undefined, anterior: number | null | undefined, menorEhMelhor = false) => {
    if (atual == null || anterior == null || anterior <= 0) return null;
    const pct = Math.round(((atual - anterior) / anterior) * 100);
    if (pct === 0) return { texto: 'igual ao período anterior', bom: true };
    const bom = menorEhMelhor ? pct < 0 : pct > 0;
    return { texto: `${pct > 0 ? '+' : ''}${pct}% vs. período anterior`, bom };
  };
  const prevRespTotal = prev ? prev.under_5 + prev.under_15 + prev.under_60 + prev.over_60 : 0;
  const prevResponseRate = prev && prevRespTotal + prev.unanswered_chats > 0
    ? Math.round((prevRespTotal / (prevRespTotal + prev.unanswered_chats)) * 100) : null;
  const varLeads = variacao(totalLeads, prev?.total_leads);
  const varResposta = variacao(summary?.avg_response_seconds ?? null, prev?.avg_response_seconds ?? null, true);
  const varTaxa = variacao(responseRate, prevResponseRate);
  const varAtivas = variacao(activeConversations, prev?.active_conversations);
  const cls = data?.classification;
  const classificationRows = cls ? [
    { label: 'Em atendimento', value: cls.em_atendimento, color: '#3B82F6' },
    { label: 'Sem resposta', value: cls.sem_resposta, color: '#EF4444' },
    { label: 'Aguardando retorno', value: cls.aguardando_retorno, color: '#FACC15' },
    { label: 'Encerrados', value: cls.encerrado, color: '#8B5CF6' },
    { label: 'Sem conversa', value: cls.sem_conversa, color: '#52525B' },
  ].filter(r => r.value > 0) : [];
  const classificationTotal = Math.max(1, classificationRows.reduce((sum, row) => sum + row.value, 0));

  function sparkPath(points: number[], width = 260, height = 70) {
    const max = Math.max(...points, 1);
    const min = Math.min(...points, 0);
    const span = Math.max(max - min, 1);
    return points.map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point - min) / span) * (height - 8) - 4;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  if (loading) {
    return <div className="rounded-[var(--radius)] border border-border bg-card p-12 text-center text-sm text-muted-foreground">Carregando métricas de atendimento...</div>;
  }

  if (!data || !summary) {
    return <div className="rounded-[var(--radius)] border border-border bg-card p-12 text-center text-sm text-muted-foreground">Não foi possível carregar as métricas.</div>;
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-white/5 bg-[#050A0C] p-4 text-[#F4F7F8] shadow-[0_0_80px_rgba(50,232,67,0.04)]">
      <div className="grid gap-4">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <section className="relative overflow-hidden rounded-2xl border border-purple-500/35 bg-[radial-gradient(circle_at_70%_100%,rgba(139,92,246,0.28),transparent_45%),linear-gradient(135deg,rgba(139,92,246,0.24),rgba(13,21,25,0.96))] p-4 shadow-[0_0_38px_rgba(139,92,246,0.16)]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-purple-200"><Sparkles className="h-4 w-4" /> Nota IA Atendimento</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-purple-100">i</span>
              </div>
              <div className="mt-6 flex items-end gap-2">
                <span className="font-heading text-5xl leading-none text-purple-400">{auditLoading ? '…' : aiScore ?? '—'}</span>
                <span className="pb-1 font-heading text-2xl text-purple-300/75">/100</span>
                <span className={cn('mb-2 rounded-lg px-2 py-1 text-xs font-bold', aiStatusTone)}>{aiStatus}</span>
              </div>
              <p className="mt-3 max-w-[210px] text-xs leading-relaxed text-zinc-300">
                {audit
                  ? `Última auditoria: ${new Date(audit.createdAt).toLocaleDateString('pt-BR')} · conversas de ${dataBR(audit.periodFrom)} a ${dataBR(audit.periodTo)}`
                  : 'Nenhuma auditoria gerada ainda para este cliente.'}
              </p>
              <div className="relative z-10 mt-3 flex flex-wrap gap-2">
                {!somenteLeitura && <button
                  onClick={generateAudit}
                  disabled={auditGenerating}
                  className="rounded-lg border border-purple-400/40 bg-purple-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-purple-100 transition-colors hover:bg-purple-500/30 disabled:opacity-60"
                >
                  {auditGenerating ? 'Gerando…' : audit ? 'Gerar nova auditoria' : 'Gerar auditoria'}
                </button>}
                <a
                  href={`/relatorio-atendimento?${new URLSearchParams({ clientId, ...(month ? { month } : {}), ...(!month && from ? { from } : {}), ...(!month && to ? { to } : {}) })}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Piores, intermediários e melhores atendimentos do período, com o trecho da conversa, o porquê e o ajuste — pronto para salvar em PDF"
                  className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/25"
                >
                  Relatório com prints (PDF)
                </a>
                {audit && (
                  <button
                    onClick={irParaAuditoria}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-white/10"
                  >
                    Ver auditoria completa ↓
                  </button>
                )}
              </div>
              {auditError && <p className="relative z-10 mt-2 max-w-[220px] text-[11px] text-red-300">{auditError}</p>}
              {/* ⚠️ Esta linha era um desenho fixo no código ([32, 40, 36…]). Agora é a
                  nota de cada auditoria do cliente; com menos de duas, não há linha. */}
              {historico.length >= 2 && (
                <svg className="absolute bottom-0 left-0 h-16 w-full opacity-80" viewBox="0 0 260 70" preserveAspectRatio="none">
                  <path d={`${sparkPath(historico.map(h => h.nota), 260, 70)} L 260 70 L 0 70 Z`} fill="rgba(139,92,246,0.28)" />
                  <path d={sparkPath(historico.map(h => h.nota), 260, 70)} fill="none" stroke="#8B5CF6" strokeWidth="2.4" />
                </svg>
              )}
            </section>

            {[
              { label: 'Leads no período', value: totalLeads.toLocaleString('pt-BR'), sub: 'leads captados', badge: varLeads?.texto ?? null, badgeBom: varLeads?.bom, Icon: Users, tone: 'border-blue-500/20 bg-[#0D1519]', color: '#A78BFA', badgeTone: 'bg-blue-500/15 text-blue-300' },
              { label: 'Sem resposta', value: unanswered.toLocaleString('pt-BR'), sub: 'leads aguardando retorno', badge: unanswered > 0 ? 'Risco alto de perda' : null, badgeBom: false, Icon: Clock3, tone: 'border-red-500/25 bg-red-500/10', color: '#EF4444', badgeTone: 'bg-red-500/15 text-red-300' },
              { label: 'Resposta média', value: formatDuration(summary.avg_response_seconds), sub: 'tempo médio', badge: varResposta?.texto ?? null, badgeBom: varResposta?.bom, Icon: Sparkles, tone: 'border-emerald-500/20 bg-emerald-500/10', color: '#32E843', badgeTone: 'bg-emerald-500/15 text-emerald-300' },
              { label: 'Taxa de resposta', value: `${responseRate}%`, sub: 'das conversas', badge: varTaxa?.texto ?? null, badgeBom: varTaxa?.bom, Icon: BarChart3, tone: 'border-emerald-500/20 bg-[#0B1B15]', color: '#32E843', badgeTone: 'bg-emerald-500/15 text-emerald-300' },
              { label: 'Conversas ativas', value: activeConversations.toLocaleString('pt-BR'), sub: 'ativas agora', badge: varAtivas?.texto ?? null, badgeBom: varAtivas?.bom, Icon: MessageCircle, tone: 'border-blue-500/20 bg-blue-500/10', color: '#3B82F6', badgeTone: 'bg-blue-500/15 text-blue-300' },
            ].map(card => (
              <section key={card.label} className={cn('min-h-[178px] rounded-2xl border p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)]', card.tone)}>
                <card.Icon className="mb-5 h-5 w-5" style={{ color: card.color }} />
                <p className="text-sm font-semibold" style={{ color: card.color }}>{card.label}</p>
                <p className="mt-5 font-heading text-4xl leading-none text-zinc-100">{card.value}</p>
                <p className="mt-2 text-sm text-zinc-400">{card.sub}</p>
                {card.badge && (
                  <span className={cn(
                    'mt-5 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold',
                    card.badgeBom === undefined ? card.badgeTone
                      : card.badgeBom ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300',
                  )}>{card.badge}</span>
                )}
              </section>
            ))}
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[1.6fr_1fr]">
            <EvolucaoMensal meses={data.mensal ?? []} />
            <TentativasContatoCard t={data.tentativas ?? null} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.5fr_0.78fr_0.98fr]">
            <section className="rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold">Desempenho de resposta ao longo do tempo</h3>
                  <div className="mt-4 flex items-center gap-5 text-xs text-zinc-400">
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Tempo médio de resposta</span>
                    <span className="flex items-center gap-2"><span className="h-px w-7 border-t border-dashed border-zinc-500" /> Meta</span>
                  </div>
                </div>
                <span className="rounded-lg border border-white/[0.08] bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-300">Últimos 7 dias</span>
              </div>
              {responseTrend.length === 0 ? (
                <div className="flex h-[250px] items-center justify-center text-center text-sm text-zinc-500">
                  Nenhuma resposta registrada nos últimos 7 dias.
                </div>
              ) : (
              <svg viewBox="0 0 620 240" className="h-[250px] w-full">
                {[0, 1, 2, 3].map(i => <line key={i} x1="42" x2="600" y1={35 + i * 52} y2={35 + i * 52} stroke="rgba(255,255,255,0.06)" />)}
                {[0, 1, 2, 3, 4, 5, 6].map(i => <line key={i} x1={70 + i * 83} x2={70 + i * 83} y1="35" y2="192" stroke="rgba(255,255,255,0.04)" />)}
                <line x1="42" x2="600" y1="116" y2="116" stroke="rgba(154,164,170,0.55)" strokeDasharray="6 7" />
                {['12h', '8h', '4h', '0h'].map((label, i) => <text key={label} x="0" y={40 + i * 52} fill="#7b8790" fontSize="12">{label}</text>)}
                {responseTrend.map((point, index) => <text key={point.label} x={52 + index * (530 / Math.max(responseTrend.length - 1, 1))} y="224" fill="#7b8790" fontSize="12">{point.label}</text>)}
                <path
                  d={responseTrend.map((point, index) => {
                    const x = 70 + index * (530 / Math.max(responseTrend.length - 1, 1));
                    const y = 192 - Math.min(12, point.value) / 12 * 156;
                    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="#32E843"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {responseTrend.map((point, index) => {
                  const x = 70 + index * (530 / Math.max(responseTrend.length - 1, 1));
                  const y = 192 - Math.min(12, point.value) / 12 * 156;
                  return <circle key={point.label} cx={x} cy={y} r="5" fill="#32E843" stroke="#0D1519" strokeWidth="2" />;
                })}
              </svg>
              )}
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
              <h3 className="text-base font-bold">SLA de resposta</h3>
              <div className="mt-7 space-y-5">
                {slaRows.map(row => {
                  const percent = responseTotal > 0 ? Math.round((row.value / responseTotal) * 100) : 0;
                  return (
                    <div key={row.label} className="grid grid-cols-[72px_1fr_68px] items-center gap-3 text-sm">
                      <span className="font-semibold text-zinc-300">{row.label}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full rounded-full" style={{ width: `${percent}%`, background: row.color }} />
                      </div>
                      <span className="text-right text-xs text-zinc-400">{percent}% ({row.value})</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-7 flex items-center gap-2 text-sm text-zinc-300"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-400/40 text-blue-300">↗</span>{slaRate}% das respostas em até 1h</p>
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
              <h3 className="text-base font-bold">Classificação dos atendimentos</h3>
              <div className="mt-7 grid grid-cols-1 items-center gap-5 sm:grid-cols-[150px_1fr]">
                <div className="relative h-[150px] w-[150px]">
                  <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                    {classificationRows.reduce<{ offset: number; nodes: React.ReactNode[] }>((acc, row) => {
                      const dash = (row.value / classificationTotal) * 301.59;
                      acc.nodes.push(
                        <circle
                          key={row.label}
                          cx="60"
                          cy="60"
                          r="48"
                          fill="none"
                          stroke={row.color}
                          strokeWidth="18"
                          strokeDasharray={`${dash} 301.59`}
                          strokeDashoffset={-acc.offset}
                        />,
                      );
                      acc.offset += dash;
                      return acc;
                    }, { offset: 0, nodes: [] }).nodes}
                    <circle cx="60" cy="60" r="31" fill="#0D1519" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-heading text-3xl">{totalLeads.toLocaleString('pt-BR')}</span>
                    <span className="text-xs text-zinc-400">leads</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {classificationRows.map(row => {
                    const percent = Math.round((row.value / Math.max(totalLeads, 1)) * 100);
                    return (
                      <div key={row.label} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                        <span className="flex items-center gap-2 text-zinc-300"><span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />{row.label}</span>
                        <span className="text-zinc-400">{percent}% ({row.value})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.45fr_0.82fr]">
            <section className="rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
              <h3 className="text-base font-bold">Risco de perda (leads sem resposta)</h3>
              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[180px_1fr]">
                <div>
                  <p className="flex items-center gap-2 text-sm text-zinc-400"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" /> Leads em risco</p>
                  <p className="mt-10 font-heading text-5xl leading-none">{unanswered.toLocaleString('pt-BR')}</p>
                  <p className="mt-2 text-sm text-zinc-400">leads em risco</p>
                  {riskTrend.length > 0 && (
                    <span className="mt-5 inline-flex rounded-lg bg-red-500/15 px-3 py-1.5 text-sm font-semibold text-red-300">
                      {riskTrend.reduce((t, p) => t + p.value, 0)} nos últimos 7 dias
                    </span>
                  )}
                </div>
                <svg viewBox="0 0 520 180" className="h-[190px] w-full">
                  {[0, 1, 2].map(i => <line key={i} x1="35" x2="500" y1={28 + i * 58} y2={28 + i * 58} stroke="rgba(255,255,255,0.06)" />)}
                  {['30', '15', '0'].map((label, i) => <text key={label} x="2" y={33 + i * 58} fill="#7b8790" fontSize="12">{label}</text>)}
                  {riskTrend.map((point, index) => <text key={point.label} x={42 + index * 72} y="170" fill="#7b8790" fontSize="12">{point.label}</text>)}
                  <path
                    d={`${riskTrend.map((point, index) => {
                      const x = 58 + index * 72;
                      const y = 144 - Math.min(30, point.value) / 30 * 116;
                      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
                    }).join(' ')} L 490 144 L 58 144 Z`}
                    fill="rgba(239,68,68,0.18)"
                  />
                  <path
                    d={riskTrend.map((point, index) => {
                      const x = 58 + index * 72;
                      const y = 144 - Math.min(30, point.value) / 30 * 116;
                      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {riskTrend.map((point, index) => {
                    const x = 58 + index * 72;
                    const y = 144 - Math.min(30, point.value) / 30 * 116;
                    return <circle key={point.label} cx={x} cy={y} r="5" fill="#EF4444" />;
                  })}
                </svg>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
              <h3 className="text-base font-bold">Retomada de conversas paradas</h3>
              {followupRate === null ? (
                <>
                  <p className="mt-8 font-heading text-5xl leading-none text-zinc-500">—</p>
                  <p className="mt-2 max-w-[200px] text-sm text-zinc-400">
                    nenhuma mensagem foi enviada depois de 48h de silêncio neste período
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-8 font-heading text-5xl leading-none">{followupRate}%</p>
                  <p className="mt-2 max-w-[200px] text-sm text-zinc-400">
                    das {retomada?.enviadas} retomadas trouxeram resposta do cliente
                    {retomada ? ` (${retomada.responderam})` : ''}
                  </p>
                </>
              )}
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
              <h3 className="text-base font-bold">Por atendente</h3>
              {(data?.atendentes ?? []).length === 0 ? (
                <p className="mt-6 text-sm text-zinc-500">
                  Ainda não há mensagem com autor registrado. A partir de agora, toda resposta
                  enviada pela tela guarda quem respondeu — e este painel passa a comparar a
                  equipe. Mensagem de follow-up, disparo ou que chega pelo WhatsApp fora do
                  sistema continua sem autor, de propósito.
                </p>
              ) : (
                <div className="mt-5 space-y-3">
                  {(data?.atendentes ?? []).map(a => {
                    const pctRapido = a.respostas > 0 ? Math.round((a.ate_5min / a.respostas) * 100) : 0;
                    return (
                      <div key={a.autor_nome} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-semibold text-zinc-100">{a.autor_nome}</span>
                          <span className="shrink-0 text-xs text-zinc-400">{formatDuration(a.avg_response_seconds)} em média</span>
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                          {[
                            ['Leads', a.leads_atendidos.toLocaleString('pt-BR')],
                            ['Respostas', a.respostas.toLocaleString('pt-BR')],
                            ['Até 5 min', `${pctRapido}%`],
                            ['+1h', a.mais_1h.toLocaleString('pt-BR')],
                          ].map(([k, v]) => (
                            <div key={k}>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{k}</p>
                              <p className="mt-0.5 text-sm font-semibold text-zinc-200">{v}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
              <h3 className="text-base font-bold">Por que perdemos</h3>
              {(data?.motivosPerda ?? []).length === 0 ? (
                <p className="mt-6 text-sm text-zinc-500">
                  Nenhum motivo registrado ainda. A partir de agora, mover um lead para uma etapa
                  de perda pede o motivo — e em um mês este painel mostra o que ajustar na compra
                  e no preço.
                  {(data?.perdidosSemMotivo ?? 0) > 0 && (
                    <> Há {data?.perdidosSemMotivo} lead(s) perdido(s) antes disso, sem motivo.</>
                  )}
                </p>
              ) : (
                <>
                  <div className="mt-5 space-y-3">
                    {(data?.motivosPerda ?? []).map(m => {
                      const totalMotivos = (data?.motivosPerda ?? []).reduce((t, x) => t + x.total, 0) || 1;
                      const pct = Math.round((m.total / totalMotivos) * 100);
                      return (
                        <div key={m.motivo ?? 'sem'}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-semibold text-zinc-300">{rotuloMotivo(m.motivo) ?? 'Sem motivo'}</span>
                            <span className="text-xs text-zinc-400">{pct}% ({m.total})</span>
                          </div>
                          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                            <div className="h-full rounded-full bg-red-400/70" style={{ width: `${pct}%` }} />
                          </div>
                          {m.detalhes.slice(0, 2).map((d, i) => (
                            <p key={i} className="mt-1 truncate text-[11px] text-zinc-500" title={d}>“{d}”</p>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  {(data?.perdidosSemMotivo ?? 0) > 0 && (
                    <p className="mt-4 text-[11px] text-zinc-500">
                      {data?.perdidosSemMotivo} perdido(s) sem motivo (de antes deste registro).
                    </p>
                  )}
                </>
              )}
            </section>
          </div>

          <AttendanceAuditReport
            audit={audit}
            loading={auditLoading}
            clientId={clientId}
            leadNomes={leadNomes}
            historico={historico}
          />
        </div>

      </div>
    </div>
  );
}

/** 'YYYY-MM-DD' (ou ISO) → dd/mm/aaaa sem passar por fuso. */
function dataBR(iso: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function mesCurto(ym: string) {
  const [y, m] = ym.split('-');
  return `${MESES_CURTOS[Number(m) - 1] ?? m}/${y.slice(2)}`;
}
const pctDe = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : null);

/**
 * Comparação mês a mês do atendimento. ⚠️ O mês é o da MENSAGEM: é quando o
 * atendimento acontece. Os cards do topo seguem o filtro da tela (que recorta
 * pela criação do lead) — por isso os números não precisam bater com eles.
 */
function EvolucaoMensal({ meses }: { meses: MesAtendimento[] }) {
  // Esconde os meses antes de existir histórico: zero ali é ausência de dado,
  // não atendimento ruim.
  const primeiro = meses.findIndex(m => m.turnos > 0 || m.tentados > 0);
  const linhas = primeiro < 0 ? [] : meses.slice(primeiro);
  const mesAtual = meses[meses.length - 1]?.mes;

  type Col = {
    k: string; titulo: string; dica: string; menorMelhor?: boolean;
    valor: (m: MesAtendimento) => number | null; fmt: (v: number) => string;
  };
  const cols: Col[] = [
    { k: 'conv', titulo: 'Conversas', dica: 'Pessoas que mandaram mensagem no mês', valor: m => m.conversas, fmt: v => v.toLocaleString('pt-BR') },
    { k: 'med', titulo: 'Tempo de resposta', dica: 'Mediana do tempo entre o cliente falar e a nossa resposta (cada vez que ele fala, não só a primeira)', menorMelhor: true, valor: m => m.mediana_resposta_seg, fmt: v => formatDuration(v) },
    { k: 'r5', titulo: 'Até 5 min', dica: '% das respostas dadas em até 5 minutos', valor: m => pctDe(m.ate_5min, m.respondidos), fmt: v => `${v}%` },
    { k: 'r60', titulo: 'Mais de 1h', dica: '% das respostas que passaram de 1 hora', menorMelhor: true, valor: m => pctDe(m.mais_1h, m.respondidos), fmt: v => `${v}%` },
    { k: 'sr', titulo: 'Sem resposta', dica: '% das vezes em que o cliente falou e ninguém respondeu', menorMelhor: true, valor: m => pctDe(m.sem_resposta, m.turnos), fmt: v => `${v}%` },
    { k: 'ret', titulo: 'Retomadas', dica: 'Mensagens nossas depois de 48h de silêncio (entre parênteses, quantas tiveram resposta)', valor: m => m.retomadas, fmt: v => v.toLocaleString('pt-BR') },
    { k: 'si', titulo: 'Sem interação', dica: '% de quem tentamos contato no mês e nunca respondeu', menorMelhor: true, valor: m => pctDe(m.sem_interacao, m.tentados), fmt: v => `${v}%` },
  ];

  return (
    <section className="min-w-0 rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">Evolução mês a mês</h3>
          <p className="mt-1 text-xs text-zinc-500">Pelo mês da mensagem · setas comparam com o mês anterior · não segue o filtro de período</p>
        </div>
      </div>
      {linhas.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">Ainda não há conversas registradas no sistema para este cliente.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <th className="pb-2 pr-3">Mês</th>
                  {cols.map(c => <th key={c.k} className="pb-2 pr-3" title={c.dica}>{c.titulo}</th>)}
                </tr>
              </thead>
              <tbody>
                {linhas.map((m, i) => {
                  const ant = i > 0 ? linhas[i - 1] : null;
                  return (
                    <tr key={m.mes} className="border-t border-white/[0.06]">
                      <td className="py-2.5 pr-3 font-semibold text-zinc-200">
                        {mesCurto(m.mes)}
                        {m.mes === mesAtual && <span className="ml-1.5 text-[10px] font-normal text-zinc-500">parcial</span>}
                      </td>
                      {cols.map(c => {
                        const v = c.valor(m);
                        const va = ant ? c.valor(ant) : null;
                        let seta: { s: string; bom: boolean } | null = null;
                        if (v != null && va != null && v !== va && c.k !== 'conv' && c.k !== 'ret') {
                          const subiu = v > va;
                          seta = { s: subiu ? '▲' : '▼', bom: c.menorMelhor ? !subiu : subiu };
                        }
                        return (
                          <td key={c.k} className="py-2.5 pr-3 text-zinc-300">
                            {v == null ? <span className="text-zinc-600">—</span> : c.fmt(v)}
                            {c.k === 'ret' && m.retomadas > 0 && (
                              <span className="ml-1 text-[11px] text-zinc-500">({m.retomadas_responderam})</span>
                            )}
                            {seta && <span className={cn('ml-1 text-[10px]', seta.bom ? 'text-emerald-400' : 'text-red-400')}>{seta.s}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {linhas.length < 2 && (
            <p className="mt-3 text-xs text-zinc-500">A comparação aparece quando houver o segundo mês com conversas.</p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Quem a loja tentou alcançar e não respondeu. ⚠️ Tentativa = um DIA com
 * mensagem nossa: cinco mensagens na mesma manhã são uma tentativa só.
 */
function TentativasContatoCard({ t }: { t: TentativasContato | null }) {
  const n1 = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
  return (
    <section className="min-w-0 rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
      <h3 className="text-base font-bold">Tentativas de contato</h3>
      <p className="mt-1 text-xs text-zinc-500">Pessoas que receberam a 1ª mensagem nossa no período selecionado</p>
      {!t || t.tentados === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">Nenhuma tentativa de contato registrada neste período.</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <p className="font-heading text-4xl leading-none text-red-300">{t.sem_interacao.toLocaleString('pt-BR')}</p>
              <p className="mt-1.5 text-xs text-zinc-400">sem nenhuma interação, de {t.tentados.toLocaleString('pt-BR')} que tentamos ({pctDe(t.sem_interacao, t.tentados)}%)</p>
            </div>
            <div>
              <p className="font-heading text-4xl leading-none text-zinc-100">{n1(t.media_tentativas_sem_interacao)}</p>
              <p className="mt-1.5 text-xs text-zinc-400">tentativas em média antes de parar ({n1(t.media_mensagens_sem_interacao)} mensagens)</p>
            </div>
          </div>

          <div className="mt-5 space-y-1.5 text-xs text-zinc-400">
            <p><span className="font-semibold text-zinc-200">{t.nunca_escreveram.toLocaleString('pt-BR')}</span> nunca escreveram nada (contato ativo nosso)</p>
            <p><span className="font-semibold text-zinc-200">{t.sumiram_apos_primeira.toLocaleString('pt-BR')}</span> mandaram a 1ª mensagem e sumiram depois da nossa resposta</p>
            <p><span className="font-semibold text-emerald-300">{t.responderam.toLocaleString('pt-BR')}</span> responderam, depois de {n1(t.media_tentativas_ate_responder)} tentativa(s) em média</p>
          </div>

          {t.sem_interacao > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Quem não respondeu, por nº de tentativas</p>
              <div className="grid grid-cols-4 gap-2">
                {([['1', t.dist.t1], ['2', t.dist.t2], ['3', t.dist.t3], ['4+', t.dist.t4mais]] as const).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-center">
                    <p className="text-[10px] text-zinc-500">{k} tentativa{k === '1' ? '' : 's'}</p>
                    <p className="font-heading text-xl text-zinc-100">{v.toLocaleString('pt-BR')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-4 text-[11px] text-zinc-500">Tentativa = um dia em que mandamos mensagem. Várias mensagens no mesmo dia contam como uma.</p>
        </>
      )}
    </section>
  );
}

const PESOS_CRITERIO = [
  ['velocidade_sla', 'Velocidade e SLA', 25],
  ['qualidade_conversa', 'Qualidade da conversa', 30],
  ['conducao_comercial', 'Condução comercial', 30],
  ['followup_recuperacao', 'Follow-up e recuperação', 10],
  ['organizacao_crm', 'Organização no CRM', 5],
] as const;

/** O relatório inteiro da auditoria, aberto na aba (antes ficava num modal). */
function AttendanceAuditReport({
  audit, loading, clientId, leadNomes, historico,
}: {
  audit: { result: AttendanceAudit; periodFrom: string; periodTo: string; createdAt: string } | null;
  loading: boolean;
  clientId: string;
  leadNomes: Record<string, string>;
  historico: ItemHistoricoAuditoria[];
}) {
  const card = 'rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]';
  if (loading) return null;
  if (!audit) {
    return (
      <section id="auditoria-completa" className={card}>
        <h3 className="flex items-center gap-2 text-base font-bold"><Sparkles className="h-4 w-4 text-purple-300" /> Auditoria de atendimento</h3>
        <p className="mt-4 text-sm text-zinc-500">Nenhuma auditoria gerada ainda para este cliente.</p>
      </section>
    );
  }
  const r = audit.result;
  const gravidadeTone: Record<string, string> = {
    alta: 'bg-red-500/15 text-red-300 border-red-400/30',
    média: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
    baixa: 'bg-zinc-500/15 text-zinc-300 border-zinc-400/30',
  };
  const nomeLead = (id: string) => leadNomes[id] ?? 'Lead';
  const linkLead = (id: string) => `/crm?${new URLSearchParams({ clientId, lead: id })}`;
  const anterior = historico.length >= 2 ? historico[historico.length - 2] : null;
  const delta = anterior ? r.nota_geral - anterior.nota : null;

  return (
    <section id="auditoria-completa" className="min-w-0 scroll-mt-4 space-y-4">
      <div className={cn(card, 'border-purple-500/30 bg-[linear-gradient(135deg,rgba(139,92,246,0.14),rgba(13,21,25,0.96))]')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold"><Sparkles className="h-4 w-4 text-purple-300" /> Auditoria de atendimento</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Conversas de {dataBR(audit.periodFrom)} a {dataBR(audit.periodTo)} · gerada em {new Date(audit.createdAt).toLocaleString('pt-BR')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-heading text-5xl leading-none text-purple-300">{r.nota_geral}<span className="text-2xl text-purple-300/60">/100</span></span>
            <span className="rounded-lg bg-purple-500/20 px-2 py-1 text-xs font-bold text-purple-100">{r.classificacao}</span>
            {delta !== null && delta !== 0 && (
              <span className={cn('text-xs font-semibold', delta > 0 ? 'text-emerald-300' : 'text-red-300')}>
                {delta > 0 ? '+' : ''}{delta} vs. auditoria anterior
              </span>
            )}
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-zinc-300">{r.resumo_semana}</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {PESOS_CRITERIO.map(([k, label, max]) => {
            const bruto = Number(r.notas_criterios?.[k] ?? 0);
            // Auditoria antiga gravada em 0–100 por critério: converte para os pontos da régua.
            const v = bruto > max ? Math.round((bruto * max) / 100) : bruto;
            const pct = Math.round((v / max) * 100);
            return (
              <div key={k} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</p>
                <p className="mt-1 font-heading text-2xl text-zinc-100">{v}<span className="text-sm text-zinc-500">/{max}</span></p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className={cn('h-full rounded-full', pct >= 70 ? 'bg-emerald-400' : pct >= 55 ? 'bg-amber-400' : 'bg-red-400')} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className={card}>
          <h4 className="text-sm font-bold text-zinc-100">Principais problemas</h4>
          <ul className="mt-3 list-disc space-y-2 pl-4 text-sm text-zinc-300">
            {(r.principais_problemas ?? []).map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
        <div className={card}>
          <h4 className="text-sm font-bold text-zinc-100">Plano de ação</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {([
              ['Ações urgentes', r.plano_acao?.urgentes],
              ['Melhorias de processo', r.plano_acao?.melhorias_processo],
              ['Treinamento do time', r.plano_acao?.treinamento_time],
              ['Ajustes de script', r.plano_acao?.ajustes_script],
              ['Ajustes no CRM/automações', r.plano_acao?.ajustes_crm_automacoes],
            ] as const).filter(([, items]) => (items?.length ?? 0) > 0).map(([label, items]) => (
              <div key={label} className={cn('rounded-lg border p-3', label === 'Ações urgentes' ? 'border-red-400/25 bg-red-500/5' : 'border-white/[0.08] bg-white/[0.03]')}>
                <p className="mb-1.5 text-xs font-bold text-zinc-200">{label}</p>
                <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-300">
                  {(items ?? []).map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className={card}>
          <h4 className="text-sm font-bold text-zinc-100">Oportunidades perdidas</h4>
          <div className="mt-3 space-y-2">
            {(r.oportunidades_perdidas ?? []).map((o, i) => (
              <div key={i} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <a href={linkLead(o.lead_id)} className="truncate text-xs font-semibold text-zinc-100 hover:text-primary" title="Abrir conversa no CRM">
                    {nomeLead(o.lead_id)} <span className="font-normal text-zinc-500">· {o.canal}</span>
                  </a>
                  <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold', gravidadeTone[o.gravidade] ?? gravidadeTone.baixa)}>{o.gravidade}</span>
                </div>
                <p className="text-zinc-300"><strong className="text-zinc-100">Queria:</strong> {o.o_que_queria}</p>
                <p className="text-zinc-300"><strong className="text-zinc-100">Falha:</strong> {o.onde_falhou}</p>
                <p className="text-zinc-300"><strong className="text-zinc-100">Ação:</strong> {o.acao_deveria}</p>
              </div>
            ))}
            {(r.oportunidades_perdidas ?? []).length === 0 && <p className="text-sm text-zinc-500">Nenhuma registrada.</p>}
          </div>
        </div>
        <div className={card}>
          <h4 className="text-sm font-bold text-zinc-100">Bons exemplos</h4>
          <div className="mt-3 space-y-2">
            {(r.bons_exemplos ?? []).map((b, i) => (
              <div key={i} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
                <a href={linkLead(b.lead_id)} className="text-xs font-semibold text-zinc-100 hover:text-primary" title="Abrir conversa no CRM">{nomeLead(b.lead_id)}</a>
                <p className="mt-1 text-zinc-300"><strong className="text-zinc-100">Bem feito:</strong> {b.o_que_foi_bem}</p>
                <p className="text-zinc-300"><strong className="text-zinc-100">Por quê:</strong> {b.motivo_referencia}</p>
              </div>
            ))}
            {(r.bons_exemplos ?? []).length === 0 && <p className="text-sm text-zinc-500">Nenhum registrado.</p>}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className={card}>
          <h4 className="text-sm font-bold text-zinc-100">Por fonte de captação</h4>
          <div className="mt-3 space-y-2">
            {(r.analise_fontes ?? []).map((f, i) => (
              <div key={i} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-sm">
                <p className="font-semibold text-zinc-100">{f.fonte} <span className="font-normal text-zinc-500">· {f.quantidade_leads} leads · {f.qualidade_atendimento}</span></p>
                <p className="text-zinc-400">{f.taxa_avanco}</p>
                <p className="text-zinc-400">Gargalo: {f.principais_gargalos}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={card}>
          <h4 className="text-sm font-bold text-zinc-100">Por atendente</h4>
          {(r.analise_atendentes ?? []).length > 0 ? (
            <div className="mt-3 space-y-2">
              {r.analise_atendentes.map((a, i) => (
                <div key={i} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-zinc-300">
                  <p className="font-semibold text-zinc-100">{a.atendente}</p>
                  {a.pontos_fortes && <p>Pontos fortes: {a.pontos_fortes}</p>}
                  {a.pontos_melhoria && <p>Pontos de melhoria: {a.pontos_melhoria}</p>}
                  {a.tempo_medio_resposta && <p className="text-zinc-400">Tempo: {a.tempo_medio_resposta}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Não informado: as mensagens antigas não guardam quem respondeu.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-purple-300">Recomendação final</p>
        <p className="text-sm text-zinc-200">{r.recomendacao_final}</p>
      </div>
    </section>
  );
}

// ── Funnel Editor ────────────────────────────────────────────────────────────

function SortableStageRow({
  stage, onChange, onDelete,
}: {
  stage: LocalStage;
  onChange: (updates: Partial<CrmStage>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2 py-1.5">
      <button type="button" {...attributes} {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5 shrink-0">
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Espelho da cor do degrau escolhido ao lado — não é escolha de cor.
          Um seletor aqui seria pior que nada: o gestor trocaria a cor e o board
          continuaria pintando pelo degrau. */}
      <span
        className="h-5 w-5 shrink-0 rounded-full border border-border/50"
        style={{ background: corDaEtapa(stage.etapa_funil, stage.label) }}
        title={`Cor do degrau ${ROTULOS_ETAPA[stage.etapa_funil ?? classificarEtapa(stage.label)]}`}
      />

      <input
        value={stage.label}
        onChange={e => onChange({ label: e.target.value })}
        className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none focus:bg-primary/5 rounded px-1 py-0.5"
      />

      {/* O que esta etapa SIGNIFICA no Funil de Performance — é daqui que o
          dashboard conta Agendamentos/Comparecimentos/Fechamentos. Dropdown
          COMPOSTO: grau e, onde existe, a situação ("sem resposta" no topo,
          "parou de responder" em qualificado) numa escolha só. Sem escolha
          explícita, vale a auto-classificação pelo nome. */}
      <select
        value={valorOpcaoEditor(stage.etapa_funil, stage.situacao, stage.label)}
        onChange={e => { const o = opcaoDoValor(e.target.value); onChange({ etapa_funil: o.etapa, situacao: o.situacao }); }}
        title="Em qual degrau do Funil de Performance esta coluna entra — e, se for o caso, a situação (sem resposta / parou de responder)"
        className="w-[196px] shrink-0 rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {OPCOES_EDITOR.map(o => (
          <option key={o.valor} value={o.valor}>{o.rotulo}</option>
        ))}
      </select>

      <button type="button" onClick={onDelete}
        className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors p-0.5">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FunnelEditorModal({
  funnel, stages: initialStages, clientId, funnelCount,
  onSaved, onClose, onDeleteFunnel, onNewFunnel,
}: {
  funnel: CrmFunnel;
  stages: CrmStage[];
  clientId: string;
  funnelCount: number;
  onSaved: (funnel: CrmFunnel, stages: CrmStage[]) => void;
  onClose: () => void;
  onDeleteFunnel: () => void;
  onNewFunnel: () => void;
}) {
  const [name, setName] = useState(funnel.name);
  const [localStages, setLocalStages] = useState<LocalStage[]>(initialStages.map(s => ({ ...s })));
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // "Salvar como modelo": fotografa as etapas que estão NA TELA (não as do
  // banco) — o gestor costuma ajustar e só então decidir guardar o desenho.
  const [aplicarModelo, setAplicarModelo] = useState(false);
  const [modoModelo, setModoModelo] = useState(false);
  const [nomeModelo, setNomeModelo] = useState('');
  const [salvandoModelo, setSalvandoModelo] = useState(false);
  const [recadoModelo, setRecadoModelo] = useState<string | null>(null);

  async function salvarComoModelo() {
    const nomeLimpo = nomeModelo.trim();
    if (!nomeLimpo || salvandoModelo) return;
    setSalvandoModelo(true);
    setRecadoModelo(null);
    try {
      const res = await fetch('/api/crm/funil-modelos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nomeLimpo,
          clientId,
          etapas: localStages.map(st => ({
            label: st.label,
            color: st.color,
            etapa_funil: st.etapa_funil ?? classificarEtapa(st.label),
          })),
        }),
      });
      if (res.ok) {
        setRecadoModelo(`Modelo "${nomeLimpo}" salvo — já aparece ao criar funil em qualquer cliente.`);
        setModoModelo(false);
        setNomeModelo('');
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setRecadoModelo(d.error ?? 'Não foi possível salvar o modelo.');
      }
    } catch {
      setRecadoModelo('Erro de conexão ao salvar o modelo.');
    } finally {
      setSalvandoModelo(false);
    }
  }

  const editorSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function addStage() {
    setLocalStages(prev => [...prev, {
      id: `_new_${Date.now()}`,
      label: 'Nova Etapa',
      color: '#71717a',
      position: prev.length,
      _isNew: true,
    }]);
  }

  function deleteStage(id: string) {
    if (!id.startsWith('_new_')) setDeletedIds(prev => [...prev, id]);
    setLocalStages(prev => prev.filter(s => s.id !== id));
  }

  function updateStage(id: string, updates: Partial<CrmStage>) {
    setLocalStages(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }

  function handleStageDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = localStages.findIndex(s => s.id === active.id);
    const newIdx = localStages.findIndex(s => s.id === over.id);
    if (oldIdx !== -1 && newIdx !== -1) setLocalStages(prev => arrayMove(prev, oldIdx, newIdx));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const funnelRes = await fetch(`/api/crm/funnels/${funnel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, clientId }),
      });
      const savedFunnel: CrmFunnel = funnelRes.ok ? await funnelRes.json() as CrmFunnel : { ...funnel, name };

      await Promise.all(deletedIds.map(id => fetch(`/api/crm/stages/${id}`, { method: 'DELETE' })));

      const savedStages: CrmStage[] = [];
      for (let i = 0; i < localStages.length; i++) {
        const s = localStages[i];
        // Persistir sempre o que o dropdown EXIBE (explícito ou auto) — grau e
        // situação — assim um rename futuro não muda o funil por baixo de quem
        // já conferiu.
        const { etapa: etapaFunil, situacao } = opcaoDoValor(valorOpcaoEditor(s.etapa_funil, s.situacao, s.label));
        if (s._isNew) {
          const res = await fetch(`/api/crm/funnels/${funnel.id}/stages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // `position: i` é o que faz a etapa nova nascer ONDE foi arrastada —
            // sem ele a rota grava MAX+1 e ela volta pro fim no refresh.
            body: JSON.stringify({ label: s.label, color: s.color, clientId, etapa_funil: etapaFunil, situacao, position: i }),
          });
          if (res.ok) savedStages.push(await res.json() as CrmStage);
        } else {
          const res = await fetch(`/api/crm/stages/${s.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: s.label, color: s.color, position: i, etapa_funil: etapaFunil, situacao }),
          });
          savedStages.push(res.ok ? await res.json() as CrmStage : { ...s, position: i });
        }
      }

      onSaved(savedFunnel, savedStages);
    } finally {
      setSaving(false);
    }
  }

  const stageIds = localStages.map(s => s.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Configurar Funil</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome do funil</span>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapas ({localStages.length})</span>
              <button onClick={addStage}
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Adicionar etapa
              </button>
            </div>

            {/* ⚠️ O seletor da direita decide o FUNIL DA DASHBOARD e vivia sem
                rótulo nenhum, só com um title no hover — ninguém achava. Um
                cliente com 14 etapas (D1…D7, Lead Morno, Lead Quente…) precisa
                dizer que todas elas são topo de funil, senão a dashboard conta
                cada uma como um degrau diferente. */}
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="text-[11px] leading-snug text-muted-foreground">
                <strong className="text-foreground">Grau no funil</strong> (coluna da direita) é o
                que a <strong className="text-foreground">dashboard</strong> conta. Várias etapas
                podem ter o mesmo grau — marque D1, D2, D3… todas como
                <strong className="text-foreground"> Contato</strong> e elas viram um degrau só no
                Funil de Performance, sem deixar de ser colunas separadas aqui no Kanban.
              </p>
            </div>

            <div className="mb-1 flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span className="w-4 shrink-0" />
              <span className="w-5 shrink-0" />
              <span className="flex-1">Nome da coluna</span>
              <span className="w-[118px] shrink-0">Grau no funil</span>
              <span className="w-4 shrink-0" />
            </div>

            <DndContext sensors={editorSensors} onDragEnd={handleStageDragEnd}>
              <SortableContext items={stageIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {localStages.map(stage => (
                    <SortableStageRow key={stage.id} stage={stage}
                      onChange={u => updateStage(stage.id, u)}
                      onDelete={() => deleteStage(stage.id)} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {localStages.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">Nenhuma etapa. Clique em "Adicionar etapa".</p>
            )}
          </div>
        </div>

        {(modoModelo || recadoModelo) && (
          <div className="shrink-0 border-t border-border bg-background/40 px-5 py-3">
            {modoModelo ? (
              <div className="flex items-center gap-2">
                <input
                  value={nomeModelo}
                  autoFocus
                  onChange={e => setNomeModelo(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void salvarComoModelo();
                    if (e.key === 'Escape') { setModoModelo(false); setNomeModelo(''); }
                  }}
                  placeholder="Nome do modelo — ex.: Funil Clínica Odontológica"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={() => void salvarComoModelo()}
                  disabled={salvandoModelo || !nomeModelo.trim()}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {salvandoModelo ? 'Salvando…' : 'Salvar modelo'}
                </button>
                <button
                  onClick={() => { setModoModelo(false); setNomeModelo(''); }}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{recadoModelo}</p>
            )}
            {modoModelo && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Guarda as {localStages.length} etapas desta tela. É uma cópia: mudar este funil depois não altera o modelo.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
          <div className="flex gap-2">
            {funnelCount > 1 && (
              <button onClick={onDeleteFunnel}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 className="h-3.5 w-3.5" /> Excluir funil
              </button>
            )}
            <button onClick={onNewFunnel}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
              <Plus className="h-3.5 w-3.5" /> Novo funil
            </button>
            <button
              onClick={() => { setRecadoModelo(null); setModoModelo(true); setNomeModelo(name); }}
              disabled={localStages.length === 0}
              title="Guardar este desenho de funil para reusar em outros clientes"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <BookmarkPlus className="h-3.5 w-3.5" /> Salvar como modelo
            </button>
            <button
              onClick={() => setAplicarModelo(true)}
              title="Trocar as colunas deste funil pelas de um modelo salvo"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <Layers className="h-3.5 w-3.5" /> Aplicar modelo
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>

      {aplicarModelo && (
        <AplicarModeloFunil
          funnelId={funnel.id}
          clientId={clientId}
          onClose={() => setAplicarModelo(false)}
          onAplicado={() => {
            setAplicarModelo(false);
            // Recarrega as etapas do servidor: o plano pode ter criado, apagado
            // e reordenado colunas, e o estado local do editor ficou velho.
            void fetch(`/api/crm/funnels/${funnel.id}/stages`)
              .then(r => r.ok ? r.json() as Promise<CrmStage[]> : null)
              .then(novas => { if (novas) onSaved(funnel, novas); })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}

/**
 * Criar funil escolhendo um modelo salvo.
 *
 * ⚠️ O modelo é aplicado só no NASCIMENTO do funil. Trocar as colunas de um
 * funil que já tem lead exigiria migrar o `status` (que é TEXTO) de cada um —
 * é o mesmo buraco que faz lead sumir do Kanban quando uma etapa é renomeada
 * por fora. Por isso aqui não existe "aplicar modelo num funil existente".
 */
function NovoFunilModal({
  clientId, onCriado, onClose,
}: {
  clientId: string;
  onCriado: (funnel: CrmFunnel) => void;
  onClose: () => void;
}) {
  const [nome, setNome] = useState('');
  const [nomeTocado, setNomeTocado] = useState(false);
  const [modeloId, setModeloId] = useState<string>(MODELO_PADRAO);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function escolher(id: string, nomeSugerido: string) {
    setModeloId(id);
    // Preenche o nome com o do modelo até o gestor digitar o dele — economiza
    // o passo mais chato sem sequestrar o que ele escreveu.
    if (!nomeTocado) setNome(nomeSugerido);
  }

  async function criar() {
    const limpo = nome.trim();
    if (!limpo || criando) return;
    setCriando(true);
    setErro(null);
    try {
      const res = await fetch('/api/crm/funnels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // MODELO_PADRAO não é registro no banco — é o seed do código, e a rota
        // cai nele quando não recebe modeloId.
        body: JSON.stringify({ clientId, name: limpo, modeloId: modeloId === MODELO_PADRAO ? undefined : modeloId }),
      });
      if (!res.ok) { setErro('Não foi possível criar o funil.'); return; }
      onCriado(await res.json() as CrmFunnel);
    } catch {
      setErro('Erro de conexão ao criar o funil.');
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-bold">Novo funil</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome do funil</span>
            <input
              value={nome}
              autoFocus
              onChange={e => { setNome(e.target.value); setNomeTocado(true); }}
              onKeyDown={e => { if (e.key === 'Enter') void criar(); }}
              placeholder="Ex.: Funil Comercial"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Começar a partir de</span>

            <SeletorModeloFunil modeloId={modeloId} onEscolher={escolher} permitirExcluir />
          </div>

          {erro && <p className="text-xs text-red-400">{erro}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
            Cancelar
          </button>
          <button
            onClick={() => void criar()}
            disabled={criando || !nome.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {criando ? 'Criando…' : 'Criar funil'}
          </button>
        </div>
      </div>
    </div>
  );
}

type TemperatureCriteria = Partial<Record<'quente' | 'morno' | 'frio', string>>;

function AiCriteriaModal({
  clientId,
  onClose,
}: {
  clientId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [useDefault, setUseDefault] = useState(true);
  const [defaults, setDefaults] = useState<TemperatureCriteria>({});
  const [criteria, setCriteria] = useState<TemperatureCriteria>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/ai/criteria?clientId=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { useDefault?: boolean; defaults?: TemperatureCriteria; custom?: TemperatureCriteria; effective?: TemperatureCriteria } | null) => {
        setUseDefault(data?.useDefault ?? true);
        setDefaults(data?.defaults ?? {});
        setCriteria(data?.useDefault ? data?.effective ?? {} : data?.custom ?? data?.effective ?? {});
      })
      .catch(() => {
        setDefaults({});
        setCriteria({});
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/crm/ai/criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, useDefault, criterios: criteria }),
      });
      if (res.ok) onClose();
    } finally {
      setSaving(false);
    }
  }

  function setCriterion(key: 'quente' | 'morno' | 'frio', value: string) {
    setCriteria(prev => ({ ...prev, [key]: value }));
  }

  const source = useDefault ? defaults : criteria;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Critérios da IA</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useDefault}
              onChange={e => {
                setUseDefault(e.target.checked);
                if (e.target.checked) setCriteria(defaults);
              }}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              <span className="block text-sm font-semibold">Usar critérios globais</span>
              <span className="block text-xs text-muted-foreground">Desmarque para definir a régua de temperatura deste cliente.</span>
            </span>
          </label>

          {loading ? (
            <div className="rounded-lg border border-border bg-background/50 p-6 text-center text-sm text-muted-foreground">Carregando critérios...</div>
          ) : (
            (['quente', 'morno', 'frio'] as const).map(temp => (
              <label key={temp} className="block space-y-1.5">
                <span className={cn('inline-flex rounded-full border px-2 py-1 text-[10px] font-bold', temperatureBadgeClass(temp))}>
                  {TEMPERATURE_LABEL[temp]}
                </span>
                <div className="relative">
                  <textarea
                    value={source[temp] ?? ''}
                    onChange={e => setCriterion(temp, e.target.value)}
                    disabled={useDefault}
                    rows={4}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-70"
                  />
                  {!useDefault && (
                    <DictateButton className="absolute bottom-2 right-2" onTranscript={(text) => setCriterion(temp, source[temp] ? `${source[temp]} ${text}` : text)} />
                  )}
                </div>
              </label>
            ))
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || loading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? 'Salvando...' : 'Salvar critérios'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientLogoBg({ clientId }: { clientId: string }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  useEffect(() => { void fetchClientPicture(clientId).then(setImgUrl); }, [clientId]);
  if (!imgUrl) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
      <img
        src={imgUrl}
        alt=""
        className="absolute right-0 top-1/2 -translate-y-1/2 h-[115%] w-auto object-cover opacity-[0.07] scale-105"
        onError={() => setImgUrl(null)}
      />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.9) 34%, rgba(0,0,0,0.58) 68%, rgba(0,0,0,0.34) 100%)' }} />
    </div>
  );
}

function ClientChoiceCard({
  client,
  recentLabel,
  onOpen,
}: {
  client: Client;
  recentLabel?: string;
  onOpen: () => void;
}) {
  const theme = clientTheme(client.id);
  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-gradient-to-br p-3 transition-all hover:-translate-y-0.5',
        theme.bg,
      )}
      style={{
        borderColor: `${theme.accent}38`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.025), 0 14px 42px ${theme.glow}`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(circle at 88% 8%, ${theme.glow}, transparent 30%)` }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(120deg,rgba(85,245,47,0.08),transparent_55%)] opacity-60" />
      <ClientLogoBg clientId={client.id} />
      <div className="relative flex justify-between">
        {recentLabel && (
          <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ borderColor: `${theme.accent}55`, color: theme.accent, background: `${theme.accent}14` }}>
            {recentLabel}
          </span>
        )}
      </div>

      <div className="relative mt-8 flex items-center gap-3">
        <div className="rounded-lg border bg-black/25 p-1" style={{ borderColor: `${theme.accent}60` }}>
          <ClientAvatar clientId={client.id} name={client.name} size="md" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-foreground">{client.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{client.segment}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-bold text-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', client.status === 'Ativo' ? 'bg-primary' : 'bg-amber-400')} />
          {client.status}
        </span>
      </div>

      <div className="relative mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors hover:bg-white/5"
          style={{ borderColor: `${theme.accent}80`, color: '#fff' }}
        >
          Abrir CRM
          <ChevronRight className="h-3.5 w-3.5" style={{ color: theme.accent }} />
        </button>
      </div>
    </article>
  );
}

/** Ações de configuração do CRM que a página do cliente dispara pelo modal Configurações. */
export type AcaoConfigCrm = 'funil' | 'acessos' | 'criterios';

type CrmPageProps = {
  lockedClientId?: string;
  embedded?: boolean;
  /**
   * Dentro do cliente o ⋮ da barra some (pedido do Matheus, 13/09: "essa parte
   * tem que ficar dentro de Configurações"). Os mesmos 4 itens vivem no modal
   * Configurar cliente e chegam aqui por esta prop; `onAcaoConsumida` zera.
   */
  acaoConfig?: AcaoConfigCrm | null;
  onAcaoConsumida?: () => void;
};

export default function CrmPage({ lockedClientId, embedded = false, acaoConfig = null, onAcaoConsumida }: CrmPageProps = {}) {
  const { clients } = useClients();
  const activeClients = useMemo(() => clients.filter(c => c.status === 'Ativo'), [clients]);
  // Funcionário do CLIENTE (ver src/lib/modo-cliente.ts): esconde o que é da
  // agência. O servidor já recusa as rotas fora da lista dele.
  const modoCliente = useEhUsuarioCliente();
  const gestorCliente = useEhGestorCliente();
  const meuNome = useMeuNome();
  const [showNovoLead, setShowNovoLead] = useState(false);
  // Atalhos de operação: ignoram o período (a consulta de hoje pode ser de um lead de agosto).
  const [atalho, setAtalho] = useState<'' | 'meus' | 'hoje' | 'atrasados'>('');

  // Deep-link `?clientId=&lead=` — é como o modal do Funil de Performance (e
  // qualquer outra tela) manda abrir a conversa de um lead específico. A URL
  // vence o último cliente usado; sem param, nada muda.
  const [clientId, setClientId] = useState<string>(() => {
    if (lockedClientId) return lockedClientId;
    if (typeof window === 'undefined') return '';
    const doLink = new URLSearchParams(window.location.search).get('clientId');
    return doLink || localStorage.getItem('crm:last-client') || '';
  });
  const [clientSearch, setClientSearch] = useState('');
  const [segmentChoice, setSegmentChoice] = useState('');
  const [clientSort, setClientSort] = useState<'az' | 'za'>('az');
  const [clientView, setClientView] = useState<'grid' | 'list'>('grid');
  const [recentClientIds, setRecentClientIds] = useState<string[]>([]);
  const [chatInstanceStatus, setChatInstanceStatus] = useState<'connected' | 'disconnected' | 'unknown' | 'no_instance' | null>(null);
  const [conectandoWhatsapp, setConectandoWhatsapp] = useState(false);
  const [statusTick, setStatusTick] = useState(0);

  // ── Funnels & Stages ──────────────────────────────────────────────────
  const [funnels, setFunnels] = useState<CrmFunnel[]>([]);
  const [selectedFunnelId, setSelectedFunnelId] = useState('');
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [showFunnelEditor, setShowFunnelEditor] = useState(false);
  const [showNovoFunil, setShowNovoFunil] = useState(false);
  const [showAcessosModal, setShowAcessosModal] = useState(false);
  const [showAiCriteria, setShowAiCriteria] = useState(false);

  const [leads, setLeads]           = useState<CrmLead[]>([]);
  // ── Recarga leve e à prova de corrida ──────────────────────────────────────
  // A lista completa vem ao abrir e a cada 2 min; entre uma e outra, o poll de
  // 8 s busca só o que mudou (`since`). Com 3.500 leads (Atmos, 8,5 MB) baixar
  // tudo a cada 8 s travava a tela.
  const leadsRef = useRef<CrmLead[]>([]);
  useEffect(() => { leadsRef.current = leads; }, [leads]);
  const chaveCarregada = useRef('');
  const chaveAtual = useRef('');
  const ultimaCargaCompleta = useRef(0);
  // ⚠️ Mudança feita na tela (ex.: arrastar de etapa) vence qualquer resposta de
  // recarga que tenha COMEÇADO antes de o servidor confirmar a gravação — senão
  // o poll que já estava no ar devolve a etapa antiga e o card "volta" sozinho.
  const edicoesLocais = useRef(new Map<string, { campos: Partial<CrmLead>; salvoEm: number | null }>());
  // Durante o arraste a lista não é trocada: re-renderizar o board no meio do
  // gesto derrubava o drop.
  const arrastandoRef = useRef(false);
  const [loading, setLoading]       = useState(false);
  const [leadsErro, setLeadsErro]   = useState(false);
  const [search, setSearch]         = useState('');
  const [soAtendimentoRuim, setSoAtendimentoRuim] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [temperatureFilter, setTemperatureFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  // ⚠️ Nasce no MÊS ATUAL, não em "todo período". Cliente alimentado por CRM
  // externo (SULTS, Agendor, planilha) traz anos de histórico de uma vez: abrir
  // no total fazia "1.807 leads no funil" competir com o número do mês e não
  // dizer nada sobre o desempenho atual.
  const [dateFromFilter, setDateFromFilter] = useState(() => presetDateRange('thisMonth').from);
  const [dateToFilter, setDateToFilter] = useState(() => presetDateRange('thisMonth').to);
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth');
  const [funnelMenuOpen, setFunnelMenuOpen] = useState(false);
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [saving, setSaving]         = useState(false);
  const dateMenuRef = useRef<HTMLDivElement>(null);
  const [chatFocusLeadId, setChatFocusLeadId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('lead');
  });
  // Chegou por deep-link de lead → abre direto na conversa (`forcar`), senão a
  // aba salva venceria e o lead pedido não apareceria em lugar nenhum.
  const [crmView, setCrmView] = useAbaPersistida('crm', ABAS_CRM, 'leads', {
    param: 'view',
    forcar: () => (new URLSearchParams(window.location.search).get('lead') ? 'chat' : null),
  });

  // Ação vinda do modal Configurações do cliente (ver AcaoConfigCrm).
  useEffect(() => {
    if (!acaoConfig) return;
    if (acaoConfig === 'funil') setShowFunnelEditor(true);
    else if (acaoConfig === 'acessos') setShowAcessosModal(true);
    else if (acaoConfig === 'criterios') setShowAiCriteria(true);
    onAcaoConsumida?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acaoConfig]);
  const [kanbanEditLead, setKanbanEditLead] = useState<CrmLead | null>(null);
  const [analiseIaAberta, setAnaliseIaAberta] = useState(false);
  const [perdaPendente, setPerdaPendente] = useState<{ id: string; status: string; nome: string } | null>(null);
  const [salvandoPerda, setSalvandoPerda] = useState(false);

  useEffect(() => {
    if (lockedClientId) setClientId(lockedClientId);
  }, [lockedClientId]);

  const clientSegments = useMemo(() => (
    Array.from(new Set(activeClients.map(client => client.segment).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [activeClients]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return activeClients
      .filter(client => !segmentChoice || client.segment === segmentChoice)
      .filter(client => !q || client.name.toLowerCase().includes(q) || client.segment.toLowerCase().includes(q))
      .sort((a, b) => clientSort === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  }, [activeClients, clientSearch, clientSort, segmentChoice]);

  const recentClients = useMemo(() => (
    recentClientIds
      .map(id => activeClients.find(client => client.id === id))
      .filter((client): client is Client => Boolean(client))
      .slice(0, 4)
  ), [activeClients, recentClientIds]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('crm:recent-clients');
      if (stored) setRecentClientIds(JSON.parse(stored) as string[]);
    } catch {
      setRecentClientIds([]);
    }
  }, []);

  // Poll instance status for the Chat tab dot indicator
  useEffect(() => {
    if (!clientId) { setChatInstanceStatus(null); return; }
    function check() {
      fetch(`/api/crm/instance-status?clientId=${clientId}`)
        .then(r => r.json())
        .then((data: { status: string }) => {
          setChatInstanceStatus(data.status as 'connected' | 'disconnected' | 'unknown' | 'no_instance');
        })
        .catch(() => setChatInstanceStatus('unknown'));
    }
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [clientId, statusTick]);

  useEffect(() => {
    try { if (clientId) localStorage.setItem('crm:last-client', clientId); } catch { /* ignore */ }
  }, [clientId]);

  // Modo cliente: abre direto no cliente dele (e corrige um cliente antigo
  // lembrado no navegador que não é mais dele), só Leads e Chat, e o quadro
  // mostra todo o trabalho em andamento — não só quem entrou no mês.
  const modoClienteAplicado = useRef(false);
  useEffect(() => {
    if (!modoCliente || lockedClientId) return;
    if (activeClients.length > 0 && !activeClients.some(c => c.id === clientId)) {
      setClientId(activeClients[0].id);
    }
  }, [modoCliente, lockedClientId, activeClients, clientId]);
  useEffect(() => {
    if (!modoCliente) return;
    const permitidas: CrmTab[] = gestorCliente ? ['leads', 'chat', 'attendance', 'equipe'] : ['leads', 'chat'];
    if (!permitidas.includes(crmView)) setCrmView('leads');
    if (!modoClienteAplicado.current) {
      modoClienteAplicado.current = true;
      applyDatePreset('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoCliente, crmView]);

  function openClientCrm(id: string) {
    if (lockedClientId) return;
    setClientId(id);
    try { localStorage.setItem('crm:last-client', id); } catch { /* ignore */ }
    setRecentClientIds(prev => {
      const next = [id, ...prev.filter(item => item !== id)].slice(0, 8);
      localStorage.setItem('crm:recent-clients', JSON.stringify(next));
      return next;
    });
  }

  function aplicarEdicoesLocais(rows: CrmLead[], inicio: number) {
    const mapa = edicoesLocais.current;
    if (!mapa.size) return rows;
    return rows.map(l => {
      const e = mapa.get(l.id);
      if (!e) return l;
      // Ainda não confirmado, ou confirmado depois que esta recarga começou: a
      // resposta pode estar velha — vale o que está na tela.
      if (e.salvoEm === null || e.salvoEm >= inicio) return { ...l, ...e.campos };
      mapa.delete(l.id);
      return l;
    });
  }

  function refreshLeads(options?: { silent?: boolean; incremental?: boolean }) {
    if (!clientId || !selectedFunnelId) {
      setLeads([]);
      return;
    }
    const chave = `${clientId}:${selectedFunnelId}`;
    const inicio = Date.now();
    let since: string | null = null;
    if (options?.incremental && chaveCarregada.current === chave && inicio - ultimaCargaCompleta.current < 120_000) {
      for (const l of leadsRef.current) {
        const u = (l as { updated_at?: string | null }).updated_at;
        if (u && (!since || u > since)) since = u;
      }
    }
    if (!options?.silent) setLoading(true);
    if (!since) setLeadsErro(false);
    const qs = new URLSearchParams({ clientId, funnelId: selectedFunnelId });
    if (since) qs.set('since', since);
    fetch(`/api/crm?${qs}`)
      .then(async r => {
        if (!r.ok) throw new Error('falha');
        return await r.json() as CrmLead[];
      })
      .then(data => {
        // Resposta de outro cliente/funil (trocou no meio): descarta.
        if (chaveAtual.current !== chave) return;
        // No meio de um arraste não troca a lista; a próxima rodada traz de novo.
        if (arrastandoRef.current) return;
        if (since) {
          if (!data.length) return;
          setLeads(prev => {
            const porId = new Map(prev.map(l => [l.id, l]));
            const numeros = new Set(prev.map(l => (l.numero ?? '').replace(/\D/g, '')).filter(Boolean));
            for (const novo of data) {
              if (porId.has(novo.id)) porId.set(novo.id, novo);
              // Lead novo: entra, a não ser que o número já esteja na lista
              // (a carga completa deduplica por telefone; a próxima resolve).
              else if (!numeros.has((novo.numero ?? '').replace(/\D/g, ''))) porId.set(novo.id, novo);
            }
            return aplicarEdicoesLocais([...porId.values()], inicio);
          });
        } else {
          chaveCarregada.current = chave;
          ultimaCargaCompleta.current = Date.now();
          setLeads(aplicarEdicoesLocais(data, inicio));
        }
      })
      // Falha de servidor não pode virar "nenhum lead" — a lista vazia mentiria.
      // No incremental, falhar só significa tentar de novo na próxima rodada.
      .catch(() => { if (!since) { setLeads([]); setLeadsErro(true); } })
      .finally(() => {
        if (!options?.silent) setLoading(false);
      });
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (dateMenuRef.current && !dateMenuRef.current.contains(e.target as Node)) setDateMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (!clientId) { setFunnels([]); setSelectedFunnelId(''); setStages([]); return; }
    fetch(`/api/crm/funnels?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<CrmFunnel[]> : [])
      .then(data => { setFunnels(data); if (data[0]) setSelectedFunnelId(data[0].id); })
      .catch(() => setFunnels([]));
  }, [clientId]);

  useEffect(() => {
    if (!selectedFunnelId) { setStages([]); return; }
    fetch(`/api/crm/funnels/${selectedFunnelId}/stages`)
      .then(r => r.ok ? r.json() as Promise<CrmStage[]> : [])
      .then(setStages)
      .catch(() => setStages([]));
  }, [selectedFunnelId]);

  useEffect(() => {
    chaveAtual.current = `${clientId}:${selectedFunnelId}`;
    refreshLeads();
  }, [clientId, selectedFunnelId]);

  useEffect(() => {
    if (crmView !== 'leads') return;
    refreshLeads({ silent: true });
  }, [crmView]);

  useEffect(() => {
    if (!clientId || !selectedFunnelId) return;
    const timer = window.setInterval(() => refreshLeads({ silent: true, incremental: true }), 8_000);
    function onFocus() { refreshLeads({ silent: true, incremental: true }); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [clientId, selectedFunnelId]);




  function applyDatePreset(nextPreset: DatePreset) {
    setDatePreset(nextPreset);
    setMonthFilter('');
    if (nextPreset === 'custom') {
      setDateMenuOpen(true);
      return;
    }
    const range = presetDateRange(nextPreset);
    setDateFromFilter(range.from);
    setDateToFilter(range.to);
    setDateMenuOpen(false);
  }

  function updateCustomDateRange(side: 'from' | 'to', value: string) {
    setDatePreset('custom');
    setMonthFilter('');
    if (side === 'from') setDateFromFilter(value);
    else setDateToFilter(value);
  }

  function openLeadChat(leadId: string) {
    setChatFocusLeadId(leadId);
    setCrmView('chat');
  }

  // 1D–4D são marcações de cadência da agência; para quem atende não dizem nada.

  // Busca procura em TODOS os períodos: com "Mês atual" escolhido, quem buscava
  // um lead de setembro não achava e concluía que ele não existia.
  const busca = useMemo(() => prepararBusca(search), [search]);
  const filtered = useMemo(() => leads.filter(l => {
    const semPeriodo = !!busca || !!atalho;
    if (!semPeriodo && monthFilter && monthFromDate(l.data) !== monthFilter) return false;
    if (!semPeriodo && (dateFromFilter || dateToFilter) && !isDateInRange(l.data, dateFromFilter, dateToFilter)) return false;
    if (atalho && !passaAtalho(l, atalho, meuNome)) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    if (temperatureFilter) {
      if (temperatureFilter === 'sem' && l.temperatura) return false;
      if (temperatureFilter !== 'sem' && l.temperatura !== temperatureFilter) return false;
    }
    if (soAtendimentoRuim && !(temNota(l) && l.nota_atendimento <= 2)) return false;
    if (busca && !leadCasaBusca(l, busca)) return false;
    return true;
  }).sort((a, b) => {
    if (a.time_interno !== b.time_interno) return a.time_interno ? 1 : -1;
    // Mais recente primeiro dentro de cada coluna do Kanban.
    return ordemPorData(a, b);
  }), [leads, busca, atalho, meuNome, soAtendimentoRuim, statusFilter, temperatureFilter, monthFilter, dateFromFilter, dateToFilter]);

  const contagemAtalho = useMemo(() => ({
    meus: meuNome ? leads.filter(l => passaAtalho(l, 'meus', meuNome)).length : 0,
    hoje: leads.filter(l => passaAtalho(l, 'hoje', meuNome)).length,
    atrasados: leads.filter(l => passaAtalho(l, 'atrasados', meuNome)).length,
  }), [leads, meuNome]);

  /**
   * Recorte da análise de IA: CLIENTE + PERÍODO, nada mais (instrução do
   * Matheus, 2026-10-02).
   *
   * ⚠️ De propósito NÃO reusa `filtered`, que também aplica busca, status,
   * temperatura e filtros de coluna. Uma busca digitada para achar um lead
   * encolheria o lote sem ninguém perceber, e o número do modal passaria a
   * mudar enquanto se digita. O lote é sobre o período; a busca é para achar
   * alguém.
   */
  const leadsDoPeriodo = useMemo(() => leads.filter(l => {
    if (monthFilter && monthFromDate(l.data) !== monthFilter) return false;
    if ((dateFromFilter || dateToFilter) && !isDateInRange(l.data, dateFromFilter, dateToFilter)) return false;
    return true;
  }), [leads, monthFilter, dateFromFilter, dateToFilter]);

  const kanbanLeads = useMemo(
    () => filtered.filter(lead => lead.time_interno !== true),
    [filtered],
  );

  const stats = useMemo(() => {
    const closedLeads = kanbanLeads.filter(l => l.status === 'Comprou' || l.status === 'Fechado' || l.fechou);
    return {
      total: kanbanLeads.length,
      qualificados: kanbanLeads.filter(l => l.qualificado).length,
      fechamentos: closedLeads.length,
      faturamento: closedLeads.reduce((s, l) => s + toMoneyNumber(l.valor_rs), 0),
      quentes: kanbanLeads.filter(l => l.temperatura === 'quente').length,
      mornos: kanbanLeads.filter(l => l.temperatura === 'morno').length,
      frios: kanbanLeads.filter(l => l.temperatura === 'frio').length,
    };
  }, [kanbanLeads]);

  const statusOptions = useMemo(
    () => stages.length > 0 ? stages.map(s => s.label) : STATUS_OPTIONS,
    [stages],
  );

  const selectedFunnel = funnels.find(f => f.id === selectedFunnelId) ?? null;
  const activeFollowupLeadIds = useActiveFollowups(clientId, crmView === 'leads');

  async function handleFunnelSaved(updatedFunnel: CrmFunnel, updatedStages: CrmStage[]) {
    setFunnels(prev => prev.map(f => f.id === updatedFunnel.id ? updatedFunnel : f));
    setStages(updatedStages);
    setShowFunnelEditor(false);
  }

  // O `window.prompt` saiu: criar funil passou a ser escolher um MODELO, e a
  // lista de modelos com prévia das colunas não cabe num prompt do navegador.
  function handleNewFunnel() {
    setShowNovoFunil(true);
  }

  function handleFunilCriado(newFunnel: CrmFunnel) {
    setFunnels(prev => [...prev, newFunnel]);
    setSelectedFunnelId(newFunnel.id);
    setShowNovoFunil(false);
    setShowFunnelEditor(false);
  }

  async function handleDeleteFunnel() {
    if (!selectedFunnelId || !window.confirm('Excluir este funil? Os leads serão movidos para o próximo funil.')) return;
    const res = await fetch(`/api/crm/funnels/${selectedFunnelId}`, { method: 'DELETE' });
    if (res.ok) {
      const remaining = funnels.filter(f => f.id !== selectedFunnelId);
      setFunnels(remaining);
      setSelectedFunnelId(remaining[0]?.id ?? '');
      setShowFunnelEditor(false);
    } else {
      const body = await res.json().catch(() => ({})) as { error?: string };
      alert(body.error ?? 'Erro ao excluir funil');
    }
  }






  async function deleteRow(id: string) {
    const alvo = leadsRef.current.find(l => l.id === id);
    // Exclusão é definitiva (fica registrada no histórico, mas o lead some).
    if (!window.confirm(`Excluir o lead "${alvo?.nome || alvo?.numero || 'sem nome'}"? Esta ação não pode ser desfeita.`)) return false;
    const res = await fetch(`/api/crm/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      setLeads(prev => prev.filter(l => l.id !== id));
      return true;
    }
    notificar('Não foi possível excluir o lead — tente de novo.', 'erro');
    return false;
  }

  // ⚠️ Mover para uma etapa de PERDA abre o modal ANTES de gravar. O servidor
  // recusa com 422 quem tentar sem motivo (rota PUT), então a tela é só o
  // caminho amigável — nenhum lead se perde sem registro, nem por aqui nem por
  // fora. O lead só sai do lugar depois que o motivo é confirmado.
  async function salvarStatus(id: string, status: string, motivo?: MotivoPerdaId, detalhe?: string | null) {
    const previousStatus = leads.find(l => l.id === id)?.status ?? null;
    edicoesLocais.current.set(id, { campos: { status }, salvoEm: null });
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
    try {
      const res = await fetch(`/api/crm/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(motivo
          ? { status, motivo_perda: motivo, motivo_perda_detalhe: detalhe ?? null }
          : { status }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const e = edicoesLocais.current.get(id);
      if (e && e.campos.status === status) e.salvoEm = Date.now();
      return true;
    } catch {
      edicoesLocais.current.delete(id);
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status: previousStatus } : l));
      notificar('Não foi possível mover o lead — tente de novo.', 'erro');
      return false;
    }
  }

  async function changeLeadStatus(id: string, status: string) {
    if (classificarEtapa(status) === 'perdido') {
      const lead = leads.find(l => l.id === id);
      if (lead && classificarEtapa(lead.status ?? '') !== 'perdido') {
        setPerdaPendente({ id, status, nome: lead.nome ?? lead.numero ?? 'este lead' });
        return;
      }
    }
    await salvarStatus(id, status);
  }








  /**
   * ⚠️ Qualificado é decisão HUMANA e o critério muda por cliente (MQL) — por isso é um
   * botão, não uma automação. O valor vai para o Meta otimizar por lead bom, então
   * marcar/desmarcar tem consequência fora do sistema: o commit avisa o servidor, que
   * dispara a conversão só na virada.
   */
  async function toggleLeadQualificado(lead: CrmLead) {
    const next = !lead.qualificado;
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, qualificado: next } : l));
    const res = await fetch(`/api/crm/${lead.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qualificado: next }),
    }).catch(() => null);
    if (res?.ok) {
      const saved = await res.json() as CrmLead;
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, qualificado: saved.qualificado } : l));
    } else {
      // reverte: sem isto o card mentiria sobre um sinal que o Meta nunca recebeu
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, qualificado: lead.qualificado } : l));
    }
  }

  async function toggleLeadInternal(lead: CrmLead) {
    const nextTimeInterno = !lead.time_interno;
    if (nextTimeInterno) {
      const ok = window.confirm('Ao marcar como Time Interno, nenhuma automação será executada para este contato. Tem certeza?');
      if (!ok) return;
    }

    const leadPhone = String(lead.numero ?? '').replace(/\D/g, '');
    const isSameLead = (item: CrmLead) => {
      const itemPhone = String(item.numero ?? '').replace(/\D/g, '');
      return item.id === lead.id || (!!leadPhone && itemPhone === leadPhone);
    };

    setLeads(prev => prev.map(l => isSameLead(l) ? { ...l, time_interno: nextTimeInterno } : l));
    const res = await fetch(`/api/crm/${lead.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_interno: nextTimeInterno }),
    });
    if (res.ok) {
      const saved = await res.json() as CrmLead;
      setLeads(prev => prev.map(l => isSameLead(l) ? { ...l, time_interno: saved.time_interno } : l));
    } else {
      setLeads(prev => prev.map(l => isSameLead(l) ? { ...l, time_interno: lead.time_interno } : l));
    }
  }

  async function saveKanbanEdit(data: Draft) {
    if (!kanbanEditLead) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/${kanbanEditLead.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (res.ok) {
        const saved = await res.json() as CrmLead;
        setLeads(prev => prev.map(l => l.id === kanbanEditLead.id ? saved : l));
        setKanbanEditLead(null);
      } else {
        notificar('Não foi possível salvar o lead — tente de novo.', 'erro');
      }
    } catch {
      notificar('Não foi possível salvar o lead — tente de novo.', 'erro');
    } finally { setSaving(false); }
  }



  const lockedClient = lockedClientId ? activeClients.find(c => c.id === lockedClientId) : null;

  return (
    <ModoClienteContext.Provider value={modoCliente}>
    <div className={cn(
      'flex flex-col gap-5 overflow-hidden',
      // 200px: sobrou header do cliente (~90) + a linha de abas/Configurações
      // (~55) + espaçamentos. Descontar mais do que existe é o que fazia o
      // board parecer espremido com espaço sobrando embaixo.
      embedded ? 'h-[calc(100vh-200px)] min-h-[520px]' : 'h-full',
    )}>

      {/* ── PAGE HEADER ─────────────────────────────────────────────────
          ⚠️ Escondido quando embutido na página do cliente: ali a aba "CRM" já
          está destacada e o nome do cliente está no topo. Repetir título,
          subtítulo e ícone custava ~75px da altura do quadro — que é a parte
          que o gestor realmente usa. Os avisos de "Salvando…"/erro migram para
          a barra de filtros, que continua visível. */}
      {!embedded && (
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600/20 border border-violet-500/30">
          {clientId ? <Users className="h-5 w-5 text-violet-400" /> : <Sparkles className="h-5 w-5 text-violet-400" />}
        </div>
        <div>
          <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">
            {clientId ? 'CRM' : 'Escolha um cliente'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {clientId ? 'Gestão de leads e funil de vendas por cliente.' : 'Acesse leads, funil e histórico comercial de forma rápida e organizada.'}
          </p>
        </div>
        {saving    && <span className="ml-2 text-xs font-medium text-amber-400 animate-pulse">Salvando…</span>}
      </div>
      )}

      {!clientId && (
        <div className="space-y-7">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Buscar cliente ou segmento..."
                className="h-12 w-full rounded-[var(--radius)] border border-border bg-card pl-11 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              />
            </div>
            <div className="relative">
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={segmentChoice}
                onChange={e => setSegmentChoice(e.target.value)}
                className="h-12 min-w-56 appearance-none rounded-[var(--radius)] border border-border bg-card pl-10 pr-10 text-sm font-semibold outline-none transition-colors focus:border-primary"
              >
                <option value="">Todos os segmentos</option>
                {clientSegments.map(segment => <option key={segment} value={segment}>{segment}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setClientSort(value => value === 'az' ? 'za' : 'az')}
              className="flex h-12 items-center gap-2 rounded-[var(--radius)] border border-border bg-card px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpDown className="h-4 w-4" />
              Ordenar: {clientSort === 'az' ? 'A-Z' : 'Z-A'}
            </button>
            <div className="flex h-12 overflow-hidden rounded-[var(--radius)] border border-border bg-card p-1">
              <button
                type="button"
                onClick={() => setClientView('grid')}
                className={cn('flex h-10 w-10 items-center justify-center rounded-lg transition-colors', clientView === 'grid' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setClientView('list')}
                className={cn('flex h-10 w-10 items-center justify-center rounded-lg transition-colors', clientView === 'list' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {recentClients.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-bold">
                  <Clock3 className="h-5 w-5 text-primary" />
                  Acessados recentemente
                </h2>
                <button type="button" onClick={() => setRecentClientIds([])} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Limpar</button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                {recentClients.map((client, index) => (
                  <ClientChoiceCard
                    key={client.id}
                    client={client}
                    recentLabel={index === 0 ? 'Acessado agora' : index === 1 ? 'Recente' : 'Histórico'}
                    onOpen={() => openClientCrm(client.id)}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <LayoutGrid className="h-5 w-5 text-primary" />
              Todos os clientes
            </h2>
            {filteredClients.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-border bg-card p-12 text-center text-sm text-muted-foreground">
                Nenhum cliente encontrado com os filtros atuais.
              </div>
            ) : clientView === 'grid' ? (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                {filteredClients.map(client => (
                  <ClientChoiceCard key={client.id} client={client} onOpen={() => openClientCrm(client.id)} />
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
                {filteredClients.map(client => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => openClientCrm(client.id)}
                    className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    <ClientAvatar clientId={client.id} name={client.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{client.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{client.segment}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-background px-2 py-1 text-[10px] font-bold">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      {client.status}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── BARRA ────────────────────────────────────────────────────────
          UMA linha: funil · ⋮ · visão · período · busca · Novo Lead.
          ⚠️ Já foi duas, e estava certo enquanto havia 6 controles — a fileira
          única quebrava onde calhasse e deixou "Critérios IA" órfão. Com os
          filtros de status e temperatura fora e Fontes de Captura no ⋮, sobrou
          largura: manter duas linhas passou a gastar uma faixa inteira para
          dois controles. A busca é flex-1 e come a sobra, então não há vazio.
      */}
      {clientId && (
      <>
      <div className="flex flex-wrap items-center gap-2">
        {lockedClientId ? (
          // Só fora da página do cliente: lá dentro o nome está no cabeçalho.
          !embedded && (
            <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold">
              <Users className="h-3.5 w-3.5 text-primary" />
              <span>{lockedClient?.name ?? 'Cliente selecionado'}</span>
            </div>
          )
        ) : modoCliente && activeClients.length <= 1 ? (
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold">
            <Users className="h-3.5 w-3.5 text-primary" />
            <span>{activeClients[0]?.name ?? 'Carregando…'}</span>
          </div>
        ) : (
          <IconSelect icon={Users} value={clientId} onChange={openClientCrm}
            placeholder="Selecionar cliente..." className="min-w-[180px]">
            {activeClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </IconSelect>
        )}

        {/* Funnel selector */}
        {funnels.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="relative flex items-center">
              <Layers className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
              <select
                value={selectedFunnelId}
                onChange={e => setSelectedFunnelId(e.target.value)}
                className="appearance-none pl-8 pr-8 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            {/* ⚠️ Configuração, não operação: editar funil e gerar o portal
                acontecem uma vez e ficavam ocupando ~230px da barra para
                sempre. Dentro do CLIENTE nem o menu fica — os 4 itens moram
                no modal Configurações (13/09); aqui só no /crm avulso, que
                não tem esse modal. */}
            {!embedded && !modoCliente && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setFunnelMenuOpen(o => !o)}
                title="Configurações do CRM"
                aria-label="Configurações do CRM"
                className="flex h-9 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {funnelMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFunnelMenuOpen(false)} />
                  <div className="absolute left-0 top-10 z-50 w-52 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
                    <button type="button"
                      onClick={() => { setFunnelMenuOpen(false); setShowFunnelEditor(true); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                      <Pencil className="h-3.5 w-3.5" /> Editar funil
                    </button>
                    <button type="button"
                      onClick={() => { setFunnelMenuOpen(false); setShowAcessosModal(true); }}
                      title="Logins do cliente no crm.onmid.app (gestor e atendentes)"
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                      <Users className="h-3.5 w-3.5" /> Acessos ao CRM
                    </button>
                    <button type="button"
                      onClick={() => { setFunnelMenuOpen(false); setShowAiCriteria(true); }}
                      title="Regras que a IA usa para qualificar e mover leads"
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                      <Sparkles className="h-3.5 w-3.5" /> Critérios IA
                    </button>
                  </div>
                </>
              )}
            </div>
            )}
          </div>
        )}

        {/* Leads / Chat / Follow up toggle */}
        <div className="flex overflow-hidden rounded-lg border border-border bg-card p-0.5">
          <button type="button" onClick={() => setCrmView('leads')}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'leads' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <Users className="h-3.5 w-3.5" /> Leads
          </button>
          <button type="button" onClick={() => setCrmView('chat')}
            className={cn('relative flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'chat' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <MessageCircle className="h-3.5 w-3.5" /> Chat
            {/* Instance status dot */}
            {clientId && chatInstanceStatus && chatInstanceStatus !== 'connected' && (
              <span
                className={cn(
                  'absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-card',
                  chatInstanceStatus === 'disconnected' || chatInstanceStatus === 'no_instance'
                    ? 'bg-red-500 animate-pulse'
                    : 'bg-amber-400',
                )}
                title={chatInstanceStatus === 'no_instance' ? 'Sem instância configurada' : 'WhatsApp desconectado'}
              />
            )}
            {clientId && chatInstanceStatus === 'connected' && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-card" />
            )}
          </button>
          {gestorCliente && (<>
          <button type="button" onClick={() => setCrmView('attendance')}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'attendance' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <BarChart3 className="h-3.5 w-3.5" /> Atendimento
          </button>
          <button type="button" onClick={() => setCrmView('equipe')}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'equipe' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <Users className="h-3.5 w-3.5" /> Equipe
          </button>
          </>)}
          {!modoCliente && (<>
          <button type="button" onClick={() => setCrmView('followup')}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'followup' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <Send className="h-3.5 w-3.5" /> Follow up
          </button>
          <button type="button" onClick={() => setCrmView('attendance')}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'attendance' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <BarChart3 className="h-3.5 w-3.5" /> Atendimento
          </button>
          {/* ⚠️ Aba "Disparos" do CRM ESCONDIDA (auditoria 2026-08-22): o motor
              dela (crm_disparo_campaigns) não tem cron nenhum E não tem o pacote
              anti-ban (piso 90s, teto diário) — campanha criada aqui ficava
              "Agendada 0%" pra sempre, e ligar o motor como está arriscaria ban.
              Disparos de verdade: tela Disparos. Fase 2 da Fidelidade nasce do
              motor bom (/api/disparos/worker), aí esta aba volta. */}
          <button type="button" onClick={() => setCrmView('ads')}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'ads' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <Clapperboard className="h-3.5 w-3.5" /> Anúncios
          </button>
          </>)}
        </div>

        {clientId && (crmView === 'leads' || crmView === 'attendance') && (
          <>
            {/* ⚠️ Filtros de status e temperatura removidos a pedido: o Kanban
                JÁ é a visão por status (cada coluna é um), então filtrar por
                status é filtrar a única coisa que o board existe para mostrar.
                Temperatura continua visível — é a borda colorida do card —, só
                deixou de ser eixo de filtro. O estado permanece porque a régua
                de filtragem e os efeitos ainda o leem; só não é mais ajustável
                daqui. */}

            <div ref={dateMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setDateMenuOpen(open => !open)}
                className={cn(
                  'flex h-10 min-w-[190px] items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold transition-colors hover:bg-muted/50',
                  (dateFromFilter || dateToFilter || monthFilter) ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  <span className="truncate">{periodLabel(datePreset, dateFromFilter, dateToFilter)}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>

              {dateMenuOpen && (
                <div className="absolute left-0 top-11 z-50 w-72 rounded-xl border border-border bg-popover p-2 shadow-xl">
                  <div className="grid grid-cols-2 gap-1">
                    {([
                      ['lastMonth', 'Mês passado'],
                      ['thisMonth', 'Mês atual'],
                      ['last7', 'Últimos 7d'],
                      ['last15', 'Últimos 15d'],
                      ['last30', 'Últimos 30d'],
                      ['last90', 'Últimos 90d'],
                      ['thisYear', 'Este ano'],
                      ['today', 'Hoje'],
                      ['yesterday', 'Ontem'],
                      // ⚠️ Último da lista, não o primeiro: "todo período" num
                      // cliente alimentado por CRM externo mostra anos de
                      // histórico e o número do topo deixa de dizer algo sobre
                      // o mês. Continua disponível, só não é mais o convite.
                      ['all', 'Todo período'],
                    ] as Array<[DatePreset, string]>).map(([preset, label]) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => applyDatePreset(preset)}
                        className={cn(
                          'rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-muted',
                          datePreset === preset ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2 border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => applyDatePreset('custom')}
                      className={cn(
                        'mb-2 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-muted',
                        datePreset === 'custom' ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
                      )}
                    >
                      Período personalizado
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">De</span>
                        <input
                          type="date"
                          value={dateFromFilter}
                          onChange={e => updateCustomDateRange('from', e.target.value)}
                          className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Até</span>
                        <input
                          type="date"
                          value={dateToFilter}
                          onChange={e => updateCustomDateRange('to', e.target.value)}
                          className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {crmView === 'leads' && (
              <>
                {/* A busca cresce e come a sobra da linha: espaço vazio numa
                    barra de ferramentas não é respiro, é desperdício. */}
                <div className="relative min-w-[160px] flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou número..."
                    className={cn('w-full pl-8 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary', search && (monthFilter || dateFromFilter || dateToFilter) ? 'pr-36' : 'pr-3')} />
                  {search && (monthFilter || dateFromFilter || dateToFilter) && (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-muted-foreground">em todos os períodos</span>
                  )}
                </div>

                <div className="flex shrink-0 overflow-hidden rounded-lg border border-border bg-card p-0.5">
                  {([
                    ['meus', 'Meus leads', contagemAtalho.meus, 'Leads em que você é o responsável'],
                    ['hoje', 'Agenda de hoje', contagemAtalho.hoje, 'Agendados para hoje, de qualquer período'],
                    ['atrasados', 'Atrasados', contagemAtalho.atrasados, 'Próxima ação com prazo vencido'],
                  ] as const).map(([id, rotulo, n, dica]) => (
                    <button key={id} type="button" title={dica}
                      onClick={() => setAtalho(a => a === id ? '' : id)}
                      className={cn('flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-colors',
                        atalho === id
                          ? id === 'atrasados' ? 'bg-red-500/15 text-red-300' : 'bg-primary/15 text-primary'
                          : 'text-muted-foreground hover:text-foreground')}>
                      {rotulo}
                      {n > 0 && <span className={cn('rounded px-1 text-[10px]', id === 'atrasados' ? 'bg-red-500/20 text-red-300' : 'bg-muted')}>{n}</span>}
                    </button>
                  ))}
                </div>

                {!modoCliente && (() => {
                  const ruins = leads.filter(l => temNota(l) && l.nota_atendimento <= 2).length;
                  if (!ruins && !soAtendimentoRuim) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setSoAtendimentoRuim(v => !v)}
                      title="Mostra só os leads com nota de atendimento 0, 1 ou 2"
                      className={cn('flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                        soAtendimentoRuim ? 'border-red-500/50 bg-red-500/15 text-red-300' : 'border-border bg-card text-muted-foreground hover:text-foreground')}
                    >
                      <Star className="h-3.5 w-3.5" /> Atendimento ruim <span className="rounded bg-red-500/20 px-1.5 text-[11px] text-red-300">{ruins}</span>
                    </button>
                  );
                })()}

                {/* Abre o modal em qualquer visão. Antes chamava saveNew(), que só
                    gravava a linha em branco da visão LISTA — no Kanban (a visão
                    padrão) o botão não fazia nada. */}
                <button onClick={() => setShowNovoLead(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-4 w-4" /> Novo Lead
                </button>
              </>
            )}
          </>
        )}
      </div>
      </>
      )}

      {/* WhatsApp caído: o aviso fica na tela de Leads também — quem atende pode
          nem abrir o Chat e passar o dia sem receber mensagem. O próprio
          cliente reconecta pelo QR (um WhatsApp por cliente; ver whatsapp-conexao). */}
      {clientId && crmView === 'leads' && (chatInstanceStatus === 'disconnected' || chatInstanceStatus === 'no_instance') && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
          <WifiOff className="h-4 w-4 shrink-0 animate-pulse" />
          <span className="flex-1">
            {chatInstanceStatus === 'no_instance'
              ? 'Nenhum WhatsApp conectado a este CRM — as conversas não chegam aqui.'
              : 'WhatsApp desconectado — as mensagens não estão chegando nem saindo.'}
          </span>
          <button type="button" onClick={() => setConectandoWhatsapp(true)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
            {chatInstanceStatus === 'no_instance' ? 'Conectar WhatsApp' : 'Reconectar agora'}
          </button>
        </div>
      )}
      {conectandoWhatsapp && clientId && (
        <ConectarWhatsappModal clientId={clientId}
          onFechar={() => { setConectandoWhatsapp(false); setStatusTick(t => t + 1); }}
          onConectou={() => setStatusTick(t => t + 1)} />
      )}

      {/* ── STATS (faixa única compacta — o espaço vertical é do funil) ── */}
      {clientId && !loading && leads.length > 0 && crmView === 'leads' && (
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-6 py-2.5">
          {([
            { label: 'leads no funil', value: stats.total.toLocaleString('pt-BR'), Icon: Users, color: '#8b5cf6' },
            { label: 'qualificados', value: stats.qualificados.toLocaleString('pt-BR'), Icon: BadgeCheck, color: '#55f52f' },
            { label: 'comprou', value: stats.fechamentos.toLocaleString('pt-BR'), Icon: HeartHandshake, color: '#10b981' },
            { label: 'faturamento', value: formatCurrencyBRL(stats.faturamento), Icon: CircleDollarSign, color: '#7c3aed' },
          ] as const).map(({ label, value, Icon, color }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}20` }}>
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-heading text-2xl leading-none">{value}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
              </div>
            </div>
          ))}
          {/* Temperatura é COMPOSIÇÃO do total ao lado, não uma métrica irmã dele —
              por isso vem depois de uma divisória e num corpo menor. Com o mesmo
              peso das três primeiras, a faixa virava seis números indistinguíveis. */}
          <span className="h-6 w-px shrink-0 bg-border" aria-hidden />
          <div className="flex items-center gap-3">
            {([
              { label: 'frio', value: stats.frios, color: '#60a5fa' },
              { label: 'morno', value: stats.mornos, color: '#f59e0b' },
              { label: 'quente', value: stats.quentes, color: '#f87171' },
            ] as const).map(item => (
              <div key={item.label} className="flex items-baseline gap-1.5" title={item.label}>
                <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: item.color }} />
                <span className="font-heading text-base leading-none" style={{ color: item.color }}>{item.value.toLocaleString('pt-BR')}</span>
                <span className="text-[10px] text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {clientId && loading && crmView === 'leads' && (
        <div className="rounded-[var(--radius)] border border-border bg-card p-12 text-center text-sm text-muted-foreground">Carregando...</div>
      )}

      {/* ── CHAT VIEW ───────────────────────────────────────────────── */}
      {clientId && crmView === 'chat' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatView clientId={clientId} statusOptions={statusOptions} focusLeadId={chatFocusLeadId} />
        </div>
      )}

      {/* ── FOLLOW UP ───────────────────────────────────────────────── */}
      {clientId && gestorCliente && crmView === 'equipe' && (
        <div className="flex-1 min-h-0 overflow-y-auto"><EquipeCliente clientId={clientId} /></div>
      )}

      {clientId && crmView === 'followup' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FollowupTab clientId={clientId} statusOptions={statusOptions} />
        </div>
      )}

      {clientId && crmView === 'disparos' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <div className="mx-auto max-w-lg rounded-xl border border-amber-400/25 bg-amber-400/5 p-5 text-sm text-amber-200">
            <p className="font-bold">Os disparos saíram do CRM.</p>
            <p className="mt-1 text-xs text-amber-200/80">
              Campanhas criadas aqui não eram processadas. Use a tela <Link href="/disparos" className="font-bold underline">Disparos</Link>,
              que tem o motor completo (intervalo seguro, teto diário e validação de números).
            </p>
          </div>
        </div>
      )}

      {/* ── BIBLIOTECA DE ANÚNCIOS (criativos do cliente por resultado) ── */}
      {clientId && crmView === 'ads' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-1">
          <CreativeLibrary clientId={clientId} />
        </div>
      )}

      {clientId && crmView === 'attendance' && (
        <AttendanceView
          clientId={clientId}
          month={monthFilter}
          from={dateFromFilter}
          to={dateToFilter}
        />
      )}

      {/* ── TABLE / KANBAN ──────────────────────────────────────────── */}
      {clientId && !loading && crmView === 'leads' && (
        <div className="flex flex-col flex-1 min-h-0 rounded-[var(--radius)] border border-border bg-card overflow-hidden">

          {/* Erro de carregamento — distinto de "nenhum lead". */}
          {leadsErro && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400 shrink-0">
              <span>Não foi possível carregar os leads — a lista abaixo pode estar incompleta.</span>
              <button
                onClick={() => refreshLeads()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-2.5 py-1 font-bold text-red-300 hover:bg-red-500/10 transition-colors"
              >
                <RefreshCw className="h-3 w-3" /> Tentar de novo
              </button>
            </div>
          )}

          {/* Table toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Leads</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Análise de IA sob demanda — recupera o retroativo que a
                  automação desligada não fez (pedido do Matheus, 2026-10-02).
                  Age sobre `leadsDoPeriodo`: só o cliente aberto e o período
                  escolhido, sem herdar busca nem filtros de coluna.
                  Fica com a agência: custa IA e a rota é recusada ao cliente. */}
              {clientId && !modoCliente && (
                <button
                  type="button"
                  onClick={() => setAnaliseIaAberta(true)}
                  title="A IA lê as conversas do recorte atual e move os leads no Kanban"
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Analisar com IA</span>
                </button>
              )}
            </div>
          </div>

          {/* Kanban view — as colunas ocupam toda a altura; o scroll vertical é POR coluna */}
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-2.5">
              <KanbanView
                leads={kanbanLeads}
                stages={stages}
                onEdit={setKanbanEditLead}
                onDelete={id => void deleteRow(id)}
                onStatusChange={(id, status) => void changeLeadStatus(id, status)}
                onToggleQualificado={lead => void toggleLeadQualificado(lead)}
                onToggleInternal={lead => void toggleLeadInternal(lead)}
                activeFollowupIds={activeFollowupLeadIds}
                onArrasteMudou={v => { arrastandoRef.current = v; }}
              />
          </div>

        </div>
      )}

      {perdaPendente && (
        <MotivoPerdaModal
          leadNome={perdaPendente.nome}
          etapaDestino={perdaPendente.status}
          salvando={salvandoPerda}
          onCancelar={() => { if (!salvandoPerda) setPerdaPendente(null); }}
          onConfirmar={async (motivo, detalhe) => {
            setSalvandoPerda(true);
            const ok = await salvarStatus(perdaPendente.id, perdaPendente.status, motivo, detalhe);
            setSalvandoPerda(false);
            if (ok) setPerdaPendente(null);
          }}
        />
      )}

      {analiseIaAberta && clientId && (
        <AnaliseIaModal
          clientId={clientId}
          clientName={clients.find(c => c.id === clientId)?.name ?? 'este cliente'}
          leadIds={leadsDoPeriodo.map(l => l.id)}
          periodoLabel={periodLabel(datePreset, dateFromFilter, dateToFilter)}
          onClose={() => setAnaliseIaAberta(false)}
          onConcluido={() => refreshLeads({ silent: true })}
        />
      )}

      {kanbanEditLead && (
        <QuickEditModal
          lead={kanbanEditLead}
          onSave={saveKanbanEdit}
          onClose={() => setKanbanEditLead(null)}
          onDelete={() => { void deleteRow(kanbanEditLead.id).then(ok => { if (ok) setKanbanEditLead(null); }); }}
          statusOptions={statusOptions}
          onOpenChat={openLeadChat}
          clientId={clientId}
        />
      )}

      {showNovoLead && clientId && (
        <NovoLeadModal
          clientId={clientId}
          funnelId={selectedFunnelId || undefined}
          statusOptions={statusOptions}
          leads={leads}
          onClose={() => setShowNovoLead(false)}
          onCreated={lead => {
            setShowNovoLead(false);
            setLeads(prev => [lead as unknown as CrmLead, ...prev]);
            notificar('Lead criado.', 'ok');
          }}
          onAbrirExistente={id => {
            const existente = leads.find(l => l.id === id);
            setShowNovoLead(false);
            if (existente) setKanbanEditLead(existente);
          }}
        />
      )}

      {showFunnelEditor && selectedFunnel && (
        <FunnelEditorModal
          funnel={selectedFunnel}
          stages={stages}
          clientId={clientId}
          funnelCount={funnels.length}
          onSaved={handleFunnelSaved}
          onClose={() => setShowFunnelEditor(false)}
          onDeleteFunnel={handleDeleteFunnel}
          onNewFunnel={handleNewFunnel}
        />
      )}

      {showNovoFunil && clientId && (
        <NovoFunilModal
          clientId={clientId}
          onCriado={handleFunilCriado}
          onClose={() => setShowNovoFunil(false)}
        />
      )}

      {showAcessosModal && clientId && (
        <AcessosClienteModal
          clientId={clientId}
          clientName={activeClients.find(c => c.id === clientId)?.name ?? 'Cliente'}
          onClose={() => setShowAcessosModal(false)}
        />
      )}

      {showAiCriteria && clientId && (
        <AiCriteriaModal
          clientId={clientId}
          onClose={() => setShowAiCriteria(false)}
        />
      )}
    </div>
    </ModoClienteContext.Provider>
  );
}


