/**
 * Resolução telefone → LID para etiquetar no WhatsApp.
 *
 * ⚠️⚠️ Por que isto existe (2026-10-01): o `handleLabel` da Evolution aceita um
 * telefone, converte para `55…@s.whatsapp.net` e aplica a etiqueta nesse JID.
 * Só que o CELULAR chaveia a etiqueta pelo **LID** (`…@lid`) — conferido no
 * banco da Evolution: as associações que vêm do aparelho são todas `@lid`, e
 * as três que escrevemos pelo telefone nunca apareceram na tela do Matheus.
 * É a issue #2524 da Evolution ("retorna sucesso mas não aplica"), fechada
 * como "not planned". Passar o JID já em `@lid` funciona: a Evolution preserva.
 *
 * De onde vem o LID: o Baileys resolve telefone→LID na hora de ENVIAR (consulta
 * usync com protocolo LID) e persiste em disco, no diretório da instância:
 *   /evolution/instances/<uuid>/lid-mapping-<telefone>.json  →  "<lid>"
 * Medido: o arquivo nasce ~300 ms ANTES do envio terminar, então já está lá
 * quando o `sendText` retorna. Esse diretório é montado só-leitura no container
 * do reports (`EVOLUTION_INSTANCES_DIR`).
 *
 * ⚠️ O nome do arquivo usa o telefone na forma que o WhatsApp usa como JID — e
 * para celular brasileiro antigo isso é SEM o nono dígito: na instância do
 * Matheus, 1.020 arquivos sem o 9 contra 132 com. Por isso `candidatosPn`
 * devolve as duas formas e a leitura tenta ambas.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Formas que o telefone pode assumir no nome do arquivo (com e sem o 9º dígito). */
export function candidatosPn(phone: string): string[] {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return [];
  const out = new Set<string>([d]);
  // 55 + DDD(2) + 9 + 8 dígitos = 13 → versão sem o 9
  if (/^55\d{2}9\d{8}$/.test(d)) out.add(d.slice(0, 4) + d.slice(5));
  // 55 + DDD(2) + 8 dígitos = 12 → versão com o 9 (celular)
  if (/^55\d{10}$/.test(d)) out.add(d.slice(0, 4) + '9' + d.slice(4));
  return [...out];
}

/** Lê o conteúdo de um lid-mapping (`"209504360788187"`) e devolve só os dígitos. */
export function parseLidMapping(conteudo: string): string | null {
  const t = String(conteudo ?? '').trim();
  if (!t) return null;
  let v: unknown = t;
  try { v = JSON.parse(t); } catch { /* texto cru */ }
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

export function jidLid(lid: string): string {
  return `${lid.replace(/\D/g, '')}@lid`;
}

/**
 * Procura o LID no disco. `null` quando não há mapeamento — aí o chamador cai
 * no telefone (que pelo menos grava no banco da Evolution) e registra o motivo.
 */
export async function lerLidDoDisco(opts: {
  dir: string; instanceUuid: string; phone: string;
}): Promise<{ lid: string; arquivo: string } | null> {
  const base = path.join(opts.dir, opts.instanceUuid);
  for (const pn of candidatosPn(opts.phone)) {
    const arquivo = path.join(base, `lid-mapping-${pn}.json`);
    try {
      const lid = parseLidMapping(await fs.readFile(arquivo, 'utf8'));
      if (lid) return { lid, arquivo };
    } catch { /* não existe nessa forma — tenta a próxima */ }
  }
  return null;
}

/**
 * Diretório montado do Baileys. Sem a env, a feature degrada para o telefone —
 * nunca derruba o envio.
 */
export function instancesDir(): string | null {
  const v = process.env.EVOLUTION_INSTANCES_DIR?.trim();
  return v ? v : null;
}

/**
 * A etiqueta só chega no celular se a SESSÃO do Baileys tiver a coleção
 * `regular` do app-state sincronizada de verdade. Medido em 01/10/2026: quando
 * a sessão perde a chave dessa coleção, o Baileys trata como erro irrecuperável
 * (404), zera a versão e nunca mais tenta — e todo patch que enviamos sai
 * sobre base vazia: o servidor responde OK, o celular descarta. Das 25
 * instâncias da VPS, só 3 tinham a coleção com algum conteúdo.
 *
 * O arquivo `app-state-sync-version-regular.json` da instância é o termômetro:
 * ausente ou com `indexValueMap` quase vazio = etiqueta NÃO vai aparecer, e o
 * remédio é re-parear a instância (QR). Melhor avisar do que gastar uma
 * requisição por envio fingindo que funciona.
 */
export type SaudeEtiquetas =
  | { ok: true; versao: number; entradas: number }
  | { ok: false; motivo: 'sem_sincronia' | 'sem_diretorio' | 'ilegivel'; detalhe: string };

export async function saudeEtiquetasDaInstancia(opts: {
  dir: string; instanceUuid: string;
}): Promise<SaudeEtiquetas> {
  const arquivo = path.join(opts.dir, opts.instanceUuid, 'app-state-sync-version-regular.json');
  let cru: string;
  try {
    cru = await fs.readFile(arquivo, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      // Diretório da instância existe mas a coleção nunca sincronizou?
      try { await fs.access(path.join(opts.dir, opts.instanceUuid)); }
      catch { return { ok: false, motivo: 'sem_diretorio', detalhe: `sem diretório ${opts.instanceUuid}` }; }
      return { ok: false, motivo: 'sem_sincronia', detalhe: 'coleção regular nunca sincronizada nesta sessão' };
    }
    return { ok: false, motivo: 'ilegivel', detalhe: String(e) };
  }
  return avaliarColecaoRegular(cru);
}

/** Pura: decide pela versão e pelo tamanho do indexValueMap. */
export function avaliarColecaoRegular(cru: string): SaudeEtiquetas {
  let j: { version?: unknown; indexValueMap?: Record<string, unknown> };
  try { j = JSON.parse(cru); } catch (e) { return { ok: false, motivo: 'ilegivel', detalhe: String(e) }; }
  const versao = Number(j.version ?? 0) || 0;
  const entradas = j.indexValueMap ? Object.keys(j.indexValueMap).length : 0;
  // 1 entrada = só a nossa própria escrita (foi exatamente o estado observado
  // quando nada aparecia no celular). Conta Business com etiquetas em uso tem
  // dezenas/centenas.
  if (entradas <= 1) {
    return { ok: false, motivo: 'sem_sincronia', detalhe: `regular v${versao} com ${entradas} entrada(s) — base vazia` };
  }
  return { ok: true, versao, entradas };
}

// ─────────────────── Orquestração usada pelo worker e pelo tick ───────────────────
import { fetchEvolutionInstances, handleEvolutionLabel, type SendResult } from '@/lib/evolution-api';

/** nome da instância → UUID, com cache por processo (a lista muda raramente). */
const cacheUuid = new Map<string, { uuid: string; em: number }>();
export async function uuidDaInstancia(instanceName: string): Promise<string | null> {
  const hit = cacheUuid.get(instanceName);
  if (hit && Date.now() - hit.em < 10 * 60_000) return hit.uuid;
  try {
    const lista = await fetchEvolutionInstances();
    for (const i of lista) if (i.id) cacheUuid.set(i.name, { uuid: i.id, em: Date.now() });
    return cacheUuid.get(instanceName)?.uuid ?? null;
  } catch {
    return hit?.uuid ?? null;
  }
}

export type ResultadoEtiqueta =
  | { aplicada: true; via: 'lid' | 'telefone'; jid: string }
  | { aplicada: false; motivo: string };

/**
 * Pendura a etiqueta em quem acabou de receber o disparo — pelo LID quando
 * existe (é o que o celular reconhece), pelo telefone como último recurso.
 *
 * ⚠️ Nunca lança: a mensagem já saiu, e falha aqui não pode virar falha do
 * contato. O chamador só registra o motivo.
 *
 * ⚠️ Com `EVOLUTION_INSTANCES_DIR` montado, checa antes se a sessão tem a
 * coleção `regular` sincronizada; se não tem, NEM TENTA — a chamada daria
 * 200 e não apareceria em lugar nenhum (o caso de 01/10). O motivo volta
 * explícito para a tela poder dizer "re-pareie a instância".
 */
export async function etiquetarQuemRecebeu(opts: {
  instanceName: string; phone: string; labelId: string;
}): Promise<ResultadoEtiqueta> {
  const dir = instancesDir();
  let jid: string | null = null;
  let via: 'lid' | 'telefone' = 'telefone';

  if (dir) {
    const uuid = await uuidDaInstancia(opts.instanceName);
    if (uuid) {
      const saude = await saudeEtiquetasDaInstancia({ dir, instanceUuid: uuid });
      if (!saude.ok) {
        return { aplicada: false, motivo: `etiqueta indisponível nesta instância (${saude.motivo}: ${saude.detalhe}) — re-pareie o WhatsApp` };
      }
      const lid = await lerLidDoDisco({ dir, instanceUuid: uuid, phone: opts.phone });
      if (lid) { jid = jidLid(lid.lid); via = 'lid'; }
    }
  }

  const alvo = jid ?? opts.phone;
  let r: SendResult;
  try {
    r = await handleEvolutionLabel(opts.instanceName, alvo, opts.labelId, 'add');
  } catch (e) {
    return { aplicada: false, motivo: `handleLabel falhou: ${String(e).slice(0, 160)}` };
  }
  if (!r.ok) return { aplicada: false, motivo: `handleLabel recusou: ${String(r.error ?? '').slice(0, 160)}` };
  return { aplicada: true, via, jid: alvo };
}
