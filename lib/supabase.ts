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
    minPrice = 1,
    maxPrice = 999999999,
    brand = null,
    category = null,
    inStockOnly = true,
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

      // Fallback to simple ILIKE search if textSearch fails (e.g., query parser error)
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('products')
        .select('*')
        .ilike('product_name', `%${query}%`)
        .gte('retail_price', minPrice)
        .lte('retail_price', maxPrice)
        .gt('total_stock', inStockOnly ? 0 : -1)
        .limit(limit);

      if (fallbackError) {
        console.error('[Search] Fallback error:', fallbackError);
        return [];
      }

      return (fallbackData || []) as Product[];
    }

    return (data || []) as Product[];
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
 * Save a finalized quote request from the AI agent into the database
 */
export async function saveQuoteRequest(
  phoneNumber: string,
  customerName: string | undefined,
  details: QuoteRequestDetails
): Promise<QuoteRequest> {
  const { data, error } = await supabase
    .from('whatsapp_quote_requests')
    .insert({
      phone_number: phoneNumber,
      customer_name: customerName,
      status: 'new',
      details: details,
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
}>> {
  const { data, error } = await supabase
    .from('whatsapp_outbound_queue')
    .select('id, conversation_id, phone_number, message, sent_by')
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
