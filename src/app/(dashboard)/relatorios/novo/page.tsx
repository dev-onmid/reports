"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useClients } from '@/lib/client-store';
import { Check, Sparkles } from 'lucide-react';

export default function NovoRelatorioPage() {
  const { clients } = useClients();

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Criar Novo Relatório</h1>
        <p className="text-muted-foreground mt-1">Configure os dados e deixe a IA da ONMID gerar os insights.</p>
      </div>

      <div className="grid gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>1. Selecione o Cliente e Período</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cliente</Label>
                <select defaultValue="" className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                  <option value="" disabled>Selecione um cliente</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Período</Label>
                <select className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <option>Últimos 30 dias</option>
                  <option>Mês passado</option>
                  <option>Personalizado</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>2. Fontes de Dados</CardTitle>
            <CardDescription>Selecione quais plataformas incluir no relatório</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {['Meta Ads', 'Google Ads', 'Instagram', 'CRM / Leads'].map(source => (
                <div key={source} className="flex items-center space-x-2 border border-border p-3 rounded-md bg-muted/30">
                  <div className="w-4 h-4 rounded border border-primary bg-primary/20 flex items-center justify-center">
                    <Check className="w-3 h-3 text-primary" />
                  </div>
                  <Label className="font-medium cursor-pointer">{source}</Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>3. Configuração da IA Interpretativa</CardTitle>
            <CardDescription>Defina como a inteligência artificial deve analisar os dados</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                 <input type="checkbox" id="ai-analysis" className="rounded text-primary border-primary bg-primary/20" defaultChecked />
                 <Label htmlFor="ai-analysis" className="font-bold flex items-center gap-2">
                   Gerar análise automática com IA <Sparkles className="w-4 h-4 text-primary" />
                 </Label>
              </div>
              <p className="text-sm text-muted-foreground ml-6">
                A IA irá gerar textos explicativos, resumo executivo, diagnóstico do funil e recomendações estratégicas.
              </p>
            </div>
            
            <div className="space-y-2 mt-4">
              <Label>Observações internas (opcional)</Label>
              <textarea 
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Ex: Campanha pausada no dia 15. A IA considerará este contexto."
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button render={<Link href="/relatorios" />} nativeButton={false} variant="outline">Cancelar</Button>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            Gerar Relatório
          </Button>
        </div>
      </div>
    </div>
  );
}
