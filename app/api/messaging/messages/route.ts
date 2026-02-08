import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
// Import from main module to ensure providers are registered
import { getChannelRouter, transformMessage } from '@/lib/messaging';
import type { SendMessageInput, MessageContent, DbMessagingMessage } from '@/lib/messaging';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify auth
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: SendMessageInput = await request.json();
    const { conversationId, content, replyToMessageId } = body;

    if (!conversationId || !content) {
      return NextResponse.json(
        { message: 'conversationId and content are required' },
        { status: 400 }
      );
    }

    // Fetch conversation to get channel info and recipient
    const { data: conversation, error: convError } = await supabase
      .from('messaging_conversations')
      .select(`
        *,
        channel:messaging_channels!channel_id (
          id,
          channel_type,
          provider
        )
      `)
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { message: 'Conversation not found' },
        { status: 404 }
      );
    }

    const channel = conversation.channel as { id: string; channel_type: string; provider: string };

    // Create message record in database (pending state)
    const messageData = {
      conversation_id: conversationId,
      direction: 'outbound' as const,
      content_type: content.type,
      content: content as unknown as Record<string, unknown>,
      reply_to_message_id: replyToMessageId || null,
      status: 'pending' as const,
      sender_user_id: user.id,
      sender_type: 'user' as const,
      metadata: {},
    };

    const { data: dbMessage, error: insertError } = await supabase
      .from('messaging_messages')
      .insert(messageData)
      .select()
      .single();

    if (insertError || !dbMessage) {
      return NextResponse.json(
        { message: 'Failed to create message' },
        { status: 500 }
      );
    }

    // Send via channel router (async - dont wait)
    const router = getChannelRouter();
    
    // Update to queued status
    await supabase
      .from('messaging_messages')
      .update({ status: 'queued' })
      .eq('id', dbMessage.id);

    // Send message to provider
    const result = await router.sendMessage(channel.id, {
      conversationId,
      to: conversation.external_contact_id,
      content: content as MessageContent,
      replyToMessageId,
    });

    // Update message status based on result
    if (result.success) {
      await supabase
        .from('messaging_messages')
        .update({
          status: 'sent',
          external_id: result.externalMessageId,
          sent_at: new Date().toISOString(),
        })
        .eq('id', dbMessage.id);
    } else {
      // Save as failed but don't return error - message is still saved
      await supabase
        .from('messaging_messages')
        .update({
          status: 'failed',
          error_code: result.error?.code,
          error_message: result.error?.message,
          failed_at: new Date().toISOString(),
        })
        .eq('id', dbMessage.id);
    }

    // Fetch updated message and return it (even if failed)
    const { data: updatedMessage, error: fetchError } = await supabase
      .from('messaging_messages')
      .select('*')
      .eq('id', dbMessage.id)
      .single();

    if (fetchError || !updatedMessage) {
      // Return the original message data as fallback
      return NextResponse.json(transformMessage({
        ...dbMessage,
        status: result.success ? 'sent' : 'failed',
      } as DbMessagingMessage));
    }

    return NextResponse.json(transformMessage(updatedMessage as DbMessagingMessage));
  } catch (error) {
    console.error('[messaging/messages]', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
