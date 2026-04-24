-- Migration: expand allowed MIME types for messaging-media bucket
--
-- The edge function webhook downloads inbound media from UazAPI's /message/download
-- endpoint and uploads it to Supabase Storage. The original bucket policy restricted
-- the allowed MIME types to a small set, causing uploads to fail silently when
-- UazAPI returned audio/webm, audio/ogg (Opus), or other common WhatsApp media
-- formats. This migration expands the allowed list and also increases the file
-- size limit for video.

UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY[
    -- Images
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff',
    -- Video
    'video/mp4', 'video/3gpp', 'video/webm', 'video/quicktime', 'video/x-msvideo',
    -- Audio (WhatsApp + common formats)
    'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/webm',
    'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/opus',
    -- Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    'text/plain', 'text/csv',
    -- Fallback for unknown binary data (edge-function downloads may hit this)
    'application/octet-stream'
  ],
  file_size_limit = 104857600 -- 100MB
WHERE id = 'messaging-media';
