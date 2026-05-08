"use client";

export type ClientAccountLink = {
  id: string;
  clientId: string;
  platform: string;
  connectionId?: string;
  accountId: string;
  accountName?: string;
  currency: string;
  createdAt: string;
};

export async function loadClientLinks(clientId: string): Promise<ClientAccountLink[]> {
  const res = await fetch(`/api/clients/${clientId}/links`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<ClientAccountLink[]>;
}

export async function addClientLink(
  clientId: string,
  link: { platform: string; connectionId?: string; accountId: string; accountName?: string; currency?: string }
): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(link),
  });
  if (!res.ok && res.status !== 409) throw new Error(await res.text());
}

export async function removeClientLink(clientId: string, linkId: string): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/links?linkId=${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await res.text());
}
