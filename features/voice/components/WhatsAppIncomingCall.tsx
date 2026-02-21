'use client';

/**
 * @fileoverview WhatsApp Incoming Call Overlay
 *
 * Full-screen overlay when receiving an inbound WhatsApp call.
 * Shows caller info, accept/reject buttons, and auto-dismiss timer.
 *
 * @module features/voice/components/WhatsAppIncomingCall
 */

import React, { useEffect, useState, useRef } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import type { IncomingCallData } from '@/lib/voice/useWhatsAppCall';

// =============================================================================
// Types
// =============================================================================

interface WhatsAppIncomingCallProps {
  incoming: IncomingCallData;
  onAccept: () => void;
  onReject: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function WhatsAppIncomingCall({
  incoming,
  onAccept,
  onReject,
}: WhatsAppIncomingCallProps) {
  const [secondsLeft, setSecondsLeft] = useState(30);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Auto-reject after 30s
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          onReject();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [onReject]);

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center">
      <div className="mx-4 mt-4 flex w-full max-w-md items-center gap-4 rounded-2xl border border-green-500/30 bg-slate-900/95 p-5 shadow-2xl backdrop-blur-sm">
        {/* Pulse indicator */}
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full bg-green-500/20" />
          <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-green-600">
            <Phone className="h-6 w-6 text-white" />
          </div>
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Chamada WhatsApp</p>
          <p className="truncate text-sm text-slate-300">{incoming.callerPhone}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Desligará automaticamente em {secondsLeft}s
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 transition-colors hover:bg-red-500"
            title="Rejeitar"
          >
            <PhoneOff className="h-5 w-5 text-white" />
          </button>

          <button
            type="button"
            onClick={onAccept}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-green-600 transition-colors hover:bg-green-500"
            title="Atender"
          >
            <Phone className="h-5 w-5 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
