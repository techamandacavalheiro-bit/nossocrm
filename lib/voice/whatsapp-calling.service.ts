/**
 * @fileoverview WhatsApp Business Calling API Service
 *
 * Wrapper para Meta Graph API v23.0 — chamadas VoIP via WebRTC.
 * Suporta BIC (Business-Initiated Calls) e UIC (User-Initiated Calls).
 *
 * @module lib/voice/whatsapp-calling.service
 */

// =============================================================================
// Constants
// =============================================================================

const META_GRAPH_VERSION = 'v23.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// =============================================================================
// Types
// =============================================================================

export interface MetaCallResponse {
  id?: string;
  success?: boolean;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

export interface MetaCallSettingsResponse {
  success: boolean;
}

// =============================================================================
// API Helper
// =============================================================================

async function metaFetch<T>(
  accessToken: string,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const err = data.error || { message: `HTTP ${response.status}`, code: response.status };
    throw new Error(
      `[WhatsApp Calling] Meta API error ${err.code}: ${err.message}`
    );
  }

  return data as T;
}

// =============================================================================
// Calling Settings
// =============================================================================

/**
 * Enable calling on a WhatsApp Business phone number.
 * Must be called once before making/receiving calls.
 */
export async function enableCalling(
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  await metaFetch<MetaCallSettingsResponse>(
    accessToken,
    `${META_GRAPH_BASE}/${phoneNumberId}/settings`,
    {
      method: 'POST',
      body: JSON.stringify({
        calling: { status: 'ENABLED' },
      }),
    }
  );
}

// =============================================================================
// Outbound (BIC)
// =============================================================================

/**
 * Initiate an outbound call (BIC) to a WhatsApp user.
 * Requires prior call permission from the user.
 *
 * @returns Call ID from Meta API
 */
export async function initiateCall(
  accessToken: string,
  phoneNumberId: string,
  toPhone: string,
  sdpOffer: string
): Promise<string> {
  // Normalize phone: Meta API expects digits only (no + or dashes)
  const phone = toPhone.replace(/\D/g, '');

  const result = await metaFetch<MetaCallResponse>(
    accessToken,
    `${META_GRAPH_BASE}/${phoneNumberId}/calls`,
    {
      method: 'POST',
      body: JSON.stringify({
        to: phone,
        action: 'connect',
        sdp: sdpOffer,
      }),
    }
  );

  if (!result.id) {
    throw new Error('[WhatsApp Calling] No call ID returned from Meta API');
  }

  return result.id;
}

// =============================================================================
// Inbound (UIC) — Accept/Reject
// =============================================================================

/**
 * Pre-accept an inbound call (step 1 of 2).
 * Sends SDP answer to Meta to begin WebRTC setup.
 */
export async function preAcceptCall(
  accessToken: string,
  phoneNumberId: string,
  callId: string,
  sdpAnswer: string
): Promise<void> {
  await metaFetch<MetaCallResponse>(
    accessToken,
    `${META_GRAPH_BASE}/${phoneNumberId}/calls`,
    {
      method: 'POST',
      body: JSON.stringify({
        call_id: callId,
        action: 'pre_accept',
        sdp: sdpAnswer,
      }),
    }
  );
}

/**
 * Accept an inbound call (step 2 of 2).
 * Completes the call connection after pre_accept.
 */
export async function acceptCall(
  accessToken: string,
  phoneNumberId: string,
  callId: string,
  sdpAnswer: string
): Promise<void> {
  await metaFetch<MetaCallResponse>(
    accessToken,
    `${META_GRAPH_BASE}/${phoneNumberId}/calls`,
    {
      method: 'POST',
      body: JSON.stringify({
        call_id: callId,
        action: 'accept',
        sdp: sdpAnswer,
      }),
    }
  );
}

/**
 * Reject an inbound call.
 */
export async function rejectCall(
  accessToken: string,
  phoneNumberId: string,
  callId: string
): Promise<void> {
  await metaFetch<MetaCallResponse>(
    accessToken,
    `${META_GRAPH_BASE}/${phoneNumberId}/calls`,
    {
      method: 'POST',
      body: JSON.stringify({
        call_id: callId,
        action: 'reject',
      }),
    }
  );
}

// =============================================================================
// Terminate
// =============================================================================

/**
 * Terminate an active call (works for both inbound and outbound).
 */
export async function terminateCall(
  accessToken: string,
  phoneNumberId: string,
  callId: string
): Promise<void> {
  await metaFetch<MetaCallResponse>(
    accessToken,
    `${META_GRAPH_BASE}/${phoneNumberId}/calls`,
    {
      method: 'POST',
      body: JSON.stringify({
        call_id: callId,
        action: 'terminate',
      }),
    }
  );
}

// =============================================================================
// BIC Permission
// =============================================================================

/**
 * Request call permission from a WhatsApp user (BIC prerequisite).
 * Sends an interactive `call_permission_request` message.
 *
 * Limits:
 * - 1 request per 24h, max 2 per 7 days
 * - After permission: up to 5 calls per 24h
 * - Permission lasts 7 days
 */
export async function requestCallPermission(
  accessToken: string,
  phoneNumberId: string,
  toPhone: string
): Promise<void> {
  // Normalize phone: Meta API expects digits only (no + or dashes)
  const phone = toPhone.replace(/\D/g, '');

  await metaFetch<MetaCallResponse>(
    accessToken,
    `${META_GRAPH_BASE}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'interactive',
        interactive: {
          type: 'call_permission_request',
          body: {
            text: 'Gostaríamos de ligar para você via WhatsApp. Você autoriza?',
          },
          action: {
            name: 'call_permission_request',
          },
        },
      }),
    }
  );
}
