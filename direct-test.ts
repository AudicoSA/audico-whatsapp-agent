import 'dotenv/config';
import { whatsapp } from './lib/whatsapp';

async function test() {
    console.log('Starting direct test...');
    await whatsapp.initialize();

    whatsapp.client.on('ready', () => {
        console.log('✅ Ready! Please send a message to the bot from your phone.');
    });

    whatsapp.client.on('message', async (m) => {
        console.log('📥 Got message:', m.body, 'from', m.from);
        try {
            console.log('📤 Attempting to send reply...');
            const r = await whatsapp.client.sendMessage(m.from, 'Echo direct from library: ' + m.body);
            console.log('✅ Send result ID:', r.id);
        } catch (e) {
            console.error('❌ Send error:', e);
        }
    });
}

test();
