import dotenv from 'dotenv';
dotenv.config();

import { orderTrackingService } from './lib/tracking';

async function test() {
    console.log('Testing OpenCart Connection with Tracking Service...');
    try {
        const result = await orderTrackingService.trackOrderFormatted('900304');
        console.log('RESULT:');
        console.log(result);
    } catch (error: any) {
        console.log('UNCAUGHT ERROR:');
        console.log(error);
    }
}

test();
