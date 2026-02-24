# Audico WhatsApp Agent

AI-powered WhatsApp sales assistant for Audico Online. Helps customers find products, build quotes, and get recommendations autonomously using OpenAI's `gpt-4o-mini` and `whatsapp-web.js`.

## Features

- **OpenAI Native Brain** - Uses the proven `AUDICO-CHAT-QUOTE-X` master prompt and 10 recursive tools.
- **Product Search** - Searches Audico's 10,000+ product catalog using Supabase hybrid search.
- **Quote Builder** - Asks clarifying questions and automatically pushes formal leads into the CRM.
- **Independent WhatsApp Web** - Runs independently using Puppeteer, completely bypassing Meta's strict 24-hour business rules.
- **Human Escalation** - Seamlessly pauses chat logic when requested so Kenny can take over.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   WhatsApp      │─────▶│   Railway.app   │─────▶│   OpenAI        │
│   (Customer)    │◀─────│   server.ts     │◀─────│   gpt-4o-mini   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                │
                                ▼
                         ┌─────────────────┐
                         │   Supabase      │
                         │   (Products &   │
                         │   Conversations)│
                         └─────────────────┘
```

## Setup & Deployment

### 1. Prerequisites
- Node.js 18+ (for local development)
- Supabase project (same as main Audico system)
- OpenAI API key
- A smartphone with the target WhatsApp number installed

### 2. Environment Variables

Create a `.env` file locally, and also copy these into your **Railway Dashboard > Variables**:

```bash
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://ajdehycoypilsegmxbto.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
```

### 3. Deploy to Railway

This bot is designed to run 24/7 on [Railway.app](https://railway.app):
1. Connect this GitHub repository to a new Railway project.
2. Railway will automatically build the `Dockerfile` provided in the repo (which includes the necessary Chromium libraries for Puppeteer).
3. The server starts via `npx tsx server.ts`.

### 4. Authenticate the Bot (QR Code)

Since this uses `whatsapp-web.js`, the cloud server must link to your WhatsApp account just like WhatsApp Web.

1. Once Railway says the deployment is live, open a terminal locally.
2. Run `npx tsx fetch-qr.ts`.
3. Wait ~30 seconds. When Railway boots up, it renders the QR code and pushes it to Supabase.
4. `fetch-qr.ts` will print the QR code cleanly in your terminal.
5. Open WhatsApp on your phone > **Settings** > **Linked Devices** > **Link a Device**.
6. Scan the terminal. The bot is now permanently connected in the cloud!

*(Note: To keep the session alive across server restarts, add a persistent Volume to the Railway container mapped to `/app/.whatsapp_auth`)*.

---

## File Structure

```
whatsapp-agent/
├── server.ts                     # Main Express server and WhatsApp Client Init
├── fetch-qr.ts                   # Local helper to pull Railway's live QR code
├── lib/
│   ├── agent.ts                  # OpenAI agent with 10 complex AV tools
│   ├── whatsapp.ts               # whatsapp-web.js Puppeteer wrapper
│   ├── supabase.ts               # Product search & DB operations
│   └── types.ts                  # TypeScript types
├── supabase/
│   └── migrations/
│       └── 001_whatsapp_tables.sql  # DB schema
├── Dockerfile                    # Chrome Linux runtime for Railway
├── .env                          # Local env vars (not in git)
└── package.json                  # Dependencies
```

## Troubleshooting

- **QR Code isn't generating?** Ensure the Railway server isn't OOM (Out of Memory). Puppeteer requires at least 512MB RAM.
- **Messages aren't sending silently?** Ensure `webVersionCache` in `whatsapp.ts` is strictly pinned to `2.2412.54`. Do not upgrade this blindly, as Meta frequently breaks headless clients.
- **AI isn't formatting products correctly?** Check the 800-line `SYSTEM_PROMPT` in `agent.ts`.

## Cost Estimates

- **WhatsApp API:** $0 (Bypassed entirely).
- **OpenAI gpt-4o-mini:** fractions of a cent per conversation. Highly cost-effective.
- **Railway Hosting:** ~$5/mo depending on RAM usage.

## Future Enhancements
- [ ] Implement persistent Volumes on Railway to avoid re-scanning QR codes.
- [ ] Add more granular `tool_calls` for tracking OpenCart order statuses.
