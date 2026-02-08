/**
 * @fileoverview Voice Webhook Handler
 *
 * Processa webhooks post-call do ElevenLabs.
 * Verifica HMAC, salva transcript, e dispara pipeline AI compartilhado.
 *
 * @module lib/voice/webhook-handler
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ElevenLabsWebhookPayload,
  TranscriptEntry,
  CallAnalysis,
} from './elevenlabs.types';
import { buildLeadContext } from '@/lib/ai/agent/context-builder';
import { evaluateStageAdvancement } from '@/lib/ai/agent/stage-evaluator';
import { extractAndUpdateBANT } from '@/lib/ai/extraction/extraction.service';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import type { StageAIConfig, LeadContext } from '@/lib/ai/agent/types';

// =============================================================================
// HMAC Verification
// =============================================================================

const TIMESTAMP_TOLERANCE_SECONDS = 30 * 60; // 30 minutes

/**
 * Verifica a assinatura HMAC-SHA256 do webhook ElevenLabs.
 *
 * Header format: `t=timestamp,v0=hash`
 */
export function verifyElevenLabsWebhook(
  signatureHeader: string,
  rawBody: string
): boolean {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[VoiceWebhook] ELEVENLABS_WEBHOOK_SECRET not configured');
    return false;
  }

  try {
    const parts = signatureHeader.split(',');
    if (parts.length < 2) return false;

    const timestamp = parts[0].replace('t=', '');
    const receivedHash = parts[1]; // v0=hash

    // Validate timestamp to prevent replay attacks
    const tolerance = Math.floor(Date.now() / 1000) - TIMESTAMP_TOLERANCE_SECONDS;
    if (parseInt(timestamp, 10) < tolerance) {
      console.warn('[VoiceWebhook] Timestamp too old, possible replay attack');
      return false;
    }

    // Reconstruct and verify HMAC
    const payload = `${timestamp}.${rawBody}`;
    const mac = createHmac('sha256', secret).update(payload).digest('hex');
    const expectedHash = `v0=${mac}`;

    // Timing-safe comparison
    const a = Buffer.from(receivedHash);
    const b = Buffer.from(expectedHash);
    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
  } catch (error) {
    console.error('[VoiceWebhook] Verification error:', error);
    return false;
  }
}

// =============================================================================
// Webhook Processing
// =============================================================================

export interface ProcessWebhookResult {
  success: boolean;
  callId?: string;
  error?: string;
}

/**
 * Processa o webhook post-call do ElevenLabs.
 *
 * 1. Busca voice_call pelo elevenlabs_conversation_id
 * 2. Salva transcript + analysis
 * 3. Cria messaging_message na conversation
 * 4. Roda pipeline AI (stage eval + BANT extraction)
 * 5. Registra no ai_conversation_log
 */
export async function processPostCallWebhook(
  supabase: SupabaseClient,
  payload: ElevenLabsWebhookPayload
): Promise<ProcessWebhookResult> {
  const { data } = payload;
  const { conversation_id: elConvId, transcript, metadata, analysis } = data;

  console.log(`[VoiceWebhook] Processing post-call for conversation: ${elConvId}`);

  // 1. Find voice_call record
  const { data: voiceCall, error: findError } = await supabase
    .from('voice_calls')
    .select('id, organization_id, deal_id, conversation_id, contact_id')
    .eq('elevenlabs_conversation_id', elConvId)
    .single();

  if (findError || !voiceCall) {
    console.error('[VoiceWebhook] Voice call not found for:', elConvId, findError);
    return { success: false, error: 'Voice call not found' };
  }

  // 2. Transform transcript to our format
  const transformedTranscript: TranscriptEntry[] = transcript.map((turn) => ({
    role: turn.role,
    message: turn.message,
    time_in_call_secs: turn.time_in_call_secs,
  }));

  const callAnalysis: CallAnalysis = {
    call_successful: analysis.call_successful,
    transcript_summary: analysis.transcript_summary,
    evaluation_criteria_results: analysis.evaluation_criteria_results,
    data_collection_results: analysis.data_collection_results,
  };

  // 3. Update voice_call with transcript and analysis
  const { error: updateError } = await supabase
    .from('voice_calls')
    .update({
      transcript: transformedTranscript,
      analysis: callAnalysis,
      status: 'completed',
      duration_seconds: metadata.call_duration_secs,
      ended_at: new Date(
        (metadata.start_time_unix_secs + metadata.call_duration_secs) * 1000
      ).toISOString(),
      metadata: {
        elevenlabs_cost: metadata.cost,
        termination_reason: metadata.termination_reason,
        feedback: metadata.feedback,
      },
    })
    .eq('id', voiceCall.id);

  if (updateError) {
    console.error('[VoiceWebhook] Failed to update voice call:', updateError);
    return { success: false, callId: voiceCall.id, error: 'Failed to update call' };
  }

  // 4. Create messaging_message in the conversation (if linked)
  if (voiceCall.conversation_id) {
    const transcriptText = transformedTranscript
      .map((t) => `${t.role === 'agent' ? 'AI' : 'Lead'}: ${t.message}`)
      .join('\n');

    await supabase.from('messaging_messages').insert({
      conversation_id: voiceCall.conversation_id,
      direction: 'outbound',
      content_type: 'audio',
      content: {
        type: 'audio',
        text: `[Chamada de voz - ${metadata.call_duration_secs}s]\n\n${analysis.transcript_summary}`,
      },
      status: 'sent',
      sender_type: 'system',
      metadata: {
        sent_by_ai: true,
        voice_call_id: voiceCall.id,
        voice_mode: 'ai_agent',
        transcript_preview: transcriptText.slice(0, 500),
      },
    });

    // Update conversation last_message_at
    await supabase
      .from('messaging_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', voiceCall.conversation_id);
  }

  // 5. Run AI pipeline (stage evaluation + BANT extraction)
  await runPostCallAIPipeline(supabase, voiceCall, transformedTranscript, callAnalysis);

  console.log(`[VoiceWebhook] Successfully processed call: ${voiceCall.id}`);
  return { success: true, callId: voiceCall.id };
}

// =============================================================================
// Post-Call AI Pipeline
// =============================================================================

async function runPostCallAIPipeline(
  supabase: SupabaseClient,
  voiceCall: {
    id: string;
    organization_id: string;
    deal_id: string | null;
    conversation_id: string | null;
    contact_id: string | null;
  },
  transcript: TranscriptEntry[],
  analysis: CallAnalysis
): Promise<void> {
  const { organization_id: orgId, deal_id: dealId, conversation_id: convId } = voiceCall;

  // Skip pipeline if no deal
  if (!dealId) {
    console.log('[VoiceWebhook] No deal linked, skipping AI pipeline');
    return;
  }

  try {
    // Get AI config
    const aiConfig = await getOrgAIConfig(supabase, orgId);
    if (!aiConfig?.enabled) {
      console.log('[VoiceWebhook] AI not enabled for org, skipping pipeline');
      return;
    }

    // Convert transcript to conversation history format
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> =
      transcript.map((t) => ({
        role: t.role === 'user' ? 'user' : 'assistant',
        content: t.message,
      }));

    // Build lead context (if conversation exists)
    let context: LeadContext | null = null;
    if (convId) {
      context = await buildLeadContext({
        supabase,
        conversationId: convId,
        organizationId: orgId,
      });
    }

    // Evaluate stage advancement
    if (context && context.deal?.stage_id) {
      const { data: stageConfig } = await supabase
        .from('stage_ai_config')
        .select('*')
        .eq('stage_id', context.deal.stage_id)
        .single();

      if (stageConfig) {
        const evalResult = await evaluateStageAdvancement({
          supabase,
          context,
          stageConfig: stageConfig as unknown as StageAIConfig,
          conversationHistory,
          aiConfig: {
            provider: aiConfig.provider,
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
          },
          organizationId: orgId,
          hitlThreshold: aiConfig.hitlThreshold,
          conversationId: convId || undefined,
        });

        console.log(
          `[VoiceWebhook] Stage evaluation result: advanced=${evalResult.advanced}, ` +
            `confirmation=${evalResult.requiresConfirmation}`
        );
      }
    }

    // Extract BANT from transcript
    if (convId) {
      const bantResult = await extractAndUpdateBANT({
        supabase,
        dealId,
        conversationId: convId,
        organizationId: orgId,
      });

      if (bantResult.success && bantResult.updated?.length) {
        console.log(`[VoiceWebhook] BANT updated fields: ${bantResult.updated.join(', ')}`);
      }
    }

    // Log AI interaction
    await supabase.from('ai_conversation_log').insert({
      organization_id: orgId,
      conversation_id: convId,
      stage_id: context?.deal?.stage_id || null,
      context_snapshot: context,
      ai_response: analysis.transcript_summary,
      action_taken: 'voice_call_completed',
      action_reason: `Voice call (AI agent) - ${transcript.length} turns`,
      metadata: {
        voice_call_id: voiceCall.id,
        duration_seconds: transcript[transcript.length - 1]?.time_in_call_secs || 0,
        call_successful: analysis.call_successful,
      },
    });
  } catch (error) {
    console.error('[VoiceWebhook] AI pipeline error:', error);
    // Don't throw — pipeline failures shouldn't affect webhook response
  }
}
