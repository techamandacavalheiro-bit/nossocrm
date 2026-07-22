'use client';

import React, { memo } from 'react';
import { cn } from '@/lib/utils';

interface ChannelBadgeProps {
  /** Nome do canal (messaging_channels.name) */
  name: string;
  /** Apelido curto opcional (settings.short) — cai no name quando ausente */
  shortName?: string;
  /** Cor de identidade (settings.color). Sem cor, usa o cinza neutro. */
  color?: string;
  className?: string;
}

const COR_PADRAO = '#64748b';

/**
 * Etiqueta de origem: diz de QUAL número/instância veio a conversa ou o negócio.
 * O ChannelIndicator distingue apenas o tipo (WhatsApp, Instagram…) — com duas
 * instâncias de WhatsApp ele fica ambíguo, e é esse buraco que este badge cobre.
 */
export const ChannelBadge = memo(function ChannelBadge({
  name,
  shortName,
  color,
  className,
}: ChannelBadgeProps) {
  const cor = color || COR_PADRAO;
  const label = shortName || name;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
        'text-[10px] font-medium leading-none whitespace-nowrap',
        className
      )}
      style={{ backgroundColor: `${cor}1a`, color: cor }}
      title={`Origem: ${name}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: cor }}
      />
      {label}
    </span>
  );
});
