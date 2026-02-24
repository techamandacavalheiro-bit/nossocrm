/**
 * POST /api/voice/whatsapp-call/initiate
 *
 * Initiate an outbound WhatsApp call (BIC).
 * 1. Verifica permissão BIC do contato
 * 2. Cria row em whatsapp_calls
 * 3. POST Meta API com SDP offer
 * 4. Cria voice_calls record
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { initiateCall } from '@/lib/voice/whatsapp-calling.service';

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { channelId, contactPhone, sdpOffer, contactId, contactName, dealId } = body;

  if (!channelId || !contactPhone || !sdpOffer) {
    return NextResponse.json(
      { error: 'channelId, contactPhone, and sdpOffer are required' },
      { status: 400 }
    );
  }

  // Get user profile for org
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Check instance feature flag — prevents calls even if UI was bypassed
  const { data: instanceFlags } = await supabase
    .from('instance_feature_flags')
    .select('whatsapp_calling_access')
    .eq('organization_id', profile.organization_id)
    .maybeSingle();

  if (!instanceFlags?.whatsapp_calling_access) {
    return NextResponse.json(
      { error: 'WhatsApp Calling API access not enabled for this organization.' },
      { status: 403 }
    );
  }

  // Get channel credentials + BIC permission in parallel
  const [channelResult, contactBicResult] = await Promise.all([
    supabase
      .from('messaging_channels')
      .select('id, credentials, settings, external_identifier')
      .eq('id', channelId)
      .eq('organization_id', profile.organization_id)
      .single(),
    contactId
      ? supabase
          .from('contacts')
          .select('call_permission_status')
          .eq('id', contactId)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const channel = channelResult.data;
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }

  const credentials = channel.credentials as Record<string, unknown>;
  const accessToken = credentials.accessToken as string;
  const phoneNumberId = credentials.phoneNumberId as string;

  if (!accessToken || !phoneNumberId) {
    return NextResponse.json(
      { error: 'Channel missing accessToken or phoneNumberId' },
      { status: 400 }
    );
  }

  // Check BIC permission (already fetched above)
  if (contactId && contactBicResult.data) {
    const contact = contactBicResult.data;
    const permStatus = (contact.call_permission_status || {}) as Record<string, any>;
    const channelPerm = permStatus[channelId];
    if (!channelPerm || channelPerm.status !== 'granted') {
      return NextResponse.json(
        { error: 'Call permission not granted for this contact' },
        { status: 403 }
      );
    }
    if (channelPerm.expiresAt && new Date(channelPerm.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: 'Call permission has expired' },
        { status: 403 }
      );
    }
  }

  try {
    // Insert whatsapp_calls record
    const { data: waCall, error: insertErr } = await supabase
      .from('whatsapp_calls')
      .insert({
        organization_id: profile.organization_id,
        channel_id: channelId,
        direction: 'outbound',
        caller_phone: channel.external_identifier,
        callee_phone: contactPhone,
        sdp_offer: sdpOffer,
        status: 'initiating',
        initiated_by: user.id,
        contact_id: contactId || null,
        contact_name: contactName || null,
      })
      .select('id')
      .single();

    if (insertErr) {
      throw insertErr;
    }

    // Call Meta API
    const waCallId = await initiateCall(accessToken, phoneNumberId, contactPhone, sdpOffer);

    // Update waCall + resolve conversation in parallel
    const [, convResult] = await Promise.all([
      supabase
        .from('whatsapp_calls')
        .update({ wa_call_id: waCallId, status: 'ringing' })
        .eq('id', waCall.id),
      contactId
        ? supabase
            .from('messaging_conversations')
            .select('id')
            .eq('channel_id', channelId)
            .eq('external_contact_id', contactPhone)
            .eq('status', 'open')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const conversationId = convResult.data?.id || null;

    // Create voice_calls record linked to deal + conversation
    const { data: voiceCall } = await supabase
      .from('voice_calls')
      .insert({
        organization_id: profile.organization_id,
        contact_id: contactId || null,
        deal_id: dealId || null,
        conversation_id: conversationId,
        mode: 'human_call',
        status: 'in_progress',
        initiated_by: user.id,
        channel: 'whatsapp',
        direction: 'outbound',
      })
      .select('id')
      .single();

    // Link voice_call to whatsapp_call
    if (voiceCall) {
      await supabase
        .from('whatsapp_calls')
        .update({ voice_call_id: voiceCall.id })
        .eq('id', waCall.id);
    }

    return NextResponse.json({
      callId: waCall.id,
      waCallId,
      voiceCallId: voiceCall?.id,
    });
  } catch (error) {
    console.error('[API] Initiate call error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initiate call' },
      { status: 500 }
    );
  }
}
