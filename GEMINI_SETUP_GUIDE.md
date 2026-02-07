# WhatsApp Agent - Gemini Setup Guide

Instructions for deploying the Audico WhatsApp Agent to Vercel.

## Step 1: Create GitHub Repository

1. Create a new GitHub repo: `audico-whatsapp-agent`
2. Push this folder's contents to the repo

## Step 2: Set Up Meta WhatsApp Business

1. Go to [Meta for Developers](https://developers.facebook.com)
2. Create an app (Business type)
3. Add WhatsApp product
4. In WhatsApp > Getting Started:
   - Note your **Phone Number ID**
   - Generate a **Permanent Access Token**
5. Create a verify token (any random string, e.g., `audico_wa_verify_2026`)

## Step 3: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Import the GitHub repository
3. Add these environment variables:

```
WHATSAPP_PHONE_NUMBER_ID = [from Meta console]
WHATSAPP_ACCESS_TOKEN = [from Meta console]
WHATSAPP_VERIFY_TOKEN = audico_wa_verify_2026
WHATSAPP_BUSINESS_ACCOUNT_ID = [from Meta console]

ANTHROPIC_API_KEY = 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

SUPABASE_URL = https://ajdehycoypilsegmxbto.supabase.co
SUPABASE_SERVICE_KEY = [from existing .env]

NODE_ENV = production
```

4. Deploy!

## Step 4: Run Database Migration

1. Go to Supabase dashboard
2. Open SQL Editor
3. Run the SQL from `supabase/migrations/001_whatsapp_tables.sql`

## Step 5: Configure Webhook in Meta

1. Back in Meta for Developers
2. Go to WhatsApp > Configuration
3. Click "Edit" on Webhook
4. Webhook URL: `https://[your-vercel-url]/api/webhook`
5. Verify Token: `audico_wa_verify_2026` (same as env var)
6. Subscribe to: `messages`

## Step 6: Test

1. Send "Hi" to the WhatsApp number
2. Check Vercel logs for any errors
3. Should receive welcome message

## Environment Variables Reference

| Variable | Where to get it |
|----------|-----------------|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Console > WhatsApp > Getting Started |
| `WHATSAPP_ACCESS_TOKEN` | Meta Console > Generate permanent token |
| `WHATSAPP_VERIFY_TOKEN` | Make up any random string |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta Console > Settings > Business Account ID |
| `ANTHROPIC_API_KEY` | Same as existing Audico .env |
| `SUPABASE_URL` | Same as existing Audico .env |
| `SUPABASE_SERVICE_KEY` | Same as existing Audico .env |

## Troubleshooting

### Webhook verification fails
- Check `WHATSAPP_VERIFY_TOKEN` matches exactly
- Check Vercel logs for errors

### Messages not being received
- Check webhook subscription is active for `messages`
- Check Meta Console for webhook delivery errors

### AI not responding
- Check Anthropic API key is valid
- Check Vercel logs for Claude errors

### Products not found
- Verify Supabase connection
- Check `bm25_product_search` function exists (or use fallback)

## Files Changed

If you need to modify behavior:
- `lib/agent.ts` - AI system prompt and tools
- `lib/whatsapp.ts` - Message formatting
- `app/api/webhook/route.ts` - Message handling logic

---

Good luck! 🎧
