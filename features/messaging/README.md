# Messaging Feature

Sistema de messaging omnichannel integrado ao CRM.

## Canais Suportados

| Canal | Provider | Status |
|-------|----------|--------|
| WhatsApp | Z-API | ✅ Produção |
| WhatsApp | Meta Cloud API | ✅ Produção |
| Instagram | Meta Messenger Platform | ✅ Produção |
| Email | Resend | ✅ Produção |

## Estrutura de Pastas

```
features/messaging/
├── components/
│   ├── ConversationList.tsx      # Lista de conversas (sidebar)
│   ├── ConversationItem.tsx      # Item individual da lista
│   ├── MessageThread.tsx         # Thread de mensagens
│   ├── MessageBubble.tsx         # Bolha de mensagem
│   ├── MessageInput.tsx          # Input com templates
│   ├── ContactPanel.tsx          # Painel lateral do contato
│   ├── ChannelIndicator.tsx      # Ícone/badge do canal
│   ├── WindowExpiryBadge.tsx     # Badge de janela 24h
│   ├── TemplateSelector.tsx      # Seletor de templates HSM
│   └── TemplateManager.tsx       # Gerenciador de templates (admin)
├── hooks/                        # Hooks específicos da feature
└── README.md                     # Este arquivo
```

## Arquitetura

### Channel Router Service

O sistema usa um padrão Factory para abstrair providers:

```
ChannelRouterService
    └── ChannelProviderFactory
            ├── WhatsApp
            │   ├── ZApiWhatsAppProvider
            │   └── MetaCloudWhatsAppProvider
            └── Instagram
                └── MetaInstagramProvider
```

### Fluxo de Mensagens

**Inbound (recebida)**:
1. Webhook recebe evento do provider
2. Valida assinatura/secret
3. Cria/atualiza conversa
4. Insere mensagem
5. Auto-cria contato se não existir
6. Auto-cria deal se lead routing rule ativa
7. Realtime notifica UI

**Outbound (enviada)**:
1. UI chama API route `/api/messaging/messages`
2. API valida permissões
3. ChannelRouterService roteia para provider
4. Provider envia via API externa
5. Webhook recebe confirmação de status
6. Realtime atualiza UI

## Webhooks

### Z-API
- **Rota**: `POST /functions/v1/messaging-webhook-zapi/<channel_id>`
- **Auth**: `X-Webhook-Secret` header
- **Eventos**: mensagem recebida, status update

### Meta (WhatsApp + Instagram)
- **Rota**: `POST /functions/v1/messaging-webhook-meta/<channel_id>`
- **Auth**: `X-Hub-Signature-256` (HMAC-SHA256)
- **Verificação**: `GET` com `hub.verify_token`
- **Eventos**: mensagem recebida, status update, delivery, read

### Resend (Email)
- **Rota**: `POST /functions/v1/messaging-webhook-resend/<channel_id>`
- **Auth**: Svix headers (svix-id, svix-timestamp, svix-signature)
- **Eventos**: email.sent, email.delivered, email.opened, email.bounced, email.clicked

## Templates (WhatsApp HSM)

Templates são mensagens pré-aprovadas pela Meta para iniciar conversas fora da janela de 24h.

### Sincronização
```typescript
// API route
POST /api/messaging/templates/sync
Body: { channelId: string }
```

### Envio
```typescript
// API route
POST /api/messaging/messages/send-template
Body: {
  conversationId: string,
  templateId: string,
  parameters?: { body: [{ type: 'text', text: string }] }
}
```

## Query Hooks

```typescript
// Conversas
useConversationsQuery(filters?)
useConversationQuery(id)
useUpdateConversationMutation()

// Mensagens
useMessagesQuery(conversationId)
useSendTextMessage()

// Canais
useChannelsQuery()
useChannelQuery(id)
useCreateChannelMutation()
useUpdateChannelMutation()
useDeleteChannelMutation()

// Templates
useTemplatesQuery(channelId)
useApprovedTemplatesQuery(channelId)
useTemplateSyncMutation()
useSendTemplateMutation()

// Lead Routing
useLeadRoutingRulesQuery()
useLeadRoutingRuleMutation()
```

## Realtime

```typescript
// Em qualquer componente de messaging
import { useRealtimeSyncMessaging } from '@/lib/realtime/useRealtimeSync';

function MessagingPage() {
  useRealtimeSyncMessaging(); // Subscribe to messaging_conversations + messaging_messages
  // ...
}
```

## Lead Routing

Quando uma nova conversa é criada (primeira mensagem de um contato):

1. Webhook busca `lead_routing_rules` para o canal
2. Se rule existe e `enabled=true`:
   - Auto-cria contato (se não existir)
   - Auto-cria deal no board/stage configurado
   - Vincula deal à conversa via metadata

### Configuração
- Feita via UI em Settings > Canais > [Canal] > Destino de Leads
- Armazenada em `lead_routing_rules` (channel_id, board_id, stage_id, enabled)

## Janela de 24h (WhatsApp/Instagram)

- Após última mensagem do cliente, empresa tem 24h para responder livremente
- Após 24h, apenas templates aprovados podem ser enviados
- `window_expires_at` é atualizado em cada mensagem inbound
- UI mostra badge de expiração e bloqueia input quando expirado

## Segurança

- **HMAC Verification**: Meta webhooks verificados com `X-Hub-Signature-256`
- **Secret Validation**: Z-API webhooks validados com `X-Webhook-Secret`
- **RLS**: Todas as tabelas com Row Level Security por organization_id
- **Credentials Masking**: Credenciais não retornam em list queries

## Tabelas do Banco

- `messaging_channels`: Configuração de canais (credentials, settings)
- `messaging_conversations`: Conversas (1:1 com contato por canal)
- `messaging_messages`: Mensagens individuais
- `messaging_templates`: Templates HSM sincronizados
- `messaging_webhook_events`: Log de eventos para debug/retry
- `lead_routing_rules`: Regras de roteamento de leads

## Providers

### Z-API (`lib/messaging/providers/whatsapp/z-api.provider.ts`)
- Conexão via QR Code
- Sem verificação Meta
- Sem limites de mensagem
- Ideal para SMBs

### Meta Cloud API (`lib/messaging/providers/whatsapp/meta-cloud.provider.ts`)
- Verificação Meta obrigatória
- Templates pré-aprovados
- Janela de 24h
- Ideal para enterprise

### Instagram (`lib/messaging/providers/instagram/meta.provider.ts`)
- Via Meta Messenger Platform
- Suporta DMs, story replies
- Janela de 24h
- Sem templates (apenas resposta dentro da janela)

### Resend (`lib/messaging/providers/email/resend.provider.ts`)
- API de email transacional moderna
- Suporte a HTML e texto plain
- Tracking de abertura, cliques, bounces
- Webhooks via Svix
