export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendInstagramDM(
  igUserId: string,
  recipientId: string,
  message: string,
  token: string,
): Promise<SendResult> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: message },
          messaging_type: 'MESSAGE_TAG',
          tag: 'ACCOUNT_UPDATE',
          access_token: token,
        }),
      },
    );
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return { ok: false, error: body.error?.message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
