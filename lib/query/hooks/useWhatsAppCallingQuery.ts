/**
 * @fileoverview WhatsApp Calling Query Hooks
 *
 * Hooks para permissão de chamada BIC e ações de calling.
 *
 * @module lib/query/hooks/useWhatsAppCallingQuery
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query/queryKeys';

// =============================================================================
// Types
// =============================================================================

interface CallPermission {
  status: 'granted' | 'declined' | 'pending' | 'none';
  grantedAt: string | null;
  expiresAt: string | null;
  respondedAt: string | null;
}

// =============================================================================
// Call Permission Query
// =============================================================================

/**
 * Check if a contact has granted BIC call permission for a given channel.
 */
export function useCallPermissionQuery(contactId: string | null, channelId: string | null) {
  return useQuery({
    queryKey: queryKeys.voice.callPermission(contactId || ''),
    queryFn: async (): Promise<CallPermission> => {
      if (!contactId || !channelId) {
        return { status: 'none', grantedAt: null, expiresAt: null, respondedAt: null };
      }

      const { data, error } = await supabase
        .from('contacts')
        .select('call_permission_status')
        .eq('id', contactId)
        .single();

      if (error || !data) {
        return { status: 'none', grantedAt: null, expiresAt: null, respondedAt: null };
      }

      const permStatus = (data.call_permission_status || {}) as Record<string, any>;
      const channelPerm = permStatus[channelId];

      if (!channelPerm) {
        return { status: 'none', grantedAt: null, expiresAt: null, respondedAt: null };
      }

      // Check expiry
      if (channelPerm.status === 'granted' && channelPerm.expiresAt) {
        if (new Date(channelPerm.expiresAt) < new Date()) {
          return { status: 'none', grantedAt: null, expiresAt: null, respondedAt: null };
        }
      }

      return {
        status: channelPerm.status || 'none',
        grantedAt: channelPerm.grantedAt || null,
        expiresAt: channelPerm.expiresAt || null,
        respondedAt: channelPerm.respondedAt || null,
      };
    },
    enabled: !!contactId && !!channelId,
    staleTime: 30_000,
  });
}

// =============================================================================
// Request Permission Mutation
// =============================================================================

export function useRequestCallPermissionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      channelId,
      contactPhone,
    }: {
      channelId: string;
      contactPhone: string;
      contactId: string;
    }) => {
      const response = await fetch('/api/voice/whatsapp-call/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, contactPhone }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to request permission');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.voice.callPermission(variables.contactId),
      });
    },
  });
}

// =============================================================================
// Enable Calling Mutation
// =============================================================================

export function useEnableWhatsAppCallingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId }: { channelId: string }) => {
      const response = await fetch('/api/voice/whatsapp-call/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to enable calling');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.messagingChannels.all,
      });
    },
  });
}
