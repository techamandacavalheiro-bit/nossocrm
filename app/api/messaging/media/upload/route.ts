/**
 * POST /api/messaging/media/upload
 *
 * Returns a signed upload URL so the client can PUT the file directly to
 * Supabase Storage, bypassing the 4.5 MB Vercel serverless body limit.
 *
 * Request body (JSON):
 *   { conversationId, fileName, mimeType, fileSize }
 *
 * Response (JSON):
 *   { signedUrl, path, publicUrl, mediaType, mimeType, fileName, fileSize }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;
import crypto from 'crypto';

// WhatsApp limits (Meta API v25 — https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB (Meta limit: 5MB)
const MAX_VIDEO_SIZE = 16 * 1024 * 1024; // 16MB (Meta limit: 16MB post-processing)
const MAX_AUDIO_SIZE = 16 * 1024 * 1024; // 16MB
const MAX_DOCUMENT_SIZE = 100 * 1024 * 1024; // 100MB

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/3gpp'];
const ALLOWED_AUDIO_TYPES = ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/webm'];
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

function getMediaType(mimeType: string): 'image' | 'video' | 'audio' | 'document' | null {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return 'image';
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return 'video';
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return 'audio';
  if (ALLOWED_DOCUMENT_TYPES.includes(mimeType)) return 'document';
  return null;
}

function getMaxSize(mediaType: string): number {
  switch (mediaType) {
    case 'image': return MAX_IMAGE_SIZE;
    case 'video': return MAX_VIDEO_SIZE;
    case 'audio': return MAX_AUDIO_SIZE;
    case 'document': return MAX_DOCUMENT_SIZE;
    default: return MAX_DOCUMENT_SIZE;
  }
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/amr': 'amr', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt', 'text/csv': 'csv',
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get user profile for org check
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Parse JSON metadata — no file in the body
  let body: { conversationId?: string; fileName?: string; mimeType?: string; fileSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { conversationId, fileName, mimeType, fileSize } = body;

  if (!conversationId || !fileName || !mimeType || fileSize == null) {
    return NextResponse.json(
      { error: 'conversationId, fileName, mimeType and fileSize are required' },
      { status: 400 }
    );
  }

  // Validate conversation belongs to org
  const { data: conversation } = await supabase
    .from('messaging_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  // Validate MIME type
  const mediaType = getMediaType(mimeType);
  if (!mediaType) {
    return NextResponse.json(
      { error: `Tipo de arquivo não suportado: ${mimeType}` },
      { status: 400 }
    );
  }

  // Validate file size declared by client
  const maxSize = getMaxSize(mediaType);
  if (fileSize > maxSize) {
    const maxMB = Math.round(maxSize / (1024 * 1024));
    return NextResponse.json(
      { error: `Arquivo excede o limite de ${maxMB}MB para ${mediaType}` },
      { status: 400 }
    );
  }

  try {
    const ext = MIME_TO_EXT[mimeType] || 'bin';
    const uniqueId = crypto.randomUUID();
    const storagePath = `${profile.organization_id}/${conversationId}/${uniqueId}.${ext}`;

    // Create a signed upload URL (client will PUT directly to Supabase Storage)
    const { data: signedData, error: signedError } = await supabase.storage
      .from('messaging-media')
      .createSignedUploadUrl(storagePath);

    if (signedError || !signedData) {
      console.error('[API] Failed to create signed upload URL:', signedError);
      return NextResponse.json(
        { error: 'Failed to create upload URL' },
        { status: 500 }
      );
    }

    // Compute the public URL (will be valid once the client uploads)
    const { data: urlData } = supabase.storage
      .from('messaging-media')
      .getPublicUrl(storagePath);

    return NextResponse.json({
      signedUrl: signedData.signedUrl,
      path: storagePath,
      publicUrl: urlData.publicUrl,
      mediaType,
      mimeType,
      fileName,
      fileSize,
    });
  } catch (error) {
    console.error('[API] Media upload error:', error);
    return NextResponse.json(
      { error: 'Failed to create upload URL' },
      { status: 500 }
    );
  }
}
