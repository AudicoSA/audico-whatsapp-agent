/**
 * Wade Quote Generation — Jarvis API Client
 * Bridges WhatsApp agent to Wade (via Jarvis) for automated quote generation.
 */

import axios from 'axios';
import { whatsapp } from './whatsapp';

const JARVIS_API_BASE = process.env.JARVIS_API_BASE || 'http://localhost:8001';
const POST_TIMEOUT = 10_000;  // 10s for quote creation
const GET_TIMEOUT = 30_000;   // 30s for PDF download
const POLL_INTERVAL = 5_000;  // 5s between retries
const POLL_MAX_RETRIES = 3;

export interface QuoteItem {
  product_name: string;
  quantity: number;
  notes?: string;
}

export interface GenerateQuotePayload {
  message_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  items: QuoteItem[];
}

export interface GenerateQuoteResponse {
  draft_id: string;
  quote_number: string;
  metadata?: {
    out_of_stock?: boolean;
    out_of_stock_items?: string[];
    alternatives?: string[];
  };
}

/**
 * POST to Jarvis to create a quote draft via Wade
 */
export async function generateQuote(payload: GenerateQuotePayload): Promise<GenerateQuoteResponse> {
  const url = `${JARVIS_API_BASE}/api/wade/generate-from-whatsapp`;
  console.log(`[Wade] Requesting quote generation: ${payload.items.length} item(s) for ${payload.customer_phone}`);

  const { data } = await axios.post<GenerateQuoteResponse>(url, payload, {
    timeout: POST_TIMEOUT,
    headers: { 'Content-Type': 'application/json' },
  });

  console.log(`[Wade] Quote draft created: ${data.quote_number} (draft_id: ${data.draft_id})`);
  return data;
}

/**
 * GET quote PDF from Jarvis
 * Returns the PDF as a Buffer, or null if not ready yet (404).
 */
export async function fetchQuotePdf(quoteNumber: string): Promise<Buffer | null> {
  const url = `${JARVIS_API_BASE}/api/quotes/pdf/${quoteNumber}`;
  console.log(`[Wade] Fetching PDF for ${quoteNumber}`);

  try {
    const { data } = await axios.get(url, {
      timeout: GET_TIMEOUT,
      responseType: 'arraybuffer',
    });
    return Buffer.from(data);
  } catch (err: any) {
    if (err.response?.status === 404) {
      console.log(`[Wade] PDF not ready yet for ${quoteNumber}`);
      return null;
    }
    throw err;
  }
}

/**
 * Poll for the PDF and send it to the WhatsApp thread once ready.
 * Runs in the background — does not block the agent response.
 */
export async function pollAndSendQuotePdf(
  quoteNumber: string,
  customerPhone: string
): Promise<void> {
  console.log(`[Wade] Starting PDF poll for ${quoteNumber} → ${customerPhone}`);

  for (let attempt = 1; attempt <= POLL_MAX_RETRIES; attempt++) {
    await sleep(POLL_INTERVAL);

    try {
      const pdfBuffer = await fetchQuotePdf(quoteNumber);

      if (pdfBuffer) {
        // Send PDF as document attachment via WhatsApp
        const sent = await whatsapp.sendDocumentBuffer(
          customerPhone,
          pdfBuffer,
          `Audico_Quote_${quoteNumber}.pdf`,
          `Here's your Audico quote ${quoteNumber}. It's valid for 7 days. Let me know if you want to proceed and I'll send a pro-forma invoice.`
        );

        if (sent) {
          console.log(`[Wade] PDF sent to ${customerPhone} for quote ${quoteNumber}`);
        } else {
          console.error(`[Wade] Failed to send PDF to ${customerPhone}`);
        }
        return;
      }

      console.log(`[Wade] PDF poll attempt ${attempt}/${POLL_MAX_RETRIES} for ${quoteNumber}`);
    } catch (err) {
      console.error(`[Wade] PDF poll error (attempt ${attempt}):`, err);
    }
  }

  // All retries exhausted — notify customer
  await whatsapp.sendText(
    customerPhone,
    `Your quote ${quoteNumber} is still being prepared. The Audico team will send it to you shortly.`
  );
  console.log(`[Wade] PDF poll exhausted for ${quoteNumber}, notified customer`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
