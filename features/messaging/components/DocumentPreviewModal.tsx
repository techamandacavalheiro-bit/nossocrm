'use client';

import React, { memo, useCallback, useEffect } from 'react';
import { X, Download, FileText, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sanitizeUrl } from '@/lib/utils/sanitize';

interface DocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  mediaUrl: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
}

/** MIME types/extensions the browser can render directly via iframe or <object>. */
const NATIVE_PREVIEW_MIME = new Set<string>([
  'application/pdf',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Extensions that Google/Office viewer can render (non-native). */
const OFFICE_EXTENSIONS = new Set<string>(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Document preview modal.
 *
 * - PDFs + text + images: rendered natively via iframe
 * - Office docs (doc/docx/xls/xlsx/ppt/pptx): rendered via Google Docs viewer
 * - Unknown types: shows metadata + download-only fallback
 */
export const DocumentPreviewModal = memo(function DocumentPreviewModal({
  open,
  onClose,
  mediaUrl,
  fileName,
  fileSize,
  mimeType,
}: DocumentPreviewModalProps) {
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

  if (!open) return null;

  const ext = getExtension(fileName);
  // Detect MIME from extension too (UazAPI often sends fileName="document" with no ext, no mime)
  const MIME_FROM_EXT: Record<string, string> = {
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif',
  };
  const inferredMime = MIME_FROM_EXT[ext] ?? mimeType ?? '';
  const isNativePreview = NATIVE_PREVIEW_MIME.has(inferredMime);
  const isOfficePreview = OFFICE_EXTENSIONS.has(ext);
  // If we have a URL but no recognized type, try Google Docs viewer anyway —
  // it accepts most formats and will render "cannot preview" if it can't.
  const useGoogleFallback = !!safeUrl && !isNativePreview && !isOfficePreview;
  const canPreview = !!safeUrl;

  const previewSrc = isNativePreview
    ? safeUrl
    : (isOfficePreview || useGoogleFallback)
      ? `https://docs.google.com/viewer?url=${encodeURIComponent(safeUrl)}&embedded=true`
      : '';

  const sizeLabel = formatFileSize(fileSize);

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Pré-visualização: ${fileName}`}
    >
      <div
        className={cn(
          'relative w-full max-w-5xl h-[90vh] flex flex-col',
          'bg-white dark:bg-slate-900 rounded-xl shadow-2xl overflow-hidden',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <FileText className="w-5 h-5 text-primary-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-900 dark:text-white truncate">{fileName}</p>
            {sizeLabel && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{sizeLabel}</p>
            )}
          </div>

          {/* Download button */}
          {safeUrl && (
            <a
              href={safeUrl}
              download={fileName}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                'bg-primary-500 hover:bg-primary-600 text-white',
              )}
              title="Baixar arquivo"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Baixar</span>
            </a>
          )}

          {/* Open in new tab */}
          {safeUrl && canPreview && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Abrir em nova aba"
              aria-label="Abrir em nova aba"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Fechar"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-950">
          {canPreview ? (
            <iframe
              src={previewSrc}
              title={fileName}
              className="w-full h-full border-0"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <FileText className="w-16 h-16 text-slate-400 mb-4" />
              <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">
                Pré-visualização não disponível
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Este tipo de arquivo não pode ser exibido no navegador.
              </p>
              {safeUrl && (
                <a
                  href={safeUrl}
                  download={fileName}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Baixar {fileName}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
