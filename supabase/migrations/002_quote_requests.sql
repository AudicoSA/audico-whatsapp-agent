-- WhatsApp Quote Requests Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS whatsapp_quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  customer_name TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'quoted', 'closed')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_wa_qr_phone ON whatsapp_quote_requests(phone_number);
CREATE INDEX IF NOT EXISTS idx_wa_qr_status ON whatsapp_quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_wa_qr_created ON whatsapp_quote_requests(created_at DESC);

-- Enable Row Level Security
ALTER TABLE whatsapp_quote_requests ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (our API uses service role key)
CREATE POLICY "Service role full access to quote requests" ON whatsapp_quote_requests
  FOR ALL USING (true) WITH CHECK (true);

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_wa_qr_updated_at ON whatsapp_quote_requests;
CREATE TRIGGER update_wa_qr_updated_at
  BEFORE UPDATE ON whatsapp_quote_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Grant permissions to service role
GRANT ALL ON whatsapp_quote_requests TO service_role;
