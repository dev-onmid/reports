"use client";

// Modal "Configurar cliente" e as peças que só ele usa. Saiu do page.tsx
// (2026-09-13) por dois motivos: o page tem 7 mil linhas e não monta em bundle
// isolado (usa next/link) — aqui o modal dá para renderizar num harness e olhar.
import { useEffect, useState } from 'react';
import {
  AlertTriangle, BookMarked, ChevronRight, ExternalLink, Globe2, Kanban, Layers,
  Link2, Pencil, Power, PowerOff, Settings, Sparkles, Store, Wallet, WalletCards,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VaultTab } from '@/components/vault-tab';
import type { AcaoConfigCrm } from '@/app/(dashboard)/crm/page';

export const CLIENT_BILLING_MODE_PREFIX = 'clientAdsBillingMode_';

export function ClientBillingSection({ clientId }: { clientId: string }) {
  const [billingMode, setBillingMode] = useState<'prepaid' | 'card'>('prepaid');

  useEffect(() => {
    const stored = localStorage.getItem(`${CLIENT_BILLING_MODE_PREFIX}${clientId}`);
    setBillingMode(stored === 'card' ? 'card' : 'prepaid');
    let cancelled = false;
    fetch(`/api/clients/${clientId}/billing-mode`)
      .then(r => r.json())
      .then((data: { mode: 'prepaid' | 'card' }) => {
        if (cancelled) return;
        setBillingMode(data.mode);
        localStorage.setItem(`${CLIENT_BILLING_MODE_PREFIX}${clientId}`, data.mode);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);

  function updateBillingMode(next: 'prepaid' | 'card') {
    setBillingMode(next);
    localStorage.setItem(`${CLIENT_BILLING_MODE_PREFIX}${clientId}`, next);
    fetch(`/api/clients/${clientId}/billing-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).catch(() => {});
  }

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr]">
      {([
        { value: 'prepaid' as const, label: 'Pré-pago / saldo', Icone: Wallet },
        { value: 'card' as const, label: 'Cartão / faturado', Icone: WalletCards },
      ]).map(({ value, label, Icone }) => (
        <button key={value} type="button" onClick={() => updateBillingMode(value)}
          className={cn('flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-bold transition-colors',
            billingMode === value ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground')}>
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', billingMode === value ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-background')}>
            <Icone className="h-4 w-4" />
          </span>
          {label}
        </button>
      ))}
      <p className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Use “Cartão/faturado” para clientes em que a Meta/Google cobra direto no cartão. Essas contas não aparecem como saldo crítico em Pagamentos.
      </p>
    </div>
  );
}

// Célula da faixa de ajustes do modal Configurar cliente: ícone + rótulo + controle.
export function CelulaAjuste({ icone: Icone, rotulo, dica, children }: { icone: typeof Layers; rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3" title={dica}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{rotulo}</p>
        {children}
      </div>
    </div>
  );
}
export const SELECT_AJUSTE = 'mt-0.5 h-7 w-full bg-transparent pr-1 text-sm font-bold text-foreground focus:outline-none';

type SecaoConfig = 'geral' | 'contas' | 'crm' | 'cobranca' | 'links' | 'risco';

// Cabeçalho de seção do modal.
function SecaoTitulo({ Icone, titulo, sub }: { Icone: typeof Settings; titulo: string; sub: string }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <Icone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div>
        <h3 className="text-base font-bold text-foreground">{titulo}</h3>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

// Modal único de configuração do cliente — junta tudo que é setup (conexões, cobrança,
// e Links & Senhas). O Anota Aí saiu daqui (2026-08-21): delivery configura-se na
// aba Integrações → Delivery, um lugar só.
//
// Layout (2026-09-13, referência do Matheus): cabeçalho com selo de status, faixa de
// ajustes, navegação lateral e cards. ⚠️ A lateral é de ABAS, não de âncoras: só a
// seção clicada aparece ("caso contrário os botões laterais perdem o sentido").
// No mobile a mesma lista vira chips horizontais.
// ⚠️ Sem "Salvar alterações": cada controle grava no ato (PATCH), como sempre foi.
// Um botão Salvar aqui seria decorativo e faria o gestor achar que nada gravou
// antes de clicar.
export function ClientConfigModal({ open, onClose, clientId, clientName, statusCliente, ajustes, contas, onVincularContas, onIrParaIntegracoes, onAlterarStatus, inativo, onAcaoCrm }: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
  statusCliente?: string;
  /**
   * Categoria, tipo de dashboard, topo do funil e Fidelidade.
   *
   * ⚠️ Chega como JSX pronto, não como props soltas: os controles dependem de
   * oito pedaços de estado da página do cliente (categorias carregadas,
   * `patchClient`, a aba atual para o caso de desligar Fidelidade com ela
   * aberta). Recriá-los aqui significaria duplicar esse estado — e duas cópias
   * divergiriam na primeira mudança.
   */
  ajustes?: React.ReactNode;
  /** Quantas contas de anúncio estão vinculadas por plataforma (null = ainda carregando). */
  contas?: { meta: number; google: number } | null;
  /** Abre o diálogo de vínculo de contas — fecha este antes, para não empilhar modal. */
  onVincularContas?: () => void;
  /** Delivery, Mapa de Calor e afins moram na aba Integrações — o item da navegação leva pra lá. */
  onIrParaIntegracoes?: () => void;
  /** Ativa/desativa o cliente. Fica no fim, separado: é a única ação destrutiva daqui. */
  onAlterarStatus?: () => void;
  inativo?: boolean;
  /** Ações de configuração do CRM (funil, portal, critérios IA, fontes) — abrem na aba CRM. */
  onAcaoCrm?: (acao: AcaoConfigCrm) => void;
}) {
  const [ativa, setAtiva] = useState<SecaoConfig>('geral');
  // Fechar volta para Geral — reabrir num cliente e cair em "Zona de risco" assusta.
  const fechar = () => { onClose(); setAtiva('geral'); };

  const NAV: Array<{ id: SecaoConfig; rotulo: string; Icone: typeof Settings; mostrar: boolean }> = [
    { id: 'geral', rotulo: 'Geral', Icone: Settings, mostrar: true },
    { id: 'contas', rotulo: 'Contas de anúncio', Icone: Link2, mostrar: !!onVincularContas },
    { id: 'crm', rotulo: 'CRM', Icone: Kanban, mostrar: !!onAcaoCrm },
    { id: 'cobranca', rotulo: 'Cobrança', Icone: WalletCards, mostrar: true },
    { id: 'links', rotulo: 'Links & senhas', Icone: BookMarked, mostrar: true },
    { id: 'risco', rotulo: 'Zona de risco', Icone: AlertTriangle, mostrar: !!onAlterarStatus },
  ];


  const plataformas = [
    { chave: 'meta' as const, nome: 'Meta Ads', logo: '/brand/meta-ads-logo.webp', n: contas?.meta ?? 0 },
    { chave: 'google' as const, nome: 'Google Ads', logo: '/brand/google-ads-logo.png', n: contas?.google ?? 0 },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) fechar(); }}>
      <DialogContent className="w-[95vw] sm:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            Configurar cliente
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-2xl tracking-wide text-foreground">{clientName}</span>
            {statusCliente && (
              <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold',
                inativo ? 'border-border bg-muted/40 text-muted-foreground' : 'border-primary/30 bg-primary/10 text-primary')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', inativo ? 'bg-muted-foreground' : 'bg-primary')} />
                Cliente {statusCliente.toLowerCase()}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Ajustes, contas de anúncio, cobrança e senhas. Delivery continua na aba Integrações. As alterações são salvas na hora.
          </p>
        </DialogHeader>

        {open && (
          <div className="pt-2">
            {ajustes && (
              <div className="mb-6 grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
                {ajustes}
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-[190px_1fr]">
              {/* Desktop: lista vertical; mobile: os mesmos itens em chips roláveis. */}
              <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:block md:self-start md:overflow-visible md:px-0 md:pb-0">
                {NAV.filter(n => n.mostrar).map(({ id, rotulo, Icone }) => (
                  <button key={id} type="button" onClick={() => setAtiva(id)} aria-current={ativa === id ? 'page' : undefined}
                    className={cn('flex shrink-0 items-center gap-2 rounded-lg border-l-2 px-3 py-2 text-left text-sm transition-colors md:mb-1 md:w-full',
                      ativa === id ? 'border-primary bg-primary/10 font-bold text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground')}>
                    <Icone className={cn('h-4 w-4', ativa === id ? 'text-primary' : '')} /> {rotulo}
                  </button>
                ))}
                {onIrParaIntegracoes && (
                  <button type="button" onClick={() => { fechar(); onIrParaIntegracoes(); }}
                    className="flex shrink-0 items-center gap-2 rounded-lg border-l-2 border-transparent px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground md:w-full">
                    <Store className="h-4 w-4" /> Integrações <ExternalLink className="h-3 w-3 md:ml-auto" />
                  </button>
                )}
              </nav>

              {/* Altura mínima: sem ela o modal encolhe e cresce a cada aba (Cobrança é 1 linha, Links é alto). */}
              <div className="min-w-0 md:min-h-[440px]">
                {ativa === 'geral' && (<section>
                  <SecaoTitulo Icone={Settings} titulo="Geral" sub="Informações principais e status do cliente." />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {plataformas.map(({ chave, nome, logo, n }) => {
                      const ligada = n > 0;
                      return (
                        <div key={chave} className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start gap-3">
                            <img src={logo} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-white/90 object-contain p-1" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-foreground">{nome}</p>
                              {contas === null || contas === undefined ? (
                                <span className="mt-1 inline-block text-[11px] text-muted-foreground">verificando…</span>
                              ) : (
                                <span className={cn('mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold',
                                  ligada ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground')}>
                                  <span className={cn('h-1.5 w-1.5 rounded-full', ligada ? 'bg-primary' : 'bg-muted-foreground')} />
                                  {ligada ? `Conectada · ${n} conta${n === 1 ? '' : 's'}` : 'Não conectada'}
                                </span>
                              )}
                              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                {ligada ? 'Conta vinculada e alimentando dashboard, relatórios e alertas de saldo.' : `Vincule a conta do ${nome} para ativar a importação de dados.`}
                              </p>
                            </div>
                          </div>
                          {onVincularContas && (
                            <Button variant={ligada ? 'outline' : 'default'} className="mt-3 h-9 w-full gap-2 text-xs font-bold"
                              onClick={() => { fechar(); onVincularContas(); }}>
                              <Link2 className="h-4 w-4" /> {ligada ? 'Gerenciar contas' : 'Conectar conta'}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>)}

                {ativa === 'contas' && onVincularContas && (
                  <section>
                    <SecaoTitulo Icone={Link2} titulo="Contas de anúncio" sub="Meta e Google. Delivery continua na aba Integrações." />
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
                      <Button variant="outline" className="h-9 gap-2 border-border text-xs font-bold uppercase tracking-wider"
                        onClick={() => { fechar(); onVincularContas(); }}>
                        <Link2 className="h-4 w-4 text-primary" /> Vincular contas
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {contas ? `${contas.meta} Meta · ${contas.google} Google vinculadas.` : 'Escolha as contas de anúncio que alimentam este cliente.'}
                      </span>
                    </div>
                  </section>
                )}

                {ativa === 'crm' && onAcaoCrm && (
                  <section>
                    <SecaoTitulo Icone={Kanban} titulo="CRM" sub="Funil, portal do cliente, critérios da IA e captura de leads." />
                    {/* Eram o ⋮ da barra do CRM. Cada um fecha este modal e abre na aba CRM. */}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {([
                        ['funil', Pencil, 'Editar funil', 'Visualize e edite as etapas do funil de vendas.'],
                        ['portal', Globe2, 'Portal do cliente', 'Link somente-leitura para o cliente acompanhar.'],
                        ['criterios', Sparkles, 'Critérios IA', 'Regras que a IA usa para qualificar e mover leads.'],
                        ['captura', Link2, 'Fontes de captura', 'WhatsApp rastreável, landing, Meta Forms e UTMs.'],
                      ] as Array<[AcaoConfigCrm, typeof Pencil, string, string]>).map(([acao, Icone, rotulo, desc]) => (
                        <button key={acao} type="button" onClick={() => { fechar(); onAcaoCrm(acao); }}
                          className="group flex flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
                          <div className="flex items-start justify-between">
                            <Icone className="h-5 w-5 text-primary" />
                            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                          </div>
                          <p className="mt-3 text-sm font-bold text-foreground">{rotulo}</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {ativa === 'cobranca' && (<section>
                  <SecaoTitulo Icone={WalletCards} titulo="Cobrança dos anúncios" sub="Defina a forma de cobrança usada nas contas de anúncio (Meta e Google)." />
                  <ClientBillingSection clientId={clientId} />
                </section>)}

                {ativa === 'links' && (<section>
                  <SecaoTitulo Icone={BookMarked} titulo="Links & senhas" sub="Centralize todas as credenciais e acessos do cliente." />
                  <VaultTab clientId={clientId} />
                </section>)}

                {ativa === 'risco' && onAlterarStatus && (
                  <section>
                    <SecaoTitulo Icone={AlertTriangle} titulo="Zona de risco" sub="Ações que afetam diretamente o funcionamento do cliente." />
                    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4',
                      inativo ? 'border-primary/30 bg-primary/5' : 'border-red-500/30 bg-red-500/5')}>
                      <div className="flex items-start gap-3">
                        {inativo ? <Power className="mt-0.5 h-5 w-5 text-primary" /> : <PowerOff className="mt-0.5 h-5 w-5 text-red-400" />}
                        <div>
                          <p className={cn('text-sm font-bold', inativo ? 'text-primary' : 'text-red-300')}>
                            {inativo ? 'Reativar cliente' : 'Desativar cliente'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {inativo
                              ? 'Volta a aparecer na carteira, nos relatórios e nas automações.'
                              : 'Sai da carteira, dos relatórios e das automações. Nada é apagado — dá para reativar depois.'}
                          </p>
                        </div>
                      </div>
                      <Button variant="outline"
                        className={cn('h-9 shrink-0 gap-2 text-xs font-bold uppercase tracking-wider',
                          inativo ? 'border-primary/40 text-primary' : 'border-red-500/40 text-red-300 hover:bg-red-500/10')}
                        onClick={() => { fechar(); onAlterarStatus(); }}>
                        {inativo ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                        {inativo ? 'Ativar cliente' : 'Desativar cliente'}
                      </Button>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

