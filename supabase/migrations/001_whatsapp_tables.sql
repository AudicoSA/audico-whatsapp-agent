-- WhatsApp Agent Database Tables
-- Run this in Supabase SQL Editor

-- Conversations table
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  customer_name TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending_quote', 'completed', 'escalated')),
  context JSONB DEFAULT '{"quote_items": []}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_wa_conv_phone ON whatsapp_conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_wa_conv_status ON whatsapp_conversations(status);
CREATE INDEX IF NOT EXISTS idx_wa_conv_updated ON whatsapp_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msg_conv ON whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_created ON whatsapp_messages(created_at DESC);

-- Enable Row Level Security
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (our API uses service role key)
CREATE POLICY "Service role full access to conversations" ON whatsapp_conversations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to messages" ON whatsapp_messages
  FOR ALL USING (true) WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_wa_conv_updated_at ON whatsapp_conversations;
CREATE TRIGGER update_wa_conv_updated_at
  BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Grant permissions to service role
GRANT ALL ON whatsapp_conversations TO service_role;
GRANT ALL ON whatsapp_messages TO service_role;
