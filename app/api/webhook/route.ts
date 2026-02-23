/**
 * WhatsApp Webhook Handler
 * Receives messages from Meta's WhatsApp Cloud API
 */

import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppWebhook, WhatsAppMessage } from '@/lib/types';
import { whatsapp } from '@/lib/whatsapp';
import { getOrCreateConversation } from '@/lib/supabase';
import { processMessage, sendAgentResponse } from '@/lib/agent';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

/**
 * GET - Webhook Verification
 * Meta sends a challenge to verify the webhook URL
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  console.log('[Webhook] Verification request:', { mode, token: token?.slice(0, 10) + '...' });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Webhook] Verification successful');
    return new NextResponse(challenge, { status: 200 });
  }

  console.log('[Webhook] Verification failed');
  return new NextResponse('Forbidden', { status: 403 });
}

/**
 * POST - Receive Messages
 * Handles incoming messages from WhatsApp
 */
export async function POST(request: NextRequest) {
  try {
    const body: WhatsAppWebhook = await request.json();

    // Validate webhook structure
    if (body.object !== 'whatsapp_business_account') {
      console.log('[Webhook] Invalid object type:', body.object);
      return NextResponse.json({ success: false }, { status: 400 });
    }

    // Process each entry
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;

        // Handle incoming messages
        if (messages && messages.length > 0) {
          for (const message of messages) {
            // FIRE AND FORGET: do not await this on serverless or Railway
            // this ensures Meta gets a 200 OK immediately and doesn't retry
            handleIncomingMessage(message, contacts?.[0]?.profile?.name).catch(err => {
               console.error('[Background Task Error]', err);
            });
          }
        }
      }
    }

    // Always return 200 quickly to acknowledge receipt
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Webhook] Error processing:', error);
    // Still return 200 to prevent retries
    return NextResponse.json({ success: true });
  }
}

/**
 * Handle an incoming message
 */
async function handleIncomingMessage(
  message: WhatsAppMessage,
  customerName?: string
): Promise<void> {
  const { from: phoneNumber, id: messageId, type } = message;

  console.log(`[Message] From ${phoneNumber}, type: ${type}`);

  // Mark as read immediately
  await whatsapp.markAsRead(messageId);

  // Extract message text
  let text = '';

  switch (type) {
    case 'text':
      text = message.text?.body || '';
      break;

    case 'interactive':
      if (message.interactive?.button_reply) {
        text = message.interactive.button_reply.id;
      } else if (message.interactive?.list_reply) {
        text = message.interactive.list_reply.id;
      }
      break;

    case 'button':
      // Quick reply button
      text = message.text?.body || '';
      break;

    default:
      // Unsupported message type
      await whatsapp.sendText({
        to: phoneNumber,
        text: "I can only read text messages at the moment. Please type your question and I'll help you! 😊",
        replyTo: messageId,
      });
      return;
  }

  if (!text.trim()) {
    return;
  }

  // Check for special commands
  const lowerText = text.toLowerCase().trim();

  if (lowerText === 'hi' || lowerText === 'hello' || lowerText === 'start') {
    await sendWelcomeMessage(phoneNumber, customerName);
    return;
  }

  if (lowerText === 'help') {
    await sendHelpMessage(phoneNumber);
    return;
  }

  // Get or create conversation
  const conversation = await getOrCreateConversation(phoneNumber, customerName);

  // Handle button/list selections
  if (text.startsWith('add_')) {
    // Quick add from product card
    const productId = text.replace('add_', '');
    text = `Add product ${productId} to my quote`;
  }

  // Process with AI agent
  try {
    const agentResponse = await processMessage(conversation, text, phoneNumber);
    await sendAgentResponse(phoneNumber, agentResponse);
  } catch (error) {
    console.error('[Message] Processing error:', error);
    await whatsapp.sendText({
      to: phoneNumber,
      text: "Oops! Something went wrong on my end. Let me connect you with Kenny - he'll sort this out. 🙏",
    });
  }
}

/**
 * Send welcome message to new customers
 */
async function sendWelcomeMessage(phone: string, name?: string): Promise<void> {
  const greeting = name ? `Hi ${name}! 👋` : "Hi there! 👋";

  await whatsapp.sendText({
    to: phone,
    text: `${greeting}

Welcome to *Audico* - South Africa's premium audio specialists! 🔊

I'm your AI assistant and I can help you:
• Find the perfect speakers, amplifiers & audio gear
• Build a quote for your project
• Answer product questions
• Connect you with our team

What are you looking for today?`,
  });

  // Send quick action buttons
  await whatsapp.sendButtons({
    to: phone,
    body: 'Quick start:',
    buttons: [
      { id: 'search', title: '🔍 Search Products' },
      { id: 'help', title: '❓ What can you do?' },
      { id: 'human', title: '👤 Talk to Kenny' },
    ],
  });
}

/**
 * Send help message
 */
async function sendHelpMessage(phone: string): Promise<void> {
  await whatsapp.sendText({
    to: phone,
    text: `*How I can help you:* 🎯

🔍 *Search* - Tell me what you're looking for
   "Show me Denon AV receivers"
   "I need ceiling speakers for a restaurant"

💰 *Quote* - I'll build you a quote
   "Add the Denon X3800H to my quote"
   "Show my quote"
   "Clear quote"

📦 *Track Order* - Check your order status
   "Track order 12345"

💬 *Help* - Talk to a human
   "Talk to Kenny"
   "I need help"

Just type naturally - I'll figure out what you need! 😊`,
  });
}
