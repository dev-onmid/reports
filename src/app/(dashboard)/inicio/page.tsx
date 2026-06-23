"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Home, Bell, Sparkles, ArrowRight, Megaphone, ShieldCheck } from 'lucide-react';
import { getAuthSession, useMyPermissions, type AuthSession } from '@/lib/auth-store';
import { NAV_ITEMS } from '@/lib/nav-items';
import { useInvestmentPayments } from '@/lib/payment-store';
import { getHolidayPaymentImpacts, getTodayISO, formatDateBR } from '@/lib/holidays';
import { APP_VERSION } from '@/lib/app-version';
import { cn } from '@/lib/utils';

// A small curated rotation — picked by day-of-year so it's stable through the day
// and changes tomorrow. Honest "frase do dia" without needing a backend.
const PHRASES = [
  'Estratégico por dentro, criativo por natureza.',
  'O que é medido, melhora. O que é acompanhado, cresce.',
  'Consistência todo dia vale mais que intensidade um dia só.',
  'Cada cliente bem atendido hoje é uma indicação amanhã.',
  'Clareza no plano, leveza na execução.',
  'Pequenos ajustes diários constroem grandes resultados.',
  'Comece pelo que move o ponteiro.',
];

function greetingFor(hour: number): string {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

type Note = { id: string; tone: 'warning' | 'danger' | 'info'; title: string; when: string };

const TONE_BORDER: Record<Note['tone'], string> = {
  warning: 'border-amber-400',
  danger: 'border-red-400',
  info: 'border-primary',
};

export default function InicioPage() {
  const { permissions } = useMyPermissions();
  const { payments } = useInvestmentPayments();
  const [session, setSession] = useState<AuthSession | null>(null);
  // Computed in an effect (not during render) so the page stays a pure function.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setSession(getAuthSession());
    setNow(new Date());
  }, []);

  const firstName = session?.name?.trim().split(/\s+/)[0] ?? '';
  const greeting = now ? greetingFor(now.getHours()) : '';
  const dateLabel = now
    ? now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
        .replace(/^./, (c) => c.toUpperCase())
    : '';
  const phrase = now ? PHRASES[dayOfYear(now) % PHRASES.length] : PHRASES[0];

  const quickAccess = useMemo(() => NAV_ITEMS.filter((item) => permissions[item.key]), [permissions]);

  const notes = useMemo<Note[]>(() => {
    const list: Note[] = [];

    // Real signal: upcoming holidays that push a pending payment's send date earlier.
    if (permissions.pagamentos) {
      for (const impact of getHolidayPaymentImpacts(payments, getTodayISO(), 30)) {
        if (!impact.holiday) continue;
        list.push({
          id: `holiday-${impact.payment.id}`,
          tone: 'warning',
          title: `${impact.holiday.name} (${formatDateBR(impact.payment.date)}): antecipe o pagamento de ${impact.payment.clientName} para ${formatDateBR(impact.sendDate)}.`,
          when: 'Pagamentos',
        });
      }
    }

    list.push({
      id: `version-${APP_VERSION}`,
      tone: 'info',
      title: `Novidades da versão ${APP_VERSION} já estão disponíveis.`,
      when: 'Sistema',
    });

    return list;
  }, [payments, permissions.pagamentos]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            {greeting ? `${greeting}, ${firstName}` : 'Bem-vindo'}
            <Home className="w-5 h-5 text-primary" />
          </h1>
          {dateLabel && (
            <p className="text-sm text-muted-foreground mt-1">{dateLabel} · Bom te ver por aqui de novo.</p>
          )}
        </div>
        {session && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5">
            <ShieldCheck className="w-4 h-4 text-primary" />
            {session.role} · {session.team === 'parceiro' ? 'Parceiro' : 'Time Onmid'}
          </div>
        )}
      </div>

      {/* Acesso rápido */}
      <section>
        <p className="text-sm font-semibold text-muted-foreground mb-3">Acesso rápido</p>
        {quickAccess.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Você ainda não tem módulos liberados. Fale com um administrador para receber acesso.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {quickAccess.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-[var(--radius)] border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-card/80"
              >
                <item.icon className="w-6 h-6 text-primary" />
                <div className="mt-3 text-sm font-semibold text-foreground flex items-center gap-1">
                  {item.name}
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Notificações */}
        <section className="rounded-[var(--radius)] border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-4.5 h-4.5 text-foreground" />
            <span className="text-sm font-semibold">Notificações</span>
            {notes.length > 0 && (
              <span className="ml-auto text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-md font-semibold">
                {notes.length}
              </span>
            )}
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tudo em dia. Nenhuma notificação por enquanto.</p>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className={cn('border-l-2 pl-3 py-0.5', TONE_BORDER[note.tone])}>
                  <p className="text-[13px] text-foreground leading-snug">{note.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{note.when}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Frase do dia */}
        <section className="rounded-[var(--radius)] border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4.5 h-4.5 text-foreground" />
            <span className="text-sm font-semibold">Frase do dia</span>
          </div>
          <p className="text-base text-foreground leading-relaxed">“{phrase}”</p>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Megaphone className="w-4 h-4 text-primary" />
            Onmid · {greeting || 'Olá'}, {firstName || 'bem-vindo'}.
          </div>
        </section>
      </div>
    </div>
  );
}
