"use client";

import { ResultsTabs } from '@/components/results-tabs';
import { CreativeLibrary } from '@/components/creative-library';

// Biblioteca de Criativos — visão global (todos os clientes, filtros por
// segmento/cliente/rede). Herda a flag `radar` pelo prefixo /resultados.

export default function CriativosPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="font-bebas text-3xl uppercase tracking-wide">Biblioteca de Criativos</h1>
        <p className="text-sm text-muted-foreground">
          Ranking dos anúncios por resultado real no CRM — leads, vendas, receita e etapa do funil.
        </p>
      </div>
      <ResultsTabs />
      <CreativeLibrary />
    </div>
  );
}
