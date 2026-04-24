/**
 * POST /api/messaging/ai/improve
 *
 * Reescreve o rascunho do atendente em um tom específico, usando o script
 * de vendas da organização e o contexto recente da conversa. Atendente
 * revisa e envia — IA NUNCA envia direto.
 *
 * Body: {
 *   conversationId: string,
 *   draft: string,
 *   tone: 'general' | 'professional' | 'casual' | 'shorter' | 'empathetic'
 * }
 *
 * Response: { improved: string }
 */
import { z } from 'zod';
import { generateText } from 'ai';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getModel } from '@/lib/ai/config';
import { AI_DEFAULT_MODELS } from '@/lib/ai/defaults';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ToneEnum = z.enum(['general', 'professional', 'casual', 'shorter', 'empathetic']);

const RequestSchema = z.object({
  conversationId: z.string().uuid(),
  draft: z.string().min(1, 'Rascunho vazio').max(4000, 'Rascunho muito longo'),
  tone: ToneEnum.default('general'),
});

type Tone = z.infer<typeof ToneEnum>;

const TONE_INSTRUCTIONS: Record<Tone, string> = {
  general:
    'Melhore a redação, clareza, gramática e fluidez. Mantenha o sentido e o tom original do atendente.',
  professional:
    'Reescreva em tom mais profissional e formal, mantendo cordialidade. Sem gírias. Preserve a intenção original.',
  casual:
    'Reescreva em tom mais casual, leve e amigável — como uma conversa de WhatsApp natural. Pode usar gírias brasileiras aceitáveis ("boa", "fechado", "beleza").',
  shorter:
    'Reescreva mais curto e direto, cortando redundâncias. Máximo 2 frases. Preserve a informação essencial.',
  empathetic:
    'Reescreva demonstrando mais empatia e escuta ativa. Reconheça os sentimentos/dúvidas do cliente antes de responder. Mantenha-se natural, sem piegas.',
};

const MAX_HISTORY = 10;
const MAX_TEXT = 400;

interface DbMessage {
  direction: string;
  content_type: string;
  content: Record<string, unknown> | null;
  sender_name: string | null;
}

function summarizeMessage(m: DbMessage): string {
  const author = m.direction === 'outbound' ? 'ATENDENTE' : (m.sender_name || 'CLIENTE');
  const content = m.content || {};
  let text = '';
  switch (m.content_type) {
    case 'text': text = String(content.text ?? ''); break;
    case 'image': text = `[IMAGEM] ${content.caption ?? ''}`.trim(); break;
    case 'video': text = `[VÍDEO] ${content.caption ?? ''}`.trim(); break;
    case 'audio': text = '[ÁUDIO]'; break;
    case 'document': text = `[DOC: ${content.fileName ?? 'arquivo'}]`; break;
    default: text = `[${m.content_type}]`;
  }
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '...';
  return `${author}: ${text}`;
}

const DEFAULT_SCRIPT = 'Você é um copiloto de vendas. Tom: cordial, profissional, brasileiro coloquial. Mensagens curtas (1-3 frases). Nunca invente preços/horários.';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return json({ error: firstIssue?.message || 'Dados inválidos' }, 400);
  }

  const { conversationId, draft, tone } = parsed.data;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!profile?.organization_id) return json({ error: 'Profile not found' }, 404);

  const { data: conv } = await supabase
    .from('messaging_conversations')
    .select('id, organization_id, external_contact_name, contact_id')
    .eq('id', conversationId)
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (!conv) return json({ error: 'Conversa não encontrada' }, 404);

  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('ai_enabled, ai_model, ai_google_key, sales_script')
    .eq('organization_id', profile.organization_id)
    .single();

  if (orgSettings?.ai_enabled === false) {
    return json({ error: 'IA desativada na organização' }, 403);
  }
  const apiKey = orgSettings?.ai_google_key;
  if (!apiKey) {
    return json({ error: 'Chave Gemini não configurada.' }, 400);
  }

  const salesScript: string = orgSettings?.sales_script?.trim() || DEFAULT_SCRIPT;

  // Minimal context — last few messages for tone consistency
  const { data: rawMessages } = await supabase
    .from('messaging_messages')
    .select('direction, content_type, content, sender_name')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY);

  const recentContext = (rawMessages ?? [])
    .reverse()
    .map((m) => summarizeMessage(m as DbMessage))
    .join('\n');

  try {
    const modelId = orgSettings?.ai_model || AI_DEFAULT_MODELS.google;
    const model = getModel('google', apiKey, modelId);

    const systemPrompt = `Você é um copiloto de redação para atendentes de vendas. Sua tarefa: PEGAR o rascunho do atendente e REESCREVER seguindo a instrução de tom.

Regras invioláveis:
- Responda APENAS com o texto reescrito. Sem explicações, sem aspas, sem markdown.
- Mantenha em português do Brasil.
- NUNCA invente dados (preços, horários, nomes, produtos) que não estão no rascunho ou contexto.
- Preserve 100% da intenção do atendente — você só polui a redação.
- Se o rascunho já estiver perfeito, devolva algo muito similar (pode ser igual).

## Script de vendas da empresa
${salesScript}

## Contexto recente da conversa
${recentContext || '(sem histórico)'}

## Instrução de tom para esta reescrita
${TONE_INSTRUCTIONS[tone]}`;

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: `Reescreva este rascunho do atendente: "${draft}"`,
      temperature: 0.5,
    });

    // Strip any surrounding quotes the model might have added defensively
    const improved = result.text.trim().replace(/^["'""]+|["'""]+$/g, '').trim();

    if (!improved) {
      return json({ error: 'IA retornou resposta vazia' }, 500);
    }

    return json({ improved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[ai/improve]', msg);
    return json({ error: `Falha na IA: ${msg}` }, 500);
  }
}
