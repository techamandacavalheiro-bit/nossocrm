/**
 * @fileoverview Media Upload Mutation
 *
 * Hook para upload de mídia via signed URL flow:
 * 1. Envia metadados (JSON) para /api/messaging/media/upload
 * 2. Recebe { signedUrl, publicUrl, ... }
 * 3. Faz PUT do arquivo diretamente no Supabase Storage via signedUrl
 * 4. Retorna { mediaUrl, mediaType, mimeType, fileName, fileSize }
 *
 * Esse fluxo evita o limite de 4.5 MB do body em funções serverless da Vercel.
 *
 * @module lib/query/hooks/useMediaUploadMutation
 */

import { useMutation } from '@tanstack/react-query';

interface MediaUploadResult {
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  fileName: string;
  fileSize: number;
}

export function useMediaUploadMutation() {
  return useMutation({
    mutationFn: async ({
      file,
      conversationId,
    }: {
      file: File;
      conversationId: string;
    }): Promise<MediaUploadResult> => {
      // Step 1: Request a signed upload URL (no file in body)
      const metaResponse = await fetch('/api/messaging/media/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
        }),
      });

      if (!metaResponse.ok) {
        const error = await metaResponse.json();
        throw new Error(error.error || 'Failed to get upload URL');
      }

      const { signedUrl, publicUrl, mediaType, mimeType, fileName, fileSize } =
        await metaResponse.json();

      // Step 2: Upload file directly to Supabase Storage via signed URL
      const uploadResponse = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Direct upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
      }

      return { mediaUrl: publicUrl, mediaType, mimeType, fileName, fileSize };
    },
  });
}
