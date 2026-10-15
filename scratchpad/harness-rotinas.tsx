import { createRoot } from 'react-dom/client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { RotinasPanel } from '../src/components/settings/rotinas-panel';

const agora = new Date('2026-10-06T22:00:00Z').toISOString();
const atras = (min: number) => new Date(Date.parse(agora) - min * 60_000).toISOString();

// Estado REAL medido na VPS em 06/10: 5 arquivos de 0 byte, Cardápio Web sem
// pedido há 20h, rotina de atendimento ainda sem .last.
const resposta: any = {
  agora,
  resumo: { total: 25, problemas: 6, atencao: 1, conexoesComProblema: 0 },
  leituraIndisponivel: false,
  conexoes: [
    { id: 'm', plataforma: 'Meta Ads', conta: 'Matheus Campos', estado: 'ok', motivo: 'Token válido por mais 62 dias.', conectadaEm: atras(40000) },
    { id: 'g1', plataforma: 'Google Ads', conta: 'matheus.onmid@gmail.com', estado: 'ok', motivo: 'Conectada.', conectadaEm: atras(9000) },
    { id: 'g2', plataforma: 'Google Analytics', conta: 'matheus.onmid@gmail.com', estado: 'ok', motivo: 'Conectada.', conectadaEm: atras(10000) },
    { id: 'g3', plataforma: 'Google Planilhas', conta: 'matheus.onmid@gmail.com', estado: 'ok', motivo: 'Conectada.', conectadaEm: atras(9500) },
    { id: 'g4', plataforma: 'Gmail (envio)', conta: 'matheus.onmid@gmail.com', estado: 'erro', motivo: 'Conexão em "revoked" — reconectar em Integrações.', conectadaEm: atras(200000) },
  ],
  rotinas: [
    { id: 'balance', nome: 'Alerta de saldo de mídia', grupo: 'anuncios', oQueFaz: 'Confere o saldo das contas de anúncio e avisa quem vai ficar sem verba.', cadencia: 'todo dia às 07h', estado: 'erro', motivo: 'A última execução respondeu: resposta vazia', ultimaExecucao: atras(720), ultimaResposta: 'resposta vazia', rastroRotulo: 'último alerta enviado', rastroEm: atras(300) },
    { id: 'sheets', nome: 'Planilhas do Google', grupo: 'integracoes', oQueFaz: 'Lê as planilhas do Drive que os clientes compartilharam e importa como leads/vendas.', cadencia: 'todo dia às 08h', estado: 'erro', motivo: 'A última execução respondeu: resposta vazia', ultimaExecucao: atras(660), ultimaResposta: 'resposta vazia', rastroRotulo: 'última planilha lida', rastroEm: null },
    { id: 'cardapioweb', nome: 'Cardápio Web', grupo: 'integracoes', oQueFaz: 'Busca os pedidos de delivery das lojas conectadas ao Cardápio Web.', cadencia: 'de hora em hora', estado: 'atencao', motivo: 'Está rodando, mas último pedido importado foi há 21 h.', ultimaExecucao: atras(55), ultimaResposta: 'clientes: 3', rastroRotulo: 'último pedido importado', rastroEm: atras(1260) },
    { id: 'rotina-crm', nome: 'Análise e nota de atendimento', grupo: 'crm', oQueFaz: 'Lê as conversas do dia, move o Kanban de quem não tem integração e dá nota ao atendimento.', cadencia: 'todo dia às 03h30', estado: 'sem_leitura', motivo: 'Sem leitura da execução, mas última conversa analisada foi há 2 h — está produzindo.', ultimaExecucao: null, ultimaResposta: null, rastroRotulo: 'última conversa analisada', rastroEm: atras(130) },
    { id: 'crmsync', nome: 'Conversas do WhatsApp', grupo: 'crm', oQueFaz: 'Traz as conversas das instâncias Evolution para o CRM e reaponta webhook que tenha caído.', cadencia: 'a cada 10 minutos', estado: 'ok', motivo: 'Rodando há 4 min.', ultimaExecucao: atras(4), ultimaResposta: 'clientes: 25 · total: 25', rastroRotulo: 'última mensagem recebida', rastroEm: atras(1) },
    { id: 'agendor', nome: 'Agendor', grupo: 'integracoes', oQueFaz: 'Importa negócios e mudanças de etapa do CRM Agendor dos clientes conectados.', cadencia: 'a cada 15 minutos', estado: 'ok', motivo: 'Rodando há 12 min.', ultimaExecucao: atras(12), ultimaResposta: 'ok', rastroRotulo: 'último evento recebido', rastroEm: atras(12) },
    { id: 'disparos', nome: 'Disparos de WhatsApp', grupo: 'envios', oQueFaz: 'Envia as campanhas de disparo respeitando intervalo, teto diário e janela de horário.', cadencia: 'a cada minuto', estado: 'ocioso', motivo: 'Rodando normalmente. Sem trabalho a fazer (último envio há 4 dias).', ultimaExecucao: atras(1), ultimaResposta: 'processados: 0', rastroRotulo: 'último envio', rastroEm: atras(5760) },
    { id: 'publicacoes', nome: 'Publicações agendadas', grupo: 'envios', oQueFaz: 'Publica no Instagram e no Facebook os posts e stories agendados.', cadencia: 'a cada minuto', estado: 'ok', motivo: 'Rodando há 1 min.', ultimaExecucao: atras(1), ultimaResposta: 'ok', rastroRotulo: 'última publicação', rastroEm: atras(420) },
    { id: 'resumo-diario', nome: 'Relatório diário no WhatsApp', grupo: 'relatorios', oQueFaz: 'Manda no grupo o resumo do dia anterior.', cadencia: 'dias úteis às 07h15', estado: 'erro', motivo: 'A última execução respondeu: resposta vazia', ultimaExecucao: atras(705), ultimaResposta: 'resposta vazia', rastroRotulo: null, rastroEm: null },
    { id: 'luna', nome: 'Tarefas agendadas da Luna', grupo: 'envios', oQueFaz: 'Executa as tarefas que a Luna agendou e entrega o resultado no WhatsApp.', cadencia: 'a cada 15 minutos', estado: 'parado', motivo: 'Não roda há 2 dias — deveria rodar a cada 15 minutos.', ultimaExecucao: atras(2880), ultimaResposta: 'ok', rastroRotulo: 'última tarefa executada', rastroEm: atras(9000) },
  ],
};

// ?ok=1 → tudo saudável e sem leitura de execução (o que o painel mostra se o
// volume do cron-status não estiver montado).
const tudoOk = new URLSearchParams(location.search).get('ok') === '1';
if (tudoOk) {
  resposta.leituraIndisponivel = true;
  resposta.resumo = { total: 25, problemas: 0, atencao: 0, conexoesComProblema: 0 };
  resposta.conexoes = resposta.conexoes.map((c: any) => ({ ...c, estado: 'ok', motivo: 'Conectada.' }));
  resposta.rotinas = resposta.rotinas.map((r: any) => ({
    ...r, estado: 'sem_leitura', ultimaExecucao: null, ultimaResposta: null,
    motivo: 'Ainda sem leitura do servidor para esta rotina.',
  }));
}

window.fetch = (async (input: RequestInfo | URL) => {
  const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.includes('/api/admin/rotinas')) {
    await new Promise((r) => setTimeout(r, 120));
    return new Response(JSON.stringify(resposta), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 200 });
}) as typeof fetch;

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#0e0f14] p-6"><RotinasPanel /></div>,
);
