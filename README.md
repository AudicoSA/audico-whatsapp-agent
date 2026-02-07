# Audico WhatsApp Agent 🎧

AI-powered WhatsApp sales assistant for Audico Online. Helps customers find products, build quotes, and get recommendations.

## Features

- 🤖 **AI-Powered Conversations** - Uses Claude Sonnet for natural language understanding
- 🔍 **Product Search** - Searches Audico's 10,000+ product catalog
- 💰 **Quote Builder** - Helps customers build quotes with accurate pricing
- 📱 **WhatsApp Native** - Interactive buttons, lists, and rich messages
- 🔄 **Conversation Memory** - Maintains context across messages
- 👤 **Human Escalation** - Seamlessly transfers to Kenny when needed

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   WhatsApp      │─────▶│   Vercel API    │─────▶│   Claude AI     │
│   (Customer)    │◀─────│   /api/webhook  │◀─────│   (Sonnet)      │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                │
                                ▼
                         ┌─────────────────┐
                         │   Supabase      │
                         │   (Products &   │
                         │   Conversations)│
                         └─────────────────┘
```

## Setup

### 1. Prerequisites

- Node.js 18+
- Meta Business Account with WhatsApp API access
- Supabase project (same as audico-chat-quote)
- Anthropic API key

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
# WhatsApp Cloud API (Meta Business)
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_VERIFY_TOKEN=your_random_string
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Supabase (same as chat-quote)
SUPABASE_URL=https://ajdehycoypilsegmxbto.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
```

### 3. Database Setup

Run these SQL commands in Supabase to create the required tables:

```sql
-- Conversations table
CREATE TABLE whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  customer_name TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending_quote', 'completed', 'escalated')),
  context JSONB DEFAULT '{"quote_items": []}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_wa_conv_phone ON whatsapp_conversations(phone_number);
CREATE INDEX idx_wa_conv_status ON whatsapp_conversations(status);
CREATE INDEX idx_wa_msg_conv ON whatsapp_messages(conversation_id);
CREATE INDEX idx_wa_msg_created ON whatsapp_messages(created_at DESC);

-- RLS Policies (service role bypasses these)
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
```

### 4. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### 5. Configure WhatsApp Webhook

1. Go to [Meta for Developers](https://developers.facebook.com)
2. Open your WhatsApp Business App
3. Go to **WhatsApp > Configuration**
4. Set webhook URL: `https://your-vercel-url.vercel.app/api/webhook`
5. Set verify token: same as `WHATSAPP_VERIFY_TOKEN`
6. Subscribe to: `messages`

## Usage

### Customer Commands

| Command | Description |
|---------|-------------|
| `hi` / `hello` | Start conversation |
| `help` | Show help menu |
| `search [query]` | Search products |
| `add [product]` | Add to quote |
| `show quote` | View current quote |
| `clear quote` | Clear quote |
| `talk to kenny` | Escalate to human |

### Example Conversation

```
Customer: Hi!
Bot: Hi there! 👋 Welcome to Audico...

Customer: I need speakers for my restaurant
Bot: Great! For restaurant background music, I'd recommend...
[Shows ceiling speaker options]

Customer: Add the JBL CSS-15
Bot: ✅ Added JBL Control CSS-15 to your quote...

Customer: Show my quote
Bot: 🛒 Your Quote Summary...
```

## Development

```bash
# Install dependencies
npm install

# Run locally (with ngrok for webhook testing)
npm run dev
ngrok http 3000

# Update webhook URL in Meta console to ngrok URL
```

## Files

```
whatsapp-agent/
├── app/
│   ├── api/
│   │   ├── health/route.ts    # Health check
│   │   └── webhook/route.ts   # WhatsApp webhook
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── agent.ts               # AI conversation agent
│   ├── supabase.ts            # Database & product search
│   ├── types.ts               # TypeScript types
│   └── whatsapp.ts            # WhatsApp API client
├── .env.example
├── package.json
├── README.md
├── tsconfig.json
└── vercel.json
```

## Monitoring

- Health check: `GET /api/health`
- Vercel logs: `vercel logs`
- Conversation history: Query `whatsapp_conversations` in Supabase

## Escalation

When the agent escalates to Kenny:
1. Conversation status changes to `escalated`
2. Context includes escalation reason
3. (TODO) Send notification to Kenny via Signal/email

## Cost Estimates

- WhatsApp: Free for first 1,000 conversations/month, then ~$0.05/conversation
- Claude Sonnet: ~$0.003 per message (1K tokens in, 500 out)
- Vercel: Free tier should handle ~100K requests/month

## Future Enhancements

- [ ] Order tracking integration (OpenCart)
- [ ] PDF quote generation
- [ ] Voice message transcription (Whisper)
- [ ] Image recognition for product inquiries
- [ ] Automated follow-ups for abandoned quotes
- [ ] Multi-language support (Afrikaans, Zulu)

---

Built for Audico by Jason (AI COO) 🎧
