'use client';

import React, { memo, useCallback, useEffect } from 'react';
import { X, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sanitizeUrl } from '@/lib/utils/sanitize';

interface VideoPreviewModalProps {
  open: boolean;
  onClose: () => void;
  mediaUrl: string;
  caption?: string;
  fileName?: string;
}

/** Lightbox-style modal for video playback (larger player than the inline bubble). */
export const VideoPreviewModal = memo(function VideoPreviewModal({
  open,
  onClose,
  mediaUrl,
  caption,
  fileName,
}: VideoPreviewModalProps) {
  const safeUrl = sanitizeUrl(mediaUrl);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open || !safeUrl) return null;

  const downloadName = fileName || 'video.mp4';

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pré-visualização de vídeo"
    >
      <div
        className={cn(
          'relative w-full max-w-5xl max-h-[90vh] flex flex-col',
          'rounded-xl overflow-hidden',
        )}
      >
        {/* Close button - top right */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          title="Fechar"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Download button - top right, next to close */}
        <a
          href={safeUrl}
          download={downloadName}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 right-14 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          title="Baixar vídeo"
          aria-label="Baixar vídeo"
        >
          <Download className="w-5 h-5" />
        </a>

        {/* Video player */}
        <video
          src={safeUrl}
          controls
          autoPlay
          className="w-full max-h-[85vh] object-contain bg-black"
        />

        {/* Caption */}
        {caption && (
          <div className="bg-black/50 text-white text-sm px-4 py-2">
            {caption}
          </div>
        )}
      </div>
    </div>
  );
});
