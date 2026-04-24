-- Migration: increase file size limit on messaging-media bucket to 500MB
--
-- WhatsApp allows inbound videos up to 2GB (and users can send large video files
-- even when the business API limits outbound to 16MB). The previous 100MB ceiling
-- was rejecting uploads with HTTP 413 "The object exceeded the maximum allowed size",
-- so the edge function was unable to persist larger videos to Supabase Storage.
--
-- The edge function itself will cap in-memory downloads at ~200MB (to stay within
-- edge-runtime memory), and will fall back to the UazAPI temporary URL (2-day TTL)
-- for files that exceed that threshold. This bucket limit is a bit higher so that
-- uploads ≤200MB can actually be persisted.

UPDATE storage.buckets
SET file_size_limit = 524288000 -- 500MB
WHERE id = 'messaging-media';
