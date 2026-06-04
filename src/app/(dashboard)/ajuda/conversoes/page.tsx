'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type AccordionItem = { title: string; content: React.ReactNode };

// ── Accordion ─────────────────────────────────────────────────────────────────

function Accordion({ items }: { items: AccordionItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
          >
            <span className="text-sm font-semibold">{item.title}</span>
            {open === i ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </button>
          {open === i && (
            <div className="border-t border-border px-5 py-4 text-sm text-muted-foreground space-y-3">
              {item.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">{n}</span>
      <p className="pt-0.5 leading-relaxed">{text}</p>
    </div>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-orange-400/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
      ⚠️ {text}
    </div>
  );
}

function ImgPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-xs text-muted-foreground/60">
      [Screenshot: {label}]
    </div>
  );
}

// ── Guides content ────────────────────────────────────────────────────────────

const metaGuides: AccordionItem[] = [
  {
    title: 'Como obter o Pixel ID',
    content: (
      <div className="space-y-3">
        <Step n={1} text="Acesse business.facebook.com e faça login." />
        <Step n={2} text='No menu lateral, clique em "Gerenciador de Eventos".' />
        <Step n={3} text="Selecione seu Pixel na lista de fontes de dados." />
        <Step n={4} text='O Pixel ID aparece abaixo do nome do Pixel (ex: 1234567890123456).' />
        <Step n={5} text="Copie e cole no campo Pixel ID da aba Rastreio WA." />
        <ImgPlaceholder label="Gerenciador de Eventos > Pixel ID destacado" />
      </div>
    ),
  },
  {
    title: 'Como gerar o Token da API de Conversões',
    content: (
      <div className="space-y-3">
        <Step n={1} text="No Gerenciador de Eventos, clique no seu Pixel." />
        <Step n={2} text='Vá na aba "Configurações".' />
        <Step n={3} text='Role a página até a seção "API de Conversões".' />
        <Step n={4} text='Clique em "Gerar token de acesso".' />
        <Step n={5} text="Copie o token gerado e cole no campo correspondente." />
        <Warning text="Nunca compartilhe esse token. Ele dá acesso completo ao seu Pixel." />
        <ImgPlaceholder label="Configurações do Pixel > Gerar token de acesso" />
      </div>
    ),
  },
  {
    title: 'Como usar o Código de Teste (opcional)',
    content: (
      <div className="space-y-3">
        <p>O código de teste permite verificar os eventos sem afetar seus dados reais de conversão.</p>
        <Step n={1} text='No Gerenciador de Eventos, vá em "Testar eventos".' />
        <Step n={2} text='Copie o código que aparece (ex: TEST12345).' />
        <Step n={3} text="Cole no campo Código de Teste na aba Rastreio WA." />
        <Step n={4} text="Após confirmar que os eventos chegam corretamente, remova o código." />
        <ImgPlaceholder label="Testar eventos > Código de teste em destaque" />
      </div>
    ),
  },
];

const googleGuides: AccordionItem[] = [
  {
    title: 'Como encontrar o Measurement ID (GA4)',
    content: (
      <div className="space-y-3">
        <Step n={1} text="Acesse analytics.google.com." />
        <Step n={2} text='Vá em Administrador (ícone de engrenagem no rodapé esquerdo).' />
        <Step n={3} text='Na coluna "Propriedade", clique em "Fluxos de dados".' />
        <Step n={4} text="Clique no fluxo web da sua propriedade." />
        <Step n={5} text='O Measurement ID aparece no topo: começa com G- (ex: G-XXXXXXXXXX).' />
        <ImgPlaceholder label="Fluxos de dados > Measurement ID em destaque" />
      </div>
    ),
  },
  {
    title: 'Como criar o API Secret (Measurement Protocol)',
    content: (
      <div className="space-y-3">
        <Step n={1} text="No Analytics, vá em Administrador → Fluxos de dados." />
        <Step n={2} text="Clique no seu fluxo web." />
        <Step n={3} text='Role até "Measurement Protocol API secrets" e clique.'  />
        <Step n={4} text='Clique em "Criar" e dê um nome descritivo (ex: ON_REPORT).' />
        <Step n={5} text="Copie o valor gerado e cole no campo API Secret." />
        <ImgPlaceholder label="Measurement Protocol API Secrets > Criar" />
      </div>
    ),
  },
  {
    title: 'Como encontrar o Conversion Label no Google Ads',
    content: (
      <div className="space-y-3">
        <Step n={1} text="Acesse ads.google.com." />
        <Step n={2} text='No menu principal, clique em "Metas" → "Conversões" → "Resumo".' />
        <Step n={3} text="Clique na conversão desejada (ex: Lead, Purchase)." />
        <Step n={4} text='Clique em "Configurações" no topo da conversão.' />
        <Step n={5} text='O Conversion Label aparece em "Configuração da tag" (formato: XXXXXXXXXXXXXX).' />
        <ImgPlaceholder label="Conversões > Configuração da tag > Conversion Label" />
      </div>
    ),
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AjudaConversoesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16 pt-2">

      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-normal uppercase tracking-wide">Guia de Conversões API</h1>
        <p className="text-sm text-muted-foreground">
          Configure o Meta Conversions API e o Google Enhanced Conversions para enviar eventos de conversão diretamente do servidor, garantindo maior precisão e cobertura.
        </p>
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider">Como funciona</h2>
        <div className="grid gap-3 sm:grid-cols-3 text-xs text-muted-foreground">
          {[
            { label: 'Lead inicia conversa', desc: 'Evento Lead é enviado ao Meta e ao Google assim que o lead manda a primeira mensagem via WhatsApp.' },
            { label: 'Lead responde', desc: 'Evento Contact é enviado na segunda mensagem do lead, indicando engajamento.' },
            { label: 'Compra aprovada', desc: 'Evento Purchase com o valor da venda é enviado quando o atendente digita a palavra-gatilho configurada.' },
          ].map(({ label, desc }) => (
            <div key={label} className="rounded-lg border border-border bg-background/60 p-3">
              <p className="font-bold text-foreground mb-1">{label}</p>
              <p>{desc}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary/80">
          💡 Todos os envios são não-bloqueantes: uma falha de conversão nunca interrompe o atendimento.
        </div>
      </div>

      {/* Checklist */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider">Checklist de configuração</h2>
        <div className="space-y-2 text-sm">
          {[
            'Pixel ID do Meta preenchido',
            'Token da API de Conversões do Meta gerado e salvo',
            'Meta CAPI ativado (toggle ativo)',
            'Measurement ID do Google preenchido (começa com G-)',
            'API Secret do Measurement Protocol criado',
            'Pelo menos um Conversion Label preenchido',
            'Google Enhanced Conversions ativado',
            'Teste de conexão executado com sucesso para ambas as plataformas',
          ].map(item => (
            <div key={item} className="flex items-center gap-2 text-muted-foreground">
              <Circle className="h-4 w-4 shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* Meta guides */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Meta Conversions API</h2>
        <Accordion items={metaGuides} />
      </div>

      {/* Google guides */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Google Enhanced Conversions</h2>
        <Accordion items={googleGuides} />
      </div>

      {/* Events reference */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider">Referência de eventos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {['Gatilho', 'Evento Meta', 'Label Google', 'Valor'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { gatilho: 'Lead inicia conversa (1ª mensagem)', meta: 'Lead', google: 'google_conversion_label_lead', valor: 'R$ 0' },
                { gatilho: 'Lead responde (2ª mensagem)', meta: 'Contact', google: 'google_conversion_label_contact', valor: 'R$ 0' },
                { gatilho: 'Status muda para Proposta', meta: 'InitiateCheckout (configurável)', google: 'Label configurável', valor: 'R$ 0' },
                { gatilho: 'Status muda para Negociação', meta: 'AddToCart (configurável)', google: 'Label configurável', valor: 'R$ 0' },
                { gatilho: 'Compra aprovada (gatilho de texto)', meta: 'Purchase', google: 'google_conversion_label_purchase', valor: 'Obrigatório' },
              ].map((row, i) => (
                <tr key={i} className={cn('border-b border-border/40 last:border-0', i % 2 === 1 ? 'bg-muted/10' : '')}>
                  <td className="px-3 py-2">{row.gatilho}</td>
                  <td className="px-3 py-2 font-mono text-blue-400">{row.meta}</td>
                  <td className="px-3 py-2 font-mono text-yellow-400 text-[10px]">{row.google}</td>
                  <td className="px-3 py-2 font-bold">{row.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Dúvidas? Entre em contato com o suporte ON_REPORT.
      </p>
    </div>
  );
}
