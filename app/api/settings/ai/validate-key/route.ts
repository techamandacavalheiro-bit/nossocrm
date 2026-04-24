/**
 * POST /api/settings/ai/validate-key
 *
 * Validates a Google Gemini API key by making a server-side call to
 * generativelanguage.googleapis.com. Running this from the server avoids
 * the CORS restriction that blocks browsers from calling Google directly.
 *
 * Body: { apiKey: string, model: string }
 * Response: { valid: boolean, error?: string }
 */
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ValidateSchema = z.object({
  apiKey: z.string().min(10, 'Chave muito curta'),
  model: z.string().min(1),
});

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) {
    return json({ valid: false, error: 'Forbidden' }, 403);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ valid: false, error: 'Unauthorized' }, 401);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return json({ valid: false, error: 'Forbidden' }, 403);
  }

  const body = await req.json().catch(() => null);
  const parsed = ValidateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ valid: false, error: 'Chave muito curta' }, 400);
  }

  const { apiKey, model } = parsed.data;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: ctrl.signal,
      }
    ).finally(() => clearTimeout(timer));

    if (res.ok) {
      return json({ valid: true });
    }

    const errData = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };

    if (res.status === 400 && errData?.error?.message?.includes('API key not valid')) {
      return json({ valid: false, error: 'Chave de API inválida' });
    }
    if (res.status === 403) {
      return json({ valid: false, error: 'Chave sem permissão para este modelo' });
    }
    if (res.status === 429) {
      // Rate limit — chave é válida mas bateu limite
      return json({ valid: true });
    }
    return json({
      valid: false,
      error: errData?.error?.message || `Erro ao validar (${res.status})`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return json({ valid: false, error: `Falha ao contatar o Google: ${msg}` }, 500);
  }
}
