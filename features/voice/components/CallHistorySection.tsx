'use client';

/**
 * @fileoverview Call History Section
 *
 * Lista de chamadas de voz vinculadas a um deal.
 * Exibe direção, contato, duração, status e timestamp.
 *
 * @module features/voice/components/CallHistorySection
 */

import { useVoiceCallsQuery } from '@/lib/query/hooks/useVoiceCallsQuery';
import { Phone, PhoneIncoming, PhoneOutgoing, Loader2 } from 'lucide-react';
import type { VoiceCallListItem } from '@/lib/voice/elevenlabs.types';

interface CallHistorySectionProps {
  dealId: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  in_progress: { label: 'Em andamento', color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20' },
  completed: { label: 'Concluída', color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20' },
  failed: { label: 'Falha', color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20' },
  no_answer: { label: 'Sem resposta', color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20' },
};

const MODE_LABELS: Record<string, string> = {
  ai_agent: 'IA',
  human_call: 'Humano',
};

const CHANNEL_LABELS: Record<string, string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
};

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function CallRow({ call }: { call: VoiceCallListItem }) {
  const statusInfo = STATUS_LABELS[call.status] ?? { label: call.status, color: 'text-slate-500 bg-slate-50' };
  const DirectionIcon = call.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;

  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg">
      <div className={`p-2 rounded-lg ${call.direction === 'inbound' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'}`}>
        <DirectionIcon size={16} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {call.contact?.name ?? 'Contato desconhecido'}
          </span>
          <span className="text-xs text-slate-400">
            {CHANNEL_LABELS[call.channel] ?? call.channel} • {MODE_LABELS[call.mode] ?? call.mode}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {formatDateTime(call.started_at)}
          </span>
          <span className="text-xs text-slate-400">•</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {formatDuration(call.duration_seconds)}
          </span>
        </div>
      </div>

      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.color}`}>
        {statusInfo.label}
      </span>
    </div>
  );
}

export function CallHistorySection({ dealId }: CallHistorySectionProps) {
  const { data: calls, isLoading, error } = useVoiceCallsQuery(dealId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-sm text-red-500">
        Erro ao carregar chamadas
      </div>
    );
  }

  if (!calls || calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Phone size={40} strokeWidth={1.5} className="mb-3 opacity-50" />
        <p className="text-sm font-medium">Nenhuma chamada registrada</p>
        <p className="text-xs mt-1">Chamadas de voz aparecerão aqui</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
          Histórico de Chamadas
        </h3>
        <span className="text-xs text-slate-400">
          {calls.length} chamada{calls.length !== 1 ? 's' : ''}
        </span>
      </div>
      {calls.map((call) => (
        <CallRow key={call.id} call={call} />
      ))}
    </div>
  );
}
