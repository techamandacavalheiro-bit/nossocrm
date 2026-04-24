/**
 * Hook que reescreve um rascunho do atendente em um tom específico.
 */
import { useMutation } from '@tanstack/react-query';

export type ImproveTone =
  | 'general'
  | 'professional'
  | 'casual'
  | 'shorter'
  | 'empathetic';

interface ImproveInput {
  conversationId: string;
  draft: string;
  tone?: ImproveTone;
}

interface ImproveResponse {
  improved?: string;
  error?: string;
}

export function useImproveDraft() {
  return useMutation({
    mutationFn: async ({ conversationId, draft, tone = 'general' }: ImproveInput): Promise<string> => {
      const res = await fetch('/api/messaging/ai/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ conversationId, draft, tone }),
      });

      const data = (await res.json().catch(() => ({}))) as ImproveResponse;

      if (!res.ok) {
        throw new Error(data.error || `Falha (${res.status})`);
      }

      return data.improved ?? '';
    },
  });
}
