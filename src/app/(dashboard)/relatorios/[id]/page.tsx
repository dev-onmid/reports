"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ReportViewer } from '@/components/report-slides/viewer';
import type { ReportData } from '@/components/report-slides/types';

export default function ReportViewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/reports/${id}`)
      .then(r => r.json())
      .then((d: ReportData & { error?: string }) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError('Erro ao carregar relatório'));
  }, [id]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm animate-pulse">
        Carregando relatório...
      </div>
    );
  }

  return (
    // Negate dashboard padding to fill the available space
    <div className="-m-6 h-[calc(100vh-4rem)] flex flex-col">
      <ReportViewer data={data} onClose={() => router.push('/relatorios')} />
    </div>
  );
}
