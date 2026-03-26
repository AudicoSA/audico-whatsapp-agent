-- Add document support to the outbound queue
-- Allows sending PDFs (quotes) via WhatsApp alongside text messages.
-- Existing rows default to 'text', so the bot's current text-only flow is unaffected.

ALTER TABLE whatsapp_outbound_queue
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',       -- 'text' | 'document'
  ADD COLUMN IF NOT EXISTS document_url TEXT,                                -- public URL to the PDF/file
  ADD COLUMN IF NOT EXISTS document_filename TEXT,                           -- friendly filename shown in WhatsApp
  ADD COLUMN IF NOT EXISTS caption TEXT;                                     -- optional caption for document messages

-- Make message nullable for document-only sends (caption carries the text)
ALTER TABLE whatsapp_outbound_queue
  ALTER COLUMN message DROP NOT NULL;

COMMENT ON COLUMN whatsapp_outbound_queue.message_type IS 'text or document — controls how the bot sends this message';
COMMENT ON COLUMN whatsapp_outbound_queue.document_url IS 'Public URL to a PDF or file (required when message_type = document)';
COMMENT ON COLUMN whatsapp_outbound_queue.document_filename IS 'Display filename in WhatsApp (e.g. Audico-Quote-PF260326-001.pdf)';
COMMENT ON COLUMN whatsapp_outbound_queue.caption IS 'Caption text shown alongside a document message';
