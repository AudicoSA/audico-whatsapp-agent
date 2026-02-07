/**
 * WhatsApp Agent Type Definitions
 */

// WhatsApp Webhook Types
export interface WhatsAppWebhook {
  object: 'whatsapp_business_account';
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: {
    messaging_product: 'whatsapp';
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: WhatsAppContact[];
    messages?: WhatsAppMessage[];
    statuses?: WhatsAppStatus[];
  };
  field: 'messages';
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'document' | 'location' | 'interactive' | 'button';
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
  context?: {
    from: string;
    id: string;
  };
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

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
  quote_items: QuoteItem[];
  requirements?: string[];
  escalation_reason?: string;
  last_search_query?: string;
}

export interface QuoteItem {
  product_id: string;
  product_name: string;
  sku: string;
  brand?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
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

// WhatsApp Send Message Types
export interface SendTextMessage {
  to: string;
  text: string;
  replyTo?: string;
}

export interface SendInteractiveMessage {
  to: string;
  type: 'button' | 'list';
  header?: {
    type: 'text' | 'image';
    text?: string;
    image?: { link: string };
  };
  body: string;
  footer?: string;
  buttons?: Array<{
    id: string;
    title: string;
  }>;
  sections?: Array<{
    title: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}

// API Response Types
export interface WebhookResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface QuoteResponse {
  success: boolean;
  quote_id?: string;
  total?: number;
  items?: QuoteItem[];
  pdf_url?: string;
  error?: string;
}
