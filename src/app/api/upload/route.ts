import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client with service role key (bypasses RLS for storage).
// Requires SUPABASE_SERVICE_ROLE_KEY in env vars (different from the anon key).
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

const BUCKET = 'crm-media';
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// Decodes a JWT payload without verifying the signature — used only to compare
// claims (project ref / role) for diagnostics, never to trust the token.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// GET /api/upload — diagnostic only, exposes no secrets. Confirms the service
// role key actually belongs to the same Supabase project as the configured URL.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const urlRef = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
  const payload = key ? decodeJwtPayload(key) : null;
  return Response.json({
    hasUrl: Boolean(url),
    hasKey: Boolean(key),
    urlProjectRef: urlRef,
    keyProjectRef: (payload?.ref as string | undefined) ?? null,
    keyRole: (payload?.role as string | undefined) ?? null,
    keyLooksValidJwt: Boolean(payload),
    projectRefsMatch: Boolean(urlRef && payload?.ref && urlRef === payload.ref),
  });
}

export async function POST(req: NextRequest) {
  const supabase = getServiceClient();
  if (!supabase) {
    return Response.json({
      error: 'Supabase não configurado para uploads. Adicione SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente da Vercel e crie um bucket público chamado "crm-media" no Supabase Storage.',
    }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: 'Envie o arquivo como multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) return Response.json({ error: 'Campo "file" ausente' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `Arquivo muito grande (máx 50 MB)` }, { status: 413 });
  }

  // Ensure bucket exists (idempotent)
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => null);

  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    return Response.json({ error: `Falha no upload: ${error.message}` }, { status: 500 });
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return Response.json({ url: publicUrl });
}
