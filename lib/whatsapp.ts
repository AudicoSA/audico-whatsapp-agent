import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { updateWhatsappState } from './supabase';
import fs from 'fs';
import path from 'path';

export class WhatsAppClient {
  public client: Client;
  private isReady: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private messageHandler: ((message: any) => void) | null = null;

  public latestQrCode: string | null = null;
  public isConnected: boolean = false;
  public lastStateChange: string = 'init';
  public lastStateTime: Date = new Date();

  private createClient(): Client {
    return new Client({
      authStrategy: new LocalAuth({
        dataPath: './.whatsapp_auth',
      }),
      // No webVersionCache — the old pinned version (2.2412.54) was removed from GitHub.
      // Let whatsapp-web.js fetch the latest WA Web version directly from WhatsApp servers.
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

  /**
   * Register a message handler that survives client reconnections.
   * Call this once from server.ts instead of whatsapp.client.on('message', ...).
   */
  public onMessage(handler: (message: any) => void) {
    this.messageHandler = handler;
    this.client.on('message', handler);
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
      this.reconnectAttempts = 0;

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

    this.client.on('change_state', (state) => {
      console.log(`[WhatsApp] WA Web state changed to: ${state}`);
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
        const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 120000);
        this.reconnectAttempts++;
        console.log(`[WhatsApp] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        setTimeout(async () => {
          try {
            console.log('[WhatsApp] Attempting reconnection...');
            this.client.destroy().catch(() => {});
            this.client = this.createClient();
            this.setupListeners();
            // Re-attach the message handler to the new client
            if (this.messageHandler) {
              this.client.on('message', this.messageHandler);
            }
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

  public async initialize(): Promise<void> {
    // Clear stale Chrome profile locks left by previous containers (persistent volume issue)
    this.clearChromeLocks();
    await this.client.initialize();
  }

  private clearChromeLocks() {
    const authDir = './.whatsapp_auth';
    try {
      const walkAndRemoveLocks = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkAndRemoveLocks(fullPath);
          } else if (entry.name === 'SingletonLock' || entry.name === 'SingletonCookie' || entry.name === 'SingletonSocket') {
            fs.unlinkSync(fullPath);
            console.log(`[WhatsApp] Removed stale lock: ${fullPath}`);
          }
        }
      };
      walkAndRemoveLocks(authDir);
    } catch (err) {
      console.log('[WhatsApp] No lock files to clear (first boot).');
    }
  }

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

  public async sendText(to: string, text: string): Promise<boolean> {
    if (!this.isReady) {
      console.error('[WhatsApp] Cannot send message - client is not ready');
      return false;
    }

    try {
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
   * Send a document (PDF, etc.) via a public URL.
   * Used by the outbound poller to deliver quote PDFs from the dashboard.
   */
  public async sendDocument(
    to: string,
    documentUrl: string,
    filename?: string,
    caption?: string
  ): Promise<boolean> {
    if (!this.isReady) {
      console.error('[WhatsApp] Cannot send document - client is not ready');
      return false;
    }

    try {
      const formattedTo = to.includes('@c.us') || to.includes('@lid') || to.includes('@g.us')
        ? to
        : `${to.replace(/[^0-9]/g, '')}@c.us`;

      const media = await MessageMedia.fromUrl(documentUrl, { unsafeMime: true });
      if (filename) media.filename = filename;

      const response = await this.client.sendMessage(formattedTo, media, {
        caption: caption || undefined,
      });
      return !!response.id;
    } catch (error) {
      console.error('[WhatsApp] Failed to send document:', error);
      return false;
    }
  }

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
