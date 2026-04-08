/**
 * Supabase Client & Product Search
 * Connects to Audico's product database
 */

import { createClient } from '@supabase/supabase-js';
import { Product, Conversation, ConversationContext, QuoteRequest, QuoteRequestDetails } from './types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Normalize query by splitting joined letter-number boundaries
 * e.g. "Control4" -> "Control 4", "LS50" -> "LS 50"
 * This handles cases where products are stored with spaces between letters and numbers.
 */
function normalizeQuery(query: string): string {
  return query
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')   // "Control4" -> "Control 4"
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')   // "4Core" -> "4 Core"
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search products using hybrid search (semantic + keyword)
 */
export async function searchProducts(
  query: string,
  options: {
    limit?: number;
    minPrice?: number;
    maxPrice?: number;
    brand?: string;
    category?: string;
    inStockOnly?: boolean;
  } = {}
): Promise<Product[]> {
  const {
    limit = 5,
    minPrice = 0,
    maxPrice = 999999999,
    brand = null,
    category = null,
    inStockOnly = false,
  } = options;

  try {
    // Use native websearch_to_tsquery for accurate strict text matching
    let productQuery = supabase
      .from('products')
      .select('*')
      .textSearch('product_name', query, {
        type: 'websearch',
        config: 'english'
      })
      .gte('retail_price', minPrice)
      .lte('retail_price', maxPrice)
      .gt('total_stock', inStockOnly ? 0 : -1);

    if (brand) productQuery = productQuery.ilike('brand', `%${brand}%`);
    if (category) productQuery = productQuery.ilike('category', `%${category}%`);

    const { data, error } = await productQuery.limit(limit);

    if (error) {
      console.error('[Search] textSearch error:', error);
    }

    // If textSearch returned results, use them
    if (!error && data && data.length > 0) {
      return data as Product[];
    }

    // Fallback: try ILIKE with the original query
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('products')
      .select('*')
      .ilike('product_name', `%${query}%`)
      .gte('retail_price', minPrice)
      .lte('retail_price', maxPrice)
      .gt('total_stock', inStockOnly ? 0 : -1)
      .limit(limit);

    if (!fallbackError && fallbackData && fallbackData.length > 0) {
      return fallbackData as Product[];
    }

    // Fallback 2: try with normalized query (split letter-number boundaries)
    // e.g. "Control4 Core" -> "Control 4 Core"
    const normalized = normalizeQuery(query);
    if (normalized !== query) {
      console.log(`[Search] Retrying with normalized query: "${normalized}"`);

      // Try textSearch with normalized query
      let normQuery = supabase
        .from('products')
        .select('*')
        .textSearch('product_name', normalized, {
          type: 'websearch',
          config: 'english'
        })
        .gte('retail_price', minPrice)
        .lte('retail_price', maxPrice)
        .gt('total_stock', inStockOnly ? 0 : -1);

      if (brand) normQuery = normQuery.ilike('brand', `%${brand}%`);
      if (category) normQuery = normQuery.ilike('category', `%${category}%`);

      const { data: normData, error: normError } = await normQuery.limit(limit);

      if (!normError && normData && normData.length > 0) {
        return normData as Product[];
      }

      // Final fallback: ILIKE with normalized query
      const { data: normFallback, error: normFallbackError } = await supabase
        .from('products')
        .select('*')
        .ilike('product_name', `%${normalized}%`)
        .gte('retail_price', minPrice)
        .lte('retail_price', maxPrice)
        .gt('total_stock', inStockOnly ? 0 : -1)
        .limit(limit);

      if (!normFallbackError && normFallback && normFallback.length > 0) {
        return normFallback as Product[];
      }
    }

    return [];
  } catch (err) {
    console.error('[Search] Exception:', err);
    return [];
  }
}

/**
 * Get product by ID
 */
export async function getProductById(productId: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single();

  if (error) {
    console.error('[Product] Get by ID error:', error);
    return null;
  }

  return data as Product;
}

/**
 * Get quote by ID (used for Audico Chat Quote System proformas)
 */
export async function getQuoteById(quoteId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .or(`quote_id.eq.${quoteId},invoice_number.eq.${quoteId}`)
    .limit(1)
    .single();

  if (error) {
    console.error('[Quote] Get by ID error:', error);
    return null;
  }

  return data;
}

/**
 * Get or create conversation for a phone number
 */
export async function getOrCreateConversation(
  phoneNumber: string,
  customerName?: string
): Promise<Conversation> {
  // Check for the most recent conversation
  const { data: rows, error: fetchError } = await supabase
    .from('whatsapp_conversations')
    .select('*')
    .eq('phone_number', phoneNumber)
    .order('created_at', { ascending: false })
    .limit(1);

  if (fetchError) {
    console.error('[Conversation] Fetch error:', fetchError);
  }

  // If the absolute latest conversation exists and is not 'completed' or 'resolved'
  if (rows && rows.length > 0) {
    const latest = rows[0];
    if (latest.status !== 'completed' && latest.status !== 'resolved' && latest.status !== 'closed') {
      return latest as Conversation;
    }
  }

  // Create new conversation
  const newContext: ConversationContext = {
    collected_details: {},
  };

  const { data: created, error } = await supabase
    .from('whatsapp_conversations')
    .insert({
      phone_number: phoneNumber,
      customer_name: customerName,
      status: 'active',
      context: newContext,
    })
    .select()
    .single();

  if (error) {
    console.error('[Conversation] Create error:', error);
    throw new Error('Failed to create conversation');
  }

  return created as Conversation;
}

/**
 * Update global WhatsApp connection state (for the dashboard)
 */
export async function updateWhatsappState(state: {
  is_connected: boolean;
  qr_code: string | null;
}): Promise<void> {
  // We use a special phone number 'system_state' to store the bot's global status
  const systemId = 'system_state';

  // First try to find existing state
  const { data: existing } = await supabase
    .from('whatsapp_conversations')
    .select('id')
    .eq('phone_number', systemId)
    .single();

  const payload = {
    phone_number: systemId,
    status: 'active',
    context: {
      is_connected: state.is_connected,
      qr_code: state.qr_code,
      updated_at: new Date().toISOString()
    }
  };

  if (existing) {
    // Update existing
    const { error: updateError } = await supabase
      .from('whatsapp_conversations')
      .update(payload)
      .eq('id', existing.id);

    if (updateError) console.error('[Supabase] Failed to update WhatsApp state:', updateError);
  } else {
    // Insert new
    const { error: insertError } = await supabase
      .from('whatsapp_conversations')
      .insert(payload);

    if (insertError) console.error('[Supabase] Failed to insert WhatsApp state:', insertError);
  }
}

/**
 * Update conversation context
 */
export async function updateConversation(
  conversationId: string,
  updates: Partial<Pick<Conversation, 'status' | 'context' | 'customer_name'>>
): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  if (error) {
    console.error('[Conversation] Update error:', error);
  }
}

/**
 * Save a finalized quote request from the AI agent into the database.
 *
 * The whatsapp_quote_requests table has flat columns (customer_name, customer_email,
 * products, notes) — NOT a single `details` JSONB column. Wade reads `products`
 * as a structured array, so we parse the free-text products_of_interest string
 * (e.g. "1x Sonos Beam Gen2 Black" or "1x wiim amp ultra and 1 x wiim amp pro")
 * into [{product_name, quantity, notes}, ...].
 *
 * Status is set to 'routed_to_wade' so Wade's 10-min cycle picks it up immediately.
 */
export async function saveQuoteRequest(
  phoneNumber: string,
  customerName: string | undefined,
  details: QuoteRequestDetails
): Promise<QuoteRequest> {
  const products = parseProductsOfInterest(details.products_of_interest);

  // Combine company name into notes so it isn't lost (no dedicated column)
  const noteParts: string[] = [];
  if (details.company_name) noteParts.push(`Company: ${details.company_name}`);
  if (details.additional_notes) noteParts.push(details.additional_notes);
  const notes = noteParts.join(' | ');

  const { data, error } = await supabase
    .from('whatsapp_quote_requests')
    .insert({
      phone_number: phoneNumber,
      customer_name: details.customer_name || customerName,
      customer_email: details.email,
      products,
      notes,
      status: 'routed_to_wade',
    })
    .select()
    .single();

  if (error) {
    console.error('[QuoteRequest] Save error:', error);
    throw new Error(`Failed to save quote request: ${error.message}`);
  }

  return data as QuoteRequest;
}

/**
 * Parse a free-text product list ("1x Sonos Beam Gen2 Black",
 * "1x wiim amp ultra and 1 x wiim amp pro", "Denon Home 150NV, Denon AVR-X2800H")
 * into the structured array Wade expects.
 */
function parseProductsOfInterest(text: string): Array<{ product_name: string; quantity: number; notes: string }> {
  if (!text || !text.trim()) return [];
  // Split on " and " or "," — both are common separators in customer messages
  const tokens = text.split(/\s+and\s+|,/i).map((t) => t.trim()).filter(Boolean);
  return tokens.map((token) => {
    // Match a leading quantity prefix like "1x", "2 x", "3X "
    const m = token.match(/^(\d+)\s*[xX]\s+(.+)$/);
    if (m) {
      return { product_name: m[2].trim(), quantity: parseInt(m[1], 10), notes: '' };
    }
    return { product_name: token, quantity: 1, notes: '' };
  });
}

/**
 * Save chat message for history
 */
export async function saveChatMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('whatsapp_messages').insert({
    conversation_id: conversationId,
    role,
    content,
    metadata: metadata || {},
  });

  if (error) {
    console.error('[Message] Save error:', error);
  }
}

/**
 * Get recent messages for context
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number = 10
): Promise<Array<{ role: string; content: string }>> {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Messages] Get recent error:', error);
    return [];
  }

  return (data || []).reverse();
}

/**
 * Fetch pending outbound messages from the queue
 */
export async function fetchPendingOutbound(): Promise<Array<{
  id: string;
  conversation_id: string;
  phone_number: string;
  message: string;
  sent_by: string;
  message_type: string;
  document_url: string | null;
  document_filename: string | null;
  caption: string | null;
}>> {
  const { data, error } = await supabase
    .from('whatsapp_outbound_queue')
    .select('id, conversation_id, phone_number, message, sent_by, message_type, document_url, document_filename, caption')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    console.error('[Outbound] Fetch error:', error);
    return [];
  }
  return data || [];
}

/**
 * Mark an outbound message as sending (claim it)
 */
export async function claimOutbound(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('whatsapp_outbound_queue')
    .update({ status: 'sending' })
    .eq('id', id)
    .eq('status', 'pending');
  return !error;
}

/**
 * Mark an outbound message as sent
 */
export async function markOutboundSent(id: string): Promise<void> {
  await supabase
    .from('whatsapp_outbound_queue')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);
}

/**
 * Mark an outbound message as failed
 */
export async function markOutboundFailed(id: string, error: string): Promise<void> {
  await supabase
    .from('whatsapp_outbound_queue')
    .update({ status: 'failed', error })
    .eq('id', id);
}

export { supabase };
