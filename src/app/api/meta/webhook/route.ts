import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

// ── DB bootstrap ──────────────────────────────────────────────────────────────

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.meta_webhook_config (
      id TEXT PRIMARY KEY DEFAULT 'global',
      verify_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex')
    );
    INSERT INTO public.meta_webhook_config (id) VALUES ('global') ON CONFLICT DO NOTHING;

    CREATE TABLE IF NOT EXISTS public.meta_automations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT,
      account_id TEXT NOT NULL,
      account_name TEXT,
      platform TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      keyword TEXT,
      action TEXT NOT NULL,
      reply_message TEXT NOT NULL,
      dm_message TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_meta_automations_account ON public.meta_automations (account_id);

    CREATE TABLE IF NOT EXISTS public.meta_automation_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id UUID,
      platform TEXT,
      event_type TEXT,
      account_id TEXT,
      sender_id TEXT,
      trigger_text TEXT,
      action_taken TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      error_msg TEXT,
      triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_meta_automation_logs_triggered ON public.meta_automation_logs (triggered_at DESC);
  `);
}

// ── Meta API helpers ──────────────────────────────────────────────────────────

// Get page-level access token (needed for page operations)
async function getPageToken(userToken: string, accountId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token&access_token=${userToken}&limit=100`
    );
    if (!res.ok) return userToken;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as { data?: any[] };
    const page = (data.data ?? []).find((p) => p.id === accountId);
    return page?.access_token ?? userToken;
  } catch {
    return userToken;
  }
}

async function replyToInstagramComment(commentId: string, message: string, token: string) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${commentId}/replies?access_token=${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) }
  );
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: { message?: string } }).error?.message ?? 'Erro ao responder comentário IG');
  return json;
}

async function replyToFacebookComment(commentId: string, message: string, token: string) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${commentId}/comments?access_token=${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) }
  );
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: { message?: string } }).error?.message ?? 'Erro ao responder comentário FB');
  return json;
}

async function sendInstagramDM(igUserId: string, recipientId: string, message: string, token: string) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/messages?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message } }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: { message?: string } }).error?.message ?? 'Erro ao enviar DM IG');
  return json;
}

async function sendFacebookDM(pageId: string, recipientPsid: string, message: string, token: string) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${pageId}/messages?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientPsid }, message: { text: message } }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: { message?: string } }).error?.message ?? 'Erro ao enviar DM FB');
  return json;
}

// ── Rule matching ─────────────────────────────────────────────────────────────

type Automation = {
  id: string;
  account_id: string;
  platform: string;
  trigger_type: string;
  keyword: string | null;
  action: string;
  reply_message: string;
  dm_message: string | null;
};

function matchesTrigger(auto: Automation, eventType: 'comment' | 'dm', text: string): boolean {
  if (eventType === 'comment') {
    if (auto.trigger_type === 'any_comment') return true;
    if (auto.trigger_type === 'keyword_comment' && auto.keyword) {
      return text.toLowerCase().includes(auto.keyword.toLowerCase());
    }
  }
  if (eventType === 'dm') {
    if (auto.trigger_type === 'any_dm') return true;
    if (auto.trigger_type === 'keyword_dm' && auto.keyword) {
      return text.toLowerCase().includes(auto.keyword.toLowerCase());
    }
  }
  return false;
}

// ── Event processors ──────────────────────────────────────────────────────────

async function processInstagramComment(
  pool: ReturnType<typeof makeServerPool>,
  accountId: string,
  commentId: string,
  text: string,
  senderId: string,
  userToken: string,
) {
  const { rows: automations } = await pool.query<Automation>(
    `SELECT * FROM public.meta_automations WHERE account_id = $1 AND platform = 'instagram' AND enabled = true`,
    [accountId]
  );

  for (const auto of automations) {
    if (!matchesTrigger(auto, 'comment', text)) continue;

    let status = 'success';
    let errorMsg: string | null = null;
    let actionTaken = '';

    try {
      const token = await getPageToken(userToken, accountId);

      if (auto.action === 'reply_comment' || auto.action === 'reply_and_dm') {
        await replyToInstagramComment(commentId, auto.reply_message, token);
        actionTaken = 'replied_comment';
      }
      if ((auto.action === 'send_dm' || auto.action === 'reply_and_dm') && senderId) {
        const dmMsg = auto.dm_message ?? auto.reply_message;
        await sendInstagramDM(accountId, senderId, dmMsg, token);
        actionTaken = actionTaken ? 'replied_comment+dm' : 'sent_dm';
      }
    } catch (e) {
      status = 'error';
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    await pool.query(
      `INSERT INTO public.meta_automation_logs
         (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status, error_msg)
       VALUES ($1,'instagram','comment',$2,$3,$4,$5,$6,$7)`,
      [auto.id, accountId, senderId, text, actionTaken, status, errorMsg]
    );
  }
}

async function processInstagramDM(
  pool: ReturnType<typeof makeServerPool>,
  accountId: string,
  senderId: string,
  text: string,
  userToken: string,
) {
  // Ignore echo messages (bot's own messages)
  if (senderId === accountId) return;

  const { rows: automations } = await pool.query<Automation>(
    `SELECT * FROM public.meta_automations WHERE account_id = $1 AND platform = 'instagram' AND enabled = true`,
    [accountId]
  );

  for (const auto of automations) {
    if (!matchesTrigger(auto, 'dm', text)) continue;

    let status = 'success';
    let errorMsg: string | null = null;

    try {
      const token = await getPageToken(userToken, accountId);
      const msg = auto.dm_message ?? auto.reply_message;
      await sendInstagramDM(accountId, senderId, msg, token);
    } catch (e) {
      status = 'error';
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    await pool.query(
      `INSERT INTO public.meta_automation_logs
         (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status, error_msg)
       VALUES ($1,'instagram','dm',$2,$3,$4,'sent_dm',$5,$6)`,
      [auto.id, accountId, senderId, text, status, errorMsg]
    );
  }
}

async function processFacebookComment(
  pool: ReturnType<typeof makeServerPool>,
  pageId: string,
  commentId: string,
  text: string,
  senderId: string,
  userToken: string,
) {
  const { rows: automations } = await pool.query<Automation>(
    `SELECT * FROM public.meta_automations WHERE account_id = $1 AND platform = 'facebook' AND enabled = true`,
    [pageId]
  );

  for (const auto of automations) {
    if (!matchesTrigger(auto, 'comment', text)) continue;

    let status = 'success';
    let errorMsg: string | null = null;
    let actionTaken = '';

    try {
      const pageToken = await getPageToken(userToken, pageId);

      if (auto.action === 'reply_comment' || auto.action === 'reply_and_dm') {
        await replyToFacebookComment(commentId, auto.reply_message, pageToken);
        actionTaken = 'replied_comment';
      }
      if ((auto.action === 'send_dm' || auto.action === 'reply_and_dm') && senderId) {
        const dmMsg = auto.dm_message ?? auto.reply_message;
        await sendFacebookDM(pageId, senderId, dmMsg, pageToken);
        actionTaken = actionTaken ? 'replied_comment+dm' : 'sent_dm';
      }
    } catch (e) {
      status = 'error';
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    await pool.query(
      `INSERT INTO public.meta_automation_logs
         (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status, error_msg)
       VALUES ($1,'facebook','comment',$2,$3,$4,$5,$6,$7)`,
      [auto.id, pageId, senderId, text, actionTaken, status, errorMsg]
    );
  }
}

async function processFacebookDM(
  pool: ReturnType<typeof makeServerPool>,
  pageId: string,
  senderId: string,
  text: string,
  userToken: string,
) {
  if (senderId === pageId) return;

  const { rows: automations } = await pool.query<Automation>(
    `SELECT * FROM public.meta_automations WHERE account_id = $1 AND platform = 'facebook' AND enabled = true`,
    [pageId]
  );

  for (const auto of automations) {
    if (!matchesTrigger(auto, 'dm', text)) continue;

    let status = 'success';
    let errorMsg: string | null = null;

    try {
      const pageToken = await getPageToken(userToken, pageId);
      const msg = auto.dm_message ?? auto.reply_message;
      await sendFacebookDM(pageId, senderId, msg, pageToken);
    } catch (e) {
      status = 'error';
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    await pool.query(
      `INSERT INTO public.meta_automation_logs
         (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status, error_msg)
       VALUES ($1,'facebook','dm',$2,$3,$4,'sent_dm',$5,$6)`,
      [auto.id, pageId, senderId, text, status, errorMsg]
    );
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET: Meta webhook verification
export async function GET(request: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows: [cfg] } = await pool.query(`SELECT verify_token FROM public.meta_webhook_config WHERE id = 'global'`);
    const verifyToken = cfg?.verify_token ?? '';

    const mode      = request.nextUrl.searchParams.get('hub.mode');
    const token     = request.nextUrl.searchParams.get('hub.verify_token');
    const challenge = request.nextUrl.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  } finally {
    await pool.end();
  }
}

// POST: Incoming Meta events
export async function POST(request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await request.json() as any;
  const pool = makeServerPool();

  try {
    await ensureTables(pool);

    // Log every incoming POST for debugging (object type + raw payload summary)
    await pool.query(
      `INSERT INTO public.meta_automation_logs
         (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status)
       VALUES (NULL, $1, 'raw_post', 'webhook', '', $2, 'received', 'debug')`,
      [body.object ?? 'unknown', JSON.stringify(body).slice(0, 500)]
    ).catch(() => null);

    // Get user token from the first connected Meta account
    const { rows: [conn] } = await pool.query(
      `SELECT * FROM public.meta_connections WHERE status = 'connected' LIMIT 1`
    );
    if (!conn) return Response.json({ ok: true });
    const userToken = await getFreshMetaToken(conn);

    const entries = body.entry ?? [];

    for (const entry of entries) {
      const entryId: string = entry.id ?? '';

      // ── Instagram events ──
      if (body.object === 'instagram') {
        for (const change of (entry.changes ?? [])) {
          if (change.field === 'comments') {
            const v = change.value;
            // Log raw event even if no automation matches
            await pool.query(
              `INSERT INTO public.meta_automation_logs
                 (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status)
               VALUES (NULL,'instagram','comment',$1,$2,$3,'received','ignored')`,
              [entryId, v.from?.id ?? '', v.text ?? '']
            ).catch(() => null);
            await processInstagramComment(pool, entryId, v.id, v.text ?? '', v.from?.id ?? '', userToken);
          }
        }
        for (const msg of (entry.messaging ?? [])) {
          if (msg.message?.text) {
            await pool.query(
              `INSERT INTO public.meta_automation_logs
                 (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status)
               VALUES (NULL,'instagram','dm',$1,$2,$3,'received','ignored')`,
              [entryId, msg.sender?.id ?? '', msg.message.text]
            ).catch(() => null);
            await processInstagramDM(pool, entryId, msg.sender?.id ?? '', msg.message.text, userToken);
          }
        }
      }

      // ── Facebook Page events ──
      if (body.object === 'page') {
        for (const change of (entry.changes ?? [])) {
          if (change.field === 'feed' && change.value?.item === 'comment') {
            const v = change.value;
            await pool.query(
              `INSERT INTO public.meta_automation_logs
                 (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status)
               VALUES (NULL,'facebook','comment',$1,$2,$3,'received','ignored')`,
              [entryId, v.from?.id ?? '', v.message ?? '']
            ).catch(() => null);
            await processFacebookComment(pool, entryId, v.comment_id ?? v.id, v.message ?? '', v.from?.id ?? '', userToken);
          }
        }
        for (const msg of (entry.messaging ?? [])) {
          if (msg.message?.text) {
            await pool.query(
              `INSERT INTO public.meta_automation_logs
                 (automation_id, platform, event_type, account_id, sender_id, trigger_text, action_taken, status)
               VALUES (NULL,'facebook','dm',$1,$2,$3,'received','ignored')`,
              [entryId, msg.sender?.id ?? '', msg.message.text]
            ).catch(() => null);
            await processFacebookDM(pool, entryId, msg.sender?.id ?? '', msg.message.text, userToken);
          }
        }
      }
    }

    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
