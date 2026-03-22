-- Outbound message queue: dashboard → bot → WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_outbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES whatsapp_conversations(id),
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_by TEXT DEFAULT 'dashboard',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | sent | failed
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX idx_outbound_status ON whatsapp_outbound_queue(status);
CREATE INDEX idx_outbound_created ON whatsapp_outbound_queue(created_at DESC);
