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

/**
 * POST /api/messaging/channels/[id]/sync-status
 *
 * Força sincronização do status do canal chamando getStatus() no provider
 * e atualizando messaging_channels.status no banco.
 *
 * Útil quando o status local está desatualizado (ex: instância já conectou
 * antes do webhook ser registrado, então não chegou evento de connection_update).
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
    .select('id, channel_type, provider, external_identifier, credentials, status')
    .eq('id', channelId)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .single();

  if (channelError || !channel) {
    return json({ error: 'Channel not found' }, 404);
  }

  try {
    const provider = ChannelProviderFactory.createProvider(channel.channel_type, channel.provider);

    await provider.initialize({
      channelId: channel.id,
      channelType: channel.channel_type,
      provider: channel.provider,
      externalIdentifier: channel.external_identifier,
      credentials: channel.credentials as Record<string, string>,
    });

    const statusResult = await provider.getStatus();

    await supabase
      .from('messaging_channels')
      .update({
        status: statusResult.status,
        status_message: statusResult.message ?? null,
        last_connected_at: statusResult.status === 'connected' ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId);

    return json({
      success: true,
      previousStatus: channel.status,
      currentStatus: statusResult.status,
      message: statusResult.message,
    });
  } catch (error) {
    console.error('Error syncing channel status:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync status',
    }, 500);
  }
}
