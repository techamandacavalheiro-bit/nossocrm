/**
 * UazAPI Webhook Handler
 *
 * Suporta o formato NATIVO do UazAPI (uazapiGO):
 * - { BaseUrl, EventType, chat: { wa_chatid, name, phone }, message: { id, body, fromMe, ... } }
 *
 * E também o formato de teste legado:
 * - { event, instance, data: { key: { remoteJid, id, fromMe }, ... } }
 *
 * Deploy: supabase functions deploy messaging-webhook-uazapi --no-verify-jwt
 */
import { createClient } from "npm:@supabase/supabase-js@2";

// =============================================================================
// TYPES
// =============================================================================

/** Formato nativo do UazAPI (uazapiGO-Webhook/1.0) */
interface UazApiNativePayload {
  BaseUrl: string;
  EventType: string; // "messages", "messages_update", "connection"
  chat?: {
    id?: string;
    name?: string;
    phone?: string;
    wa_chatid?: string; // "5544998685747@s.whatsapp.net"
    owner?: string;     // número do negócio
    wa_archived?: boolean;
  };
  message?: {
    // ID fields (spec: messageid = external ID)
    id?: string;
    messageid?: string;
    // Direction
    from?: string;
    fromMe?: boolean;
    // Type: spec uses "messageType" with values like "conversation", "imageMessage", etc.
    // Also accept "type" with short values like "text", "image", "audio"
    messageType?: string;
    type?: string;
    // Text content: spec field is "text", not "body"
    text?: string;
    body?: string;      // fallback / alternative name
    caption?: string;
    // Media
    fileURL?: string;   // spec field name for media URL
    mediaUrl?: string;  // fallback
    fileName?: string;
    docName?: string;   // spec uses docName for document filename
    // Location
    latitude?: number;
    longitude?: number;
    // Time: spec "messageTimestamp" in ms; "timestamp" may be in seconds
    messageTimestamp?: number;
    timestamp?: number;
    // Sender info
    senderName?: string;
    // Other
    quotedMessage?: unknown;
    quoted?: string;    // ID of quoted message (spec field)
  };
}

/** Formato legado (usado no test-webhook.sh) */
interface UazApiLegacyPayload {
  event: string;
  instance: string;
  data?: {
    key?: { remoteJid: string; id: string; fromMe: boolean };
    pushName?: string;
    message?: Record<string, unknown>;
    messageType?: string;
    messageTimestamp?: number;
    body?: string;
    status?: number | string;
  };
}

type AnyPayload = UazApiNativePayload | UazApiLegacyPayload | Record<string, unknown>;

// =============================================================================
// HELPERS
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, token",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function getTokenFromRequest(req: Request): string {
  // 1. Query param ?token= (UazAPI não envia headers de auth)
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token") || "";
  if (queryToken.trim()) return queryToken.trim();

  // 2. Header "token"
  const tokenHeader = req.headers.get("token") || "";
  if (tokenHeader.trim()) return tokenHeader.trim();

  // 3. Authorization: Bearer <token>
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Normaliza qualquer formato de número para +5511999999999 */
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

/** Detecta se o payload é do formato nativo UazAPI */
function isNativeFormat(payload: AnyPayload): payload is UazApiNativePayload {
  return typeof (payload as UazApiNativePayload).EventType === "string";
}

/** Extrai o tipo de evento de qualquer formato */
function extractEventType(payload: AnyPayload): string | undefined {
  const p = payload as Record<string, unknown>;
  const et = p.EventType ?? p.event;
  return typeof et === "string" ? et.toLowerCase() : undefined;
}

// =============================================================================
// MESSAGE TEXT / CONTENT EXTRACTION
// =============================================================================

function extractTextFromLegacyData(
  data: UazApiLegacyPayload["data"]
): { text: string; contentType: string; content: Record<string, unknown> } {
  if (!data) return { text: "[mensagem]", contentType: "text", content: { type: "text", text: "[mensagem]" } };

  const { messageType, message, body } = data;

  // body field (test script)
  if (body) return { text: body, contentType: "text", content: { type: "text", text: body } };
  if (!message) return { text: "[mensagem]", contentType: "text", content: { type: "text", text: "[mensagem]" } };

  switch (messageType) {
    case "conversation":
    case "extendedTextMessage": {
      const text = (message.conversation as string) || (message.text as string) || "[mensagem]";
      return { text, contentType: "text", content: { type: "text", text } };
    }
    case "imageMessage": {
      const caption = (message.caption as string) || "[imagem]";
      return { text: caption, contentType: "image", content: { type: "image", mediaUrl: (message.url as string) || "", caption } };
    }
    case "audioMessage":
      return { text: "[áudio]", contentType: "audio", content: { type: "audio", mediaUrl: (message.url as string) || "" } };
    case "videoMessage": {
      const caption = (message.caption as string) || "[vídeo]";
      return { text: caption, contentType: "video", content: { type: "video", mediaUrl: (message.url as string) || "", caption } };
    }
    case "documentMessage": {
      const fileName = (message.fileName as string) || "document";
      return { text: fileName, contentType: "document", content: { type: "document", mediaUrl: (message.url as string) || "", fileName } };
    }
    case "locationMessage": {
      const lat = (message.latitude as number) ?? 0;
      const lng = (message.longitude as number) ?? 0;
      const text = `[localização: ${lat}, ${lng}]`;
      return { text, contentType: "location", content: { type: "location", latitude: lat, longitude: lng } };
    }
    default:
      return { text: "[mensagem]", contentType: "text", content: { type: "text", text: `[${messageType || "mensagem"}]` } };
  }
}

/** Parse timestamp from UazAPI (may be seconds or milliseconds). */
function parseTimestamp(ts: number | undefined): Date {
  if (!ts) return new Date();
  return ts > 1e10 ? new Date(ts) : new Date(ts * 1000);
}

const MIME_TO_EXT: Record<string, string> = {
  // Images
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/bmp': 'bmp', 'image/tiff': 'tiff',
  // Video
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/webm': 'webm',
  'video/quicktime': 'mov', 'video/x-msvideo': 'avi',
  // Audio
  'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/amr': 'amr',
  'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/flac': 'flac', 'audio/opus': 'opus',
  // Documents
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip', 'application/x-rar-compressed': 'rar',
  'text/plain': 'txt', 'text/csv': 'csv',
  'application/octet-stream': 'bin',
};

/**
 * Fetches the public media URL from UazAPI via /message/download.
 * Simplicity over permanence: returns the UazAPI URL directly (valid ~2 days).
 *
 * This avoids all the failure modes of the previous download-and-reupload
 * approach (bucket size limits, MIME restrictions, edge-function OOM, 413s).
 *
 * Trade-off: URLs expire after UazAPI's retention window (~2 days). For a CRM
 * context this is acceptable since conversations are usually actioned well
 * inside that window.
 */
async function getMediaUrlFromUazApi(
  _supabase: ReturnType<typeof createClient>,
  {
    externalMessageId,
    serverUrl,
    token,
  }: {
    organizationId: string;
    conversationId: string;
    externalMessageId: string;
    serverUrl: string;
    token: string;
  }
): Promise<string | null> {
  console.log(`[UazAPI:media] GET url for msg=${externalMessageId}`);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    let fileUrl: string | undefined;
    try {
      const res = await fetch(`${serverUrl}/message/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ id: externalMessageId, return_link: true, generate_mp3: true }),
        signal: ctrl.signal,
      });
      console.log(`[UazAPI:media] /message/download status=${res.status}`);
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[UazAPI:media] download failed: ${errText.slice(0, 300)}`);
        return null;
      }
      const data = await res.json() as Record<string, unknown>;
      fileUrl = data.fileURL as string | undefined;
      console.log(`[UazAPI:media] fileURL=${fileUrl?.slice(0, 100)} mimetype=${data.mimetype}`);
    } finally {
      clearTimeout(timer);
    }

    if (!fileUrl?.startsWith('http')) {
      console.warn(`[UazAPI:media] invalid fileURL=${fileUrl}`);
      return null;
    }

    console.log(`[UazAPI:media] SUCCESS using UazAPI URL directly`);
    return fileUrl;
  } catch (err) {
    console.error(`[UazAPI:media] EXCEPTION: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function extractTextFromNativeMessage(
  msg: UazApiNativePayload["message"]
): { text: string; contentType: string; content: Record<string, unknown> } {
  if (!msg) return { text: "[mensagem]", contentType: "text", content: { type: "text", text: "[mensagem]" } };

  // UazAPI spec: messageType uses WhatsApp native names ("conversation", "imageMessage", etc.)
  // or short names ("text", "image", "audio", etc.) — handle both.
  const rawType = (msg.messageType ?? msg.type ?? "conversation").toLowerCase();

  // Text content: spec field is "text"; "body" is a legacy/fallback name.
  const msgText = msg.text ?? msg.body ?? "";
  // Only keep full http/https URLs; relative paths or empty strings result in ""
  const rawFileUrl = msg.fileURL ?? msg.mediaUrl ?? "";
  const fileUrl = rawFileUrl.startsWith('http') ? rawFileUrl : "";

  const isText = rawType === "conversation" || rawType === "extendedtextmessage" || rawType === "text" || rawType === "chat";
  const isImage = rawType === "imagemessage" || rawType === "image";
  const isAudio = rawType === "audiomessage" || rawType === "audio" || rawType === "ptt" || rawType === "myaudio";
  const isVideo = rawType === "videomessage" || rawType === "videoplaymessage" || rawType === "video";
  const isDocument = rawType === "documentmessage" || rawType === "document";
  const isLocation = rawType === "locationmessage" || rawType === "location";
  const isSticker = rawType === "stickermessage" || rawType === "sticker";
  const isReaction = rawType === "reactionmessage" || rawType === "reaction";
  const isContact = rawType === "contactmessage" || rawType === "contactsarraymessage" || rawType === "contact";
  const isPoll = rawType === "pollcreationmessage" || rawType === "poll";

  if (isImage) {
    const caption = msg.caption ?? msgText;
    return {
      text: caption || "[imagem]",
      contentType: "image",
      content: { type: "image", mediaUrl: fileUrl, caption: caption || undefined },
    };
  }
  if (isAudio) {
    return { text: "[áudio]", contentType: "audio", content: { type: "audio", mediaUrl: fileUrl } };
  }
  if (isVideo) {
    const caption = msg.caption ?? msgText;
    return {
      text: caption || "[vídeo]",
      contentType: "video",
      content: { type: "video", mediaUrl: fileUrl, caption: caption || undefined },
    };
  }
  if (isDocument) {
    const fileName = (msg.fileName ?? msg.docName ?? msgText) || "document";
    return {
      text: fileName,
      contentType: "document",
      content: { type: "document", mediaUrl: fileUrl, fileName },
    };
  }
  if (isLocation) {
    const lat = msg.latitude ?? 0;
    const lng = msg.longitude ?? 0;
    const locText = `[localização: ${lat}, ${lng}]`;
    return { text: locText, contentType: "location", content: { type: "location", latitude: lat, longitude: lng } };
  }
  if (isSticker) {
    return { text: "[figurinha]", contentType: "sticker", content: { type: "sticker", mediaUrl: fileUrl } };
  }
  if (isReaction) {
    return { text: "[reação]", contentType: "reaction", content: { type: "reaction", emoji: msgText || '' } };
  }
  if (isContact) {
    return { text: "[contato]", contentType: "contact", content: { type: "contact" } };
  }
  if (isPoll) {
    return { text: "[enquete]", contentType: "poll", content: { type: "poll" } };
  }
  if (isText) {
    const finalText = msgText || "[mensagem]";
    return { text: finalText, contentType: "text", content: { type: "text", text: finalText } };
  }
  // Unknown type — try to use text content
  const finalText = msgText || `[${rawType}]`;
  return { text: finalText, contentType: "text", content: { type: "text", text: finalText } };
}

// =============================================================================
// AI PROCESSING
// =============================================================================

async function triggerAIProcessing(params: {
  conversationId: string;
  organizationId: string;
  messageText: string;
  messageId?: string;
}): Promise<void> {
  const appUrl = Deno.env.get("APP_URL") || Deno.env.get("CRM_APP_URL") || "http://localhost:3000";
  const internalSecret = Deno.env.get("INTERNAL_API_SECRET");

  if (!internalSecret) return;

  try {
    const response = await fetch(`${appUrl}/api/messaging/ai/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": internalSecret },
      body: JSON.stringify(params),
    });
    if (!response.ok) console.warn(`[UazAPI] AI processing returned ${response.status}`);
  } catch (error) {
    console.warn("[UazAPI] Error triggering AI:", error instanceof Error ? error.message : error);
  }
}

// =============================================================================
// CHANNEL STATUS
// =============================================================================

async function updateChannelStatus(
  supabase: ReturnType<typeof createClient>,
  channelId: string,
  state: string
): Promise<void> {
  const map: Record<string, string> = {
    open: "connected", connected: "connected",
    close: "disconnected", disconnected: "disconnected",
    refused: "error",
  };
  const newStatus = map[state.toLowerCase()] ?? "disconnected";
  const { error } = await supabase.from("messaging_channels").update({ status: newStatus }).eq("id", channelId);
  if (error) console.error("[UazAPI] Failed to update channel status:", error);
  else console.log(`[UazAPI] Channel ${channelId} → ${newStatus}`);
}

// =============================================================================
// LEAD ROUTING
// =============================================================================

async function getLeadRoutingRule(
  supabase: ReturnType<typeof createClient>,
  channelId: string
): Promise<{ boardId: string; stageId: string | null } | null> {
  const { data, error } = await supabase
    .from("lead_routing_rules")
    .select("board_id, stage_id, enabled")
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error || !data || !data.enabled || !data.board_id) return null;
  return { boardId: data.board_id, stageId: data.stage_id };
}

async function autoCreateDeal(
  supabase: ReturnType<typeof createClient>,
  params: {
    organizationId: string;
    contactId: string;
    boardId: string;
    stageId?: string | null;
    conversationId: string;
    contactName: string;
  }
) {
  try {
    let stageId = params.stageId;
    if (!stageId) {
      const { data: firstStage, error: stageErr } = await supabase
        .from("board_stages")
        .select("id")
        .eq("board_id", params.boardId)
        .order("order", { ascending: true })
        .limit(1)
        .single();
      if (stageErr || !firstStage) { console.error("[UazAPI] No stage for auto-deal:", stageErr); return; }
      stageId = firstStage.id;
    }

    const { data: newDeal, error: dealErr } = await supabase
      .from("deals")
      .insert({
        organization_id: params.organizationId,
        board_id: params.boardId,
        stage_id: stageId,
        contact_id: params.contactId,
        title: `${params.contactName} - WhatsApp`,
        value: 0,
      })
      .select("id")
      .single();

    if (dealErr) { console.error("[UazAPI] Error auto-creating deal:", dealErr); return; }
    console.log(`[UazAPI] Auto-created deal: ${newDeal.id}`);
  } catch (error) {
    console.error("[UazAPI] Unexpected error in autoCreateDeal:", error);
  }
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

async function handleMessage(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string; organization_id: string; business_unit_id: string; external_identifier: string; credentials?: Record<string, unknown> | null },
  payload: AnyPayload
) {
  let phone: string | null;
  let isFromMe: boolean;
  let externalMessageId: string;
  let pushName: string | undefined;
  let text: string;
  let contentType: string;
  let content: Record<string, unknown>;
  let timestamp: Date;

  if (isNativeFormat(payload)) {
    // ── UazAPI native format ──
    const chat = payload.chat;
    const msg = payload.message;

    console.log("[UazAPI] Native format — chat.wa_chatid:", chat?.wa_chatid,
      "msg.messageType:", msg?.messageType, "msg.type:", msg?.type,
      "msg.text:", (msg?.text ?? msg?.body)?.slice(0, 80));
    // Log all message keys + fileURL specifically for media debugging
    if (msg) {
      console.log("[UazAPI] message keys:", Object.keys(msg).join(","),
        "| fileURL:", msg.fileURL, "| mediaUrl:", msg.mediaUrl,
        "| messageid:", msg.messageid ?? msg.id);
    }
    console.log("[UazAPI] BaseUrl:", payload.BaseUrl);

    const rawJid = chat?.wa_chatid || "";
    phone = normalizePhone(rawJid.split("@")[0] || chat?.phone);
    if (!phone) { console.warn("[UazAPI] Could not extract phone from chat"); return; }

    // Determine direction: if message.from matches owner number → outbound
    const ownerDigits = (chat?.owner || "").replace(/\D/g, "");
    const fromDigits = (msg?.from || "").replace(/\D/g, "");
    isFromMe = msg?.fromMe === true || (ownerDigits.length > 0 && fromDigits === ownerDigits);

    // spec: messageid = external provider ID
    externalMessageId = msg?.messageid ?? msg?.id ?? `native_${Date.now()}`;
    // spec: senderName = display name; fallback to chat.name
    pushName = msg?.senderName ?? chat?.name ?? undefined;
    // spec: messageTimestamp (ms) or timestamp (seconds)
    timestamp = parseTimestamp(msg?.messageTimestamp ?? msg?.timestamp);

    const extracted = extractTextFromNativeMessage(msg);
    text = extracted.text;
    contentType = extracted.contentType;
    content = extracted.content;

  } else {
    // ── Legacy / test format ──
    const leg = payload as UazApiLegacyPayload;
    const data = leg.data;
    if (!data?.key) { console.warn("[UazAPI] Legacy format: missing data.key"); return; }

    const remoteJid = data.key.remoteJid;
    if (remoteJid.includes("@g.us") || remoteJid === "status@broadcast") return;

    phone = normalizePhone(remoteJid.split("@")[0]);
    if (!phone) { console.warn("[UazAPI] Could not normalize remoteJid:", remoteJid); return; }

    isFromMe = data.key.fromMe === true;
    externalMessageId = data.key.id;
    pushName = data.pushName;
    timestamp = data.messageTimestamp ? new Date(data.messageTimestamp * 1000) : new Date();

    const extracted = extractTextFromLegacyData(data);
    text = extracted.text;
    contentType = extracted.contentType;
    content = extracted.content;
  }

  const direction = isFromMe ? "outbound" : "inbound";
  console.log(`[UazAPI] Processing ${direction} message from ${phone}`);

  // Find or create conversation
  const { data: existingConv, error: convFindErr } = await supabase
    .from("messaging_conversations")
    .select("id, contact_id")
    .eq("channel_id", channel.id)
    .eq("external_contact_id", phone)
    .maybeSingle();

  if (convFindErr) throw convFindErr;

  let conversationId: string;
  let contactId: string | null = null;

  if (existingConv) {
    conversationId = existingConv.id;
    contactId = existingConv.contact_id;
    console.log(`[UazAPI] Found existing conversation: ${conversationId}`);
  } else {
    // Find or create contact
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", channel.organization_id)
      .eq("phone", phone)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: newContact, error: contactErr } = await supabase
        .from("contacts")
        .insert({ organization_id: channel.organization_id, name: pushName || phone, phone, email: null })
        .select("id")
        .single();
      if (contactErr) throw contactErr;
      contactId = newContact.id;
      console.log(`[UazAPI] Created contact: ${contactId}`);
    }

    // Create conversation
    const { data: newConv, error: convErr } = await supabase
      .from("messaging_conversations")
      .insert({
        organization_id: channel.organization_id,
        channel_id: channel.id,
        business_unit_id: channel.business_unit_id,
        contact_id: contactId,
        external_contact_id: phone,
        external_contact_name: pushName || phone,
        status: "open",
      })
      .select("id")
      .single();

    if (convErr) throw convErr;
    conversationId = newConv.id;
    console.log(`[UazAPI] Created conversation: ${conversationId}`);

    // Lead routing
    const routingRule = await getLeadRoutingRule(supabase, channel.id);
    if (routingRule) {
      await autoCreateDeal(supabase, {
        organizationId: channel.organization_id,
        contactId: contactId!,
        boardId: routingRule.boardId,
        stageId: routingRule.stageId,
        conversationId,
        contactName: pushName || phone,
      });
    }
  }

  // For inbound media with no URL: fetch public URL from UazAPI
  const MEDIA_CONTENT_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];
  const currentMediaUrl = content.mediaUrl as string | undefined;
  const isMediaType = MEDIA_CONTENT_TYPES.includes(contentType);
  const needsFetch = !isFromMe && isMediaType && !currentMediaUrl && !externalMessageId.startsWith('native_');

  console.log(`[UazAPI:media-check] type=${contentType} isMedia=${isMediaType} isFromMe=${isFromMe} hasUrl=${!!currentMediaUrl} msgId=${externalMessageId} needsFetch=${needsFetch}`);

  if (needsFetch) {
    const creds = (channel.credentials ?? {}) as Record<string, unknown>;
    const baseUrl = isNativeFormat(payload) ? (payload.BaseUrl ?? "") : "";
    const serverUrl = (baseUrl || (creds.serverUrl as string | undefined) || "").replace(/\/$/, '');
    const credToken = (creds.token as string | undefined) ?? "";

    if (serverUrl && credToken) {
      const mediaUrl = await getMediaUrlFromUazApi(supabase, {
        organizationId: channel.organization_id,
        conversationId,
        externalMessageId,
        serverUrl,
        token: credToken,
      });
      if (mediaUrl) {
        content = { ...content, mediaUrl };
        console.log(`[UazAPI:media-check] mediaUrl set=${mediaUrl.slice(0, 80)}`);
      } else {
        console.warn(`[UazAPI:media-check] getMediaUrlFromUazApi returned null — storing empty`);
      }
    } else {
      console.warn(`[UazAPI:media-check] missing serverUrl/token — skipping fetch`);
    }
  }

  // Insert message
  const { error: msgErr } = await supabase.from("messaging_messages").insert({
    conversation_id: conversationId,
    external_id: externalMessageId,
    direction,
    content_type: contentType,
    content,
    status: isFromMe ? "sent" : "delivered",
    sent_at: isFromMe ? timestamp.toISOString() : null,
    delivered_at: !isFromMe ? timestamp.toISOString() : null,
    sender_name: pushName ?? null,
  });

  if (msgErr) { console.error("[UazAPI] Error inserting message:", msgErr); throw msgErr; }

  // Update conversation preview
  await supabase.from("messaging_conversations").update({
    last_message_at: timestamp,
    last_message_preview: text,
  }).eq("id", conversationId);

  // Trigger AI for inbound text only.
  // Skip placeholders (text starts with '[') — these come from non-text content
  // types we couldn't fully parse (stickers, reactions, polls, view-once, etc.)
  // and would make the AI reply with confused/error messages.
  const isPlaceholder = text.startsWith('[');
  if (!isFromMe && contentType === "text" && text && !isPlaceholder) {
    await triggerAIProcessing({ conversationId, organizationId: channel.organization_id, messageText: text, messageId: externalMessageId });
  } else if (!isFromMe && contentType === "text" && isPlaceholder) {
    console.log(`[UazAPI] Skipping AI trigger for placeholder text: "${text}"`);
  }
}

async function handleMessageUpdate(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string },
  payload: AnyPayload
) {
  // Native format: status update
  if (isNativeFormat(payload)) {
    const msg = payload.message;
    if (!msg?.id) return;
    // Native format may not carry a numeric status — skip for now
    console.log("[UazAPI] Native messages_update — msg.id:", msg.id);
    return;
  }

  // Legacy format
  const leg = payload as UazApiLegacyPayload;
  const data = leg.data;
  if (!data?.key?.id || data.status === undefined || data.status === null) return;

  const statusMap: Record<string, string> = {
    "0": "pending", "1": "sent", "2": "sent", "3": "delivered", "4": "read", "5": "played",
    PENDING: "pending", SENT: "sent", SERVER_ACK: "sent",
    DELIVERY_ACK: "delivered", DELIVERED: "delivered", READ: "read", PLAYED: "played",
  };
  const statusKey = String(data.status).toUpperCase();
  const status = statusMap[statusKey] ?? statusMap[String(data.status)] ?? null;
  if (!status) return;

  const { data: convs } = await supabase.from("messaging_conversations").select("id").eq("channel_id", channel.id);
  if (!convs?.length) return;

  const updates: Record<string, unknown> = { status };
  const now = new Date().toISOString();
  if (status === "delivered") updates.delivered_at = now;
  else if (status === "read") updates.read_at = now;
  else if (status === "sent") updates.sent_at = now;

  await supabase.from("messaging_messages")
    .update(updates)
    .eq("external_id", data.key.id)
    .in("conversation_id", convs.map((c: { id: string }) => c.id));
}

async function handleConnectionUpdate(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string },
  payload: AnyPayload
) {
  const p = payload as Record<string, unknown>;
  const state = String(
    (p.data as Record<string, unknown>)?.state ??
    p.state ??
    "close"
  );
  await updateChannelStatus(supabase, channel.id, state);
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método não permitido" });

  const url = new URL(req.url);
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const channelId = url.pathname.match(uuidRegex)?.[0] ?? null;
  if (!channelId) return json(400, { error: "channel_id ausente na URL" });

  // Parse payload — handle both array and object
  let payload: AnyPayload;
  try {
    const raw = await req.json();
    console.log("[UazAPI] RAW top-level keys:", Object.keys(raw as object).join(", "));
    console.log("[UazAPI] RAW EventType:", (raw as Record<string,unknown>).EventType, "event:", (raw as Record<string,unknown>).event);
    payload = (Array.isArray(raw) ? raw[0] : raw) as AnyPayload;
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const supabaseUrl = Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SECRET_KEY") ??
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase não configurado" });

  const supabase = createClient(supabaseUrl, serviceKey);

  // Fetch channel
  const { data: channel, error: channelErr } = await supabase
    .from("messaging_channels")
    .select("id, organization_id, business_unit_id, external_identifier, status, credentials")
    .eq("id", channelId)
    .in("status", ["connected", "active"])
    .maybeSingle();

  if (channelErr) { console.error("[UazAPI] Error fetching channel:", channelErr); return json(200, { ok: false, error: "Erro ao buscar canal" }); }
  if (!channel) return json(200, { ok: false, error: "Canal não encontrado ou desconectado" });

  // Auth
  const credentials = (channel.credentials ?? {}) as Record<string, string>;
  const envSecret = (Deno.env.get("UAZAPI_WEBHOOK_SECRET") ?? "").trim();
  const channelToken = (credentials.webhookSecret ?? credentials.token ?? "").trim();
  const providedKey = getTokenFromRequest(req);

  console.log("[UazAPI] Auth check", { channelId: channel.id, hasProvidedKey: providedKey.length > 0, hasEnvSecret: envSecret.length > 0, hasChannelToken: channelToken.length > 0, providedKeyPrefix: providedKey.slice(0, 8) });

  if (!providedKey && (envSecret || channelToken)) {
    console.warn("[UazAPI] Missing token");
    return json(401, { error: "Token ausente" });
  }
  if (providedKey && (envSecret || channelToken)) {
    const matchesEnv = envSecret.length > 0 && timingSafeEqual(providedKey, envSecret);
    const matchesChannel = channelToken.length > 0 && timingSafeEqual(providedKey, channelToken);
    if (!matchesEnv && !matchesChannel) {
      console.warn("[UazAPI] Token mismatch");
      return json(401, { error: "Token inválido" });
    }
  }

  try {
    const event = extractEventType(payload);
    console.log(`[UazAPI] Event: ${event}`);

    if (event === "message" || event === "messages" || event === "messages.upsert") {
      await handleMessage(supabase, channel, payload);
    } else if (event === "messages_update" || event === "messages.update" || event === "message_update" || event === "message.update") {
      await handleMessageUpdate(supabase, channel, payload);
    } else if (event === "connection" || event === "connection.update") {
      await handleConnectionUpdate(supabase, channel, payload);
    } else {
      console.log(`[UazAPI] Unhandled event: ${event}`);
    }

    return json(200, { ok: true, event });
  } catch (error) {
    console.error("[UazAPI] Webhook processing error:", error);
    return json(200, { ok: false, error: "Erro ao processar webhook", details: error instanceof Error ? error.message : "Unknown error" });
  }
});
