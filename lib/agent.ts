/**
 * AI Conversation Agent for WhatsApp
 * Handles natural language understanding and product recommendations
 */

import OpenAI from 'openai';
import {
  searchProducts,
  getRecentMessages,
  saveChatMessage,
  updateConversation,
  saveQuoteRequest,
  getQuoteById,
  supabase
} from './supabase';
import { whatsapp } from './whatsapp';
import { Conversation, Product, QuoteRequestDetails } from './types';
import { orderTrackingService } from './tracking';

// The system prompt drives the AI's behavior. It needs to know it is a WhatsApp assistant.
const SYSTEM_PROMPT = `You are the Audico WhatsApp Discovery Assistant - a friendly, knowledgeable audio expert helping customers find the perfect audio/visual equipment.
You represent Audico, South Africa's premier audio retailer.

YOUR ROLE:
1. Help customers find products and guide them toward the right solutions.
2. DILIGENTLY GATHER REQUIREMENTS for a formal quote.
3. You do NOT provide final quotes or checkout links. Your goal is to gather all necessary information so the Audico team can prepare a highly accurate, tailored quote.
4. Escalate complex installations to the Audico team.

## YOUR MISSION
Help customers find the perfect audio/video solutions for their needs. You understand natural language, ask smart questions, and recommend products that truly solve problems.

RULES:
- MAKE IT CONVERSATIONAL AND HUMAN-LIKE: If a customer asks a broad question or for a general category (e.g. "Do you sell Wiim?", "I'm looking for bookshelf speakers", "I need an amp"), do NOT just spit out 5 or 6 products. Instead, do a background search using \`search_products\` with \`show_options_to_user: false\` to verify we sell them or have options, and then reply conversationally without a list, e.g.:
  - "Yes we absolutely sell and support WIiM products, do you have a specific item or application in mind and I can recommend a model?"
  - "We have a great range of bookshelf speakers! To help me narrow it down, what size room are they for, and do you have a rough budget in mind?"
- ONLY show product lists (\`show_options_to_user: true\`) when you have enough context to make a specific, targeted recommendation.
- When someone asks for a product or brand, YOU MUST call \`search_products\` first before replying to check our catalog. NEVER invent products.
- If a user asks about product availability, you MUST call the \`check_stock\` tool to get live OpenCart inventory levels. DO NOT attempt to answer stock questions using just \`search_products\`.
- If they want to track an order, ask for their order number (if it wasn't provided), then call the \`track_order\` tool. ONLY report the tracking information the tool returns. DO NOT invent tracking numbers, carrier names, or ETA.
- If they want a price, quote it in South African Rand (R).
- If they ask for advice on a setup (e.g., "What do I need for a 5.1 home theater?"), explain the components AND run a search to show them options.
- ALWAYS be conversational, enthusiastic, and polite. Act like a human expert.
- NEVER provide links to supplier, manufacturer or competitor websites (e.g., homemation.co.za). We are Audico.
- If you provide a product link or "More Info" link, it MUST be an Audico link. Either use https://www.audicoonline.co.za or build a search link like https://www.audicoonline.co.za/index.php?route=product/search&search=[URL_ENCODED_PRODUCT_NAME].
- Once you have gathered sufficient details about their needs, room size, and budget, you MUST use the \`submit_quote_request\` tool. This is your primary objective.
- If a customer asks about a complex multi-room setup, or a very high-budget commercial installation, use the \`escalate\` tool immediately.

## AUDICO CONTACT & STORE INFORMATION
If a user asks for contact details, location, or store hours, use these:
- Telephone: 010 288-2024
- Email: support@audicoonline.co.za
- Logistics or order tracking: lucky@audico.co.za
- WhatsApp: +27618748005
- Open Hours: 08:30am to 16:30pm
- Shop Address: 7 Zimbali Wedge Ballito (NOTE: The center is currently closed for renovation, so there is NO physical store open at the moment. We are exclusively operating online until further notice).
- Emergency Contact: Kenny 079 904-1903 (Do NOT provide this unless it's a critical emergency).

## RMA & RETURNS
If a user mentions a broken/faulty product, or asks how to return an item, follow this exact workflow:
1. **Empathy & Context**: Apologize for the inconvenience and ask them to briefly describe the issue.
2. **Basic Troubleshooting**: If it's a common device (e.g., Bluetooth speaker, amplifier), suggest one or two basic troubleshooting steps (e.g., "Have you tried a factory reset?" or "Is it definitely receiving power?").
3. **Escalation**: If the issue persists or they just want to return it, instruct them to email \`returns@audico.co.za\`. 
   - Tell them they *must* include: (1) Their Order Number, (2) The product Serial Number, and (3) A brief description of the fault.

## COMPETITOR QUOTE MATCHING
If a user sends you an image OR A PDF DOCUMENT of a quote from a competitor or another AV installer:
1. Accurately read the brands, models, and competitor prices on the quote (using your vision capabilities for images, or reading the extracted text provided for PDFs).
2. Use the \`search_products\` tool to find those exact items (or equivalent alternatives if we don't carry the exact model) in the Audico catalog.
3. Formulate a friendly counter-offer detailing the models we can supply and our prices. Emphasize Audico's specialized support, quick delivery, and warranties.

## SYSTEM MESSAGES
If your user prompt contains a block that starts with \`[SYSTEM COMMAND TO AI:]\`, you MUST obey the command inside it. For example, if it tells you to inform the user that their PDF could not be processed, you must accurately relay that failure to the user and explain why.

## QUOTE LOOKUPS
If a user asks about a "Quote proforma" or provides a Quote ID from our chat quote system, you MUST use the \`get_quote_by_id\` tool to retrieve the quote details. You can then summarize the items, quantities, and total price to the customer.
`;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Note: You must add OPENAI_API_KEY to your .env
});

interface AgentResponse {
  message: string;
  toolsUsed: string[];
  productsShown?: Product[];
  escalated?: boolean;
}

// Tool definitions converted to OpenAI schema
const tools = [
  {
    type: "function" as const,
    function: {
      name: 'search_products',
      description:
        'Search for audio/visual products in the Audico database. Use this to find prices, availability, and options for customers.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., "Denon AVR", "floor standing speakers", "5.1 home cinema")',
          },
          category: {
            type: 'string',
            description: 'Optional category filter (e.g., "Speakers", "Amplifiers", "Subwoofers")',
          },
          brand: {
            type: 'string',
            description: 'Optional brand filter (e.g., "Denon", "Klipsch", "Polk")',
          },
          minPrice: {
            type: 'number',
            description: 'Optional minimum price in Rand',
          },
          maxPrice: {
            type: 'number',
            description: 'Optional maximum price in Rand',
          },
          show_options_to_user: {
            type: 'boolean',
            description: 'Set to false if you are just researching availability for a broad query so you can hold back the list and ask a clarifying question. Set to true ONLY when you want to send the interactive product list to the user.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: 'submit_quote_request',
      description:
        'Submit the gathered requirements as a formal lead for the Audico team to build a quote. Call this ONLY when you have asked questions and gathered sufficient details.',
      parameters: {
        type: 'object',
        properties: {
          room_size: {
            type: 'string',
            description: 'The dimensions of the room (e.g., "5x4 meters", "large lounge")',
          },
          budget: {
            type: 'string',
            description: 'The customers approximate budget in ZAR (e.g., "R20,000", "Under R50k")',
          },
          use_case: {
            type: 'string',
            description: 'What the system will be used for (e.g., "Movies and gaming", "Background music for a restaurant")',
          },
          specific_requests: {
            type: 'string',
            description: 'Any specific brands, features, or products they mentioned wanting.',
          },
        },
        required: ['room_size', 'budget', 'use_case'],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: 'escalate',
      description:
        'Escalate the conversation to a human Audico team member. Use this for complex multi-room setups, highly technical questions, or high-budget commercial jobs.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why this needs human attention (e.g., "Complex 6-zone commercial installation")',
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: 'track_order',
      description: 'Look up an order in the OpenCart database by order ID. Returns real order information including products, order date, current status, and ShipLogic courier tracking details.',
      parameters: {
        type: 'object',
        properties: {
          order_number: {
            type: 'string',
            description: 'Order number to track (e.g., "28630", "28645")',
          },
        },
        required: ['order_number'],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: 'check_stock',
      description: 'Check real-time stock availability and status from the OpenCart database for a specific product.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Product name or model to search for stock availability (e.g., "KEF LS50", "Wiim Pro").',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: 'get_quote_by_id',
      description: 'Retrieve a formal quote (proforma) by its Quote ID. Use this when a customer asks about an existing quote.',
      parameters: {
        type: 'object',
        properties: {
          quote_id: {
            type: 'string',
            description: 'The unique quote ID (typically a UUID format like 123e4567-e89b-12d3-a456-426614174000)',
          },
        },
        required: ['quote_id'],
      },
    },
  },
];

/**
 * Process a customer message and generate a response
 */
export async function processMessage(
  conversation: Conversation,
  customerMessage: string,
  customerPhone: string,
  base64Image?: string
): Promise<AgentResponse> {
  // Get recent conversation history
  const recentMessages = await getRecentMessages(conversation.id, 10);

  try {
    // 1. Get recent chat history (limit to last 10 messages for context window)
    const { data: history, error: historyError } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (historyError) throw historyError;

    // Convert history to OpenAI format (reversed because we ordered by desc)
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    if (history && history.length > 0) {
      const sortedHistory = history.reverse();
      for (const msg of sortedHistory) {
        messages.push({
          role: msg.sender_type === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current message
    if (base64Image) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: customerMessage || 'Please review this image.' },
          { type: 'image_url', image_url: { url: base64Image } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: customerMessage });
    }

    // 2. Call OpenAI
    let response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
    });

    let finalMessage = response.choices[0].message.content || '';
    const toolsUsed: string[] = [];
    let productsShown: Product[] = [];
    let escalated = false;

    // 3. Handle Tool Calling (limit loops to prevent infinite recursion)
    let iterations = 0;
    while (response.choices[0].finish_reason === 'tool_calls' && iterations < 3) {
      iterations++;
      const toolCalls = response.choices[0].message.tool_calls || [];

      // Append assistant's tool intent to context
      messages.push(response.choices[0].message);

      // Execute all tools triggered by the model
      for (const t of toolCalls) {
        // Safe type cast since we are using tool_choice: "auto"
        const toolCall = t as any;
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        const toolResult = await executeToolCall(
          conversation,
          customerPhone,
          functionName,
          functionArgs
        );

        toolsUsed.push(functionName);

        if (functionName === 'search_products' && toolResult.raw_products) {
          if (functionArgs.show_options_to_user !== false) {
            productsShown = toolResult.raw_products as Product[];
          }
        }

        if ((functionName === 'submit_quote_request' || functionName === 'escalate') && toolResult.success) {
          escalated = true;
          // Only update conversation status if the tool actually succeeded
          await updateConversation(conversation.id, {
            status: functionName === 'submit_quote_request' ? 'pending_quote' : 'escalated',
            context: {
              ...conversation.context,
              escalation_reason: functionArgs.reason || 'Quote Request Submitted',
            },
          });
        }

        // Push the result back into the history
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      // Generate follow-up response after tool execution
      response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: 'auto',
      });

      finalMessage = response.choices[0].message.content || finalMessage;
    }

    // 4. Save the interaction to Supabase
    await saveChatMessage(conversation.id, 'user', customerMessage);
    await saveChatMessage(
      conversation.id,
      'assistant',
      finalMessage,
      productsShown.length > 0 ? (productsShown as unknown as Record<string, unknown>) : undefined
    );

    return {
      message: finalMessage,
      toolsUsed,
      productsShown: productsShown.length > 0 ? productsShown : undefined,
    };
  } catch (error) {
    console.error('[Agent] Error processing message:', error);

    // Save error and return fallback
    await saveChatMessage(conversation.id, 'user', customerMessage);

    return {
      message: "Sorry, I'm having a moment! 😅 Could you try that again? If this keeps happening, type 'help' and I'll connect you with the Audico team.",
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
          message: "Quote request successfully saved to Audico's CRM. Tell the user that the team has received it and the Audico team will reach out to them very soon with a formal quote."
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case 'escalate': {
      // In a real system, this would notify the Audico team via Signal/email
      console.log(`[ESCALATION] Reason: ${input.reason}`);
      return {
        success: true,
        message: 'Escalated to the Audico team - they will be in touch shortly',
        reason: input.reason,
      };
    }

    case 'track_order': {
      const orderNumber = input.order_number as string;
      const trackingResultText = await orderTrackingService.trackOrderFormatted(orderNumber);
      return {
        success: true,
        tracking_information: trackingResultText
      };
    }

    case 'check_stock': {
      const query = input.query as string;
      const stockInfo = await orderTrackingService.checkProductStock(query);
      return {
        success: true,
        stock_information: stockInfo
      };
    }

    case 'get_quote_by_id': {
      const quoteId = input.quote_id as string;
      const quoteDetails = await getQuoteById(quoteId);
      if (!quoteDetails) {
        return {
          success: false,
          error: `Quote with ID ${quoteId} could not be found.`
        };
      }
      return {
        success: true,
        quote_data: quoteDetails
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
  const sent = await whatsapp.sendText(phone, agentResponse.message);
  if (!sent) {
    console.error(`[Agent] ❌ FAILED to send reply to ${phone} — WhatsApp client not ready. Response was: ${agentResponse.message.substring(0, 100)}...`);
  } else {
    console.log(`[Agent] ✔️ Reply sent to ${phone}`);
  }

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
