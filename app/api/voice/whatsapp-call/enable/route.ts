/**
 * POST /api/voice/whatsapp-call/enable
 *
 * Enable WhatsApp calling on a phone number via Meta API settings.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { enableCalling } from '@/lib/voice/whatsapp-calling.service';

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { channelId } = body;

  if (!channelId) {
    return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
  }

  // Get profile for org + admin check
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  // Check instance feature flag — only orgs approved by the operator can use calling
  const { data: instanceFlags } = await supabase
    .from('instance_feature_flags')
    .select('whatsapp_calling_access')
    .eq('organization_id', profile.organization_id)
    .maybeSingle();

  if (!instanceFlags?.whatsapp_calling_access) {
    return NextResponse.json(
      { error: 'WhatsApp Calling API access not enabled for this organization. Contact support.' },
      { status: 403 }
    );
  }

  // Get channel
  const { data: channel } = await supabase
    .from('messaging_channels')
    .select('id, credentials, settings')
    .eq('id', channelId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }

  const credentials = channel.credentials as Record<string, unknown>;
  const accessToken = credentials.accessToken as string;
  const phoneNumberId = credentials.phoneNumberId as string;

  if (!accessToken || !phoneNumberId) {
    return NextResponse.json(
      { error: 'Channel missing credentials' },
      { status: 400 }
    );
  }

  try {
    await enableCalling(accessToken, phoneNumberId);

    // Update channel settings to mark calling as enabled
    const settings = (channel.settings || {}) as Record<string, unknown>;
    await supabase
      .from('messaging_channels')
      .update({
        settings: { ...settings, callingEnabled: true },
      })
      .eq('id', channelId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API] Enable calling error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to enable calling' },
      { status: 500 }
    );
  }
}
