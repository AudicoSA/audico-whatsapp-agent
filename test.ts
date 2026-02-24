import 'dotenv/config';
import { processMessage } from './lib/agent';
import { getOrCreateConversation } from './lib/supabase';

async function runTest() {
    console.log('1. Starting test...');
    try {
        const conv = await getOrCreateConversation('27618748005', 'Test User');
        console.log('2. Got conversation:', conv.id);
        console.log('3. Sending message to Claude...');
        const result = await processMessage(conv, 'Hi do you have denon avr x3800h', '27618748005');
        console.log('4. SUCCESS! Claude replied:');
        console.log(result);
    } catch (err) {
        console.error('CRASH in test:', err);
    }
}
runTest();
