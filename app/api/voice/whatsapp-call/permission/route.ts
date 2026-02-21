/**
 * POST /api/voice/whatsapp-call/permission
 *
 * Request BIC call permission from a WhatsApp contact.
 * Sends an interactive call_permission_request message.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requestCallPermission } from '@/lib/voice/whatsapp-calling.service';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { channelId, contactPhone } = body;

    if (!channelId || !contactPhone) {
      return NextResponse.json(
        { error: 'channelId and contactPhone are required' },
        { status: 400 }
      );
    }

    // Get profile for org
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[API permission] Profile error:', profileError?.message);
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Get channel with credentials
    const { data: channel, error: channelError } = await supabase
      .from('messaging_channels')
      .select('id, credentials')
      .eq('id', channelId)
      .eq('organization_id', profile.organization_id)
      .single();

    if (channelError || !channel) {
      console.error('[API permission] Channel error:', channelError?.message);
      return NextResponse.json({ error: `Channel not found: ${channelError?.message || 'no data'}` }, { status: 404 });
    }

    const credentials = channel.credentials as Record<string, unknown>;
    const accessToken = credentials.accessToken as string;
    const phoneNumberId = credentials.phoneNumberId as string;

    console.log('[API permission] Channel found, token present:', !!accessToken, 'phoneNumberId:', phoneNumberId);

    if (!accessToken || !phoneNumberId) {
      return NextResponse.json(
        { error: 'Channel missing credentials (accessToken or phoneNumberId)' },
        { status: 400 }
      );
    }

    await requestCallPermission(accessToken, phoneNumberId, contactPhone);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to request permission';
    console.error('[API permission] Error:', message);

    // Provide user-friendly messages for common Meta API errors
    let userMessage = message;
    if (message.includes('138009')) {
      userMessage = 'Limite de solicitações de permissão atingido para este contato. Aguarde 24h.';
    } else if (message.includes('error 131')) {
      userMessage = 'Limite de solicitações atingido. Aguarde 24h para tentar novamente.';
    } else if (message.includes('error 100')) {
      userMessage = 'Erro no formato da requisição. Verifique as credenciais do canal.';
    } else if (message.includes('error 190')) {
      userMessage = 'Token de acesso expirado. Reconecte o canal WhatsApp.';
    }

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
