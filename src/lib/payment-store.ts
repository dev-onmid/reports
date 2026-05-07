"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { logActivity } from '@/lib/activity-log-store';
import { supabase } from '@/lib/supabase';

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
};

const PaymentContext = createContext<PaymentContextValue | null>(null);

export function PaymentProvider({ children }: { children: React.ReactNode }) {
  const [payments, setPayments] = useState<InvestmentPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('payments').select('*').order('date');
        if (!data) return setPayments([]);
        const today = new Date().toISOString().split('T')[0];
        const mapped = data.map((r) => ({
          id: r.id,
          clientId: r.client_id,
          clientName: r.client_name,
          date: r.date,
          destination: r.destination,
          amount: Number(r.amount),
          channel: r.channel as PaymentChannel,
          status: r.status as PaymentStatus,
        }));
        setPayments(mapped.map((p) =>
          p.status === 'Enviado' && p.date < today ? { ...p, status: 'Em atraso' as PaymentStatus } : p
        ));
      } catch {
        setPayments([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function addPayment(payment: Omit<InvestmentPayment, 'id'>) {
    const newPayment = { ...payment, id: `pay-${Date.now()}` };
    setPayments((prev) => [...prev, newPayment]);
    void supabase.from('payments').insert({
      id: newPayment.id,
      client_id: newPayment.clientId,
      client_name: newPayment.clientName,
      date: newPayment.date,
      destination: newPayment.destination,
      amount: newPayment.amount,
      channel: newPayment.channel,
      status: newPayment.status,
    });
    const dateFormatted = payment.date.split('-').reverse().join('/');
    logActivity('payment_added', `Pix de ${fmtBRL(payment.amount)} adicionado para ${payment.clientName} (${payment.channel}) em ${dateFormatted}`);
  }

  function updatePaymentStatus(id: string, status: PaymentStatus) {
    setPayments((prev) => prev.map((p) => p.id === id ? { ...p, status } : p));
    void supabase.from('payments').update({ status }).eq('id', id);
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
    void supabase.from('payments').delete().eq('id', id);
  }

  return React.createElement(
    PaymentContext.Provider,
    { value: { payments, loading, setPayments, addPayment, updatePaymentStatus, deletePayment } },
    children,
  );
}

export function useInvestmentPayments(): PaymentContextValue {
  const ctx = useContext(PaymentContext);
  if (!ctx) throw new Error('useInvestmentPayments must be used within a PaymentProvider');
  return ctx;
}
