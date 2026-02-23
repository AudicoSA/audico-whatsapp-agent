import 'dotenv/config';
import { whatsapp } from './lib/whatsapp';
import { getOrCreateConversation, processMessage, sendAgentResponse } from './lib/agent'; // Reusing existing exports through agents

async function bootstrap() {
    console.log('[App] Starting WhatsApp Discovery Agent...');

    // Initialize the whatsapp-web.js client
    // This will print the QR code to the terminal if not authenticated
    await whatsapp.initialize();

    // Listen for incoming messages
    whatsapp.client.on('message', async (message) => {
        // Ignore group messages or status broadcasts for now
        if (message.from.endsWith('@g.us') || message.from === 'status@broadcast') {
            return;
        }

        try {
            const customerPhone = message.from;
            const text = message.body;

            console.log(`\n[Message Received] From: ${customerPhone} | Text: ${text}`);

            // We mark as read to give the user immediate feedback
            const chat = await message.getChat();
            await chat.sendSeen();

            // Get contact info (like their pushname)
            const contact = await message.getContact();
            const customerName = contact.pushname || contact.name || 'Customer';

            // 1. Get or create conversation context in Supabase
            const conversation = await getOrCreateConversation(customerPhone, customerName);

            // 2. Process message through Claude
            // Note: We're passing customerPhone as the second argument as per the refactored processMessage signature
            const agentResponse = await processMessage(
                conversation,
                text,
                customerPhone
            );

            // 3. Send response back to WhatsApp
            await sendAgentResponse(customerPhone, agentResponse);

        } catch (error) {
            console.error('[App] Error handling incoming message:', error);
            message.reply("Sorry, I'm having a technical moment! 😅 Let me clear my circuits, please try again in a minute.");
        }
    });
}

// Global unhandled rejection handler to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]', error);
});

bootstrap();
