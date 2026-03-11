import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { updateWhatsappState } from './supabase';

export class WhatsAppClient {
  public client: Client;
  private isReady: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;

  public latestQrCode: string | null = null;
  public isConnected: boolean = false;
  public lastStateChange: string = 'init';
  public lastStateTime: Date = new Date();

  private createClient(): Client {
    return new Client({
      authStrategy: new LocalAuth({
        dataPath: './.whatsapp_auth',
      }),
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      },
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      }
    });
  }

  constructor() {
    console.log('[WhatsApp] Initializing Web Client...');
    this.client = this.createClient();
    this.setupListeners();
  }

  private updateState(state: string, ready: boolean, connected: boolean) {
    this.lastStateChange = state;
    this.lastStateTime = new Date();
    this.isReady = ready;
    this.isConnected = connected;
    console.log(`[WhatsApp] State → ${state} (ready=${ready}, connected=${connected})`);
  }

  private setupListeners() {
    this.client.on('qr', async (qr) => {
      console.log('\n==================================================');
      console.log('📱 ACTION REQUIRED: Scan this QR Code with WhatsApp');
      console.log('==================================================\n');
      qrcode.generate(qr, { small: true });
      this.latestQrCode = qr;
      this.updateState('qr_received', false, false);

      await updateWhatsappState({ is_connected: false, qr_code: qr });
    });

    this.client.on('ready', async () => {
      console.log('[WhatsApp] ✔️ Client is ready and connected!');
      this.updateState('ready', true, true);
      this.latestQrCode = null;
      this.reconnectAttempts = 0; // Reset on successful connection

      await updateWhatsappState({ is_connected: true, qr_code: null });
    });

    this.client.on('authenticated', () => {
      console.log('[WhatsApp] ✔️ Authenticated successfully.');
      this.updateState('authenticated', this.isReady, this.isConnected);
    });

    this.client.on('auth_failure', async (msg) => {
      console.error('[WhatsApp] ❌ Authentication failed:', msg);
      this.updateState('auth_failure', false, false);
    });

    // Track WA Web internal state changes for better debugging
    this.client.on('change_state', (state) => {
      console.log(`[WhatsApp] WA Web state changed to: ${state}`);
      // CONNECTED state means WA Web is live — trust it even if ready hasn't fired
      if (state === 'CONNECTED') {
        this.updateState('wa_connected', true, true);
      }
    });

    this.client.on('disconnected', async (reason) => {
      console.log(`[WhatsApp] ⚠️ Client was disconnected: ${reason}`);
      this.updateState('disconnected', false, false);

      await updateWhatsappState({ is_connected: false, qr_code: null });

      // Auto-reconnect with exponential backoff
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 120000); // 5s → 120s max
        this.reconnectAttempts++;
        console.log(`[WhatsApp] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        setTimeout(async () => {
          try {
            console.log('[WhatsApp] Attempting reconnection...');
            this.client.destroy().catch(() => {}); // Clean up old client
            this.client = this.createClient();
            this.setupListeners();
            await this.client.initialize();
          } catch (err) {
            console.error('[WhatsApp] Reconnection failed:', err);
          }
        }, delay);
      } else {
        console.error('[WhatsApp] Max reconnect attempts reached. Manual intervention needed.');
      }
    });
  }

  /**
   * Initialize and start the client
   */
  public async initialize(): Promise<void> {
    await this.client.initialize();
  }

  /**
   * Get current health status for debugging
   */
  public getHealthStatus() {
    return {
      isReady: this.isReady,
      isConnected: this.isConnected,
      lastState: this.lastStateChange,
      lastStateTime: this.lastStateTime.toISOString(),
      hasQrCode: !!this.latestQrCode,
      reconnectAttempts: this.reconnectAttempts,
    };
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
      // e.g., "27618748005@c.us", but recent Meta changes also pass "@lid" for linked IDs.
      const formattedTo = to.includes('@c.us') || to.includes('@lid') || to.includes('@g.us')
        ? to
        : `${to.replace(/[^0-9]/g, '')}@c.us`;

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
