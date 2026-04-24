/**
 * POST /api/messaging/messages/[messageId]/delete
 *
 * Apaga uma mensagem do WhatsApp (para todos) e marca no banco como deletada.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getChannelRouter } from '@/lib/messaging';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { data: message, error: msgError } = await supabase
      .from('messaging_messages')
      .select(
        `id, external_id, direction, metadata,
         conversation:messaging_conversations!conversation_id (
           id, channel_id,
           channel:messaging_channels!channel_id (
             id, organization_id
           )
         )`
      )
      .eq('id', messageId)
      .single();

    if (msgError || !message) {
      return NextResponse.json({ message: 'Message not found' }, { status: 404 });
    }

    const conversation = message.conversation as unknown as {
      id: string;
      channel_id: string;
      channel: { id: string; organization_id: string };
    };

    if (!conversation?.channel) {
      return NextResponse.json({ message: 'Channel not found' }, { status: 404 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.organization_id !== conversation.channel.organization_id) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    if ((message.metadata as Record<string, unknown>)?.deleted) {
      return NextResponse.json({ message: 'Already deleted' }, { status: 409 });
    }

    // Delete from provider (best-effort)
    if (message.external_id) {
      const router = getChannelRouter();
      await router.deleteMessage(conversation.channel_id, message.external_id);
    }

    // Mark deleted in DB
    const existingMeta = (message.metadata as Record<string, unknown>) ?? {};
    await supabase
      .from('messaging_messages')
      .update({
        content: { type: 'text', text: '[Mensagem apagada]' },
        metadata: { ...existingMeta, deleted: true, deleted_at: new Date().toISOString() },
      })
      .eq('id', messageId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[messaging/messages/delete]', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
