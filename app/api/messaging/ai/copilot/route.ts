/**
 * POST /api/messaging/ai/copilot
 *
 * Copiloto de Vendas — IA assistente para o atendente humano. NUNCA envia
 * mensagens; apenas sugere/analisa.
 *
 * Body: {
 *   conversationId: string,
 *   action: 'suggest' | 'analyze' | 'objection' | 'ask',
 *   userInput?: string  // necessário para 'objection' e 'ask'
 * }
 *
 * Response:
 *   - 'suggest':  { type: 'suggestions', suggestions: string[] }
 *   - 'analyze':  { type: 'analysis', text: string }
 *   - 'objection':{ type: 'objection', text: string, suggestions: string[] }
 *   - 'ask':      { type: 'answer', text: string }
 */
import { z } from 'zod';
import { generateObject, generateText } from 'ai';
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
  action: z.enum(['suggest', 'analyze', 'objection', 'ask']),
  userInput: z.string().max(2000).optional(),
});

const SuggestionsSchema = z.object({
  suggestions: z.array(z.string().min(1).max(500)).min(2).max(3),
});

const ObjectionSchema = z.object({
  reframe: z.string().min(1).max(800),
  suggestions: z.array(z.string().min(1).max(400)).min(2).max(3),
});

const MAX_HISTORY = 20;
const MAX_TEXT = 600;

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
    case 'text': text = String(content.text ?? ''); break;
    case 'image': text = `[IMAGEM] ${content.caption ?? ''}`.trim(); break;
    case 'video': text = `[VÍDEO] ${content.caption ?? ''}`.trim(); break;
    case 'audio': text = '[ÁUDIO]'; break;
    case 'document': text = `[DOCUMENTO: ${content.fileName ?? 'arquivo'}]`; break;
    case 'location': text = `[LOCALIZAÇÃO]`; break;
    default: text = `[${m.content_type}]`;
  }
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '...';
  return `${author}: ${text}`;
}

const DEFAULT_SCRIPT = `Você é um copiloto de vendas. Tom de voz: cordial, profissional, brasileiro coloquial mas educado. Use português do Brasil. Mensagens curtas (1-3 frases). Nunca prometa resultados, nunca invente preços/horários, nunca substitua orientação profissional.`;

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Payload inválido' }, 400);

  const { conversationId, action } = parsed.data;
  const userInput = parsed.data.userInput?.trim() ?? '';

  // Profile / org
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!profile?.organization_id) return json({ error: 'Profile not found' }, 404);

  // Conversation + contact (RLS enforced by org filter)
  const { data: conv } = await supabase
    .from('messaging_conversations')
    .select('id, organization_id, external_contact_name, contact_id')
    .eq('id', conversationId)
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (!conv) return json({ error: 'Conversa não encontrada' }, 404);

  // Org AI settings + sales script
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
    return json(
      { error: 'Chave Gemini não configurada. Configure em Configurações → Inteligência Artificial.' },
      400
    );
  }

  const salesScript: string = orgSettings?.sales_script?.trim() || DEFAULT_SCRIPT;

  // Load contact info (name, tags, custom fields)
  let contactInfo = '';
  if (conv.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('name, email, phone, status, stage, tags, ltv')
      .eq('id', conv.contact_id)
      .maybeSingle();
    if (contact) {
      const lines: string[] = [];
      if (contact.name) lines.push(`Nome: ${contact.name}`);
      if (contact.email) lines.push(`Email: ${contact.email}`);
      if (contact.phone) lines.push(`Telefone: ${contact.phone}`);
      if (contact.status) lines.push(`Status: ${contact.status}`);
      if (contact.stage) lines.push(`Estágio: ${contact.stage}`);
      if (Array.isArray(contact.tags) && contact.tags.length > 0) {
        lines.push(`Tags: ${contact.tags.join(', ')}`);
      }
      if (contact.ltv != null) lines.push(`LTV: R$ ${Number(contact.ltv).toFixed(2)}`);
      contactInfo = lines.join('\n');
    }

    // Active deals for this contact
    const { data: deals } = await supabase
      .from('deals')
      .select('title, value, stage_id')
      .eq('contact_id', conv.contact_id)
      .eq('organization_id', profile.organization_id)
      .order('updated_at', { ascending: false })
      .limit(5);
    if (deals && deals.length > 0) {
      const dealLines = deals.map(d =>
        `- ${d.title}${d.value ? ` (R$ ${Number(d.value).toFixed(2)})` : ''}`
      );
      contactInfo += '\n\nDeals ativos:\n' + dealLines.join('\n');
    }
  }

  // Conversation history
  const { data: rawMessages } = await supabase
    .from('messaging_messages')
    .select('direction, content_type, content, sender_name, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY);

  const messages = (rawMessages ?? []).reverse() as DbMessage[];
  const transcript = messages.length > 0
    ? messages.map(summarizeMessage).join('\n')
    : '(conversa vazia)';

  const contextBlock = `
## Script de vendas / instruções da empresa
${salesScript}

## Dados do contato
${contactInfo || '(sem dados extras)'}

## Histórico recente da conversa
${transcript}
`.trim();

  try {
    const modelId = orgSettings?.ai_model || AI_DEFAULT_MODELS.google;
    const model = getModel('google', apiKey, modelId);

    if (action === 'suggest') {
      const result = await generateObject({
        model,
        schema: SuggestionsSchema,
        system: `Você é um copiloto que ajuda o atendente a responder. Gere 3 alternativas DIFERENTES de tom (direta / calorosa / com pergunta esclarecedora). Mensagens curtas, no máximo 2 frases. Siga o script de vendas e os dados do contato. NÃO invente preços/horários.\n\n${contextBlock}`,
        prompt: 'Gere 3 sugestões de resposta para o atendente enviar agora ao cliente.',
        temperature: 0.8,
      });
      return json({ type: 'suggestions', suggestions: result.object.suggestions });
    }

    if (action === 'analyze') {
      const result = await generateText({
        model,
        system: `Você é um copiloto de vendas. Analise a conversa de forma OBJETIVA e CURTA (máx 8 linhas). Use estes blocos:

🌡️ **Temperatura**: (frio / morno / quente / pronto pra fechar)
🎯 **Intenção atual**: (em 1 frase)
⚠️ **Objeções/Bloqueios**: (lista curta — vazio se nenhum)
✅ **Próximo passo recomendado**: (ação concreta)
📊 **Confiança**: (baixa / média / alta) com justificativa breve

Siga o script da empresa e os dados do contato.\n\n${contextBlock}`,
        prompt: 'Faça a análise agora.',
        temperature: 0.4,
      });
      return json({ type: 'analysis', text: result.text });
    }

    if (action === 'objection') {
      if (!userInput) return json({ error: 'Cole a objeção do cliente no campo' }, 400);
      const result = await generateObject({
        model,
        schema: ObjectionSchema,
        system: `Você ajuda o atendente a contornar objeções de venda. Use o script e os dados do contato. Para a objeção informada:
1. 'reframe': explique em 1-2 frases o ângulo correto pra reformular essa objeção
2. 'suggestions': 2-3 respostas curtas prontas pro atendente enviar (estilo WhatsApp)\n\n${contextBlock}`,
        prompt: `Objeção do cliente: "${userInput}"\n\nGere o reframe + sugestões.`,
        temperature: 0.7,
      });
      return json({
        type: 'objection',
        text: result.object.reframe,
        suggestions: result.object.suggestions,
      });
    }

    if (action === 'ask') {
      if (!userInput) return json({ error: 'Digite sua pergunta' }, 400);
      const result = await generateText({
        model,
        system: `Você é um copiloto que responde dúvidas do atendente sobre o cliente atual. Use APENAS as informações disponíveis no histórico, nos dados do contato e no script. Se a informação não estiver disponível, diga claramente "não tenho essa informação". Resposta curta e direta.\n\n${contextBlock}`,
        prompt: `Pergunta do atendente: "${userInput}"`,
        temperature: 0.3,
      });
      return json({ type: 'answer', text: result.text });
    }

    return json({ error: 'Ação não suportada' }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[ai/copilot]', msg);
    return json({ error: `Falha na IA: ${msg}` }, 500);
  }
}
