import type { makeServerPool } from '@/lib/server-db';
import { sendTextByInstanceId } from '@/lib/whatsapp-send';
import type { ChecklistItem } from '@/lib/reuniao-resumos';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Checklist da reunião no grupo do tráfego — traz de volta pra casa o disparo
 * que vivia no cenário v4 do Make.
 *
 * ⚠️ Por que saiu do Make: o envio parou sozinho em 25/09/2026 17:33, depois de
 * 379 mensagens, e ninguém percebeu por duas semanas. O resto da corrente
 * continuou funcionando (polling, doc, transcrição, resumo gravado na aba
 * Reuniões), então não havia erro em lugar nenhum pra olhar — só a ausência.
 * É o mesmo tipo de silêncio que o webhook do TLDV já causou duas vezes.
 *
 * O formato é CÓPIA do que o Make mandava (lido das mensagens reais do grupo),
 * porque o time lê isso todo dia e mudar o desenho junto com o conserto
 * misturaria duas coisas.
 */

/** Cabeçalho do bloco ("🏢 AGÊNCIA ONMID") × ação ("Migrar os dados..."). */
export function ehCabecalho(texto: string): boolean {
  const semEmoji = texto.replace(/[\p{Extended_Pictographic}\p{Emoji_Component}]/gu, '').trim();
  if (!semEmoji) return true;              // item só com emoji é separador
  if (semEmoji.length > 60) return false;  // frase longa é ação, não título
  const letras = semEmoji.replace(/[^\p{L}]/gu, '');
  if (!letras) return true;
  // Cabeçalho vem em CAIXA ALTA; ação vem em frase. É o que separa
  // "👥 CLIENTE" de "Enviar ao Matheus os textos ajustados".
  return letras === letras.toLocaleUpperCase('pt-BR');
}

const CABECALHO_PADRAO = '📋 CHECKLIST OPERACIONAL — AÇÕES ACORDADAS';

function dataBR(d: Date): string {
  const brt = new Date(d.getTime() - 3 * 3600_000); // BRT fixo, padrão do repo
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(brt.getUTCDate())}/${p(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()}`;
}

/**
 * Monta a mensagem. Devolve `null` quando não há NENHUMA ação de verdade —
 * mandar um checklist vazio no grupo treina o time a ignorar a mensagem.
 */
export function montarMensagemChecklist(args: {
  cliente: string;
  reuniaoEm: Date;
  checklist: ChecklistItem[] | null;
}): string | null {
  const itens = (args.checklist ?? []).filter(i => i.texto.trim().length > 0);
  if (!itens.some(i => !ehCabecalho(i.texto))) return null;

  const linhas: string[] = [`*CheckList de Reunião | ${args.cliente}*`, '', `Data: ${dataBR(args.reuniaoEm)}`];
  // O cabeçalho geral costuma vir dentro do próprio checklist; só injeta quando falta.
  if (!itens.some(i => i.texto.includes('CHECKLIST OPERACIONAL'))) {
    linhas.push('', CABECALHO_PADRAO);
  }
  for (const item of itens) {
    const texto = item.texto.trim();
    if (ehCabecalho(texto)) linhas.push('', texto, '');
    else linhas.push(`${item.feito ? '[x]' : '[ ]'} ${texto}`);
  }
  return linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Grupo e instância: chave própria, caindo no canal já validado todo dia. */
async function resolverCanal(pool: Pool): Promise<{ grupo: string; instancia: string } | null> {
  const { rows } = await pool.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM system_settings WHERE key IN
       ('reuniao_resumo_ativo','reuniao_resumo_group_id','reuniao_resumo_zapi_client_id',
        'gads_rotina_group_id','social_alert_group_id','social_alert_zapi_client_id')`);
  const m = Object.fromEntries(rows.map(r => [r.key, (r.value ?? '').trim()]));
  if (m['reuniao_resumo_ativo'] === 'false') return null;
  const grupo = m['reuniao_resumo_group_id'] || m['gads_rotina_group_id'] || m['social_alert_group_id'];
  const instancia = m['reuniao_resumo_zapi_client_id'] || m['social_alert_zapi_client_id'];
  return grupo && instancia ? { grupo, instancia } : null;
}

export type ResultadoEnvio = { enviado: boolean; motivo?: string };

/**
 * Envia o checklist de UM resumo. Best-effort: nunca lança — quem chama é o
 * webhook do Make, e derrubar a resposta dele faria o resumo (que já está
 * gravado) parecer perdido.
 *
 * ⚠️ `whatsapp_em` é tomado ANTES do envio, numa escrita condicional. O Make
 * reexecuta cenário com frequência e duas rodadas simultâneas da mesma reunião
 * mandariam o checklist duas vezes no grupo — não há desfazer. Se o envio
 * falhar, a marca volta a NULL para a próxima tentativa.
 */
export async function enviarChecklistReuniao(pool: Pool, resumoId: string): Promise<ResultadoEnvio> {
  try {
    const canal = await resolverCanal(pool);
    if (!canal) return { enviado: false, motivo: 'canal_nao_configurado' };

    const { rows: [linha] } = await pool.query<{
      cliente: string | null; checklist: ChecklistItem[] | null; reuniao_em: Date;
    }>(
      `UPDATE public.reuniao_resumos r SET whatsapp_em = NOW()
         FROM clients c
        WHERE r.id = $1 AND c.id = r.client_id AND r.whatsapp_em IS NULL
        RETURNING c.name AS cliente, r.checklist, r.reuniao_em`,
      [resumoId],
    );
    if (!linha) return { enviado: false, motivo: 'ja_enviado' };

    const texto = montarMensagemChecklist({
      cliente: linha.cliente?.trim() || 'Cliente',
      reuniaoEm: linha.reuniao_em instanceof Date ? linha.reuniao_em : new Date(linha.reuniao_em),
      checklist: linha.checklist,
    });
    // Sem ação nenhuma não é falha: fica marcado para não reavaliar a cada
    // reexecução do Make.
    if (!texto) return { enviado: false, motivo: 'sem_acoes' };

    const r = await sendTextByInstanceId(pool, canal.instancia, canal.grupo, texto);
    if ((r as { ok?: boolean }).ok) return { enviado: true };

    await pool.query('UPDATE public.reuniao_resumos SET whatsapp_em = NULL WHERE id = $1', [resumoId]);
    return { enviado: false, motivo: 'envio_falhou' };
  } catch (err) {
    await pool.query('UPDATE public.reuniao_resumos SET whatsapp_em = NULL WHERE id = $1', [resumoId]).catch(() => {});
    console.error('[reuniao whatsapp]', err);
    return { enviado: false, motivo: 'erro_interno' };
  }
}
