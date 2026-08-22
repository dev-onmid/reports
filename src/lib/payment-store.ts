"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { logActivity } from '@/lib/activity-log-store';
import { notificar } from '@/components/ui/toast';

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

// auditoria 2026-08-22: mutações devolvem Promise<boolean> (true = persistiu);
// em falha o próprio store reverte o estado otimista e mostra o toast de erro.
type PaymentContextValue = {
  payments: InvestmentPayment[];
  loading: boolean;
  setPayments: React.Dispatch<React.SetStateAction<InvestmentPayment[]>>;
  addPayment: (payment: Omit<InvestmentPayment, 'id'>) => Promise<boolean>;
  updatePayment: (id: string, fields: Partial<Omit<InvestmentPayment, 'id'>>) => Promise<boolean>;
  updatePaymentStatus: (id: string, status: PaymentStatus) => Promise<boolean>;
  deletePayment: (id: string) => Promise<boolean>;
  movePaymentDate: (id: string, date: string) => Promise<boolean>;
  togglePaymentExtra: (id: string) => Promise<boolean>;
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
        setPayments(data);
      } catch (error) {
        console.error('Erro ao carregar pagamentos:', error);
        setPayments([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // auditoria 2026-08-22: espera o fetch, checa res.ok e devolve false em falha.
  async function persist(input: string, init: RequestInit, contexto: string): Promise<boolean> {
    try {
      const res = await fetch(input, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (e) {
      console.error(`${contexto}:`, e);
      notificar('Não foi possível salvar o pagamento — tente de novo.', 'erro');
      return false;
    }
  }

  async function addPayment(payment: Omit<InvestmentPayment, 'id'>): Promise<boolean> {
    const newPayment = { ...payment, id: `pay-${Date.now()}` };
    setPayments((prev) => [...prev, newPayment]);
    const ok = await persist('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPayment),
    }, 'Erro ao salvar pagamento');
    if (!ok) {
      setPayments((prev) => prev.filter((p) => p.id !== newPayment.id));
      return false;
    }

    const dateFormatted = payment.date.split('-').reverse().join('/');
    logActivity('payment_added', `Pix de ${fmtBRL(payment.amount)} adicionado para ${payment.clientName} (${payment.channel}) em ${dateFormatted}`);
    return true;
  }

  async function updatePayment(id: string, fields: Partial<Omit<InvestmentPayment, 'id'>>): Promise<boolean> {
    const before = payments.find((p) => p.id === id);
    setPayments((prev) => prev.map((p) => p.id === id ? { ...p, ...fields } : p));
    const body: Record<string, unknown> = {};
    if (fields.status      !== undefined) body.status      = fields.status;
    if (fields.date        !== undefined) body.date        = fields.date;
    if (fields.extra       !== undefined) body.extra       = fields.extra;
    if (fields.channel     !== undefined) body.channel     = fields.channel;
    if (fields.amount      !== undefined) body.amount      = fields.amount;
    if (fields.clientId    !== undefined) body.clientId    = fields.clientId;
    if (fields.clientName  !== undefined) body.clientName  = fields.clientName;
    if (fields.destination !== undefined) body.destination = fields.destination;
    const ok = await persist(`/api/payments?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 'Erro ao atualizar pagamento');
    if (!ok && before) setPayments((prev) => prev.map((p) => p.id === id ? before : p));
    return ok;
  }

  async function updatePaymentStatus(id: string, status: PaymentStatus): Promise<boolean> {
    const before = payments.find((p) => p.id === id);
    setPayments((prev) => prev.map((p) => p.id === id ? { ...p, status } : p));
    const ok = await persist(`/api/payments?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }, 'Erro ao atualizar pagamento');
    if (!ok && before) setPayments((prev) => prev.map((p) => p.id === id ? before : p));
    return ok;
  }

  async function deletePayment(id: string): Promise<boolean> {
    const target = payments.find((p) => p.id === id);
    setPayments((prev) => prev.filter((p) => p.id !== id));
    const ok = await persist(`/api/payments?id=${id}`, { method: 'DELETE' }, 'Erro ao excluir pagamento');
    if (!ok) {
      if (target) setPayments((prev) => [...prev, target]);
      return false;
    }
    if (target) {
      const dateFormatted = target.date.split('-').reverse().join('/');
      logActivity('payment_deleted', `Pix de ${fmtBRL(target.amount)} de ${target.clientName} (${target.channel}) excluído do dia ${dateFormatted}`);
    }
    return true;
  }

  async function movePaymentDate(id: string, date: string): Promise<boolean> {
    const before = payments.find((p) => p.id === id);
    setPayments((prev) => prev.map((p) => p.id === id ? { ...p, date } : p));
    const ok = await persist(`/api/payments?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    }, 'Erro ao mover pagamento');
    if (!ok && before) setPayments((prev) => prev.map((p) => p.id === id ? before : p));
    return ok;
  }

  async function togglePaymentExtra(id: string): Promise<boolean> {
    const before = payments.find((p) => p.id === id);
    if (!before) return false;
    const extra = !before.extra;
    setPayments((prev) => prev.map((p) => p.id === id ? { ...p, extra } : p));
    const ok = await persist(`/api/payments?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra }),
    }, 'Erro ao marcar extra');
    if (!ok) setPayments((prev) => prev.map((p) => p.id === id ? before : p));
    return ok;
  }

  return React.createElement(
    PaymentContext.Provider,
    { value: { payments, loading, setPayments, addPayment, updatePayment, updatePaymentStatus, deletePayment, movePaymentDate, togglePaymentExtra } },
    children,
  );
}

export function useInvestmentPayments(): PaymentContextValue {
  const ctx = useContext(PaymentContext);
  if (!ctx) throw new Error('useInvestmentPayments must be used within a PaymentProvider');
  return ctx;
}
