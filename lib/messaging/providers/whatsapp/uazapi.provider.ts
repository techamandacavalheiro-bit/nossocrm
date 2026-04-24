/**
 * @fileoverview UazAPI WhatsApp Provider
 *
 * Self-hosted WhatsApp API provider using UazAPI.
 * Provides multi-instance management, built-in CRM, and AI chatbot capabilities.
 *
 * @see https://doc.uazapi.com/
 *
 * @module lib/messaging/providers/whatsapp/uazapi
 */

import { BaseChannelProvider } from '../base.provider';
import type {
  ChannelType,
  ProviderConfig,
  ValidationResult,
  ValidationError,
  ConnectionStatusResult,
  QrCodeResult,
  SendMessageParams,
  SendMessageResult,
  WebhookHandlerResult,
  MessageReceivedEvent,
  MessageSentEvent,
  StatusUpdateEvent,
  ConnectionUpdateEvent,
  ErrorEvent,
  MessageContent,
  TextContent,
  ImageContent,
  DocumentContent,
  AudioContent,
  VideoContent,
  LocationContent,
  ReactionContent,
  MessageStatus,
} from '../../types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * UazAPI credentials configuration.
 */
export interface UazApiCredentials {
  serverUrl: string; // e.g. https://uazapi.example.com or https://api.uazapi.com
  token: string; // instance-level API key
  webhookSecret?: string; // optional webhook signature validation
}

/**
 * UazAPI instance status response.
 */
interface UazApiStatusResponse {
  instance?: {
    status?: string; // "open" | "close" | "connecting"
    qrcode?: {
      base64?: string;
    };
  };
  error?: string;
}

/**
 * UazAPI send message response.
 */
interface UazApiSendResponse {
  key?: {
    id?: string;
    remoteJid?: string;
    fromMe?: boolean;
  };
  status?: string;
  message?: string;
  error?: string;
}

/**
 * UazAPI webhook payload.
 * Covers messages, messages_update, and connection events.
 */
export interface UazApiWebhookPayload {
  event?: string; // "message" | "messages_update" | "connection"
  instance?: string;
  data?: {
    key?: {
      remoteJid?: string;
      id?: string;
      fromMe?: boolean;
    };
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

/**
 * Normalize a WhatsApp JID to a plain phone number string.
 *
 * - "5511999999999@s.whatsapp.net" → "5511999999999"
 * - "5511999999999@g.us" (group) → "5511999999999"
 */
function normalizePhone(remoteJid: string): string {
  return remoteJid.split('@')[0];
}

// =============================================================================
// PROVIDER IMPLEMENTATION
// =============================================================================

/**
 * UazAPI WhatsApp provider implementation.
 *
 * Features:
 * - QR code authentication (self-hosted or cloud server)
 * - Text, image, video, audio, document, location, reaction messages
 * - Message status tracking (sent/delivered/read)
 * - Webhook support for incoming messages and status updates
 * - Built-in CRM and lead management
 * - AI chatbot integration
 *
 * @example
 * ```ts
 * const provider = new UazApiWhatsAppProvider();
 * await provider.initialize({
 *   channelId: 'uuid',
 *   externalIdentifier: '+5511999999999',
 *   credentials: {
 *     serverUrl: 'https://api.uazapi.com',
 *     token: 'my-instance-token',
 *   },
 * });
 *
 * const result = await provider.sendMessage({
 *   conversationId: 'uuid',
 *   to: '+5511888888888',
 *   content: { type: 'text', text: 'Olá!' },
 * });
 * ```
 */
export class UazApiWhatsAppProvider extends BaseChannelProvider {
  readonly channelType: ChannelType = 'whatsapp';
  readonly providerName = 'uazapi';

  private serverUrl: string = '';
  private token: string = '';
  private webhookSecret?: string;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    const credentials = config.credentials as unknown as UazApiCredentials;
    this.serverUrl = credentials.serverUrl.replace(/\/$/, ''); // strip trailing slash
    this.token = credentials.token;
    this.webhookSecret = credentials.webhookSecret;

    this.log('info', 'UazAPI provider initialized', {
      serverUrl: this.serverUrl,
    });
  }

  async disconnect(): Promise<void> {
    this.log('info', 'UazAPI provider disconnected');
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  async getStatus(): Promise<ConnectionStatusResult> {
    try {
      const response = await this.request<UazApiStatusResponse>('GET', '/instance/status');

      const status = response.instance?.status;

      switch (status) {
        case 'open':
        case 'connected':
          return {
            status: 'connected',
            message: 'Connected to WhatsApp',
          };

        case 'connecting':
          return {
            status: 'connecting',
            message: 'Connecting to WhatsApp',
          };

        case 'close':
        case 'disconnected':
          return {
            status: 'disconnected',
            message: 'Not connected. Scan QR code to connect.',
          };

        default:
          return {
            status: 'disconnected',
            message: 'Unknown connection state',
            details: { status },
          };
      }
    } catch (error) {
      this.log('error', 'getStatus failed', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get QR code for WhatsApp connection.
   */
  async getQrCode(): Promise<QrCodeResult> {
    const response = await this.request<UazApiStatusResponse>('GET', '/instance/status');

    if (response.error) {
      throw new Error(`QR code error: ${response.error}`);
    }

    const base64 = response.instance?.qrcode?.base64;
    if (!base64) {
      throw new Error('QR code not available. Instance may already be connected.');
    }

    return {
      qrCode: base64,
      expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    };
  }

  /**
   * Configure webhook URL for receiving messages and status updates.
   */
  async configureWebhook(webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Include the instance token in the webhook config so UazAPI sends it back
      // in the "token" header on every webhook call. Without this UazAPI may send
      // no auth header and the edge function will reject the request.
      await this.request('POST', '/webhook', {
        enabled: true,
        url: webhookUrl,
        token: this.webhookSecret || this.token,
        events: ['messages', 'messages_update', 'connection'],
        excludeMessages: ['wasSentByApi'],
      });

      return { success: true };
    } catch (error) {
      this.log('error', 'configureWebhook failed', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const { to, content } = params;

    try {
      const number = to.replace(/\D/g, '');
      const chatId = `${number}@s.whatsapp.net`;

      let response: UazApiSendResponse;

      switch (content.type) {
        case 'text':
          response = await this.sendTextMessage(chatId, content as TextContent);
          break;

        case 'image':
          response = await this.sendImageMessage(chatId, content as ImageContent);
          break;

        case 'video':
          response = await this.sendVideoMessage(chatId, content as VideoContent);
          break;

        case 'audio':
          response = await this.sendAudioMessage(chatId, content as AudioContent);
          break;

        case 'document':
          response = await this.sendDocumentMessage(chatId, content as DocumentContent);
          break;

        case 'location':
          response = await this.sendLocationMessage(chatId, content as LocationContent);
          break;

        case 'reaction':
          response = await this.sendReactionMessage(chatId, content as ReactionContent);
          break;

        default:
          return this.errorResult(
            'UNSUPPORTED_MESSAGE_TYPE',
            `Message type "${(content as any).type}" is not supported by UazAPI`
          );
      }

      if (!response.key?.id) {
        return this.errorResult('SEND_FAILED', response.error || 'No message ID in response', true);
      }

      return this.successResult(response.key.id);
    } catch (error) {
      this.log('error', 'sendMessage failed', {
        error: error instanceof Error ? error.message : error,
        to,
        type: content.type,
      });

      return this.errorResult(
        'SEND_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        true
      );
    }
  }

  private async sendTextMessage(chatId: string, content: TextContent): Promise<UazApiSendResponse> {
    return this.request<UazApiSendResponse>('POST', '/send/text', {
      chatid: chatId,
      text: content.text,
    });
  }

  private async sendImageMessage(chatId: string, content: ImageContent): Promise<UazApiSendResponse> {
    const body: Record<string, unknown> = {
      chatid: chatId,
      media: content.mediaUrl,
      mediatype: 'image',
    };

    if (content.caption) body.caption = content.caption;

    return this.request<UazApiSendResponse>('POST', '/send/media', body);
  }

  private async sendVideoMessage(chatId: string, content: VideoContent): Promise<UazApiSendResponse> {
    const body: Record<string, unknown> = {
      chatid: chatId,
      media: content.mediaUrl,
      mediatype: 'video',
    };

    if (content.caption) body.caption = content.caption;

    return this.request<UazApiSendResponse>('POST', '/send/media', body);
  }

  private async sendAudioMessage(chatId: string, content: AudioContent): Promise<UazApiSendResponse> {
    return this.request<UazApiSendResponse>('POST', '/send/media', {
      chatid: chatId,
      media: content.mediaUrl,
      mediatype: 'audio',
    });
  }

  private async sendDocumentMessage(
    chatId: string,
    content: DocumentContent
  ): Promise<UazApiSendResponse> {
    const body: Record<string, unknown> = {
      chatid: chatId,
      media: content.mediaUrl,
      mediatype: 'document',
      fileName: content.fileName,
    };

    if (content.mimeType) body.mimetype = content.mimeType;

    return this.request<UazApiSendResponse>('POST', '/send/media', body);
  }

  private async sendLocationMessage(
    chatId: string,
    content: LocationContent
  ): Promise<UazApiSendResponse> {
    return this.request<UazApiSendResponse>('POST', '/send/location', {
      chatid: chatId,
      latitude: content.latitude,
      longitude: content.longitude,
      name: content.name || '',
      address: content.address || '',
    });
  }

  private async sendReactionMessage(
    chatId: string,
    content: ReactionContent
  ): Promise<UazApiSendResponse> {
    return this.request<UazApiSendResponse>('POST', '/message/react', {
      chatid: chatId,
      messageId: content.messageId,
      reaction: content.emoji,
    });
  }

  // ---------------------------------------------------------------------------
  // Webhook Handler
  // ---------------------------------------------------------------------------

  async handleWebhook(payload: unknown): Promise<WebhookHandlerResult> {
    const raw = payload as UazApiWebhookPayload;
    const event = raw.event;

    if (event === 'message') {
      return this.handleMessage(raw, payload);
    }

    if (event === 'messages_update') {
      return this.handleMessageUpdate(raw, payload);
    }

    if (event === 'connection') {
      return this.handleConnectionUpdate(raw, payload);
    }

    const errorData: ErrorEvent = {
      type: 'error',
      code: 'UNKNOWN_EVENT',
      message: `Unknown UazAPI webhook event: ${event ?? '(none)'}`,
      timestamp: new Date(),
    };
    return {
      type: 'error',
      data: errorData,
      raw: payload,
    };
  }

  private handleMessage(raw: UazApiWebhookPayload, originalPayload: unknown): WebhookHandlerResult {
    const data = raw.data;

    if (!data) {
      const errorData: ErrorEvent = {
        type: 'error',
        code: 'MISSING_DATA',
        message: 'message payload missing data field',
        timestamp: new Date(),
      };
      return { type: 'error', data: errorData, raw: originalPayload };
    }

    if (data.key?.fromMe) {
      const sentEventData: MessageSentEvent = {
        type: 'message_sent',
        externalMessageId: data.key?.id ?? '',
        status: 'sent',
        timestamp: data.messageTimestamp
          ? new Date(data.messageTimestamp * 1000)
          : new Date(),
      };
      return {
        type: 'message_sent',
        externalId: data.key?.id ?? '',
        data: sentEventData,
        raw: originalPayload,
      };
    }

    const remoteJid = data.key?.remoteJid ?? '';
    if (remoteJid.includes('@g.us') || remoteJid.includes('status@broadcast')) {
      const errorData: ErrorEvent = {
        type: 'error',
        code: 'FILTERED_MESSAGE',
        message: 'Group or broadcast message filtered',
        timestamp: new Date(),
      };
      return { type: 'error', data: errorData, raw: originalPayload };
    }

    const from = normalizePhone(remoteJid);
    const timestamp = data.messageTimestamp
      ? new Date(data.messageTimestamp * 1000)
      : new Date();
    const content = this.extractContent(data.messageType, data.message, data.body);

    const eventData: MessageReceivedEvent = {
      type: 'message_received',
      from,
      fromName: data.pushName,
      content,
      externalMessageId: data.key?.id ?? '',
      timestamp,
    };

    return {
      type: 'message_received',
      externalId: eventData.externalMessageId,
      data: eventData,
      raw: originalPayload,
    };
  }

  private handleMessageUpdate(
    raw: UazApiWebhookPayload,
    originalPayload: unknown
  ): WebhookHandlerResult {
    const data = raw.data;

    if (!data) {
      const errorData: ErrorEvent = {
        type: 'error',
        code: 'MISSING_DATA',
        message: 'messages_update payload missing data field',
        timestamp: new Date(),
      };
      return { type: 'error', data: errorData, raw: originalPayload };
    }

    const statusMap: Record<number, MessageStatus> = {
      1: 'sent',
      2: 'sent',
      3: 'delivered',
      4: 'read',
    };

    const numericStatus = data.status ?? 0;
    const mapped = statusMap[numericStatus];
    if (!mapped && numericStatus !== undefined) {
      this.log('warn', `Unknown status code: ${numericStatus}, treating as 'sent'`);
    }
    const status: MessageStatus = mapped ?? 'sent';

    const eventData: StatusUpdateEvent = {
      type: 'status_update',
      externalMessageId: data.key?.id ?? '',
      status,
      timestamp: new Date(),
    };

    return {
      type: 'status_update',
      externalId: eventData.externalMessageId,
      data: eventData,
      raw: originalPayload,
    };
  }

  private handleConnectionUpdate(
    raw: UazApiWebhookPayload,
    originalPayload: unknown
  ): WebhookHandlerResult {
    const data = raw.data as { state?: string } | undefined;
    const stateRaw = data?.state ?? 'close';

    const stateToChannelStatus: Record<string, 'connected' | 'disconnected' | 'error'> = {
      open: 'connected',
      connected: 'connected',
      close: 'disconnected',
      disconnected: 'disconnected',
      refused: 'error',
    };

    const eventData: ConnectionUpdateEvent = {
      type: 'connection_update',
      status: stateToChannelStatus[stateRaw] ?? 'disconnected',
      message: `UazAPI instance state: ${stateRaw}`,
      timestamp: new Date(),
    };

    return {
      type: 'connection_update',
      data: eventData,
      raw: originalPayload,
    };
  }

  /**
   * Extract normalized MessageContent from UazAPI message.
   */
  private extractContent(
    messageType: string | undefined,
    message: Record<string, unknown> | undefined,
    body?: string
  ): MessageContent {
    if (body && !message) {
      return { type: 'text', text: body };
    }

    if (!message) {
      return { type: 'text', text: '[empty message]' };
    }

    switch (messageType) {
      case 'conversation':
      case 'extendedTextMessage':
        return {
          type: 'text',
          text: (message.text as string) ?? (body as string) ?? '',
        };

      case 'imageMessage': {
        const img = message as Record<string, unknown>;
        return {
          type: 'image',
          mediaUrl: (img.url as string) ?? '',
          mimeType: (img.mimetype as string) ?? 'image/jpeg',
          caption: img.caption as string | undefined,
        };
      }

      case 'videoMessage': {
        const vid = message as Record<string, unknown>;
        return {
          type: 'video',
          mediaUrl: (vid.url as string) ?? '',
          mimeType: (vid.mimetype as string) ?? 'video/mp4',
          caption: vid.caption as string | undefined,
        };
      }

      case 'audioMessage': {
        const aud = message as Record<string, unknown>;
        return {
          type: 'audio',
          mediaUrl: (aud.url as string) ?? '',
          mimeType: (aud.mimetype as string) ?? 'audio/ogg',
        };
      }

      case 'documentMessage': {
        const doc = message as Record<string, unknown>;
        return {
          type: 'document',
          mediaUrl: (doc.url as string) ?? '',
          fileName: (doc.fileName as string) ?? 'document',
          mimeType: (doc.mimetype as string) ?? 'application/octet-stream',
        };
      }

      case 'locationMessage': {
        const loc = message as Record<string, unknown>;
        return {
          type: 'location',
          latitude: (loc.latitude as number) ?? 0,
          longitude: (loc.longitude as number) ?? 0,
          name: loc.name as string | undefined,
          address: loc.address as string | undefined,
        };
      }

      case 'reactionMessage': {
        const reaction = message as Record<string, unknown>;
        return {
          type: 'reaction',
          emoji: (reaction.emoji as string) || '',
          messageId: (reaction.messageId as string) || '',
        };
      }

      default:
        return {
          type: 'text',
          text: `[${messageType ?? 'unknown'}]`,
        };
    }
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  validateConfig(config: ProviderConfig): ValidationResult {
    const baseResult = super.validateConfig(config);
    if (!baseResult.valid) {
      return baseResult;
    }

    const errors: ValidationError[] = [];
    const credentials = config.credentials as unknown as UazApiCredentials;

    if (!credentials.serverUrl) {
      errors.push({
        field: 'credentials.serverUrl',
        message: 'UazAPI server URL is required',
        code: 'REQUIRED',
      });
    } else {
      try {
        const url = new URL(credentials.serverUrl as string);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return {
            valid: false,
            errors: [{
              field: 'credentials.serverUrl',
              message: 'serverUrl deve começar com http:// ou https://',
              code: 'INVALID_URL',
            }],
          };
        }
      } catch {
        return {
          valid: false,
          errors: [{
            field: 'credentials.serverUrl',
            message: 'serverUrl não é uma URL válida (exemplo: https://api.uazapi.com)',
            code: 'INVALID_URL',
          }],
        };
      }
    }

    if (!credentials.token) {
      errors.push({
        field: 'credentials.token',
        message: 'UazAPI instance token is required',
        code: 'REQUIRED',
      });
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP Client
  // ---------------------------------------------------------------------------

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.serverUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      token: this.token,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const requestBody = body ? JSON.stringify(body) : undefined;
    this.log('info', `${method} ${endpoint}`);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();
    this.log('info', `${method} ${endpoint} response: ${response.status}`);

    if (!response.ok) {
      throw new Error(`UazAPI request failed: ${response.status} ${responseText}`);
    }

    try {
      return JSON.parse(responseText) as T;
    } catch {
      throw new Error(
        `UazAPI returned non-JSON response from ${endpoint}: ${responseText.slice(0, 200)}`
      );
    }
  }
}

export default UazApiWhatsAppProvider;
