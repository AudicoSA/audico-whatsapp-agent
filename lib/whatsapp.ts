import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { updateWhatsappState } from './supabase';

export class WhatsAppClient {
  public client: Client;
  private isReady: boolean = false;

  public latestQrCode: string | null = null;
  public isConnected: boolean = false;

  constructor() {
    console.log('[WhatsApp] Initializing Web Client...');

    // Use LocalAuth to save session data so we don't have to scan the QR code every time
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './.whatsapp_auth',
      }),
      // Fix for recent WhatsApp Web updates breaking sendMessage silently
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      },
      // Puppeteer arguments to ensure it runs well on Railway/Linux
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      }
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.client.on('qr', async (qr) => {
      console.log('\n==================================================');
      console.log('📱 ACTION REQUIRED: Scan this QR Code with WhatsApp');
      console.log('==================================================\n');
      qrcode.generate(qr, { small: true });
      this.latestQrCode = qr;

      // Push QR code to Supabase so we can read it elsewhere (e.g. locally or dashboard)
      await updateWhatsappState({ is_connected: false, qr_code: qr });
    });

    this.client.on('ready', async () => {
      console.log('[WhatsApp] ✔️ Client is ready and connected!');
      this.isReady = true;
      this.isConnected = true;
      this.latestQrCode = null;

      await updateWhatsappState({ is_connected: true, qr_code: null });
    });

    this.client.on('authenticated', () => {
      console.log('[WhatsApp] ✔️ Authenticated successfully.');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('[WhatsApp] ❌ Authentication failed:', msg);
    });

    this.client.on('disconnected', async (reason) => {
      console.log('[WhatsApp] ⚠️ Client was disconnected:', reason);
      this.isReady = false;
      this.isConnected = false;

      await updateWhatsappState({ is_connected: false, qr_code: null });
    });
  }

  /**
   * Initialize and start the client
   */
  public async initialize(): Promise<void> {
    await this.client.initialize();
  }

  /**
   * Send a simple text message
   */
  public async sendText(to: string, text: string): Promise<boolean> {
    if (!this.isReady) {
      console.error('[WhatsApp] Cannot send message - client is not ready');
      return false;
    }

    try {
      // whatsapp-web.js expects the phone number format to be "countrycode+number@c.us"
      // e.g., "27618748005@c.us"
      const formattedTo = to.includes('@c.us') ? to : `${to.replace(/[^0-9]/g, '')}@c.us`;

      const response = await this.client.sendMessage(formattedTo, text);
      return !!response.id;
    } catch (error) {
      console.error('[WhatsApp] Failed to send message:', error);
      return false;
    }
  }

  /**
   * Generate product list (simulate interactive product cards for text-only whatsapp-web)
   */
  public async sendProductOptions(to: string, products: any[], header?: string): Promise<boolean> {
    let text = header ? `*${header}*\n\n` : '';

    products.forEach((product, index) => {
      text += `${index + 1}. *${product.name}*\n`;
      text += `   💰 R${product.price.toLocaleString()}\n`;
      if (product.brand) text += `   🏢 Brand: ${product.brand}\n`;
      text += '\n';
    });

    text += '_Tell me the number to add it to your quote request!_';
    return this.sendText(to, text);
  }
}

// Singleton instance
export const whatsapp = new WhatsAppClient();
