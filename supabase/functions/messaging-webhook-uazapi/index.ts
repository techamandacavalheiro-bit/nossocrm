/**
 * UazAPI Webhook Handler
 *
 * Recebe eventos da UazAPI (mensagens, status, etc.) e processa:
 * - Mensagens recebidas → cria/atualiza conversa + insere mensagem
 * - Status updates → atualiza status da mensagem
 * - Connection updates → atualiza status do canal
 *
 * Rota:
 * - `POST /functions/v1/messaging-webhook-uazapi/<channel_id>`
 *
 * Autenticação:
 * - Header `token` verificado contra `UAZAPI_WEBHOOK_SECRET`
 *   (global) ou, se ausente, contra o `token` nos credentials do canal.
 * - Nunca aceita sem auth (default-deny).
 *
 * Deploy:
 * - Esta função deve ser deployada com `--no-verify-jwt` pois recebe
 *   chamadas externas da UazAPI sem JWT do Supabase.
 * - Exemplo: `supabase functions deploy messaging-webhook-uazapi --no-verify-jwt`
 */
import { createClient } from "npm:@supabase/supabase-js@2";

// =============================================================================
// TYPES
// =============================================================================

interface UazApiMessageKey {
  remoteJid: string;
  id: string;
  fromMe: boolean;
}

interface UazApiMessagePayload {
  event: string;
  instance: string;
  data?: {
    key?: UazApiMessageKey;
    pushName?: string;
    senderNumber?: string;
    message?: Record<string, unknown>;
    messageType?: string;
    messageTimestamp?: number;
    body?: string;
    status?: number;
  };
}

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
  const token = req.headers.get("token") || "";
  return token.trim();
}

/**
 * Normalize remoteJid to a clean phone number (no +).
 * Handles @s.whatsapp.net suffix.
 */
function normalizeRemoteJid(remoteJid: string): string | null {
  if (!remoteJid) return null;
  const phone = remoteJid.split("@")[0];
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

/**
 * Extract text preview from UazAPI message by messageType.
 */
function extractMessageText(data: UazApiMessagePayload["data"]): string {
  if (!data) return "[mensagem]";
  
  const { messageType, message, body } = data;
  
  // Fallback to body field
  if (body) return body;
  if (!message) return "[mensagem]";

  switch (messageType) {
    case "conversation":
    case "extendedTextMessage":
      return (message.text as string) || "[mensagem]";
    case "imageMessage":
      return (message.caption as string) || "[imagem]";
    case "audioMessage":
      return "[áudio]";
    case "videoMessage":
      return (message.caption as string) || "[vídeo]";
    case "documentMessage":
      return (message.fileName as string) || "[documento]";
    case "locationMessage": {
      const lat = message.latitude ?? 0;
      const lng = message.longitude ?? 0;
      return `[localização: ${lat}, ${lng}]`;
    }
    default:
      return "[mensagem]";
  }
}

/**
 * Extract structured content from UazAPI message by messageType.
 */
function extractMessageContent(
  data: UazApiMessagePayload["data"]
): { contentType: string; content: Record<string, unknown> } {
  if (!data) {
    return { contentType: "text", content: { type: "text", text: "[mensagem]" } };
  }

  const { messageType, message, body } = data;

  switch (messageType) {
    case "conversation":
    case "extendedTextMessage":
      return {
        contentType: "text",
        content: { type: "text", text: (message?.text as string) || body || "[mensagem]" },
      };
    case "imageMessage":
      return {
        contentType: "image",
        content: {
          type: "image",
          mediaUrl: (message?.url as string) || "",
          caption: message?.caption as string,
        },
      };
    case "audioMessage":
      return {
        contentType: "audio",
        content: { type: "audio", mediaUrl: (message?.url as string) || "" },
      };
    case "videoMessage":
      return {
        contentType: "video",
        content: {
          type: "video",
          mediaUrl: (message?.url as string) || "",
          caption: message?.caption as string,
        },
      };
    case "documentMessage": {
      return {
        contentType: "document",
        content: {
          type: "document",
          mediaUrl: (message?.url as string) || "",
          fileName: (message?.fileName as string) || "document",
        },
      };
    }
    case "locationMessage": {
      return {
        contentType: "location",
        content: {
          type: "location",
          latitude: (message?.latitude as number) ?? 0,
          longitude: (message?.longitude as number) ?? 0,
        },
      };
    }
    default:
      return {
        contentType: "text",
        content: { type: "text", text: `[${messageType || "mensagem"}]` },
      };
  }
}

/**
 * Map UazAPI numeric status to internal string status.
 * 1→sent, 2→sent, 3→delivered, 4→read
 */
function mapNumericStatus(status: number): string | null {
  const map: Record<number, string> = {
    1: "sent",
    2: "sent",
    3: "delivered",
    4: "read",
  };
  return map[status] ?? null;
}

/**
 * Trigger AI Agent processing for inbound message.
 */
async function triggerAIProcessing(params: {
  conversationId: string;
  organizationId: string;
  messageText: string;
  messageId?: string;
}): Promise<void> {
  const appUrl = Deno.env.get("APP_URL") || Deno.env.get("CRM_APP_URL") || "http://localhost:3000";
  const internalSecret = Deno.env.get("INTERNAL_API_SECRET");

  if (!internalSecret) {
    console.warn("[UazAPI] INTERNAL_API_SECRET not set, skipping AI processing");
    return;
  }

  const endpoint = `${appUrl}/api/messaging/ai/process`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": internalSecret,
      },
      body: JSON.stringify({
        conversationId: params.conversationId,
        organizationId: params.organizationId,
        messageText: params.messageText,
        messageId: params.messageId,
      }),
    });

    if (!response.ok) {
      console.warn(`[UazAPI] AI processing returned ${response.status}`);
    }
  } catch (error) {
    console.warn("[UazAPI] Error triggering AI processing:", error instanceof Error ? error.message : error);
  }
}

/**
 * Update channel status based on connection state.
 */
async function updateChannelStatus(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string },
  state: string
): Promise<void> {
  const statusMap: Record<string, "connected" | "disconnected" | "error"> = {
    open: "connected",
    close: "disconnected",
    refused: "error",
  };

  const newStatus = statusMap[state] ?? "disconnected";

  const { error } = await supabase
    .from("messaging_channels")
    .update({ status: newStatus })
    .eq("id", channel.id);

  if (error) {
    console.error("[UazAPI] Failed to update channel status:", error, { state, channelId: channel.id });
  } else {
    console.log(`[UazAPI] Channel ${channel.id} status → ${newStatus}`);
  }
}

/**
 * Get lead routing rule for auto-deal creation.
 */
async function getLeadRoutingRule(
  supabase: ReturnType<typeof createClient>,
  channelId: string
): Promise<{ boardId: string; stageId: string | null } | null> {
  const { data, error } = await supabase
    .from("lead_routing_rules")
    .select("board_id, stage_id, enabled")
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    console.error("[UazAPI] Error fetching lead routing rule:", error);
    return null;
  }

  if (!data || !data.enabled || !data.board_id) return null;

  return { boardId: data.board_id, stageId: data.stage_id };
}

/**
 * Auto-create a deal for a new conversation if routing rule exists.
 */
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

      if (stageErr || !firstStage) {
        console.error("[UazAPI] Could not find first stage for auto-create deal:", stageErr);
        return;
      }
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

    if (dealErr) {
      console.error("[UazAPI] Error auto-creating deal:", dealErr);
      return;
    }

    console.log(`[UazAPI] Auto-created deal: ${newDeal.id} for contact ${params.contactId}`);

    const { data: conv, error: convMetaErr } = await supabase
      .from("messaging_conversations")
      .select("metadata")
      .eq("id", params.conversationId)
      .maybeSingle();

    if (convMetaErr) {
      console.error("[UazAPI] Failed to read conversation metadata:", convMetaErr);
      return;
    }

    const { error: metaUpdateErr } = await supabase
      .from("messaging_conversations")
      .update({
        metadata: {
          ...((conv?.metadata as Record<string, unknown>) || {}),
          deal_id: newDeal.id,
          auto_created_deal: true,
        },
      })
      .eq("id", params.conversationId);

    if (metaUpdateErr) {
      console.error("[UazAPI] Failed to update conversation metadata:", metaUpdateErr);
    }
  } catch (error) {
    console.error("[UazAPI] Unexpected error in autoCreateDeal:", error);
  }
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

async function handleMessage(
  supabase: ReturnType<typeof createClient>,
  channel: {
    id: string;
    organization_id: string;
    business_unit_id: string;
    external_identifier: string;
  },
  payload: UazApiMessagePayload
) {
  const data = payload.data;
  if (!data || !data.key) return;

  const remoteJid = data.key.remoteJid;

  // Skip groups and broadcast
  if (remoteJid.includes("@g.us")) return;
  if (remoteJid === "status@broadcast") return;

  const isFromMe = data.key.fromMe === true;
  const direction = isFromMe ? "outbound" : "inbound";

  const phone = normalizeRemoteJid(remoteJid);
  if (!phone) {
    console.warn(`[UazAPI] Could not normalize remoteJid: ${remoteJid}`);
    return;
  }

  const externalMessageId = data.key.id;
  const { contentType, content } = extractMessageContent(data);
  const messageText = extractMessageText(data);
  const pushName = data.pushName;
  const timestamp = data.messageTimestamp
    ? new Date(data.messageTimestamp * 1000)
    : new Date();

  // Find existing conversation
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
  } else {
    // Find or create contact
    const { data: existingContact, error: contactLookupErr } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", channel.organization_id)
      .eq("phone", phone)
      .is("deleted_at", null)
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (contactLookupErr) throw contactLookupErr;

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const contactName = pushName || phone;

      const { data: newContact, error: contactCreateErr } = await supabase
        .from("contacts")
        .insert({
          organization_id: channel.organization_id,
          name: contactName,
          phone,
          email: null,
        })
        .select("id")
        .single();

      if (contactCreateErr) throw contactCreateErr;
      contactId = newContact.id;
    }

    // Create conversation
    const { data: newConv, error: convCreateErr } = await supabase
      .from("messaging_conversations")
      .insert({
        organization_id: channel.organization_id,
        channel_id: channel.id,
        contact_id: contactId,
        external_contact_id: phone,
        status: "active",
      })
      .select("id")
      .single();

    if (convCreateErr) throw convCreateErr;
    conversationId = newConv.id;

    // Check for lead routing
    const routingRule = await getLeadRoutingRule(supabase, channel.id);
    if (routingRule) {
      await autoCreateDeal(supabase, {
        organizationId: channel.organization_id,
        contactId: contactId,
        boardId: routingRule.boardId,
        stageId: routingRule.stageId,
        conversationId: conversationId,
        contactName: pushName || phone,
      });
    }
  }

  // Insert message
  const { error: msgInsertErr } = await supabase
    .from("messaging_messages")
    .insert({
      organization_id: channel.organization_id,
      conversation_id: conversationId,
      external_message_id: externalMessageId,
      direction,
      content_type: contentType,
      content,
      text_preview: messageText,
      status: isFromMe ? "sent" : "received",
      received_at: timestamp,
    });

  if (msgInsertErr) {
    console.error("[UazAPI] Error inserting message:", msgInsertErr);
    throw msgInsertErr;
  }

  // Update conversation last message
  const { error: convUpdateErr } = await supabase
    .from("messaging_conversations")
    .update({
      last_message_at: timestamp,
      last_message_preview: messageText,
    })
    .eq("id", conversationId);

  if (convUpdateErr) {
    console.error("[UazAPI] Error updating conversation:", convUpdateErr);
  }

  // Trigger AI processing only for inbound text messages
  if (!isFromMe && contentType === "text" && messageText) {
    await triggerAIProcessing({
      conversationId,
      organizationId: channel.organization_id,
      messageText,
      messageId: externalMessageId,
    });
  }
}

async function handleMessageUpdate(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string },
  payload: UazApiMessagePayload
) {
  const data = payload.data;
  if (!data || !data.key || data.status === undefined) return;

  const status = mapNumericStatus(data.status);
  if (!status) {
    console.warn(`[UazAPI] Unknown status code: ${data.status}`);
    return;
  }

  const { error } = await supabase
    .from("messaging_messages")
    .update({ status })
    .eq("external_message_id", data.key.id)
    .eq("conversation_id", (await supabase
      .from("messaging_conversations")
      .select("id")
      .eq("channel_id", channel.id)
      .limit(1)
      .single()).data?.id);

  if (error) {
    console.error("[UazAPI] Error updating message status:", error);
  }
}

async function handleConnectionUpdate(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string },
  payload: UazApiMessagePayload
) {
  const data = payload.data as { state?: string } | undefined;
  const state = data?.state ?? "close";
  await updateChannelStatus(supabase, channel, state);
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Método não permitido" });
  }

  // Extract channelId from URL path
  const url = new URL(req.url);
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const channelId = url.pathname.match(uuidRegex)?.[0] ?? null;
  if (!channelId) {
    return json(400, { error: "channel_id ausente na URL" });
  }

  // Parse payload
  let payload: UazApiMessagePayload;
  try {
    payload = (await req.json()) as UazApiMessagePayload;
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  // Setup Supabase client
  const supabaseUrl =
    Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SECRET_KEY") ??
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Supabase não configurado no runtime" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Fetch channel by ID
  const { data: channel, error: channelErr } = await supabase
    .from("messaging_channels")
    .select("id, organization_id, business_unit_id, external_identifier, status, credentials")
    .eq("id", channelId)
    .in("status", ["connected", "active"])
    .maybeSingle();

  if (channelErr) {
    console.error("[UazAPI] Error fetching channel:", channelErr);
    return json(200, { ok: false, error: "Erro ao buscar canal" });
  }

  if (!channel) {
    return json(200, { ok: false, error: "Canal não encontrado" });
  }

  // Auth default-deny
  const webhookSecret =
    Deno.env.get("UAZAPI_WEBHOOK_SECRET") ??
    (channel.credentials as Record<string, string>)?.token;
  const providedKey = getTokenFromRequest(req);

  if (!webhookSecret || !providedKey || providedKey !== webhookSecret) {
    return json(401, { error: "Token inválido" });
  }

  try {
    const event = payload.event?.toLowerCase();

    if (event === "message") {
      await handleMessage(supabase, channel, payload);
    } else if (event === "messages_update" || event === "messages.update") {
      await handleMessageUpdate(supabase, channel, payload);
    } else if (event === "connection") {
      await handleConnectionUpdate(supabase, channel, payload);
    } else {
      console.log(`[UazAPI] Unhandled event: ${payload.event}`);
    }

    return json(200, { ok: true, event: payload.event });
  } catch (error) {
    console.error("[UazAPI] Webhook processing error:", error);
    return json(200, {
      ok: false,
      error: "Erro ao processar webhook",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
