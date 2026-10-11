'use client';

/**
 * Ícone "i" com a explicação da métrica ao passar o mouse (pedido do Matheus,
 * 2026-10-10): quem apresenta a aba Atendimento para o cliente — ou o próprio
 * cliente — precisa saber o que cada número mede sem perguntar.
 *
 * Abre com um pequeno atraso (não dispara ao cruzar o mouse pela tela) e fica
 * aberto enquanto o cursor estiver em cima; no toque, um clique abre.
 */
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function InfoDica({ texto, className, lado = 'bottom' }: { texto: string; className?: string; lado?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipProvider delay={350} closeDelay={120}>
      <Tooltip>
        <TooltipTrigger
          aria-label="O que é esta métrica"
          className={cn('inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200', className)}
        >
          <Info className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side={lado} className="max-w-[320px] whitespace-pre-line text-left leading-relaxed">
          {texto}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Textos das métricas da aba Atendimento — a mesma explicação que vai na reunião. */
export const DICAS_ATENDIMENTO = {
  notaIa: 'Nota de 0 a 100 dada pela IA ao ler uma amostra das conversas do período, quando alguém clica em "Gerar auditoria". Excelente 85+, Bom 70–84, Atenção 55–69, Crítico 40–54, Grave abaixo de 40. Não é recalculada todo dia: vale a data da última auditoria.',
  leads: 'Quantos leads foram captados no período (pela data do lead).',
  semResposta: 'Leads cuja ÚLTIMA mensagem é do cliente: a bola está com a clínica. É o número de "risco de perda". Quem já está em etapa de ganho ou perda fica fora.',
  respostaMedia: 'Tempo médio entre o cliente escrever e a próxima mensagem nossa. Conta toda vez que o cliente fala, não só o primeiro contato. Mensagem que nunca foi respondida não entra nesta média (entra em "Sem resposta").',
  taxaResposta: 'Das vezes em que o cliente falou, em quantas a clínica respondeu. 100% = ninguém ficou sem retorno.',
  conversasAtivas: 'Leads do período que trocaram pelo menos uma mensagem com a clínica.',
  variacao: 'As setas comparam com a janela anterior de mesma duração.',
  desempenho: 'Tempo médio de resposta por dia nos últimos 7 dias (fixo, não segue o filtro de período). A linha tracejada é a referência de meta.',
  sla: 'As respostas dadas, separadas por quanto demoraram: até 5 min, até 15 min, até 1 hora e mais de 1 hora. A soma é o total de respostas do período.',
  classificacao: 'Cada lead cai em UM estado, e a soma fecha com o total de leads:\n• Encerrados: etapa de ganho ou perda no funil (vence tudo).\n• Sem conversa: nenhuma mensagem trocada.\n• Sem resposta: a última mensagem é do cliente.\n• Aguardando retorno: a última é nossa e já passaram 48h sem o cliente responder.\n• Em atendimento: a última é nossa, há menos de 48h.',
  classEncerrados: 'Leads em etapa de ganho ou perda no funil. Desfecho não é pendência de atendimento.',
  classSemConversa: 'Nenhuma mensagem trocada entre a clínica e o lead.',
  classSemResposta: 'A última mensagem é do cliente: está esperando a clínica responder.',
  classAguardando: 'A última mensagem é nossa e já passaram 48 horas sem o cliente responder.',
  classEmAtendimento: 'A última mensagem é nossa e tem menos de 48 horas: conversa viva.',
  risco: 'Leads sem resposta (a última mensagem é do cliente) e como esse número andou nos últimos dias.',
  retomada: 'Mensagens que a clínica mandou depois de 48 horas de silêncio na conversa, e quantas dessas trouxeram resposta do cliente. O percentual é "retomadas que funcionaram".',
  porAtendente: 'Só quem envia pela tela do CRM tem nome na mensagem; follow-up automático, disparos e o histórico anterior ficam fora. Por pessoa: mensagens enviadas, respostas, tempo médio, % em até 5 min e % acima de 1 hora. O crédito (ou a demora) vai para quem deu a PRIMEIRA resposta depois da mensagem do cliente.',
  porQuePerdemos: 'Motivos registrados quando um lead é movido para uma etapa de perda. "Perdidos sem motivo" são os movidos antes de o campo existir.',
  evolucao: 'Últimos 6 meses, fixos (não seguem o filtro de período), pelo mês da MENSAGEM — não do lead. Atendimento acontece quando a mensagem anda. Setas comparam com o mês anterior.',
  tentativas: 'Pessoas que receberam a primeira mensagem nossa no período (contato ativo: lista, prospecção ou resposta ao anúncio). Tentativa = um DIA em que mandamos mensagem; cinco mensagens na mesma manhã contam como uma. Só contam as tentativas antes de a pessoa responder.',
} as const;
