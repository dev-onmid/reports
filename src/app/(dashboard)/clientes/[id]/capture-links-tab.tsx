'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Check, Code2, Copy, ExternalLink, FileText, Globe2, Link2, Megaphone,
  MessageCircle, MousePointerClick, Plus, RefreshCw, Settings2, Trash2, Wand2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DictateButton } from '@/components/ui/dictate-button';

type RedirectLink = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  name: string;
  slug: string;
  whatsapp: string;
  message: string;
  clicks: number;
  last_click: string | null;
  created_at: string;
};

type WebhookConfig = {
  id: string;
  name: string;
  token: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
};

type SourceKind = 'whatsapp' | 'landing' | 'meta_form' | 'api';

const DEFAULT_MESSAGE = 'Olá, vim pelo anúncio!';
// Macros da Meta: nomes legíveis nos utm_* (campanha/conjunto/anúncio aparecem
// pelo nome no CRM) + ids crus e posicionamento como parâmetros extras.
const META_UTM = 'utm_source=facebookads&utm_medium={{site_source_name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&placement={{placement}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}';
// ValueTrack do Google: palavra-chave, correspondência, dispositivo, rede e
// posicionamento. O gclid é anexado automaticamente pelo auto-tagging do Google
// e capturado junto — não precisa incluir na URL.
const GOOGLE_UTM = 'utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&utm_content={creative}&keyword={keyword}&matchtype={matchtype}&device={device}&network={network}&placement={placement}&loc={loc_physical_ms}';
// Snippet para landing pages: repassa os parâmetros da URL da página (utm, gclid…)
// para todos os botões/links que apontam para o /r/ — sem isso, o clique que
// chega na LP perde a atribuição antes de virar conversa no WhatsApp.
const LP_SNIPPET = `<script>
(function(){var q=location.search.replace(/^\\?/,'');if(!q)return;
document.querySelectorAll('a[href*="/r/"]').forEach(function(a){
a.href+=(a.href.indexOf('?')>-1?'&':'?')+q;});})();
</script>`;

function publicBase() {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function copyToClipboard(text: string, onDone: () => void) {
  navigator.clipboard.writeText(text).then(() => {
    onDone();
    setTimeout(onDone, 1600);
  });
}

function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(text, () => setCopied(v => !v))}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copiado' : label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function CodeLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/70 p-2">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{text}</code>
      <CopyButton text={text} label="Copiar" />
    </div>
  );
}

function SourceCard({
  active,
  icon: Icon,
  title,
  desc,
  badge,
  onClick,
}: {
  active?: boolean;
  icon: React.ElementType;
  title: string;
  desc: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-full items-start gap-3 rounded-xl border p-4 text-left transition-colors',
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border bg-background/40 text-muted-foreground hover:border-primary/30 hover:bg-muted/30 hover:text-foreground',
      )}
    >
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', active ? 'bg-primary/15' : 'bg-muted/50')}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">{title}</span>
          {badge && <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-bold">{badge}</span>}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

function SetupResult({ webhook, sourceName, sourceKind, clientId }: { webhook: WebhookConfig; sourceName: string; sourceKind: SourceKind; clientId: string }) {
  const endpoint = `${publicBase()}/api/webhooks/${webhook.token}`;
  const sourceLabel = sourceKind === 'meta_form' ? 'meta_form' : sourceKind === 'landing' ? 'landing_page' : 'api';
  const payload = JSON.stringify({
    event: 'lead.create',
    data: {
      client_id: clientId,
      name: '{{nome_do_lead}}',
      phone: '{{telefone_do_lead}}',
      email: '{{email_do_lead}}',
      source: sourceLabel,
      mensagem: sourceName ? `Lead vindo de ${sourceName}` : 'Lead vindo da fonte de captura',
      status: 'Em Atendimento',
      page_url: '{{url_da_pagina_com_utm_e_gclid}}',
      utm_source: '{{utm_source}}',
      utm_medium: '{{utm_medium}}',
      utm_campaign: '{{utm_campaign}}',
      utm_content: '{{utm_content}}',
      utm_term: '{{utm_term}}',
      gclid: '{{gclid}}',
      fbclid: '{{fbclid}}',
      keyword: '{{palavra_chave}}',
      cidade: '{{cidade}}',
      estado: '{{uf}}',
    },
  }, null, 2);

  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Check className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Fonte pronta para receber leads</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Copie o webhook abaixo para o formulário, Make, Zapier, Elementor, Webflow ou ferramenta da landing page.
            Os campos de rastreio (utm, gclid, keyword…) são opcionais — envie o que a ferramenta tiver, ou apenas
            <code className="mx-1 rounded bg-muted px-1">page_url</code> com a URL completa da página (extraímos tudo dela).
          </p>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Webhook</p>
        <CodeLine text={endpoint} />
      </div>
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Modelo de dados</p>
        <CodeLine text={payload} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[
          ['1', 'Cole o webhook no formulário ou automação.'],
          ['2', 'Mapeie nome e telefone do lead.'],
          ['3', 'Faça um teste e confira o lead no CRM.'],
        ].map(([step, text]) => (
          <div key={step} className="rounded-lg border border-border bg-background/50 p-3">
            <p className="text-xs font-bold text-primary">Passo {step}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function UseInstructions({ link, onClose }: { link: RedirectLink; onClose: () => void }) {
  const [mode, setMode] = useState<'direct' | 'site' | 'custom'>('direct');
  const [custom, setCustom] = useState({ source: '', medium: '', campaign: '', content: '' });
  const baseLink = `${publicBase()}/r/${link.slug}`;
  const metaLink = `${baseLink}?${META_UTM}`;
  const googleLink = `${baseLink}?${GOOGLE_UTM}`;

  const customParams = new URLSearchParams();
  if (custom.source) customParams.set('utm_source', custom.source);
  if (custom.medium) customParams.set('utm_medium', custom.medium);
  if (custom.campaign) customParams.set('utm_campaign', custom.campaign);
  if (custom.content) customParams.set('utm_content', custom.content);
  const customLink = customParams.toString() ? `${baseLink}?${customParams.toString()}` : baseLink;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-foreground">Como Usar Este Link</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Use uma das opções abaixo. O CRM vai registrar a origem do clique e levar essa informação para a primeira conversa.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-3">
          {[
            { id: 'direct' as const, title: 'Direto Para WhatsApp', icon: MessageCircle },
            { id: 'site' as const, title: 'Para Site ou Landing Page', icon: Link2 },
            { id: 'custom' as const, title: 'UTM Personalizada', icon: Settings2 },
          ].map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-4 text-left transition-colors',
                mode === item.id ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-background/50 text-muted-foreground hover:bg-muted/40',
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-sm font-bold">{item.title}</span>
            </button>
          ))}
        </div>

        {mode === 'direct' && (
          <div className="space-y-3">
            <p className="text-sm font-bold text-foreground">Meta Ads</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Coloque este link no destino do anúncio de WhatsApp. As macros da Meta preenchem campanha, conjunto, anúncio e posicionamento.
            </p>
            <CodeLine text={metaLink} />
            <p className="text-sm font-bold text-foreground">Google Ads</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Use como URL final do anúncio. O Google preenche palavra-chave, correspondência, dispositivo e rede —
              e o gclid do auto-tagging é capturado automaticamente junto.
            </p>
            <CodeLine text={googleLink} />
          </div>
        )}

        {mode === 'site' && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Use o link abaixo nos botões da página que abrem WhatsApp. Para campanhas pagas, adicione a UTM da plataforma no anúncio ou no final da URL.
            </p>
            <CodeLine text={baseLink} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-background/50 p-3">
                <p className="mb-2 text-xs font-bold text-foreground">UTM Meta Ads</p>
                <CodeLine text={`?${META_UTM}`} />
              </div>
              <div className="rounded-xl border border-border bg-background/50 p-3">
                <p className="mb-2 text-xs font-bold text-foreground">UTM Google Ads</p>
                <CodeLine text={`?${GOOGLE_UTM}`} />
              </div>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="mb-1 text-xs font-bold text-foreground">Importante: cole este snippet na landing page</p>
              <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                Quando o anúncio leva primeiro para a landing e só depois para o WhatsApp, os parâmetros de rastreio
                (UTM, gclid do Google, palavra-chave) ficam na URL da página — este código repassa tudo automaticamente
                para os botões de WhatsApp. Sem ele, o lead chega sem origem.
              </p>
              <CodeLine text={LP_SNIPPET} />
            </div>
          </div>
        )}

        {mode === 'custom' && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ['source', 'Origem', 'instagram_bio'],
                ['medium', 'Meio', 'influencer'],
                ['campaign', 'Campanha', 'promocao_junho'],
                ['content', 'Conteúdo', 'story_01'],
              ].map(([key, label, placeholder]) => (
                <Field key={key} label={label}>
                  <input
                    value={custom[key as keyof typeof custom]}
                    onChange={e => setCustom(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </Field>
              ))}
            </div>
            <CodeLine text={customLink} />
          </div>
        )}
      </div>
    </div>
  );
}

export function CaptureLinksTab({ clientId }: { clientId: string }) {
  const [links, setLinks] = useState<RedirectLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [selectedLink, setSelectedLink] = useState<RedirectLink | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind>('whatsapp');
  const [createdWebhook, setCreatedWebhook] = useState<WebhookConfig | null>(null);
  const [setupForm, setSetupForm] = useState({
    name: '',
    destination: '',
    initialStatus: 'Em Atendimento',
  });
  const [form, setForm] = useState({
    name: '',
    whatsapp: '',
    message: DEFAULT_MESSAGE,
    slug: '',
  });

  const totalClicks = useMemo(() => links.reduce((sum, link) => sum + (link.clicks ?? 0), 0), [links]);

  function load() {
    setLoading(true);
    fetch(`/api/link-redirects?clientId=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() as Promise<RedirectLink[]> : [])
      .then(rows => setLinks(Array.isArray(rows) ? rows : []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/link-redirects?clientId=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() as Promise<RedirectLink[]> : [])
      .then(rows => {
        if (active) setLinks(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setLinks([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  async function save() {
    setError('');
    if (!form.name.trim() || !onlyDigits(form.whatsapp)) {
      setError('Preencha o nome do link e o WhatsApp.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/link-redirects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          name: form.name.trim(),
          whatsapp: form.whatsapp,
          message: form.message.trim() || DEFAULT_MESSAGE,
          slug: form.slug.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null) as RedirectLink | { error?: string } | null;
      if (!res.ok) {
        setError((data && 'error' in data && data.error) ? data.error : 'Não consegui criar o link.');
        return;
      }
      const created = data as RedirectLink;
      setShowForm(false);
      setForm({ name: '', whatsapp: '', message: DEFAULT_MESSAGE, slug: '' });
      setLinks(prev => [created, ...prev]);
      setSelectedLink(created);
    } finally {
      setSaving(false);
    }
  }

  async function createWebhookSource() {
    setError('');
    if (!setupForm.name.trim()) {
      setError('Dê um nome para a fonte.');
      return;
    }
    setSaving(true);
    setCreatedWebhook(null);
    try {
      const label = sourceKind === 'landing'
        ? 'Landing Page'
        : sourceKind === 'meta_form'
          ? 'Formulário Meta'
          : 'API/Webhook';
      const res = await fetch('/api/automacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${label} - ${setupForm.name.trim()}`,
          description: `Fonte de captura plug and play para cliente ${clientId}`,
        }),
      });
      const data = await res.json().catch(() => null) as WebhookConfig | { error?: string } | null;
      if (!res.ok || !data || !('token' in data)) {
        setError(data && 'error' in data && data.error ? data.error : 'Não consegui criar a fonte.');
        return;
      }
      setCreatedWebhook(data);
    } finally {
      setSaving(false);
    }
  }

  function resetWizard(kind: SourceKind = 'whatsapp') {
    setSourceKind(kind);
    setCreatedWebhook(null);
    setError('');
    setSetupForm({ name: '', destination: '', initialStatus: 'Em Atendimento' });
    setForm({ name: '', whatsapp: '', message: DEFAULT_MESSAGE, slug: '' });
  }

  function openWizard(kind: SourceKind = 'whatsapp') {
    resetWizard(kind);
    setShowForm(true);
  }

  async function remove(id: string) {
    if (!confirm('Remover este link e todos os cliques dele?')) return;
    await fetch(`/api/link-redirects/${id}`, { method: 'DELETE' });
    setLinks(prev => prev.filter(link => link.id !== id));
  }

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h3 className="text-sm font-bold text-foreground">Fontes de Captura</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Configure WhatsApp, landing pages, formulários do Meta e webhooks sem precisar montar API manualmente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => openWizard('whatsapp')}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-bold text-black transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Nova Fonte
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SourceCard
          icon={MessageCircle}
          title="WhatsApp Rastreável"
          desc="Gera link para anúncios, bio, Google, Meta e influenciadores."
          badge="Link"
          onClick={() => openWizard('whatsapp')}
        />
        <SourceCard
          icon={Globe2}
          title="Landing Page"
          desc="Cria webhook pronto para Elementor, Webflow, Framer ou formulário próprio."
          badge="Webhook"
          onClick={() => openWizard('landing')}
        />
        <SourceCard
          icon={Megaphone}
          title="Formulário Meta"
          desc="Prepara a captura via Make/Zapier enquanto a conexão nativa entra no sistema."
          badge="Meta"
          onClick={() => openWizard('meta_form')}
        />
        <SourceCard
          icon={Code2}
          title="API Direta"
          desc="Para ferramentas externas enviarem leads direto ao CRM do cliente."
          badge="API"
          onClick={() => openWizard('api')}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { label: 'Links cadastrados', value: links.length, icon: Link2 },
          { label: 'Cliques registrados', value: totalClicks, icon: MousePointerClick },
          { label: 'Configuração', value: 'Plug and play', icon: Wand2 },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-lg font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Carregando...</div>
      ) : links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-bold text-foreground">Nenhum link de captura ainda.</p>
          <p className="mt-1 text-xs text-muted-foreground">Crie o primeiro link para usar em anúncios, bio, site ou influenciadores.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {links.map(link => {
            const url = `${publicBase()}/r/${link.slug}`;
            return (
              <div key={link.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-foreground">{link.name}</p>
                      <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                        {link.clicks} cliques
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-primary">{url}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">WhatsApp {link.whatsapp} · {link.message}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyButton text={url} />
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir
                    </a>
                    <button
                      type="button"
                      onClick={() => setSelectedLink(link)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary/15"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Como Usar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(link.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-bold text-red-300 transition-colors hover:bg-red-500/15"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remover
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-foreground">Nova Fonte de Captura</h3>
                <p className="mt-1 text-xs text-muted-foreground">Escolha o tipo e o sistema entrega o link, webhook ou instrução pronta.</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-5 grid gap-2 md:grid-cols-4">
              <SourceCard active={sourceKind === 'whatsapp'} icon={MessageCircle} title="WhatsApp" desc="Link rastreável." onClick={() => resetWizard('whatsapp')} />
              <SourceCard active={sourceKind === 'landing'} icon={Globe2} title="Landing" desc="Webhook para form." onClick={() => resetWizard('landing')} />
              <SourceCard active={sourceKind === 'meta_form'} icon={Megaphone} title="Meta Forms" desc="Lead Ads." onClick={() => resetWizard('meta_form')} />
              <SourceCard active={sourceKind === 'api'} icon={Code2} title="API" desc="Integração externa." onClick={() => resetWizard('api')} />
            </div>

            {sourceKind === 'whatsapp' ? (
              <div className="space-y-4">
              <Field label="Nome">
                <input
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: WhatsApp Aniversário"
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                />
              </Field>
              <Field label="WhatsApp com DDI">
                <input
                  value={form.whatsapp}
                  onChange={e => setForm(prev => ({ ...prev, whatsapp: e.target.value }))}
                  placeholder="5543999999999"
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                />
              </Field>
              <Field label="Mensagem inicial">
                <div className="relative">
                  <textarea
                    value={form.message}
                    onChange={e => setForm(prev => ({ ...prev, message: e.target.value }))}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:border-primary"
                  />
                  <DictateButton className="absolute bottom-2 right-2" onTranscript={(text) => setForm(prev => ({ ...prev, message: prev.message ? `${prev.message} ${text}` : text }))} />
                </div>
              </Field>
              <Field label="Slug opcional">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">/r/</span>
                  <input
                    value={form.slug}
                    onChange={e => setForm(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    placeholder="whatsapp-aniversario"
                    className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </div>
              </Field>
              {error && <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-border py-2 text-sm font-bold text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                  Cancelar
                </button>
                <button type="button" onClick={save} disabled={saving} className="flex-1 rounded-lg bg-primary py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-60">
                  {saving ? 'Criando...' : 'Criar Link'}
                </button>
              </div>
            </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Nome da fonte">
                    <input
                      value={setupForm.name}
                      onChange={e => setSetupForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder={sourceKind === 'meta_form' ? 'Ex: Formulário Meta - Junho' : sourceKind === 'landing' ? 'Ex: Landing Franquia' : 'Ex: Integração externa'}
                      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    />
                  </Field>
                  <Field label={sourceKind === 'meta_form' ? 'Página ou formulário' : sourceKind === 'landing' ? 'URL da landing' : 'Ferramenta de origem'}>
                    <input
                      value={setupForm.destination}
                      onChange={e => setSetupForm(prev => ({ ...prev, destination: e.target.value }))}
                      placeholder={sourceKind === 'meta_form' ? 'Ex: Página PicoLocos / Formulário Orçamento' : sourceKind === 'landing' ? 'https://...' : 'Ex: Typeform, n8n, Make'}
                      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {sourceKind === 'landing' && (
                    <>
                      <div className="rounded-xl border border-border bg-background/50 p-3">
                        <FileText className="mb-2 h-5 w-5 text-primary" />
                        <p className="text-xs font-bold text-foreground">Para landing page</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Cole o webhook no envio do formulário ou peça para o dev usar o POST.</p>
                      </div>
                      <div className="rounded-xl border border-border bg-background/50 p-3">
                        <MousePointerClick className="mb-2 h-5 w-5 text-primary" />
                        <p className="text-xs font-bold text-foreground">Com rastreio</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Use UTMs da campanha e envie junto no campo observação.</p>
                      </div>
                    </>
                  )}
                  {sourceKind === 'meta_form' && (
                    <>
                      <div className="rounded-xl border border-border bg-background/50 p-3">
                        <Megaphone className="mb-2 h-5 w-5 text-primary" />
                        <p className="text-xs font-bold text-foreground">Meta Lead Ads</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Use Make/Zapier para receber o lead do formulário e enviar ao CRM.</p>
                      </div>
                      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
                        <Settings2 className="mb-2 h-5 w-5 text-amber-300" />
                        <p className="text-xs font-bold text-foreground">Conexão nativa</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Próxima etapa: selecionar página e formulário direto aqui.</p>
                      </div>
                    </>
                  )}
                  <div className="rounded-xl border border-border bg-background/50 p-3">
                    <MessageCircle className="mb-2 h-5 w-5 text-primary" />
                    <p className="text-xs font-bold text-foreground">Cai no CRM</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">O lead entra vinculado a este cliente com status Em Atendimento.</p>
                  </div>
                </div>

                {error && <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>}

                {createdWebhook ? (
                  <SetupResult webhook={createdWebhook} sourceName={setupForm.name} sourceKind={sourceKind} clientId={clientId} />
                ) : (
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-border py-2 text-sm font-bold text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                      Cancelar
                    </button>
                    <button type="button" onClick={createWebhookSource} disabled={saving} className="flex-1 rounded-lg bg-primary py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-60">
                      {saving ? 'Criando...' : 'Gerar Configuração'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedLink && <UseInstructions link={selectedLink} onClose={() => setSelectedLink(null)} />}
    </div>
  );
}
