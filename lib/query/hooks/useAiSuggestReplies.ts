/**
 * Mutation hook that asks the server for 2-3 AI-generated reply suggestions
 * for a conversation. Used by the messaging copilot.
 */
import { useMutation } from '@tanstack/react-query';

interface SuggestRepliesResponse {
  suggestions?: string[];
  error?: string;
}

export function useSuggestReplies() {
  return useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string }): Promise<string[]> => {
      const res = await fetch('/api/messaging/ai/suggest-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ conversationId }),
      });

      const data = (await res.json().catch(() => ({}))) as SuggestRepliesResponse;

      if (!res.ok) {
        throw new Error(data.error || `Falha ao gerar sugestões (${res.status})`);
      }

      return data.suggestions ?? [];
    },
  });
}
