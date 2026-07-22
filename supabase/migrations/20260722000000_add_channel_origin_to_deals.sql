-- Origem do negócio: de qual número/instância veio o card.
-- Com múltiplos números WhatsApp caindo no MESMO funil, o board deixa de
-- identificar a origem — daí a coluna explícita no deal.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES messaging_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_channel_id ON deals(channel_id) WHERE channel_id IS NOT NULL;

COMMENT ON COLUMN deals.channel_id IS
  'Canal de messaging que originou o negócio (etiqueta de origem no kanban). NULL para deals criados manualmente.';

-- Backfill dos deals existentes a partir da conversa do contato.
UPDATE deals d
SET channel_id = c.channel_id
FROM messaging_conversations c
WHERE d.contact_id = c.contact_id
  AND d.channel_id IS NULL
  AND d.organization_id = c.organization_id;
