/**
 * WhatsApp Agent Type Definitions
 */

// WhatsApp Webhook Types (Meta API - REPLACED BY whatsapp-web.js)
// Keeping basic types for reference if needed, but no longer core to the app

// Conversation Types
export interface Conversation {
  id: string;
  phone_number: string;
  customer_name?: string;
  status: 'active' | 'pending_quote' | 'completed' | 'escalated';
  context: ConversationContext;
  created_at: string;
  updated_at: string;
}

export interface ConversationContext {
  scenario?: 'home' | 'business' | 'commercial' | 'general';
  requirements?: string[];
  collected_details?: Partial<QuoteRequestDetails>;
  escalation_reason?: string;
  last_search_query?: string;
}

export interface QuoteRequestDetails {
  budget: string;
  room_size: string;
  use_case: string;
  specific_brands: string;
  timeline: string;
  additional_notes: string;
}

export interface QuoteRequest {
  id?: string;
  phone_number: string;
  customer_name?: string;
  status: 'new' | 'contacted' | 'quoted' | 'closed';
  details: QuoteRequestDetails;
  created_at?: string;
}

// Product Types (from Supabase)
export interface Product {
  id: string;
  product_name: string;
  sku: string;
  model?: string;
  brand?: string;
  category_name?: string;
  retail_price: number;
  cost_price?: number;
  description?: string;
  images?: string[];
  total_stock: number;
  stock_jhb?: number;
  stock_cpt?: number;
  specifications?: Record<string, unknown>;
}

// Message Types for AI
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// API Response Types
export interface QuoteResponse {
  success: boolean;
  quote_id?: string;
  error?: string;
}
