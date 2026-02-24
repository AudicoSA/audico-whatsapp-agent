import { createClient } from '@supabase/supabase-js';
import qrcode from 'qrcode-terminal';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function watchQrCode() {
  console.log('📡 Waiting for Railway to boot and push QR code to Supabase...');
  
  let lastQr = null;
  let isConnected = false;

  // Poll every 3 seconds
  setInterval(async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select('context')
        .eq('phone_number', 'system_state')
        .single();
        
      if (error || !data) return;
      
      const state = data.context as { is_connected: boolean; qr_code: string | null };
      
      if (state.is_connected && !isConnected) {
        console.log('\n✅ BOOM! WhatsApp is officially connected on Railway!');
        isConnected = true;
        process.exit(0);
      }
      
      if (state.qr_code && state.qr_code !== lastQr && !state.is_connected) {
        console.log('\n==================================================');
        console.log('📱 ACTION REQUIRED: Scan this NEW QR Code with WhatsApp');
        console.log('==================================================\n');
        
        // Use qrcode-terminal to print it cleanly in the local powershell
        qrcode.generate(state.qr_code, { small: true });
        lastQr = state.qr_code;
      }
      
    } catch (err) {
      // Ignore network blips
    }
  }, 3000);
}

watchQrCode();
