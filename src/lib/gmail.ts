import { google } from 'googleapis';

const BASE_URL = 'https://www.googleapis.com/gmail/v1/users/me/messages/send';

export interface GmailClient {
  email: string;
  refreshToken: string;
}

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

function buildRFC822(from: string, msg: EmailMessage): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const toHeader = msg.toName ? `"${msg.toName}" <${msg.to}>` : msg.to;

  const lines = [
    `From: ${from}`,
    `To: ${toHeader}`,
    `Subject: =?UTF-8?B?${Buffer.from(msg.subject).toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    msg.replyTo ? `Reply-To: ${msg.replyTo}` : null,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(msg.text ?? msg.html.replace(/<[^>]+>/g, '')).toString('base64'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(msg.html).toString('base64'),
    '',
    `--${boundary}--`,
  ].filter((l) => l !== null).join('\r\n');

  return Buffer.from(lines).toString('base64url');
}

export async function sendGmail(client: GmailClient, msg: EmailMessage): Promise<SendResult> {
  try {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: client.refreshToken });

    const { credentials } = await oauth2.refreshAccessToken();
    const accessToken = credentials.access_token;
    if (!accessToken) return { ok: false, error: 'Falha ao renovar access token' };

    const raw = buildRFC822(client.email, msg);

    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (res.ok) {
      const data = await res.json() as { id?: string };
      return { ok: true, messageId: data.id };
    }

    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return { ok: false, error: err.error?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
