'use client';

/**
 * @fileoverview WhatsApp Call Button for DealDetailModal
 *
 * Shows call permission request or call initiate button depending on BIC status.
 * Placed in the deal header alongside "Preparar Conversa" and VoiceCallButton.
 *
 * @module features/deals/components/WhatsAppCallButton
 */

import React from 'react';
import { Phone, PhoneCall, PhoneOff, Shield, ShieldX, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import {
  useCallPermissionQuery,
  useRequestCallPermissionMutation,
} from '@/lib/query/hooks/useWhatsAppCallingQuery';
import { useChannelsQuery } from '@/lib/query/hooks/useChannelsQuery';
import { useToast } from '@/context/ToastContext';
import { useWhatsAppCallingContext } from '@/features/voice/components/WhatsAppCallingProvider';

// =============================================================================
// Types
// =============================================================================

interface WhatsAppCallButtonProps {
  dealId: string;
  contactId: string | null;
  contactPhone: string | null;
  contactName: string | null;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function WhatsAppCallButton({
  dealId,
  contactId,
  contactPhone,
  contactName,
  className,
}: WhatsAppCallButtonProps) {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const callingCtx = useWhatsAppCallingContext();

  // Get connected WhatsApp meta-cloud channels
  const { data: channels } = useChannelsQuery();
  const waChannel = channels?.find(
    (c) =>
      c.channelType === 'whatsapp' &&
      c.provider === 'meta-cloud' &&
      (c.settings as any)?.callingEnabled
  );

  // Check BIC permission
  const { data: permission } = useCallPermissionQuery(
    contactId,
    waChannel?.id || null
  );

  const requestPermission = useRequestCallPermissionMutation();

  if (!waChannel || !contactPhone) {
    return null;
  }

  const hasPermission = permission?.status === 'granted';
  const isDeclined = permission?.status === 'declined';
  const isPending = permission?.status === 'pending';
  const isCallActive = callingCtx.status !== 'idle' && callingCtx.status !== 'ended';

  // Check if declined within last 24h (Meta rate limit: 1 request/24h)
  const declinedRecently = isDeclined && permission?.respondedAt
    ? (Date.now() - new Date(permission.respondedAt).getTime()) < 24 * 60 * 60 * 1000
    : false;

  const handleRequestPermission = async () => {
    if (!contactId) {
      addToast('Contato sem ID cadastrado', 'warning');
      return;
    }

    try {
      await requestPermission.mutateAsync({
        channelId: waChannel.id,
        contactPhone,
        contactId,
      });
      addToast('Solicitação de permissão enviada via WhatsApp', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Erro ao solicitar permissão',
        'error'
      );
    }
  };

  const handleCall = () => {
    if (isCallActive) return;
    callingCtx.startCall({
      channelId: waChannel.id,
      contactPhone,
      contactId: contactId || undefined,
      contactName: contactName || undefined,
      dealId,
    });
  };

  // Call active — show minimal indicator
  if (isCallActive) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
          'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
          className
        )}
      >
        <PhoneCall size={14} className="animate-pulse" />
        <span className="hidden sm:inline">Em chamada</span>
      </button>
    );
  }

  // Declined recently — show cooldown indicator
  if (declinedRecently) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
          'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
          className
        )}
        title="Permissão recusada pelo contato. Aguarde 24h para re-solicitar."
      >
        <ShieldX size={14} />
        <span className="hidden sm:inline">Recusada</span>
      </button>
    );
  }

  // Pending — waiting for contact response
  if (isPending) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
          'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400',
          className
        )}
        title="Aguardando resposta do contato"
      >
        <Clock size={14} className="animate-pulse" />
        <span className="hidden sm:inline">Aguardando</span>
      </button>
    );
  }

  // No permission — show request button
  if (!hasPermission) {
    return (
      <button
        type="button"
        onClick={handleRequestPermission}
        disabled={requestPermission.isPending}
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
          'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:hover:bg-amber-500/30',
          className
        )}
        title="Solicitar permissão para ligar via WhatsApp"
      >
        <Shield size={14} />
        <span className="hidden sm:inline">
          {requestPermission.isPending ? 'Enviando...' : 'Permissão'}
        </span>
      </button>
    );
  }

  // Has permission — show call button
  return (
    <button
      type="button"
      onClick={handleCall}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
        'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-300 dark:hover:bg-green-500/30',
        className
      )}
      title="Ligar via WhatsApp"
    >
      <Phone size={14} />
      <span className="hidden sm:inline">Ligar WA</span>
    </button>
  );
}
