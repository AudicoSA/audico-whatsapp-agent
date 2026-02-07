/**
 * Supabase Client & Product Search
 * Connects to Audico's product database
 */

import { createClient } from '@supabase/supabase-js';
import { Product, Conversation, ConversationContext, QuoteItem } from './types';

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
    // Use BM25 text search (simpler, works without embeddings)
    const { data, error } = await supabase.rpc('bm25_product_search', {
      search_query: query,
      min_price: minPrice,
      max_price: maxPrice,
      brand_filter: brand,
      category_filter: category,
      in_stock_only: inStockOnly,
      result_limit: limit,
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
    quote_items: [],
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
 * Add item to quote
 */
export async function addToQuote(
  conversationId: string,
  product: Product,
  quantity: number = 1
): Promise<QuoteItem[]> {
  // Get current conversation
  const { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('context')
    .eq('id', conversationId)
    .single();

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const context = conversation.context as ConversationContext;
  const existingIndex = context.quote_items.findIndex(
    (item) => item.product_id === product.id
  );

  const newItem: QuoteItem = {
    product_id: product.id,
    product_name: product.product_name,
    sku: product.sku,
    brand: product.brand,
    quantity,
    unit_price: product.retail_price,
    total_price: product.retail_price * quantity,
  };

  if (existingIndex >= 0) {
    // Update existing item quantity
    context.quote_items[existingIndex].quantity += quantity;
    context.quote_items[existingIndex].total_price =
      context.quote_items[existingIndex].quantity *
      context.quote_items[existingIndex].unit_price;
  } else {
    // Add new item
    context.quote_items.push(newItem);
  }

  // Save updated context
  await updateConversation(conversationId, { context });

  return context.quote_items;
}

/**
 * Clear quote
 */
export async function clearQuote(conversationId: string): Promise<void> {
  const { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('context')
    .eq('id', conversationId)
    .single();

  if (conversation) {
    const context = conversation.context as ConversationContext;
    context.quote_items = [];
    await updateConversation(conversationId, { context });
  }
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
