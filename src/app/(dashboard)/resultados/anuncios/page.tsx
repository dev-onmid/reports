"use client";

import { ResultsTabs } from '@/components/results-tabs';
import { BibliotecaAnuncios } from '@/components/biblioteca-anuncios';

// Biblioteca de Anúncios — tudo que rodou no Meta, em todas as contas, com capa,
// gasto, leads, prévia e alerta de cidade. Herda a flag `radar` pelo prefixo
// /resultados. Difere da aba Criativos: aquela ranqueia pelo CRM; esta mostra
// o que foi veiculado, conta a conta.

export default function AnunciosPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="font-bebas text-3xl uppercase tracking-wide">Biblioteca de Anúncios</h1>
        <p className="text-sm text-muted-foreground">
          Todos os anúncios que entregaram no Meta, conta a conta — capa, campanha, gasto, leads e prévia.
        </p>
      </div>
      <ResultsTabs />
      <BibliotecaAnuncios />
    </div>
  );
}
