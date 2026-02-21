/**
 * @fileoverview useWhatsAppCall Hook
 *
 * Hook central que gerencia o ciclo completo de chamadas WhatsApp via WebRTC.
 * Suporta outbound (BIC) e inbound (UIC).
 *
 * @module lib/voice/useWhatsAppCall
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// =============================================================================
// Types
// =============================================================================

export type WhatsAppCallStatus =
  | 'idle'
  | 'initiating'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'ended';

export interface WhatsAppCallState {
  status: WhatsAppCallStatus;
  direction: 'outbound' | 'inbound' | null;
  callId: string | null;
  waCallId: string | null;
  contactPhone: string | null;
  contactName: string | null;
  channelId: string | null;
  isMuted: boolean;
  error: string | null;
}

export interface IncomingCallData {
  callId: string;
  channelId: string;
  callerPhone: string;
  sdpOffer: string;
}

interface UseWhatsAppCallOptions {
  organizationId: string | null;
  onIncomingCall?: (data: IncomingCallData) => void;
  onCallEnded?: () => void;
  onPermissionUpdated?: (contactId: string, status: string) => void;
}

// ICE servers - Google STUN for NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// =============================================================================
// Hook
// =============================================================================

export function useWhatsAppCall(options: UseWhatsAppCallOptions) {
  const { organizationId, onIncomingCall, onCallEnded, onPermissionUpdated } = options;

  const [state, setState] = useState<WhatsAppCallState>({
    status: 'idle',
    direction: null,
    callId: null,
    waCallId: null,
    contactPhone: null,
    contactName: null,
    channelId: null,
    isMuted: false,
    error: null,
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Refs for callbacks (avoid stale closures)
  const onIncomingCallRef = useRef(onIncomingCall);
  const onCallEndedRef = useRef(onCallEnded);
  const onPermissionUpdatedRef = useRef(onPermissionUpdated);
  useEffect(() => {
    onIncomingCallRef.current = onIncomingCall;
    onCallEndedRef.current = onCallEnded;
    onPermissionUpdatedRef.current = onPermissionUpdated;
  }, [onIncomingCall, onCallEnded, onPermissionUpdated]);

  // =========================================================================
  // Cleanup helpers
  // =========================================================================

  const cleanupWebRTC = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    cleanupWebRTC();
    setState({
      status: 'idle',
      direction: null,
      callId: null,
      waCallId: null,
      contactPhone: null,
      contactName: null,
      channelId: null,
      isMuted: false,
      error: null,
    });
  }, [cleanupWebRTC]);

  // =========================================================================
  // Subscribe to Supabase Broadcast for call events
  // =========================================================================

  useEffect(() => {
    if (!organizationId || !supabase) return;

    const channelName = `org:${organizationId}:wa-calls`;
    const channel = supabase.channel(channelName);

    channel
      .on('broadcast', { event: 'call_answered' }, ({ payload }) => {
        // Outbound: lead answered, apply SDP answer
        if (payload.sdpAnswer && pcRef.current) {
          const answer = new RTCSessionDescription({
            type: 'answer',
            sdp: payload.sdpAnswer,
          });
          pcRef.current
            .setRemoteDescription(answer)
            .then(() => {
              setState((prev) => ({
                ...prev,
                status: 'connected',
                waCallId: payload.callId || prev.waCallId,
              }));
            })
            .catch((err) => {
              console.error('[WhatsAppCall] Failed to set remote description:', err);
              setState((prev) => ({ ...prev, error: 'Failed to connect audio' }));
            });
        }
      })
      .on('broadcast', { event: 'incoming_call' }, ({ payload }) => {
        // Inbound: someone is calling
        onIncomingCallRef.current?.({
          callId: payload.callId,
          channelId: payload.channelId,
          callerPhone: payload.callerPhone,
          sdpOffer: payload.sdpOffer,
        });
      })
      .on('broadcast', { event: 'call_terminated' }, ({ payload }) => {
        setState((prev) => {
          if (prev.waCallId === payload.callId || prev.status !== 'idle') {
            return { ...prev, status: 'ended' };
          }
          return prev;
        });
        cleanupWebRTC();
        onCallEndedRef.current?.();
      })
      .on('broadcast', { event: 'permission_updated' }, ({ payload }) => {
        onPermissionUpdatedRef.current?.(payload.contactId, payload.status);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [organizationId, cleanupWebRTC]);

  // =========================================================================
  // Outbound: Start Call
  // =========================================================================

  const startCall = useCallback(
    async (params: {
      channelId: string;
      contactPhone: string;
      contactId?: string;
      contactName?: string;
      dealId?: string;
    }) => {
      if (state.status !== 'idle') return;

      setState((prev) => ({
        ...prev,
        status: 'initiating',
        direction: 'outbound',
        contactPhone: params.contactPhone,
        contactName: params.contactName || null,
        channelId: params.channelId,
        error: null,
      }));

      try {
        // Get microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;

        // Create peer connection
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        // Add audio tracks
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        // Handle remote audio
        pc.ontrack = (event) => {
          const audio = new Audio();
          audio.srcObject = event.streams[0];
          audio.play().catch(() => {});
          remoteAudioRef.current = audio;
        };

        // Create SDP offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Wait for ICE gathering to complete (or timeout)
        const sdpOffer = await waitForIceGathering(pc);

        // Call API to initiate
        const response = await fetch('/api/voice/whatsapp-call/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: params.channelId,
            contactPhone: params.contactPhone,
            sdpOffer,
            contactId: params.contactId,
            contactName: params.contactName,
            dealId: params.dealId,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to initiate call');
        }

        const result = await response.json();

        setState((prev) => ({
          ...prev,
          status: 'ringing',
          callId: result.callId,
          waCallId: result.waCallId,
        }));

        // SDP answer will arrive via Broadcast → call_answered handler above
      } catch (err) {
        console.error('[WhatsAppCall] startCall error:', err);
        cleanupWebRTC();
        setState((prev) => ({
          ...prev,
          status: 'ended',
          error: err instanceof Error ? err.message : 'Failed to start call',
        }));
      }
    },
    [state.status, cleanupWebRTC]
  );

  // =========================================================================
  // Inbound: Accept Call
  // =========================================================================

  const acceptIncomingCall = useCallback(
    async (incoming: IncomingCallData) => {
      setState((prev) => ({
        ...prev,
        status: 'connecting',
        direction: 'inbound',
        waCallId: incoming.callId,
        channelId: incoming.channelId,
        contactPhone: incoming.callerPhone,
        error: null,
      }));

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        pc.ontrack = (event) => {
          const audio = new Audio();
          audio.srcObject = event.streams[0];
          audio.play().catch(() => {});
          remoteAudioRef.current = audio;
        };

        // Set remote offer
        const offer = new RTCSessionDescription({
          type: 'offer',
          sdp: incoming.sdpOffer,
        });
        await pc.setRemoteDescription(offer);

        // Create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const sdpAnswer = await waitForIceGathering(pc);

        // Send accept to API
        const response = await fetch('/api/voice/whatsapp-call/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: incoming.callId,
            sdpAnswer,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to accept call');
        }

        setState((prev) => ({ ...prev, status: 'connected' }));
      } catch (err) {
        console.error('[WhatsAppCall] acceptCall error:', err);
        cleanupWebRTC();
        setState((prev) => ({
          ...prev,
          status: 'ended',
          error: err instanceof Error ? err.message : 'Failed to accept call',
        }));
      }
    },
    [cleanupWebRTC]
  );

  // =========================================================================
  // Reject Inbound
  // =========================================================================

  const rejectIncomingCall = useCallback(
    async (callId: string) => {
      try {
        await fetch('/api/voice/whatsapp-call/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId }),
        });
      } catch (err) {
        console.error('[WhatsAppCall] rejectCall error:', err);
      }
    },
    []
  );

  // =========================================================================
  // Terminate Call
  // =========================================================================

  const terminateCall = useCallback(async () => {
    const callId = state.waCallId;
    if (!callId) {
      resetState();
      return;
    }

    try {
      await fetch('/api/voice/whatsapp-call/terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      });
    } catch (err) {
      console.error('[WhatsAppCall] terminateCall error:', err);
    }

    cleanupWebRTC();
    setState((prev) => ({ ...prev, status: 'ended' }));
    onCallEndedRef.current?.();
  }, [state.waCallId, cleanupWebRTC, resetState]);

  // =========================================================================
  // Mute Toggle
  // =========================================================================

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setState((prev) => ({ ...prev, isMuted: !audioTrack.enabled }));
      }
    }
  }, []);

  // =========================================================================
  // Cleanup on unmount
  // =========================================================================

  useEffect(() => {
    return () => {
      cleanupWebRTC();
    };
  }, [cleanupWebRTC]);

  return {
    ...state,
    startCall,
    acceptIncomingCall,
    rejectIncomingCall,
    terminateCall,
    toggleMute,
    resetState,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Wait for ICE gathering to complete, with a 3s timeout.
 * Returns the final SDP with all ICE candidates included.
 */
function waitForIceGathering(pc: RTCPeerConnection): Promise<string> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve(pc.localDescription?.sdp || '');
      return;
    }

    const timeout = setTimeout(() => {
      resolve(pc.localDescription?.sdp || '');
    }, 3000);

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve(pc.localDescription?.sdp || '');
      }
    };
  });
}
