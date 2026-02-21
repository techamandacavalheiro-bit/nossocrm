/**
 * POST /api/voice/whatsapp-call/[action]
 *
 * Handle accept, reject, and terminate actions for WhatsApp calls.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  preAcceptCall,
  acceptCall,
  rejectCall,
  terminateCall,
} from '@/lib/voice/whatsapp-calling.service';

type ActionType = 'accept' | 'reject' | 'terminate';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;
  const validActions: ActionType[] = ['accept', 'reject', 'terminate'];

  if (!validActions.includes(action as ActionType)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { callId, sdpAnswer } = body;

  if (!callId) {
    return NextResponse.json({ error: 'callId is required' }, { status: 400 });
  }

  // Get profile for org check
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Get the call record
  const { data: waCall } = await supabase
    .from('whatsapp_calls')
    .select('id, wa_call_id, channel_id, voice_call_id')
    .eq('wa_call_id', callId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!waCall) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  // Get channel credentials
  const { data: channel } = await supabase
    .from('messaging_channels')
    .select('credentials')
    .eq('id', waCall.channel_id)
    .single();

  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }

  const credentials = channel.credentials as Record<string, unknown>;
  const accessToken = credentials.accessToken as string;
  const phoneNumberId = credentials.phoneNumberId as string;

  try {
    switch (action as ActionType) {
      case 'accept': {
        if (!sdpAnswer) {
          return NextResponse.json(
            { error: 'sdpAnswer is required for accept' },
            { status: 400 }
          );
        }

        // Two-step accept: pre_accept then accept
        await preAcceptCall(accessToken, phoneNumberId, callId, sdpAnswer);
        await acceptCall(accessToken, phoneNumberId, callId, sdpAnswer);

        await supabase
          .from('whatsapp_calls')
          .update({
            status: 'connected',
            sdp_answer: sdpAnswer,
            answered_at: new Date().toISOString(),
          })
          .eq('id', waCall.id);

        break;
      }

      case 'reject': {
        await rejectCall(accessToken, phoneNumberId, callId);

        await supabase
          .from('whatsapp_calls')
          .update({ status: 'rejected', ended_at: new Date().toISOString() })
          .eq('id', waCall.id);

        break;
      }

      case 'terminate': {
        await terminateCall(accessToken, phoneNumberId, callId);

        const now = new Date().toISOString();
        const { data: callForDuration } = await supabase
          .from('whatsapp_calls')
          .select('answered_at')
          .eq('id', waCall.id)
          .single();

        let durationSeconds: number | null = null;
        if (callForDuration?.answered_at) {
          durationSeconds = Math.round(
            (new Date(now).getTime() - new Date(callForDuration.answered_at).getTime()) / 1000
          );
        }

        await supabase
          .from('whatsapp_calls')
          .update({
            status: 'completed',
            ended_at: now,
            duration_seconds: durationSeconds,
          })
          .eq('id', waCall.id);

        // Update voice_calls if linked
        if (waCall.voice_call_id) {
          await supabase
            .from('voice_calls')
            .update({
              status: 'completed',
              ended_at: now,
              duration_seconds: durationSeconds,
            })
            .eq('id', waCall.voice_call_id);
        }

        break;
      }
    }

    return NextResponse.json({ ok: true, action });
  } catch (error) {
    console.error(`[API] Call ${action} error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : `Failed to ${action} call` },
      { status: 500 }
    );
  }
}
