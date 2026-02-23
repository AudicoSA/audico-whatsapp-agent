/**
 * AI Conversation Agent for WhatsApp
 * Handles natural language understanding and product recommendations
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  searchProducts,
  getRecentMessages,
  saveChatMessage,
  updateConversation,
  saveQuoteRequest
} from './supabase';
import { whatsapp } from './whatsapp';
import { Conversation, Product, QuoteRequestDetails } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are the Audico WhatsApp Discovery Assistant - a friendly, knowledgeable audio expert helping customers find the perfect audio/visual equipment.

ABOUT AUDICO:
- Premium audio/visual retailer in South Africa
- 10,000+ products across 586 brands
- Specializes in home audio, commercial sound, conferencing, and custom installations
- Website: www.audicoonline.co.za

YOUR ROLE:
1. Help customers find products and guide them toward the right solutions.
2. DILIGENTLY GATHER REQUIREMENTS for a formal quote.
3. You do NOT provide final quotes or checkout links. Your goal is to gather all necessary information so Kenny (the owner and installation expert) can prepare a highly accurate, tailored quote.
4. Escalate complex installations to Kenny.

THE DISCOVERY PROCESS (Gather these details naturally):
- **Budget**: What is their approximate budget?
- **Room Size / Area**: How large is the space, or is it commercial/residential?
- **Use Case**: What is the primary use? (Movies, background music, PA system, etc.)
- **Specific Brands**: Do they have any brand preferences?
- **Timeline**: When do they need this installed or delivered?

CONVERSATION STYLE:
- Keep messages SHORT (WhatsApp format, max 2-3 paragraphs)
- Use emojis sparingly but naturally 🔊
- Be helpful and consultative, not pushy.
- Ask clarifying questions one at a time (don't overwhelm them with a form).
- Once you have enough information, use the \`submit_quote_request\` tool to finalize the lead.

TOOLS AVAILABLE:
- search_products: Find products in the catalog to suggest to the user.
- submit_quote_request: Use this ONLY WHEN you have gathered sufficient requirements to generate a quote request lead for the Audico team.
- escalate: Transfer to human support (Kenny) without a quote request, if they just need complex advice or have a complaint.

PRICE DISPLAY:
- Always show prices in Rands (R)
- Format: R12,500 (not R12500 or 12500)
- Explicitly mention: "Please note these are estimated retail prices. The Audico team will send you a formal quote."

WHEN TO ESCALATE DIRECTLY:
- Complaints or disputes
- Requests for massive commercial tenders where gathering basic details isn't enough.

Remember: You're having a WhatsApp conversation, not writing an email. Keep it conversational and concise!`;

interface AgentResponse {
  message: string;
  toolsUsed: string[];
  productsShown?: Product[];
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

  const tools: Anthropic.Tool[] = [
    {
      name: 'search_products',
      description: 'Search the Audico product catalog for audio/visual equipment to guide your recommendations',
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
      name: 'submit_quote_request',
      description: 'Submit an incredibly detailed lead to the Audico sales team so they can build a formal quote. Call this ONLY when you have asked the discovery questions and the user is ready for a quote.',
      input_schema: {
        type: 'object' as const,
        properties: {
          budget: { type: 'string', description: 'The customer\'s budget (e.g., "R10,000", "Unknown/Flexible")' },
          room_size: { type: 'string', description: 'Size of the room or venue (e.g., "5x5m living room", "commercial warehouse")' },
          use_case: { type: 'string', description: 'What they are using the equipment for (e.g., "Home Theater", "Restaurant background music")' },
          specific_brands: { type: 'string', description: 'Any brands they requested or you recommended' },
          timeline: { type: 'string', description: 'When they need it (e.g., "ASAP", "Next month")' },
          additional_notes: { type: 'string', description: 'A detailed summary of exactly what products they are looking for and any other context.' },
        },
        required: ['budget', 'room_size', 'use_case', 'specific_brands', 'timeline', 'additional_notes'],
      },
    },
    {
      name: 'escalate',
      description: 'Transfer conversation to human support (Kenny) for complex technical queries or complaints',
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
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const toolsUsed: string[] = [];
    let productsShown: Product[] = [];
    let escalated = false;
    let finalMessage = '';

    // Process response content
    for (const block of response.content) {
      if (block.type === 'text') {
        finalMessage = block.text;
      } else if (block.type === 'tool_use') {
        const toolResult = await executeToolCall(
          conversation,
          customerPhone,
          block.name,
          block.input as Record<string, unknown>
        );

        toolsUsed.push(block.name);

        if (block.name === 'search_products' && toolResult.raw_products) {
          productsShown = toolResult.raw_products as Product[];
        }

        if (block.name === 'submit_quote_request' || block.name === 'escalate') {
          escalated = true;
          await updateConversation(conversation.id, {
            status: block.name === 'submit_quote_request' ? 'pending_quote' : 'escalated',
            context: {
              ...conversation.context,
              escalation_reason: (block.input as { reason?: string }).reason || 'Quote Request Submitted',
            },
          });
        }

        // If tools were used, we need to continue the conversation
        if (response.stop_reason === 'tool_use') {
          const followUp = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
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
  customerPhone: string,
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

    case 'submit_quote_request': {
      const details = input as unknown as QuoteRequestDetails;

      try {
        await saveQuoteRequest(
          customerPhone,
          conversation.customer_name,
          details
        );
        return {
          success: true,
          message: "Quote request successfully saved to Audico's CRM. Tell the user that the team has received it and Kenny will reach out to them very soon with a formal quote."
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
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
  await whatsapp.sendText(phone, agentResponse.message);

  // If products were shown, send as interactive list
  if (agentResponse.productsShown && agentResponse.productsShown.length > 0) {
    await whatsapp.sendProductOptions(
      phone,
      agentResponse.productsShown.map(p => ({
        id: p.id,
        name: p.product_name,
        price: p.retail_price,
        sku: p.sku,
        brand: p.brand
      })),
      '🔍 I found these options:'
    );
  }
}
