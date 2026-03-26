import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
const pdfParse = require('pdf-parse');
import { whatsapp } from './lib/whatsapp';
import { getOrCreateConversation, saveChatMessage, fetchPendingOutbound, claimOutbound, markOutboundSent, markOutboundFailed, updateConversation } from './lib/supabase';
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

// Health/debug endpoint for diagnosing connection issues
app.get('/health', (req, res) => {
    const health = whatsapp.getHealthStatus();
    res.json({
        status: health.isReady ? 'ok' : 'degraded',
        whatsapp: health,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
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
    startOutboundPoller();

    // Listen for incoming messages (uses onMessage so handler survives reconnects)
    whatsapp.onMessage(async (message) => {
        // Ignore group messages or status broadcasts for now
        if (message.from.endsWith('@g.us') || message.from === 'status@broadcast') {
            return;
        }

        try {
            const customerPhone = message.from;
            let text = message.body;

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
                if (media) {
                    if (media.mimetype.startsWith('image/')) {
                        base64Image = `data:${media.mimetype};base64,${media.data}`;
                        console.log(`[Image Received] Included an image: ${media.mimetype}`);
                    } else if (media.mimetype.includes('pdf')) {
                        try {
                            const buffer = Buffer.from(media.data, 'base64');
                            const pdfData = await pdfParse(buffer);
                            if (pdfData.text && pdfData.text.trim().length > 0) {
                                text = text + `\n\n[USER UPLOADED A PDF DOCUMENT. EXTRACTED TEXT:]\n${pdfData.text}\n[END OF PDF DOCUMENT]`;
                                console.log(`[PDF Received] Extracted ${pdfData.text.length} characters of text.`);
                            } else {
                                text = text + `\n\n[SYSTEM COMMAND TO AI: The user uploaded a PDF, but no text could be extracted. It might be a scanned image. Tell the user this.]`;
                            }
                        } catch (err: any) {
                            text = text + `\n\n[SYSTEM COMMAND TO AI: The user uploaded a PDF, but the system threw an error while parsing it: ${err.message}. Tell the user this.]`;
                            console.error('[PDF Parse Error]', err);
                        }
                    } else {
                        text = text + `\n\n[SYSTEM COMMAND TO AI: The user uploaded an unsupported media file with mimetype: ${media.mimetype}. Tell the user this.]`;
                        console.log(`[Media Received] Unsupported media type: ${media.mimetype}`);
                    }
                }
            }

            // 1. Get or create conversation context in Supabase
            const conversation = await getOrCreateConversation(customerPhone, customerName);

            // 2. If conversation was already escalated or pending_quote, let the customer know
            //    their request is with the team — don't restart the AI flow
            const lowerText = text.toLowerCase().trim();
            const wantsNew = lowerText.includes('new question') || 
                             lowerText.includes('fresh conversation') || 
                             lowerText.includes('start over') ||
                             lowerText.includes('new chat') ||
                             lowerText.includes('restart');

            if (wantsNew && (conversation.status === 'escalated' || conversation.status === 'pending_quote')) {
                // Mark this conversation as completely closed/resolved so human agents know it's done
                await updateConversation(conversation.id, { status: 'completed' });
                await saveChatMessage(conversation.id, 'user', text);
                await whatsapp.sendText(
                    customerPhone,
                    `No problem! I've cleared the previous chat. What can I help you with today? 🤖`
                );
                return;
            }

            if (conversation.status === 'escalated' || conversation.status === 'pending_quote') {
                const statusLabel = conversation.status === 'pending_quote' ? 'quote request' : 'enquiry';
                await whatsapp.sendText(
                    customerPhone,
                    `Hi there! Your ${statusLabel} has already been passed to the Audico team and they'll be in touch with you shortly. If you have a new or different question, just let me know and I'll start a fresh conversation for you! 😊`
                );
                // Save the customer's follow-up message for the team to see
                await saveChatMessage(conversation.id, 'user', text);
                return;
            }

            // 3. Process message through the agent
            const agentResponse = await processMessage(
                conversation,
                text,
                customerPhone,
                base64Image
            );

            // 4. Send response back to WhatsApp
            await sendAgentResponse(customerPhone, agentResponse);

        } catch (error) {
            console.error('[App] Error handling incoming message:', error);
            message.reply("Sorry, I'm having a technical moment! 😅 Let me clear my circuits, please try again in a minute.");
        }
    });
}

/**
 * Poll the outbound queue every 3 seconds and send any pending messages.
 * Messages are queued from the Jarvis dashboard when Kenny replies manually.
 */
async function startOutboundPoller() {
    console.log('[Outbound] Queue poller started (every 3s)');
    setInterval(async () => {
        if (!whatsapp.isConnected) return;

        try {
            const pending = await fetchPendingOutbound();
            for (const msg of pending) {
                const claimed = await claimOutbound(msg.id);
                if (!claimed) continue;

                let sent = false;
                const isDocument = msg.message_type === 'document' && msg.document_url;

                if (isDocument) {
                    console.log(`[Outbound] Sending document to ${msg.phone_number}: ${msg.document_filename || msg.document_url}`);
                    sent = await whatsapp.sendDocument(
                        msg.phone_number,
                        msg.document_url!,
                        msg.document_filename || undefined,
                        msg.caption || undefined,
                    );
                } else {
                    console.log(`[Outbound] Sending to ${msg.phone_number}: ${(msg.message || '').substring(0, 60)}...`);
                    sent = await whatsapp.sendText(msg.phone_number, msg.message);
                }

                if (sent) {
                    await markOutboundSent(msg.id);
                    if (msg.conversation_id) {
                        const content = isDocument
                            ? `📄 Document sent: ${msg.document_filename || 'file'}\n${msg.caption || ''}`
                            : msg.message;
                        await saveChatMessage(msg.conversation_id, 'assistant', content, {
                            source: 'dashboard',
                            sent_by: msg.sent_by,
                            ...(isDocument ? { document_url: msg.document_url, document_filename: msg.document_filename } : {}),
                        });
                    }
                    console.log(`[Outbound] Sent successfully`);
                } else {
                    const errorMsg = isDocument ? 'sendDocument returned false' : 'sendText returned false';
                    await markOutboundFailed(msg.id, errorMsg);
                    console.error(`[Outbound] Failed to send`);
                }
            }
        } catch (err) {
            console.error('[Outbound] Poller error:', err);
        }
    }, 3000);
}

// Global unhandled rejection handler to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]', error);
});

bootstrap();
