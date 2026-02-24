import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import { whatsapp } from './lib/whatsapp';
import { getOrCreateConversation } from './lib/supabase';
import { processMessage, sendAgentResponse } from './lib/agent';
import { abandonedCartService } from './lib/abandoned-cart';

// Set up Express server for QR Code
const app = express();
const port = process.env.PORT || 8080;

app.get('/', async (req, res) => {
    if (whatsapp.isConnected) {
        return res.send(`
            <html><body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h1>✅ WhatsApp Agent is Connected!</h1>
                <p>The bot is actively listening for messages.</p>
            </body></html>
        `);
    }

    if (whatsapp.latestQrCode) {
        try {
            const qrImage = await QRCode.toDataURL(whatsapp.latestQrCode);
            return res.send(`
                <html><body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h1>📱 Scan this QR Code to Link WhatsApp</h1>
                    <img src="${qrImage}" alt="QR Code" style="background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 300px; height: 300px;"/>
                    <p>Open WhatsApp > Settings > Linked Devices > Link a Device</p>
                    <script>
                        // Auto-refresh every 5 seconds until connected
                        setInterval(() => window.location.reload(), 5000);
                    </script>
                </body></html>
            `);
        } catch (err) {
            return res.status(500).send("Error generating QR Code image.");
        }
    }

    return res.send(`
        <html><body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1>⏳ Initializing WhatsApp Client...</h1>
            <p>Please wait a moment and refresh this page.</p>
            <script>
                setInterval(() => window.location.reload(), 2000);
            </script>
        </body></html>
    `);
});

// Start Express server
app.listen(port as number, '0.0.0.0', () => {
    console.log(`[App] Web server listening on port ${port}`);
});

async function bootstrap() {
    console.log('[App] Starting WhatsApp Discovery Agent...');

    // Initialize the whatsapp-web.js client
    await whatsapp.initialize();

    // Start background services
    abandonedCartService.startCron();

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

            // Check for image attachments
            let base64Image: string | undefined;
            if (message.hasMedia) {
                const media = await message.downloadMedia();
                if (media && media.mimetype.startsWith('image/')) {
                    base64Image = `data:${media.mimetype};base64,${media.data}`;
                    console.log(`[Image Received] Included an image: ${media.mimetype}`);
                }
            }

            // 1. Get or create conversation context in Supabase
            const conversation = await getOrCreateConversation(customerPhone, customerName);

            // 2. Process message through the agent
            const agentResponse = await processMessage(
                conversation,
                text,
                customerPhone,
                base64Image
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
