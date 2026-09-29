import type { Pool } from 'pg';
import { sendText as zapiText, sendImage as zapiImage, sendDocument as zapiDoc, isZapiConnected } from '@/lib/zapi';
import { sendEvolutionText, sendEvolutionImage, sendEvolutionDocument, checkEvolutionStatus } from '@/lib/evolution-api';

// Envio de WhatsApp por ID de instância (linha de `zapi_clients`), ramificando
// pelo `provider`: Evolution (principal) usa a Evolution API pelo NOME da instância
// (coluna instance_id); Z-API usa a nuvem com instance_id/token/security_token.
//
// É o caminho canônico para as automações INTERNAS da agência (aviso do monitor,
// Luna, automações multi, alerta de créditos) que antes só falavam com Z-API.

export type ResolvedInstance = {
  id: string;
  name: string;
  provider: 'evolution' | 'zapi';
  instanceId: string;
  token: string;
  clientToken?: string;
};

export type WaResult = { ok: boolean; error?: string };

export async function resolveInstance(pool: Pool, id: string): Promise<ResolvedInstance | null> {
  const { rows } = await pool.query(
    `SELECT id, name, COALESCE(provider,'zapi') AS provider, instance_id, token, security_token
       FROM public.zapi_clients WHERE id = $1 AND active = TRUE`,
    [id],
  );
  const r = rows[0] as
    | { id: string; name: string; provider: string; instance_id: string; token: string; security_token: string | null }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    provider: r.provider === 'evolution' ? 'evolution' : 'zapi',
    instanceId: r.instance_id,
    token: r.token,
    clientToken: r.security_token ?? undefined,
  };
}

/** Conexão real da instância (Evolution: state 'open'; Z-API: campo `connected`). */
export async function isInstanceConnected(inst: ResolvedInstance): Promise<boolean> {
  if (inst.provider === 'evolution') return checkEvolutionStatus(inst.instanceId);
  return isZapiConnected({ instanceId: inst.instanceId, token: inst.token, clientToken: inst.clientToken });
}

export async function sendInstanceText(inst: ResolvedInstance, to: string, message: string): Promise<WaResult> {
  if (inst.provider === 'evolution') return sendEvolutionText(inst.instanceId, to, message);
  return zapiText({ instanceId: inst.instanceId, token: inst.token, clientToken: inst.clientToken }, to, message);
}

export async function sendInstanceImage(inst: ResolvedInstance, to: string, imageUrl: string, caption: string): Promise<WaResult> {
  if (inst.provider === 'evolution') return sendEvolutionImage(inst.instanceId, to, imageUrl, caption);
  return zapiImage({ instanceId: inst.instanceId, token: inst.token, clientToken: inst.clientToken }, to, imageUrl, caption);
}

export async function sendInstanceDocument(inst: ResolvedInstance, to: string, base64: string, fileName: string, caption?: string): Promise<WaResult> {
  if (inst.provider === 'evolution') return sendEvolutionDocument(inst.instanceId, to, base64, fileName, caption);
  return zapiDoc({ instanceId: inst.instanceId, token: inst.token, clientToken: inst.clientToken }, to, base64, fileName, caption);
}

/** Convenience: resolve + send text by instance id in one call. */
export async function sendTextByInstanceId(pool: Pool, id: string, to: string, message: string): Promise<WaResult> {
  const inst = await resolveInstance(pool, id);
  if (!inst) return { ok: false, error: 'Instância não encontrada ou inativa' };
  return sendInstanceText(inst, to, message);
}

// ── Instância OFICIAL da ONMID ───────────────────────────────────────────────
//
// ⚠️ Todo disparo feito EM NOME DA AGÊNCIA (aviso de lead no grupo do cliente,
// monitor de redes, alerta de saldo, rotina de termos, Luna) sai por UMA única
// instância: a "Onmid Assistente". Não é preferência de tela, é regra de
// servidor — decisão do Matheus em 29/09/2026, depois de ver um seletor que
// oferecia instâncias de CLIENTE (PicoLocos, SAAC) para um aviso da agência.
// Mandar recado da ONMID pelo WhatsApp de um cliente é erro que não tem
// desfazer: quem recebe vê o número errado e a conversa nasce no lugar errado.
//
// Escolher fica IMPOSSÍVEL por construção: quem envia não recebe id de
// instância, pede a oficial. O override existe só para o dia em que a agência
// trocar de número — e é uma linha em `system_settings`, não um menu.
export const CHAVE_INSTANCIA_ONMID = 'onmid_instancia_oficial';
const NOME_INSTANCIA_ONMID = 'Onmid Assistente';

export async function instanciaOnmid(pool: Pool): Promise<ResolvedInstance | null> {
  const porChave = await pool
    .query(`SELECT value FROM public.system_settings WHERE key = $1`, [CHAVE_INSTANCIA_ONMID])
    .catch(() => ({ rows: [] as Array<{ value: string }> }));
  const id = String(porChave.rows[0]?.value ?? '').trim();
  if (id) {
    const inst = await resolveInstance(pool, id);
    if (inst) return inst;
    // Id configurado que não resolve mais (instância apagada/desativada) não
    // pode virar silêncio: cai no nome, que é como a agência chama a linha.
  }
  const { rows } = await pool.query(
    `SELECT id, name, COALESCE(provider,'zapi') AS provider, instance_id, token, security_token
       FROM public.zapi_clients
      WHERE active = TRUE AND name ILIKE $1
      ORDER BY (name = $2) DESC, name
      LIMIT 1`,
    [`%onmid%assistente%`, NOME_INSTANCIA_ONMID],
  );
  const r = rows[0] as
    | { id: string; name: string; provider: string; instance_id: string; token: string; security_token: string | null }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    provider: r.provider === 'evolution' ? 'evolution' : 'zapi',
    instanceId: r.instance_id,
    token: r.token,
    clientToken: r.security_token ?? undefined,
  };
}

/** Manda texto pela instância oficial da ONMID. Sem escolha de remetente. */
export async function sendTextOnmid(pool: Pool, to: string, message: string): Promise<WaResult> {
  const inst = await instanciaOnmid(pool);
  if (!inst) {
    return { ok: false, error: `Instância oficial da ONMID ("${NOME_INSTANCIA_ONMID}") não encontrada ou inativa` };
  }
  return sendInstanceText(inst, to, message);
}
