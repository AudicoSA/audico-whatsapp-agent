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
    // Use hybrid text search (passing null for query_embedding)
    const { data, error } = await supabase.rpc('hybrid_product_search', {
      query_text: query,
      query_embedding: null,
      min_price: minPrice,
      max_price: maxPrice,
      brand_filter: brand,
      category_filter: category,
      use_case_filter: null,
      in_stock_only: inStockOnly,
      result_limit: limit,
      bm25_weight: 1.0,
      vector_weight: 0.0,
    });

    if (error) {
      console.error('[Search] BM25 search error:', error);

      // Fallback to simple text search
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
 * Get or create conversation for a phone number
 */
export async function getOrCreateConversation(
  phoneNumber: string,
  customerName?: string
): Promise<Conversation> {
  // Check for existing active conversation
  const { data: existing } = await supabase
    .from('whatsapp_conversations')
    .select('*')
    .eq('phone_number', phoneNumber)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    return existing as Conversation;
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

export { supabase };
