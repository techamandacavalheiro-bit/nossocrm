/**
 * POST /api/voice/whatsapp-call/notify
 *
 * Internal endpoint — relays call events to browser via Supabase Broadcast.
 * Called by the webhook handler (messaging-webhook-meta).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  // Verify internal secret
  const internalSecret = process.env.INTERNAL_API_SECRET;
  const receivedSecret = req.headers.get('X-Internal-Secret');

  if (!internalSecret || receivedSecret !== internalSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { organizationId, event } = body;

  if (!organizationId || !event) {
    return NextResponse.json(
      { error: 'organizationId and event are required' },
      { status: 400 }
    );
  }

  // Use service role client for broadcasting
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Broadcast via Supabase Realtime
  const channelName = `org:${organizationId}:wa-calls`;
  const channel = supabase.channel(channelName);

  await channel.subscribe();
  await channel.send({
    type: 'broadcast',
    event: event.type,
    payload: event,
  });
  await supabase.removeChannel(channel);

  return NextResponse.json({ ok: true });
}
