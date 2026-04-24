#!/bin/bash
# Testa o webhook UazAPI com mensagens fake (formato real do UazAPI).
# Usa event="messages" (plural) — que é o formato real enviado pelo UazAPI.
# Para limpar depois:
#   DELETE FROM deals WHERE contact_id IN (SELECT id FROM contacts WHERE phone = '+5511999999999');
#   DELETE FROM messaging_messages WHERE conversation_id IN (SELECT id FROM messaging_conversations WHERE external_contact_id = '5511999999999');
#   DELETE FROM messaging_conversations WHERE external_contact_id = '5511999999999';
#   DELETE FROM contacts WHERE phone = '+5511999999999';

TIMESTAMP=$(date +%s)
URL="https://tmpzwimuhwtzgyxsykjc.supabase.co/functions/v1/messaging-webhook-uazapi/9f1adf1e-c7a7-4aba-8b49-411646f791d2"
TOKEN="b27d33d6-2c64-4429-9754-e5e48a8bc87a"

# Formato real do UazAPI (event="messages", plural)
PAYLOAD=$(cat <<EOF
{
  "event": "messages",
  "instance": "r3f21e452755cb4",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "id": "TEST_${TIMESTAMP}",
      "fromMe": false
    },
    "pushName": "Teste Webhook",
    "messageType": "conversation",
    "body": "Mensagem de teste — ignore",
    "messageTimestamp": ${TIMESTAMP}
  }
}
EOF
)

echo "Enviando webhook de teste (event=messages)..."
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "token: $TOKEN" \
  -d "$PAYLOAD"
echo ""
