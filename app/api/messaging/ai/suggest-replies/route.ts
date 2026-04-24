/**
 * POST /api/messaging/ai/suggest-replies
 *
 * Gera 3 sugestões de resposta para uma conversa usando o modelo Gemini
 * configurado pela organização. O atendente vê as sugestões, escolhe uma
 * (e edita se quiser) antes de enviar — IA NUNCA envia automaticamente.
 *
 * Body: { conversationId: string }
 * Response: { suggestions: string[] }
 */
import { z } from 'zod';
import { generateObject } from 'ai';
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

const RequestSchema = z.object({
  conversationId: z.string().uuid(),
});

const SuggestionsSchema = z.object({
  suggestions: z
    .array(z.string().min(1).max(500))
    .min(2)
    .max(3)
    .describe('Lista de 2 ou 3 sugestões de resposta curtas e naturais.'),
});

const MAX_HISTORY_MESSAGES = 15;
const MAX_TEXT_LENGTH = 600; // truncate long messages to keep prompt small

interface DbMessage {
  direction: string;
  content_type: string;
  content: Record<string, unknown> | null;
  sender_name: string | null;
  created_at: string;
}

function summarizeMessage(m: DbMessage): string {
  const author = m.direction === 'outbound' ? 'ATENDENTE' : (m.sender_name || 'CLIENTE');
  const content = m.content || {};
  let text = '';

  switch (m.content_type) {
    case 'text':
      text = String(content.text ?? '');
      break;
    case 'image':
      text = `[IMAGEM] ${content.caption ?? ''}`.trim();
      break;
    case 'video':
      text = `[VÍDEO] ${content.caption ?? ''}`.trim();
      break;
    case 'audio':
      text = '[ÁUDIO]';
      break;
    case 'document':
      text = `[DOCUMENTO: ${content.fileName ?? 'arquivo'}]`;
      break;
    case 'location':
      text = `[LOCALIZAÇÃO]`;
      break;
    default:
      text = `[${m.content_type}]`;
  }

  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + '...';
  }

  return `${author}: ${text}`;
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'conversationId inválido' }, 400);
  }

  const { conversationId } = parsed.data;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) {
    return json({ error: 'Profile not found' }, 404);
  }

  // Verify user has access to this conversation (RLS-style check)
  const { data: conv } = await supabase
    .from('messaging_conversations')
    .select('id, organization_id, external_contact_name')
    .eq('id', conversationId)
    .eq('organization_id', profile.organization_id)
    .maybeSingle();

  if (!conv) {
    return json({ error: 'Conversa não encontrada' }, 404);
  }

  // Load org AI settings
  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('ai_enabled, ai_model, ai_google_key')
    .eq('organization_id', profile.organization_id)
    .single();

  if (orgSettings?.ai_enabled === false) {
    return json({ error: 'IA desativada na organização' }, 403);
  }

  const apiKey = orgSettings?.ai_google_key;
  if (!apiKey) {
    return json(
      { error: 'Chave Gemini não configurada. Configure em Configurações → Inteligência Artificial.' },
      400
    );
  }

  // Load recent message history (chronological)
  const { data: rawMessages, error: msgErr } = await supabase
    .from('messaging_messages')
    .select('direction, content_type, content, sender_name, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  if (msgErr) {
    return json({ error: msgErr.message }, 500);
  }

  const messages = (rawMessages ?? []).reverse() as DbMessage[];

  if (messages.length === 0) {
    return json({ error: 'Conversa vazia — sem contexto para sugerir' }, 400);
  }

  const conversationTranscript = messages.map(summarizeMessage).join('\n');
  const contactName = conv.external_contact_name || 'cliente';

  const systemPrompt = `Você é um copiloto de atendimento ao cliente que sugere respostas curtas e naturais para um atendente humano de uma barbearia. Você NÃO envia mensagens — apenas sugere.

Regras:
- Tom: cordial, profissional, brasileiro coloquial mas educado
- Use português do Brasil
- Cada sugestão deve ter no máximo 2 frases curtas
- Adapte ao contexto da conversa (se cliente quer agendar, oferecer horários; se reclamando, demonstrar empatia)
- NÃO invente informações que não estão no histórico (preços, horários, nomes de profissionais)
- Se faltar informação, sugira perguntas para esclarecer
- Gere 3 alternativas DIFERENTES de tom/abordagem (ex: uma direta, uma calorosa, uma com pergunta)
- Não use emojis em excesso (no máximo 1 por sugestão, e só quando fizer sentido)
- NÃO repita literalmente o que o cliente disse`;

  const userPrompt = `Histórico recente da conversa com ${contactName}:

${conversationTranscript}

Gere 3 sugestões de resposta para a próxima mensagem do ATENDENTE responder ao CLIENTE.`;

  try {
    const modelId = orgSettings?.ai_model || AI_DEFAULT_MODELS.google;
    const model = getModel('google', apiKey, modelId);

    const result = await generateObject({
      model,
      schema: SuggestionsSchema,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.8,
    });

    return json({ suggestions: result.object.suggestions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao gerar sugestões';
    console.error('[suggest-replies]', msg);
    return json({ error: `Falha ao gerar sugestões: ${msg}` }, 500);
  }
}
