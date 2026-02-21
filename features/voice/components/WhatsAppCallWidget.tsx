'use client';

/**
 * @fileoverview WhatsApp Call Widget
 *
 * Floating widget during active WhatsApp call (outbound or inbound).
 * Shows status, timer, mute/hangup controls.
 *
 * @module features/voice/components/WhatsAppCallWidget
 */

import React, { useEffect, useState, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WhatsAppCallStatus } from '@/lib/voice/useWhatsAppCall';

// =============================================================================
// Types
// =============================================================================

interface WhatsAppCallWidgetProps {
  status: WhatsAppCallStatus;
  direction: 'outbound' | 'inbound' | null;
  contactPhone: string | null;
  contactName: string | null;
  isMuted: boolean;
  error: string | null;
  onToggleMute: () => void;
  onHangup: () => void;
  onDismiss: () => void;
}

// =============================================================================
// Timer Hook
// =============================================================================

function useCallTimer(isRunning: boolean) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (isRunning) {
      setSeconds(0);
      intervalRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning]);

  const formatted = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  return { seconds, formatted };
}

// =============================================================================
// Status Labels
// =============================================================================

const STATUS_LABELS: Record<WhatsAppCallStatus, string> = {
  idle: '',
  initiating: 'Iniciando...',
  ringing: 'Chamando...',
  connecting: 'Conectando...',
  connected: 'Em chamada',
  ended: 'Chamada encerrada',
};

// =============================================================================
// Component
// =============================================================================

export function WhatsAppCallWidget({
  status,
  direction,
  contactPhone,
  contactName,
  isMuted,
  error,
  onToggleMute,
  onHangup,
  onDismiss,
}: WhatsAppCallWidgetProps) {
  const { formatted: timerText } = useCallTimer(status === 'connected');

  if (status === 'idle') return null;

  const isActive = status !== 'ended';
  const displayName = contactName || contactPhone || 'Desconhecido';

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 flex w-72 flex-col rounded-2xl border shadow-2xl backdrop-blur-sm',
        isActive
          ? 'border-green-500/30 bg-slate-900/95'
          : 'border-white/10 bg-slate-900/90'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full',
              status === 'connected'
                ? 'bg-green-600'
                : status === 'ended'
                  ? 'bg-slate-700'
                  : 'bg-amber-600'
            )}
          >
            {status === 'ended' ? (
              <PhoneOff className="h-4 w-4 text-white" />
            ) : (
              <Phone className="h-4 w-4 text-white" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{displayName}</p>
            <p className="text-xs text-slate-400">
              WhatsApp {direction === 'outbound' ? '(Saída)' : '(Entrada)'}
            </p>
          </div>
        </div>

        {!isActive && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full p-1 text-slate-500 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Status + Timer */}
      <div className="px-4 pb-2 text-center">
        <p
          className={cn(
            'text-xs font-medium',
            status === 'connected'
              ? 'text-green-400'
              : status === 'ended'
                ? 'text-slate-500'
                : 'text-amber-400'
          )}
        >
          {error || STATUS_LABELS[status]}
        </p>
        {status === 'connected' && (
          <p className="mt-0.5 font-mono text-lg font-bold text-white">
            {timerText}
          </p>
        )}
      </div>

      {/* Controls */}
      {isActive && status !== 'initiating' && (
        <div className="flex items-center justify-center gap-4 px-4 pb-4">
          <button
            type="button"
            onClick={onToggleMute}
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-full transition-colors',
              isMuted
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-white/10 hover:bg-white/20'
            )}
            title={isMuted ? 'Desmutar' : 'Mutar'}
          >
            {isMuted ? (
              <MicOff className="h-5 w-5 text-white" />
            ) : (
              <Mic className="h-5 w-5 text-white" />
            )}
          </button>

          <button
            type="button"
            onClick={onHangup}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 transition-colors hover:bg-red-500"
            title="Encerrar chamada"
          >
            <PhoneOff className="h-5 w-5 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
