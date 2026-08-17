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
