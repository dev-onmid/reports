"use client";

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Building2, Briefcase, Globe, FileText, User,
  ChevronRight, ChevronLeft, Check, Loader2,
  Link, MapPin, Phone, Mail, DollarSign,
  Calendar, BarChart2, Video, MessageSquare,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type FormData = {
  // Step 1 — Empresa
  nome_empresa: string;
  segmento: string;
  cnpj: string;
  cidade: string;
  endereco: string;
  // Step 2 — Negócio
  descricao: string;
  produtos: string;
  publico_alvo: string;
  momento_atual: string;
  diferenciais: string;
  concorrentes: string;
  // Step 3 — Presença Online
  link_instagram: string;
  link_facebook: string;
  site_url: string;
  // Step 4 — Contrato
  valor_fechado: string;
  negociacao: string;
  data_vencimento: string;
  investimento_planejado: string;
  meta_faturamento: string;
  // Step 5 — Responsável & Serviços
  nome_responsavel: string;
  email_responsavel: string;
  whatsapp_responsavel: string;
  whatsapp_financeiro: string;
  posts_mes: string;
  videos_mes: string;
  observacoes: string;
};

const EMPTY: FormData = {
  nome_empresa: '', segmento: '', cnpj: '', cidade: '', endereco: '',
  descricao: '', produtos: '', publico_alvo: '', momento_atual: '', diferenciais: '', concorrentes: '',
  link_instagram: '', link_facebook: '', site_url: '',
  valor_fechado: '', negociacao: '', data_vencimento: '', investimento_planejado: '', meta_faturamento: '',
  nome_responsavel: '', email_responsavel: '', whatsapp_responsavel: '', whatsapp_financeiro: '',
  posts_mes: '', videos_mes: '', observacoes: '',
};

const INVESTIMENTO_OPTIONS = [
  'R$ 1.000 a R$ 2.000',
  'R$ 2.000 a R$ 4.000',
  'R$ 4.000 a R$ 6.000',
  'R$ 6.000 ou mais',
  'Não, ainda não',
];

const STEPS = [
  { id: 1, label: 'Empresa',   icon: Building2 },
  { id: 2, label: 'Negócio',   icon: Briefcase },
  { id: 3, label: 'Online',    icon: Globe },
  { id: 4, label: 'Contrato',  icon: FileText },
  { id: 5, label: 'Responsável', icon: User },
];

// ─── Field components ─────────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">
        {label}{required && <span className="text-violet-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 placeholder-gray-400 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 hover:border-gray-300";
const textareaCls = `${inputCls} resize-none`;

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CadastroPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function set(field: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function input(field: keyof FormData, placeholder?: string, type = 'text') {
    return (
      <input
        type={type}
        value={form[field]}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
    );
  }

  function textarea(field: keyof FormData, placeholder?: string, rows = 3) {
    return (
      <textarea
        value={form[field]}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={textareaCls}
      />
    );
  }

  function validate(): string {
    const req: [keyof FormData, string][] = step === 1
      ? [['nome_empresa','Nome da Empresa'],['segmento','Segmento'],['cnpj','CNPJ'],['cidade','Cidade'],['endereco','Endereço']]
      : step === 2
      ? [['descricao','Descrição'],['produtos','Produtos/Serviços'],['publico_alvo','Público-alvo'],['momento_atual','Momento atual'],['diferenciais','Diferenciais'],['concorrentes','Concorrentes']]
      : step === 3
      ? [['link_instagram','Instagram'],['link_facebook','Facebook']]
      : step === 4
      ? [['valor_fechado','Valor Fechado'],['data_vencimento','Data de Vencimento'],['investimento_planejado','Investimento planejado']]
      : [['nome_responsavel','Nome do Responsável'],['email_responsavel','E-mail'],['whatsapp_responsavel','WhatsApp'],['whatsapp_financeiro','WhatsApp Financeiro'],['posts_mes','Posts por mês'],['videos_mes','Vídeos por mês']];

    for (const [field, label] of req) {
      if (!form[field]?.trim()) return `"${label}" é obrigatório`;
    }
    return '';
  }

  function next() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setStep(s => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function back() {
    setError('');
    setStep(s => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        setError(j.error ?? 'Erro ao enviar. Tente novamente.');
        return;
      }
      setDone(true);
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-violet-100">
            <Check className="h-10 w-10 text-violet-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900">Formulário enviado!</h1>
            <p className="text-gray-500 leading-relaxed">
              Recebemos os dados de <strong>{form.nome_empresa}</strong>. Em breve nossa equipe entrará em contato.
            </p>
          </div>
          <div className="rounded-2xl border border-violet-100 bg-white p-4 text-left space-y-1">
            <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide">Resumo</p>
            <p className="text-sm text-gray-700"><span className="font-medium">Empresa:</span> {form.nome_empresa}</p>
            <p className="text-sm text-gray-700"><span className="font-medium">Responsável:</span> {form.nome_responsavel}</p>
            <p className="text-sm text-gray-700"><span className="font-medium">WhatsApp:</span> {form.whatsapp_responsavel}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-purple-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* Logo mark */}
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
              <span className="text-xs font-bold text-white">ON</span>
            </div>
            <span className="font-bold text-gray-900 text-sm">ONMID Reports</span>
          </div>
          <span className="text-xs text-gray-400">Formulário de Integração</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Title */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Integração de Novo Cliente</h1>
          <p className="text-sm text-gray-500">Preencha os campos abaixo para iniciarmos seu atendimento.</p>
        </div>

        {/* Progress */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = step > s.id;
              const active = step === s.id;
              return (
                <div key={s.id} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-1 flex-1">
                    <div className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all',
                      done   ? 'border-violet-600 bg-violet-600 text-white' :
                      active ? 'border-violet-600 bg-white text-violet-600' :
                               'border-gray-200 bg-white text-gray-400',
                    )}>
                      {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </div>
                    <span className={cn('text-[10px] font-medium hidden sm:block', active ? 'text-violet-600' : done ? 'text-gray-500' : 'text-gray-400')}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={cn('h-0.5 flex-1 mx-1 rounded transition-all', step > s.id ? 'bg-violet-600' : 'bg-gray-200')} />
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-gray-400">Etapa {step} de {STEPS.length}</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm shadow-gray-100/50 overflow-hidden">
          {/* Step header */}
          <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-4">
            <div className="flex items-center gap-2.5 text-white">
              {(() => { const Icon = STEPS[step - 1].icon; return <Icon className="h-5 w-5 opacity-80" />; })()}
              <h2 className="font-semibold">
                {step === 1 ? 'Dados da Empresa'
                : step === 2 ? 'Sobre o Negócio'
                : step === 3 ? 'Presença Online'
                : step === 4 ? 'Contrato & Investimento'
                : 'Responsável & Serviços'}
              </h2>
            </div>
          </div>

          <div className="p-6 space-y-5">

            {/* ── Step 1 ── */}
            {step === 1 && <>
              <Field label="Nome da Empresa" required>
                {input('nome_empresa', 'Ex: Clínica Sorrir')}
              </Field>
              <Field label="Segmento" required>
                {input('segmento', 'Ex: Odontologia, Estética, Moda...')}
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="CNPJ" required>
                  {input('cnpj', '00.000.000/0001-00')}
                </Field>
                <Field label="Cidade / Região de Atuação" required>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={form.cidade}
                      onChange={e => set('cidade', e.target.value)}
                      placeholder="São Paulo, SP"
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
              </div>
              <Field label="Endereço da Empresa" required>
                {input('endereco', 'Rua, número, bairro')}
              </Field>
            </>}

            {/* ── Step 2 ── */}
            {step === 2 && <>
              <Field label="Descrição do Negócio" required>
                {textarea('descricao', 'O que a empresa faz, como atua, sua história...', 3)}
              </Field>
              <Field label="Produto(s) ou Serviço(s) Principal(is)" required>
                {textarea('produtos', 'Liste os principais produtos ou serviços ofertados', 2)}
              </Field>
              <Field label="Público-alvo Principal" required>
                {input('publico_alvo', 'Ex: Mulheres 30-50 anos, classe B/C, interessadas em estética')}
              </Field>
              <Field label="Momento Atual do Negócio" required>
                {input('momento_atual', 'Ex: crescimento, estagnado, reposicionamento, alta concorrência...')}
              </Field>
              <Field label="Principais Diferenciais" required>
                {textarea('diferenciais', 'O que diferencia essa empresa da concorrência?', 2)}
              </Field>
              <Field label="Concorrentes Conhecidos" required>
                {input('concorrentes', 'Ex: Clínica ABC, Studio XYZ...')}
              </Field>
            </>}

            {/* ── Step 3 ── */}
            {step === 3 && <>
              <Field label="Link do Instagram" required>
                <div className="relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="url"
                    value={form.link_instagram}
                    onChange={e => set('link_instagram', e.target.value)}
                    placeholder="https://instagram.com/suaempresa"
                    className={cn(inputCls, 'pl-9')}
                  />
                </div>
              </Field>
              <Field label="Link do Facebook" required>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="url"
                    value={form.link_facebook}
                    onChange={e => set('link_facebook', e.target.value)}
                    placeholder="https://facebook.com/suaempresa"
                    className={cn(inputCls, 'pl-9')}
                  />
                </div>
              </Field>
              <Field label="Site / URL (se tiver)">
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="url"
                    value={form.site_url}
                    onChange={e => set('site_url', e.target.value)}
                    placeholder="https://suaempresa.com.br"
                    className={cn(inputCls, 'pl-9')}
                  />
                </div>
              </Field>
            </>}

            {/* ── Step 4 ── */}
            {step === 4 && <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Valor Fechado R$" required>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={form.valor_fechado}
                      onChange={e => set('valor_fechado', e.target.value)}
                      placeholder="R$ 3.000,00"
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
                <Field label="Data de Vencimento" required>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="date"
                      value={form.data_vencimento}
                      onChange={e => set('data_vencimento', e.target.value)}
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
              </div>
              <Field label="Negociação Diferenciada">
                {textarea('negociacao', 'Ex: 3 meses de R$2.000 depois sobe para R$3.500...', 2)}
              </Field>
              <Field label="Já tem Investimento em Tráfego Planejado?" required>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {INVESTIMENTO_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => set('investimento_planejado', opt)}
                      className={cn(
                        'rounded-xl border px-4 py-2.5 text-sm font-medium text-left transition-all',
                        form.investimento_planejado === opt
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Tem Meta de Faturamento? Se sim, quanto?">
                {input('meta_faturamento', 'Ex: R$ 50.000/mês')}
              </Field>
            </>}

            {/* ── Step 5 ── */}
            {step === 5 && <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nome do Responsável" required>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={form.nome_responsavel}
                      onChange={e => set('nome_responsavel', e.target.value)}
                      placeholder="João Silva"
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
                <Field label="E-mail do Responsável" required>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="email"
                      value={form.email_responsavel}
                      onChange={e => set('email_responsavel', e.target.value)}
                      placeholder="joao@empresa.com"
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="WhatsApp do Responsável" required>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="tel"
                      value={form.whatsapp_responsavel}
                      onChange={e => set('whatsapp_responsavel', e.target.value)}
                      placeholder="(11) 99999-9999"
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
                <Field label="WhatsApp / E-mail do Financeiro" required>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={form.whatsapp_financeiro}
                      onChange={e => set('whatsapp_financeiro', e.target.value)}
                      placeholder="financeiro@empresa.com"
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Qtde de Posts por Mês" required>
                  <div className="relative">
                    <BarChart2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="number"
                      min="0"
                      value={form.posts_mes}
                      onChange={e => set('posts_mes', e.target.value)}
                      placeholder="12"
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
                <Field label="Qtde de Vídeos por Mês" required>
                  <div className="relative">
                    <Video className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="number"
                      min="0"
                      value={form.videos_mes}
                      onChange={e => set('videos_mes', e.target.value)}
                      placeholder="4"
                      className={cn(inputCls, 'pl-9')}
                    />
                  </div>
                </Field>
              </div>
              <Field label="Observações Gerais">
                <div className="relative">
                  <MessageSquare className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <textarea
                    value={form.observacoes}
                    onChange={e => set('observacoes', e.target.value)}
                    placeholder="Produtos, serviços, diferenciais adicionais, informações importantes..."
                    rows={3}
                    className={cn(textareaCls, 'pl-9')}
                  />
                </div>
              </Field>
            </>}

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button
              type="button"
              onClick={back}
              disabled={step === 1}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 hover:border-gray-300 hover:text-gray-800 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronLeft className="h-4 w-4" />
              Voltar
            </button>

            {step < STEPS.length ? (
              <button
                type="button"
                onClick={next}
                className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
              >
                Próximo
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors disabled:opacity-70"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {submitting ? 'Enviando...' : 'Enviar formulário'}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400">
          Suas informações são tratadas com segurança e confidencialidade.
        </p>
      </div>
    </div>
  );
}
