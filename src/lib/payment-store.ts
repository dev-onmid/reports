"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { logActivity } from '@/lib/activity-log-store';

export type PaymentChannel = 'Meta ADS' | 'Google ADS' | 'TikTok ADS';
export type PaymentStatus = 'Pendente' | 'Enviado' | 'Pago' | 'Em atraso';
export type InvestmentPayment = {
  id: string;
  clientId: string;
  clientName: string;
  date: string;
  destination: string;
  amount: number;
  channel: PaymentChannel;
  status: PaymentStatus;
  extra?: boolean;
};

export const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = ['Pendente', 'Enviado', 'Pago', 'Em atraso'];
export const PAYMENT_CHANNELS: Array<PaymentChannel | 'Todos'> = ['Todos', 'Meta ADS', 'Google ADS', 'TikTok ADS'];

function fmtBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function wasDispatched(status: PaymentStatus): boolean {
  return status === 'Enviado' || status === 'Pago' || status === 'Em atraso';
}

type PaymentContextValue = {
  payments: InvestmentPayment[];
  loading: boolean;
  setPayments: React.Dispatch<React.SetStateAction<InvestmentPayment[]>>;
  addPayment: (payment: Omit<InvestmentPayment, 'id'>) => void;
  updatePaymentStatus: (id: string, status: PaymentStatus) => void;
  deletePayment: (id: string) => void;
  movePaymentDate: (id: string, date: string) => void;
  togglePaymentExtra: (id: string) => void;
};

const PaymentContext = createContext<PaymentContextValue | null>(null);

export function PaymentProvider({ children }: { children: React.ReactNode }) {
  const [payments, setPayments] = useState<InvestmentPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/payments');
        if (!res.ok) { setPayments([]); return; }
        const data: InvestmentPayment[] = await res.json();
        const today = new Date().toISOString().split('T')[0];
        setPayments(data.map((p) =>
          p.status === 'Enviado' && p.date < today ? { ...p, status: 'Em atraso' as PaymentStatus } : p
        ));
      } catch (error) {
        console.error('Erro ao carregar pagamentos:', error);
        setPayments([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function addPayment(payment: Omit<InvestmentPayment, 'id'>) {
    const newPayment = { ...payment, id: `pay-${Date.now()}` };
    setPayments((prev) => [...prev, newPayment]);
    void fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPayment),
    }).catch((e) => console.error('Erro ao salvar pagamento:', e));

    const dateFormatted = payment.date.split('-').reverse().join('/');
    logActivity('payment_added', `Pix de ${fmtBRL(payment.amount)} adicionado para ${payment.clientName} (${payment.channel}) em ${dateFormatted}`);
  }

  function updatePaymentStatus(id: string, status: PaymentStatus) {
    setPayments((prev) => prev.map((p) => p.id === id ? { ...p, status } : p));
    void fetch(`/api/payments?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch((e) => console.error('Erro ao atualizar pagamento:', e));
  }

  function deletePayment(id: string) {
    setPayments((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        const dateFormatted = target.date.split('-').reverse().join('/');
        logActivity('payment_deleted', `Pix de ${fmtBRL(target.amount)} de ${target.clientName} (${target.channel}) excluído do dia ${dateFormatted}`);
      }
      return prev.filter((p) => p.id !== id);
    });
    void fetch(`/api/payments?id=${id}`, { method: 'DELETE' })
      .catch((e) => console.error('Erro ao excluir pagamento:', e));
  }

  function movePaymentDate(id: string, date: string) {
    setPayments((prev) => prev.map((p) => p.id === id ? { ...p, date } : p));
    void fetch(`/api/payments?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    }).catch((e) => console.error('Erro ao mover pagamento:', e));
  }

  function togglePaymentExtra(id: string) {
    setPayments((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const extra = !p.extra;
      void fetch(`/api/payments?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra }),
      }).catch((e) => console.error('Erro ao marcar extra:', e));
      return { ...p, extra };
    }));
  }

  return React.createElement(
    PaymentContext.Provider,
    { value: { payments, loading, setPayments, addPayment, updatePaymentStatus, deletePayment, movePaymentDate, togglePaymentExtra } },
    children,
  );
}

export function useInvestmentPayments(): PaymentContextValue {
  const ctx = useContext(PaymentContext);
  if (!ctx) throw new Error('useInvestmentPayments must be used within a PaymentProvider');
  return ctx;
}
