/**
 * Hooks para o Copiloto de Vendas (4 ações).
 */
import { useMutation } from '@tanstack/react-query';

export type CopilotAction = 'suggest' | 'analyze' | 'objection' | 'ask';

export interface CopilotResponse {
  type?: 'suggestions' | 'analysis' | 'objection' | 'answer';
  suggestions?: string[];
  text?: string;
  error?: string;
}

interface CopilotInput {
  conversationId: string;
  action: CopilotAction;
  userInput?: string;
}

export function useCopilot() {
  return useMutation({
    mutationFn: async (input: CopilotInput): Promise<CopilotResponse> => {
      const res = await fetch('/api/messaging/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => ({}))) as CopilotResponse;
      if (!res.ok) {
        throw new Error(data.error || `Falha (${res.status})`);
      }
      return data;
    },
  });
}
