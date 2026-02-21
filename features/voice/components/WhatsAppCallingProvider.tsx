'use client';

/**
 * @fileoverview WhatsApp Calling Provider
 *
 * Global context provider for WhatsApp calling.
 * Renders the IncomingCall overlay and CallWidget as needed.
 *
 * @module features/voice/components/WhatsAppCallingProvider
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  useWhatsAppCall,
  type IncomingCallData,
  type WhatsAppCallStatus,
} from '@/lib/voice/useWhatsAppCall';
import { WhatsAppCallWidget } from './WhatsAppCallWidget';
import { WhatsAppIncomingCall } from './WhatsAppIncomingCall';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';

// =============================================================================
// Context
// =============================================================================

interface WhatsAppCallingContextValue {
  status: WhatsAppCallStatus;
  startCall: (params: {
    channelId: string;
    contactPhone: string;
    contactId?: string;
    contactName?: string;
    dealId?: string;
  }) => void;
}

const WhatsAppCallingContext = createContext<WhatsAppCallingContextValue>({
  status: 'idle',
  startCall: () => {},
});

export const useWhatsAppCallingContext = () => useContext(WhatsAppCallingContext);

// =============================================================================
// Provider
// =============================================================================

export function WhatsAppCallingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const orgId = profile?.organization_id || null;

  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);

  const handleIncomingCall = useCallback((data: IncomingCallData) => {
    setIncomingCall(data);
  }, []);

  const handleCallEnded = useCallback(() => {
    setIncomingCall(null);
  }, []);

  const handlePermissionUpdated = useCallback(
    (contactId: string) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.voice.callPermission(contactId),
      });
    },
    [queryClient]
  );

  const call = useWhatsAppCall({
    organizationId: orgId,
    onIncomingCall: handleIncomingCall,
    onCallEnded: handleCallEnded,
    onPermissionUpdated: handlePermissionUpdated,
  });

  const handleAcceptIncoming = useCallback(() => {
    if (incomingCall) {
      call.acceptIncomingCall(incomingCall);
      setIncomingCall(null);
    }
  }, [incomingCall, call]);

  const handleRejectIncoming = useCallback(() => {
    if (incomingCall) {
      call.rejectIncomingCall(incomingCall.callId);
      setIncomingCall(null);
    }
  }, [incomingCall, call]);

  const handleDismissWidget = useCallback(() => {
    call.resetState();
  }, [call]);

  const contextValue: WhatsAppCallingContextValue = {
    status: call.status,
    startCall: call.startCall,
  };

  return (
    <WhatsAppCallingContext.Provider value={contextValue}>
      {children}

      {/* Incoming call overlay */}
      {incomingCall && call.status === 'idle' && (
        <WhatsAppIncomingCall
          incoming={incomingCall}
          onAccept={handleAcceptIncoming}
          onReject={handleRejectIncoming}
        />
      )}

      {/* Active call widget */}
      {call.status !== 'idle' && (
        <WhatsAppCallWidget
          status={call.status}
          direction={call.direction}
          contactPhone={call.contactPhone}
          contactName={call.contactName}
          isMuted={call.isMuted}
          error={call.error}
          onToggleMute={call.toggleMute}
          onHangup={call.terminateCall}
          onDismiss={handleDismissWidget}
        />
      )}
    </WhatsAppCallingContext.Provider>
  );
}
