"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CalendarDays, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDateBR, getHolidayPaymentImpacts, getTodayISO, getUpcomingHolidays, previousBusinessDay } from '@/lib/holidays';
import { useInvestmentPayments } from '@/lib/payment-store';

const SHOWN_AT_KEY = 'onmid-holiday-shown-at';
const HIDDEN_AT_KEY = 'onmid-tab-hidden-at';
const AWAY_MS = 20 * 60 * 1000;        // 20 min ausente = reseta
const PAYMENTS_COOLDOWN_MS = 15 * 60 * 1000; // cooldown entre exibições na aba pagamentos

export function HolidayPaymentAlert() {
  const { payments } = useInvestmentPayments();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const today = getTodayISO();
  const lastPathShownRef = useRef<string | null>(null);

  const upcomingHolidays = useMemo(() => getUpcomingHolidays(today, 2), [today]);
  const impacts = useMemo(() => getHolidayPaymentImpacts(payments, today, 2), [payments, today]);

  // Track tab visibility to detect when user was away
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now()));
      } else {
        const hiddenAt = Number(sessionStorage.getItem(HIDDEN_AT_KEY) ?? 0);
        if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) {
          sessionStorage.removeItem(SHOWN_AT_KEY);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Decide when to show
  useEffect(() => {
    if (upcomingHolidays.length === 0 && impacts.length === 0) return;

    const now = Date.now();
    const shownAt = Number(sessionStorage.getItem(SHOWN_AT_KEY) ?? 0);
    const isPayments = pathname?.includes('/pagamentos');
    const neverShown = !shownAt;
    const paymentsCooldownPassed = isPayments && now - shownAt > PAYMENTS_COOLDOWN_MS;
    const isNewPaymentsVisit = isPayments && lastPathShownRef.current !== pathname;

    const shouldShow = neverShown || (isPayments && isNewPaymentsVisit && paymentsCooldownPassed);

    if (shouldShow) {
      setOpen(true);
      sessionStorage.setItem(SHOWN_AT_KEY, String(now));
      lastPathShownRef.current = pathname ?? null;
    }
  }, [impacts.length, upcomingHolidays.length, pathname]);

  if (upcomingHolidays.length === 0 && impacts.length === 0) return null;

  const mainHoliday = upcomingHolidays[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl uppercase tracking-wider">
            <AlertTriangle className="h-5 w-5 text-orange-400" />
            Atenção aos feriados
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {mainHoliday && (
            <div className="rounded-xl border border-orange-400/30 bg-orange-500/10 p-4">
              <div className="flex items-start gap-3">
                <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
                <div>
                  <p className="text-sm font-bold">
                    Próximo feriado: {mainHoliday.name} em {formatDateBR(mainHoliday.date)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pix programados para feriados devem ser enviados no dia útil anterior: {formatDateBR(previousBusinessDay(mainHoliday.date))}.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pix impactados</p>
            {impacts.length > 0 ? (
              impacts.slice(0, 5).map(({ payment, holiday, sendDate }) => (
                <div key={payment.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{payment.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {holiday?.name} em {formatDateBR(payment.date)}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Enviar até</p>
                    <p className="text-sm font-bold">{formatDateBR(sendDate)}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-border bg-background/60 p-3 text-sm text-muted-foreground">
                Nenhum Pix pendente caindo em feriado nos próximos 45 dias.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => setOpen(false)} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Send className="mr-2 h-4 w-4" />
            Entendi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
