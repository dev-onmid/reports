function base(): string {
  const url = process.env.EVOLUTION_API_URL;
  if (!url) throw new Error('EVOLUTION_API_URL não configurada no servidor');
  return url.replace(/\/$/, '');
}

function apiKey(): string {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error('EVOLUTION_API_KEY não configurada no servidor');
  return key;
}

function headers() {
  return { 'Content-Type': 'application/json', apikey: apiKey() };
}

export interface EvolutionQrCode {
  base64?: string;
  code?: string;
}

export interface EvolutionState {
  state: 'open' | 'close' | 'connecting' | string;
}

export async function createEvolutionInstance(
  instanceName: string,
): Promise<{ instanceName: string; hash: string }> {
  const res = await fetch(`${base()}/instance/create`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ instanceName, integration: 'WHATSAPP-BAILEYS' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(err.message ?? err.error ?? `HTTP ${res.status}`));
  }
  const data = await res.json() as {
    instance: { instanceName: string };
    hash: string;
  };
  return { instanceName: data.instance.instanceName, hash: data.hash };
}

export async function getEvolutionQrCode(instanceName: string): Promise<EvolutionQrCode> {
  const res = await fetch(`${base()}/instance/connect/${instanceName}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<EvolutionQrCode>;
}

export async function getEvolutionState(instanceName: string): Promise<EvolutionState> {
  const res = await fetch(`${base()}/instance/connectionState/${instanceName}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { instance?: { state?: string }; state?: string };
  return { state: data.instance?.state ?? data.state ?? 'unknown' };
}

export async function deleteEvolutionInstance(instanceName: string): Promise<void> {
  await fetch(`${base()}/instance/delete/${instanceName}`, {
    method: 'DELETE',
    headers: headers(),
  }).catch(() => {});
}
