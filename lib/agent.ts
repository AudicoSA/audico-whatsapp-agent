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
  supabase
} from './supabase';
import { whatsapp } from './whatsapp';
import { Conversation, Product, QuoteRequestDetails } from './types';

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
- When someone asks for a product, ALWAYS call \`search_products\` first before replying.
- If they want a price, quote it in South African Rand (R).
- If they ask for advice on a setup (e.g., "What do I need for a 5.1 home theater?"), explain the components AND run a search to show them options.
- ALWAYS be conversational, enthusiastic, and polite.
- ONLY EVER recommend products that you found in the database using the search tool. NEVER invent products.
- Once you have gathered sufficient details about their needs, room size, and budget, you MUST use the \`submit_quote_request\` tool. This is your primary objective.
- If a customer asks about a complex multi-room setup, or a very high-budget commercial installation, use the \`escalate\` tool immediately.
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
];

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
    messages.push({ role: 'user', content: customerMessage });

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
          productsShown = toolResult.raw_products as Product[];
        }

        if (functionName === 'submit_quote_request' || functionName === 'escalate') {
          escalated = true;
          // Update the conversation state in the DB immediately
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
