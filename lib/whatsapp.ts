/**
 * WhatsApp Cloud API Client
 * Handles sending messages via Meta's WhatsApp Business API
 */

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

interface TextMessage {
  to: string;
  text: string;
  replyTo?: string;
}

interface ButtonMessage {
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: string;
  footer?: string;
  replyTo?: string;
}

interface ListMessage {
  to: string;
  body: string;
  buttonText: string;
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
  header?: string;
  footer?: string;
}

interface ProductCardMessage {
  to: string;
  products: Array<{
    name: string;
    price: number;
    sku: string;
    image?: string;
    id: string;
  }>;
  header?: string;
}

export class WhatsAppClient {
  private phoneNumberId: string;
  private accessToken: string;

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;

    if (!this.phoneNumberId || !this.accessToken) {
      console.error('[WhatsApp] Missing credentials');
    }
  }

  private async sendRequest(payload: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch(
        `${WHATSAPP_API_URL}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            ...payload,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        console.error('[WhatsApp] Send error:', error);
        return false;
      }

      const result = await response.json();
      console.log('[WhatsApp] Message sent:', result.messages?.[0]?.id);
      return true;
    } catch (error) {
      console.error('[WhatsApp] Request failed:', error);
      return false;
    }
  }

  /**
   * Send a simple text message
   */
  async sendText({ to, text, replyTo }: TextMessage): Promise<boolean> {
    const payload: Record<string, unknown> = {
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    };

    if (replyTo) {
      payload.context = { message_id: replyTo };
    }

    return this.sendRequest(payload);
  }

  /**
   * Send interactive button message (max 3 buttons)
   */
  async sendButtons({ to, body, buttons, header, footer, replyTo }: ButtonMessage): Promise<boolean> {
    const interactive: Record<string, unknown> = {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((btn) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title.slice(0, 20) },
        })),
      },
    };

    if (header) {
      interactive.header = { type: 'text', text: header };
    }
    if (footer) {
      interactive.footer = { text: footer };
    }

    const payload: Record<string, unknown> = {
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive,
    };

    if (replyTo) {
      payload.context = { message_id: replyTo };
    }

    return this.sendRequest(payload);
  }

  /**
   * Send interactive list message (for product catalogs)
   */
  async sendList({ to, body, buttonText, sections, header, footer }: ListMessage): Promise<boolean> {
    const interactive: Record<string, unknown> = {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText.slice(0, 20),
        sections: sections.map((section) => ({
          title: section.title.slice(0, 24),
          rows: section.rows.slice(0, 10).map((row) => ({
            id: row.id,
            title: row.title.slice(0, 24),
            description: row.description?.slice(0, 72),
          })),
        })),
      },
    };

    if (header) {
      interactive.header = { type: 'text', text: header };
    }
    if (footer) {
      interactive.footer = { text: footer };
    }

    return this.sendRequest({
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive,
    });
  }

  /**
   * Send product showcase (as formatted text with image links)
   */
  async sendProductCards({ to, products, header }: ProductCardMessage): Promise<boolean> {
    // WhatsApp doesn't have native product cards, so we format nicely
    let text = header ? `*${header}*\n\n` : '';
    
    products.forEach((product, index) => {
      text += `${index + 1}. *${product.name}*\n`;
      text += `   💰 R${product.price.toLocaleString()}\n`;
      text += `   📦 SKU: ${product.sku}\n`;
      if (product.image) {
        text += `   🖼️ ${product.image}\n`;
      }
      text += '\n';
    });

    text += '_Reply with the number to add to your quote_';

    // Also send buttons for quick selection (first 3 products)
    if (products.length > 0) {
      const buttons = products.slice(0, 3).map((p, i) => ({
        id: `add_${p.id}`,
        title: `Add ${i + 1}`,
      }));

      await this.sendText({ to, text });
      return this.sendButtons({
        to,
        body: 'Quick add to quote:',
        buttons,
        footer: 'Tap to add product',
      });
    }

    return this.sendText({ to, text });
  }

  /**
   * Send quote summary
   */
  async sendQuoteSummary(
    to: string,
    items: Array<{ name: string; quantity: number; unit_price: number }>,
    quoteId?: string
  ): Promise<boolean> {
    let text = '🛒 *Your Quote Summary*\n\n';
    let total = 0;

    items.forEach((item, index) => {
      const lineTotal = item.quantity * item.unit_price;
      total += lineTotal;
      text += `${index + 1}. ${item.name}\n`;
      text += `   ${item.quantity}x @ R${item.unit_price.toLocaleString()} = R${lineTotal.toLocaleString()}\n\n`;
    });

    text += `━━━━━━━━━━━━━━━━━\n`;
    text += `*Total: R${total.toLocaleString()}*\n`;
    text += `_(excl. VAT & delivery)_\n\n`;

    if (quoteId) {
      text += `📋 Quote Ref: ${quoteId}\n\n`;
    }

    text += `Reply "checkout" to proceed or "clear" to start over`;

    return this.sendText({ to, text });
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<boolean> {
    return this.sendRequest({
      status: 'read',
      message_id: messageId,
    });
  }

  /**
   * Send typing indicator (reaction)
   */
  async sendTyping(to: string): Promise<void> {
    // WhatsApp doesn't have a typing indicator API, but we can use a reaction
    // For now, we just mark as read quickly
    console.log(`[WhatsApp] Typing indicator for ${to}`);
  }
}

// Singleton instance
export const whatsapp = new WhatsAppClient();
