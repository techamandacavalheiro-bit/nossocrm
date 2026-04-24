import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { ChannelProviderFactory } from '@/lib/messaging';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PROVIDER_TO_WEBHOOK_FN: Record<string, string> = {
  'z-api': 'messaging-webhook-zapi',
  'evolution': 'messaging-webhook-evolution',
  'uazapi': 'messaging-webhook-uazapi',
  'meta-cloud': 'messaging-webhook-meta',
  'meta': 'messaging-webhook-meta',
  'resend': 'messaging-webhook-resend',
};

/**
 * POST /api/messaging/channels/[id]/configure-webhook
 *
 * Registra automaticamente a URL do webhook do Cavalheiro Experience
 * na instância do provider (UazAPI, Evolution, Z-API).
 *
 * Necessário porque providers como UazAPI exigem que o webhook seja
 * registrado via API antes de começar a receber mensagens.
 */
export async function POST(req: Request, { params }: RouteParams) {
  if (!isAllowedOrigin(req)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const { id: channelId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.organization_id) {
    return json({ error: 'Profile not found' }, 404);
  }

  if (profile.role !== 'admin') {
    return json({ error: 'Forbidden - Admin access required' }, 403);
  }

  const { data: channel, error: channelError } = await supabase
    .from('messaging_channels')
    .select('id, channel_type, provider, external_identifier, credentials')
    .eq('id', channelId)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .single();

  if (channelError || !channel) {
    return json({ error: 'Channel not found' }, 404);
  }

  const webhookFn = PROVIDER_TO_WEBHOOK_FN[channel.provider];
  if (!webhookFn) {
    return json({ error: `Provider "${channel.provider}" does not support webhook auto-config` }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return json({ error: 'NEXT_PUBLIC_SUPABASE_URL not configured' }, 500);
  }

  const webhookUrl = `${supabaseUrl}/functions/v1/${webhookFn}/${channelId}`;

  // Validate credentials shape before instantiating the provider so users
  // get a clear 400 instead of a vague 500 when the channel was saved
  // with missing fields.
  const credentials = (channel.credentials ?? {}) as Record<string, unknown>;
  if (!credentials || typeof credentials !== 'object' || Object.keys(credentials).length === 0) {
    return json({
      success: false,
      error: 'Canal sem credenciais configuradas. Edite o canal e preencha as credenciais antes de configurar o webhook.',
    }, 400);
  }

  let provider: Awaited<ReturnType<typeof ChannelProviderFactory.createProvider>>;
  try {
    provider = ChannelProviderFactory.createProvider(channel.channel_type, channel.provider);
  } catch (err) {
    return json({
      success: false,
      error: `Provider "${channel.provider}" não está disponível: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
    }, 400);
  }

  // Run provider-level validation if available (each provider implements
  // validateConfig() to check required fields like serverUrl/token).
  if ('validateConfig' in provider && typeof (provider as { validateConfig?: unknown }).validateConfig === 'function') {
    const validation = (provider as { validateConfig: (cfg: unknown) => { valid: boolean; errors?: Array<{ field: string; message: string }> } }).validateConfig({
      channelId: channel.id,
      channelType: channel.channel_type,
      provider: channel.provider,
      externalIdentifier: channel.external_identifier,
      credentials,
    });
    if (!validation.valid) {
      return json({
        success: false,
        error: 'Credenciais inválidas',
        details: validation.errors,
      }, 400);
    }
  }

  if (!('configureWebhook' in provider) || typeof (provider as { configureWebhook?: unknown }).configureWebhook !== 'function') {
    return json({
      success: false,
      error: `O provider "${channel.provider}" não suporta configuração automática de webhook. Configure manualmente seguindo as instruções na tela.`,
      webhookUrl,
    }, 400);
  }

  try {
    await provider.initialize({
      channelId: channel.id,
      channelType: channel.channel_type,
      provider: channel.provider,
      externalIdentifier: channel.external_identifier,
      credentials: credentials as Record<string, string>,
    });

    const result = await (provider as { configureWebhook: (url: string) => Promise<{ success: boolean; error?: string }> }).configureWebhook(webhookUrl);

    if (!result.success) {
      return json({ success: false, error: result.error || 'Falha ao configurar webhook no provider', webhookUrl }, 502);
    }

    return json({ success: true, webhookUrl });
  } catch (error) {
    console.error('Error configuring webhook:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Falha ao configurar webhook',
      webhookUrl,
    }, 500);
  }
}
