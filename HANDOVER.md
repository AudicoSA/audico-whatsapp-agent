# WhatsApp Agent - Setup Status & Handover

**Date:** February 24, 2026
**Status:** Railway Architecture Live & Waiting for Chat Logic Tuning 

---

## What's Built & Working

✅ **Standalone Railway Deployment**
- Ditched the strict Meta Cloud API and Vercel backend.
- The agent now runs 24/7 on a private Railway cloud server.
- Uses `whatsapp-web.js` (Puppeteer) to connect to WhatsApp via QR code, bypassing the 24-hour Meta business window completely.

✅ **OpenAI `gpt-4o-mini` Native Chat Engine**
- Ripped out Anthropic Claude and ported the brain to OpenAI.
- Uses the massive 800-line master prompt from the `AUDICO-CHAT-QUOTE-X` project.
- Recursive 10-tool execution loop running natively, allowing the bot to search, recommend, and escalate autonomously.

✅ **Supabase State Persistence**
- The live QR code and connection status are flushed to a special `system_state` row in Supabase (`whatsapp_conversations`).
- Local terminal script `fetch-qr.ts` successfully pulls the live cloud QR code down to the terminal for easy scanning without battling Railway's 502 port routing errors.

---

## Configuration Details

### Environment Variables
These are configured on the local `.env` and in the **Railway Dashboard** under `Variables`.

```env
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://ajdehycoypilsegmxbto.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUz...
```

*(Note: There are NO Meta Developer Tokens or Vercel Webhook secrets needed anymore).*

---

## How to Connect the Bot (If Railway Restarts)

Railway instances are ephemeral by default. If the Railway server redeploys or restarts, you will lose the `.whatsapp_auth` folder and **the bot will disconnect from WhatsApp**.

To reconnect the bot:
1. Open a local terminal in this repository.
2. Run `npx tsx fetch-qr.ts`
3. Wait ~30 seconds for Railway to boot Puppeteer and push the new QR code to Supabase.
4. The QR code will print in the terminal.
5. Scan it on your phone under **Linked Devices**.
6. The terminal will print `✅ BOOM! WhatsApp is officially connected on Railway!`. You can close your terminal and walk away.

*(To make the session permanent across Railway restarts, add a persistent "Volume" in the Railway Dashboard and map it to `/app/.whatsapp_auth`)*.

---

## Next Steps: Refining Chat Logic

The connection layer is flawless. **The immediate next step is tuning the AI Chat Logic.**

When starting the next session, instruct the AI to:
1. Examine `lib/agent.ts` and the `SYSTEM_PROMPT` contained within.
2. Review the 10 tools ported from `AUDICO-CHAT-QUOTE-X` (currently located in `agent.ts`).
3. Focus entirely on prompt engineering: making the bot friendlier, more accurate with South African Rands, and better at enforcing the "provide final quotes" pipeline.
4. Tweak the logic inside `executeToolCall()` (at the bottom of `agent.ts`) if any Supabase return mappings need adjustments to feed back into the OpenAI context cleanly.

---

## Files & Code Structure

```
whatsapp-agent/
├── server.ts                     # Main entry point (Express & WhatsApp Client Init)
├── fetch-qr.ts                   # Local helper to pull Railway's live QR code
├── lib/
│   ├── agent.ts                  # OpenAI agent with 10 complex AV tools
│   ├── whatsapp.ts               # whatsapp-web.js logic (Puppeteer configs)
│   ├── supabase.ts               # Product search & DB operations
│   └── types.ts                  # TypeScript types
├── supabase/
│   └── migrations/
│       └── 001_whatsapp_tables.sql  # DB schema
├── Dockerfile                    # Custom Puppeteer/Chrome Linux runtime for Railway
├── .env                          # Local env vars (not in git)
└── package.json                  # Dependencies
```

---

## Key Contacts & Resources

- **Railway Dashboard:** Your deployed cloud server holding the agent.
- **Supabase Dashboard:** `whatsapp_conversations` table holds the `system_state`.
- **GitHub Repo:** `AudicoSA/audico-whatsapp-agent`

---

**Last updated:** 2026-02-24 by Antigravity
