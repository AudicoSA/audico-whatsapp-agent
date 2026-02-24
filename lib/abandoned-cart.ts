import mysql from 'mysql2/promise';
import cron from 'node-cron';
import { whatsapp } from './whatsapp';
import { supabase, getOrCreateConversation } from './supabase';

class AbandonedCartService {
    private dbConfig: mysql.ConnectionOptions;
    private tablePrefix: string;
    private isRunning: boolean = false;

    constructor() {
        this.dbConfig = {
            host: process.env.OPENCART_DB_HOST,
            port: parseInt(process.env.OPENCART_DB_PORT || '3306'),
            user: process.env.OPENCART_DB_USER,
            password: process.env.OPENCART_DB_PASSWORD,
            database: process.env.OPENCART_DB_NAME,
            connectTimeout: 5000,
        };
        this.tablePrefix = process.env.OPENCART_TABLE_PREFIX || 'oc_';
    }

    private async getConnection(): Promise<mysql.Connection> {
        return await mysql.createConnection(this.dbConfig);
    }

    /**
     * Start the abandoned cart cron job
     * Runs every hour at minute 0
     */
    public startCron() {
        console.log('[AbandonedCart] Service initialized.');
        cron.schedule('0 * * * *', async () => {
            await this.processAbandonedCarts();
        });
    }

    /**
     * Look for carts older than 2 hours and newer than 24 hours
     */
    public async processAbandonedCarts() {
        if (this.isRunning) return;
        this.isRunning = true;

        let connection: mysql.Connection | null = null;
        try {
            console.log('[AbandonedCart] Checking for scheduled carts...');
            connection = await this.getConnection();

            // Query OpenCart for non-checked-out carts attached to customers with phones
            // Cart date_added is normally updated when they modify it. We want 2 hours < age < 24 hours.
            const [carts] = await connection.execute<mysql.RowDataPacket[]>(
                `SELECT 
                    c.customer_id, 
                    MAX(c.date_added) as last_active, 
                    cust.firstname, 
                    cust.telephone 
                 FROM ${this.tablePrefix}cart c
                 JOIN ${this.tablePrefix}customer cust ON c.customer_id = cust.customer_id
                 WHERE c.customer_id > 0
                 GROUP BY c.customer_id, cust.firstname, cust.telephone
                 HAVING last_active < DATE_SUB(NOW(), INTERVAL 2 HOUR)
                    AND last_active > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            console.log(`[AbandonedCart] Found ${carts.length} potential abandoned carts.`);

            for (const cart of carts) {
                let phone = cart.telephone.replace(/\D/g, '');

                // Format SA numbers if needed (very loose formatting handled by WA)
                if (phone.startsWith('0')) {
                    phone = '27' + phone.substring(1);
                }
                const formattedPhone = `${phone}@c.us`;

                // Check Supabase if we've messaged them in the last 24 hours to prevent spam
                const { data: recentMsgs, error } = await supabase
                    .from('whatsapp_messages')
                    .select('id, created_at')
                    .eq('sender_type', 'assistant')
                    .like('content', '%COMEBACK10%')
                    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
                    .limit(1);

                if (error) {
                    console.error('[AbandonedCart] Error checking Supabase history:', error);
                    continue; // skip on error
                }

                // If we haven't sent a discount code recently, send it now!
                if (!recentMsgs || recentMsgs.length === 0) {
                    await this.sendNurtureMessage(formattedPhone, cart.firstname);
                } else {
                    console.log(`[AbandonedCart] Already messaged ${cart.firstname} (${formattedPhone}) recently.`);
                }
            }
        } catch (error: any) {
            console.error('[AbandonedCart] Error processing carts:', error);
        } finally {
            if (connection) {
                try {
                    await connection.end();
                } catch (e) {
                    console.error('[AbandonedCart] Error closing DB connection:', e);
                }
            }
            this.isRunning = false;
        }
    }

    private async sendNurtureMessage(phone: string, name: string) {
        if (!whatsapp.isConnected) {
            console.log('[AbandonedCart] WhatsApp not connected, skipping.');
            return;
        }

        const messageText = `Hi ${name}! 👋 I noticed you left some great audio gear in your cart on Audico.\n\nDo you have any questions about the products, or need advice on compatibility? I'm an AI audio expert and I'd be happy to help!\n\nIf you're ready to check out, you can use the code *COMEBACK10* at checkout for a generic 10% discount on your cart. 🎶`;

        try {
            // Get conversation to sync with existing thread
            const conversation = await getOrCreateConversation(phone, name);

            console.log(`[AbandonedCart] Sending proactive message to ${phone}...`);
            await whatsapp.client.sendMessage(phone, messageText);

            // Log it in Supabase history as the assistant
            await supabase.from('whatsapp_messages').insert([{
                conversation_id: conversation.id,
                content: messageText,
                sender_type: 'assistant'
            }]);

        } catch (error) {
            console.error(`[AbandonedCart] Failed to send message to ${phone}:`, error);
        }
    }
}

export const abandonedCartService = new AbandonedCartService();
