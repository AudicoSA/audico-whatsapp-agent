/**
 * AI Conversation Agent for WhatsApp
 * Handles natural language understanding and product recommendations
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  searchProducts,
  getProductById,
  addToQuote,
  clearQuote,
  getRecentMessages,
  saveChatMessage,
  updateConversation
} from './supabase';
import { whatsapp } from './whatsapp';
import { Conversation, Product, QuoteItem } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are the Audico WhatsApp Sales Assistant - a friendly, knowledgeable audio expert helping customers find the perfect audio/visual equipment.

ABOUT AUDICO:
- Premium audio/visual retailer in South Africa
- 10,000+ products across 586 brands
- Specializes in home audio, commercial sound, conferencing, and custom installations
- Website: www.audicoonline.co.za

YOUR ROLE:
1. Help customers find products (speakers, amplifiers, microphones, etc.)
2. Provide recommendations based on their needs
3. Build quotes with accurate pricing
4. Answer product questions
5. Escalate complex installations to Kenny (the owner)

CONVERSATION STYLE:
- Keep messages SHORT (WhatsApp format, max 2-3 paragraphs)
- Use emojis sparingly but naturally 🔊
- Be helpful but not pushy
- Ask clarifying questions when needed
- Always confirm before adding to quote

TOOLS AVAILABLE:
- search_products: Find products in the catalog
- add_to_quote: Add a product to customer's quote
- show_quote: Display current quote summary
- clear_quote: Remove all items from quote
- escalate: Transfer to human support

PRICE DISPLAY:
- Always show prices in Rands (R)
- Format: R12,500 (not R12500 or 12500)
- Note: Prices exclude VAT and delivery

WHEN TO ESCALATE:
- Custom installation requests
- Technical questions you're unsure about
- Complaints or disputes
- Large commercial projects (>R100,000)
- Requests for discounts

Remember: You're having a WhatsApp conversation, not writing an email. Keep it conversational and concise!`;

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface AgentResponse {
  message: string;
  toolsUsed: string[];
  productsShown?: Product[];
  quoteUpdated?: boolean;
  escalated?: boolean;
}

/**
 * Process a customer message and generate a response
 */
export async function processMessage(
  conversation: Conversation,
  customerMessage: string,
  customerPhone: string
): Promise<AgentResponse> {
  // Get recent conversation history
  const recentMessages = await getRecentMessages(conversation.id, 10);

  // Build messages array for Claude
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...recentMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: customerMessage },
  ];

  // Build context about current quote
  let quoteContext = '';
  if (conversation.context.quote_items.length > 0) {
    const total = conversation.context.quote_items.reduce(
      (sum, item) => sum + item.total_price,
      0
    );
    quoteContext = `\n\nCURRENT QUOTE (${conversation.context.quote_items.length} items, total R${total.toLocaleString()}):\n`;
    conversation.context.quote_items.forEach((item, i) => {
      quoteContext += `${i + 1}. ${item.product_name} x${item.quantity} @ R${item.unit_price.toLocaleString()}\n`;
    });
  }

  const tools: Anthropic.Tool[] = [
    {
      name: 'search_products',
      description: 'Search the Audico product catalog for audio/visual equipment',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "Denon AV receiver", "ceiling speakers", "JBL PRX")',
          },
          min_price: {
            type: 'number',
            description: 'Minimum price in Rands (optional)',
          },
          max_price: {
            type: 'number',
            description: 'Maximum price in Rands (optional)',
          },
          brand: {
            type: 'string',
            description: 'Filter by brand (optional)',
          },
          limit: {
            type: 'number',
            description: 'Number of results (default 5, max 10)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'add_to_quote',
      description: 'Add a product to the customer quote. Use the exact product_id from search results.',
      input_schema: {
        type: 'object' as const,
        properties: {
          product_id: {
            type: 'string',
            description: 'The UUID of the product (from search results)',
          },
          quantity: {
            type: 'number',
            description: 'Quantity to add (default 1)',
          },
        },
        required: ['product_id'],
      },
    },
    {
      name: 'show_quote',
      description: 'Display the current quote summary to the customer',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'clear_quote',
      description: 'Clear all items from the quote',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'escalate',
      description: 'Transfer conversation to human support (Kenny)',
      input_schema: {
        type: 'object' as const,
        properties: {
          reason: {
            type: 'string',
            description: 'Reason for escalation',
          },
        },
        required: ['reason'],
      },
    },
  ];

  try {
    // Call Claude with tools
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 1024,
      system: SYSTEM_PROMPT + quoteContext,
      tools,
      messages,
    });

    const toolsUsed: string[] = [];
    let productsShown: Product[] = [];
    let quoteUpdated = false;
    let escalated = false;
    let finalMessage = '';

    // Process response content
    for (const block of response.content) {
      if (block.type === 'text') {
        finalMessage = block.text;
      } else if (block.type === 'tool_use') {
        const toolResult = await executeToolCall(
          conversation,
          block.name,
          block.input as Record<string, unknown>
        );

        toolsUsed.push(block.name);

        if (block.name === 'search_products' && toolResult.raw_products) {
          productsShown = toolResult.raw_products as Product[];
        }
        if (block.name === 'add_to_quote' && toolResult.success) {
          quoteUpdated = true;
        }
        if (block.name === 'escalate') {
          escalated = true;
          await updateConversation(conversation.id, {
            status: 'escalated',
            context: {
              ...conversation.context,
              escalation_reason: (block.input as { reason?: string }).reason || 'Customer request',
            },
          });
        }

        // If tools were used, we need to continue the conversation
        if (response.stop_reason === 'tool_use') {
          const followUp = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 1024,
            system: SYSTEM_PROMPT + quoteContext,
            tools,
            messages: [
              ...messages,
              { role: 'assistant', content: response.content },
              {
                role: 'user',
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: JSON.stringify(toolResult),
                  },
                ],
              },
            ],
          });

          // Get final text response
          for (const followBlock of followUp.content) {
            if (followBlock.type === 'text') {
              finalMessage = followBlock.text;
            }
          }
        }
      }
    }

    // Save messages
    await saveChatMessage(conversation.id, 'user', customerMessage);
    await saveChatMessage(conversation.id, 'assistant', finalMessage, {
      tools_used: toolsUsed,
      products_shown: productsShown.map(p => p.id),
    });

    return {
      message: finalMessage,
      toolsUsed,
      productsShown: productsShown.length > 0 ? productsShown : undefined,
      quoteUpdated,
      escalated,
    };
  } catch (error) {
    console.error('[Agent] Error processing message:', error);

    // Save error and return fallback
    await saveChatMessage(conversation.id, 'user', customerMessage);

    return {
      message: "Sorry, I'm having a moment! 😅 Could you try that again? If this keeps happening, type 'help' and I'll connect you with Kenny.",
      toolsUsed: [],
    };
  }
}

/**
 * Execute a tool call
 */
async function executeToolCall(
  conversation: Conversation,
  toolName: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  console.log(`[Tool] Executing ${toolName}:`, input);

  switch (toolName) {
    case 'search_products': {
      const products = await searchProducts(input.query as string, {
        limit: Math.min((input.limit as number) || 5, 10),
        minPrice: input.min_price as number,
        maxPrice: input.max_price as number,
        brand: input.brand as string,
      });

      // Update conversation context with last search
      await updateConversation(conversation.id, {
        context: {
          ...conversation.context,
          last_search_query: input.query as string,
        },
      });

      return {
        success: true,
        count: products.length,
        products: products.map(p => ({
          id: p.id,
          name: p.product_name,
          brand: p.brand,
          sku: p.sku,
          price: p.retail_price,
          stock: p.total_stock,
          category: p.category_name,
        })),
        raw_products: products,
      };
    }

    case 'add_to_quote': {
      const product = await getProductById(input.product_id as string);
      if (!product) {
        return { success: false, error: 'Product not found' };
      }

      const items = await addToQuote(
        conversation.id,
        product,
        (input.quantity as number) || 1
      );

      return {
        success: true,
        message: `Added ${product.product_name} to quote`,
        quote_items: items.length,
        quote_total: items.reduce((sum, item) => sum + item.total_price, 0),
      };
    }

    case 'show_quote': {
      return {
        success: true,
        items: conversation.context.quote_items,
        total: conversation.context.quote_items.reduce(
          (sum, item) => sum + item.total_price,
          0
        ),
      };
    }

    case 'clear_quote': {
      await clearQuote(conversation.id);
      return { success: true, message: 'Quote cleared' };
    }

    case 'escalate': {
      // In a real system, this would notify Kenny via Signal/email
      console.log(`[ESCALATION] Reason: ${input.reason}`);
      return {
        success: true,
        message: 'Escalated to Kenny - he will be in touch shortly',
        reason: input.reason,
      };
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Send WhatsApp response based on agent response
 */
export async function sendAgentResponse(
  phone: string,
  agentResponse: AgentResponse
): Promise<void> {
  // Send main message
  await whatsapp.sendText({ to: phone, text: agentResponse.message });

  // If products were shown, send as interactive list
  if (agentResponse.productsShown && agentResponse.productsShown.length > 0) {
    await whatsapp.sendProductCards({
      to: phone,
      products: agentResponse.productsShown.map(p => ({
        id: p.id,
        name: p.product_name,
        price: p.retail_price,
        sku: p.sku,
        image: p.images?.[0],
      })),
      header: '🔍 Search Results',
    });
  }
}
