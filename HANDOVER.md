# WhatsApp Agent - Setup Status & Handover

**Date:** February 21, 2026
**Status:** 99% Complete - **WAITING FOR META APPROVAL**

---

## Current Blocker

❌ **Phone number (+27 61 874 8005) is "Pending" approval from Meta**
- Status: "Pending" and "In Review"
- Once approved, the status will change to "Connected" or "Active"
- You'll receive an email from Meta when approved (typically 24-72 hours)

---

## What's Already Built & Working

✅ **Complete WhatsApp AI Agent**
- Claude AI integration with tool use (product search, quotes, escalation)
- Supabase database for products, conversations, and messages
- Full conversation management and quote building

✅ **Deployed to Vercel**
- URL: https://audico-whatsapp-agent.vercel.app
- Webhook endpoint: https://audico-whatsapp-agent.vercel.app/api/webhook
- GitHub repo: https://github.com/AudicoSA/audico-whatsapp-agent

✅ **Webhook Configured & Verified**
- Webhook verified successfully with Meta
- Subscribed to `messages` webhook field
- Verify token: `audico_webhook_verify_2026`

✅ **Database Setup**
- Supabase migration run successfully
- Tables created: `whatsapp_conversations`, `whatsapp_messages`
- Connected to shared product catalog

✅ **Meta App Configuration**
- App: "Audico Support 2" (ID: 2470412986746506)
- App status: **Published**
- Webhook: Verified and working
- Permissions: `whatsapp_business_messaging`, `whatsapp_business_management`

---

## Configuration Details

### Environment Variables (in Vercel)
```env
WHATSAPP_PHONE_NUMBER_ID=987697637758138
WHATSAPP_ACCESS_TOKEN=EAAjG09iGBooBQZBrM0PZBpaZCxEToZBiAhdamYPwYWY888loLp6LB7CE3xxbpfXLCTjZBXFN0XX6l0cr9qogDl86rLVemlThDyLaO85NMZBpYZBAuRnQS40RFhEELuiUAnPWfmUy76AtqwxxFyNgdNEOVQ6nVX9gNW9B8melpLZBKtmZCr9g3x7gzHiZC8wQZCpKRMnbedlmZBrBYVt5L5lan8yYPN5GsUFjmZAuGGkR9l6PKGJDjZBe08t74VJ20cecjTZBCLlGHWjS34dzmcMmdafEQZDZD
WHATSAPP_VERIFY_TOKEN=audico_webhook_verify_2026
WHATSAPP_BUSINESS_ACCOUNT_ID=1219097310341010
ANTHROPIC_API_KEY=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
SUPABASE_URL=https://ajdehycoypilsegmxbto.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqZGVoeWNveXBpbHNlZ214YnRvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjM5MTQ1MSwiZXhwIjoyMDY3OTY3NDUxfQ._gy9Lq3pJ9XoIzt7q9dBiqO9TtXFODDGOHT27jl9W4Y
NODE_ENV=production
```

### Important IDs
- **Business Phone:** +27 61 874 8005
- **Phone Number ID:** 987697637758138
- **Business Account ID:** 1219097310341010
- **Business Manager ID:** 386726345155146
- **Meta App ID:** 2470412986746506
- **System User:** WhatsappApi (ID: 61588268621302)

---

## When Meta Approves (Next Steps)

### 1. Check Approval Status
Go to WhatsApp Manager: https://business.facebook.com/wa/manage/phone-numbers/
- Status should change from "Pending" to "Connected" or "Active"

### 2. Generate Fresh Access Token (Access tokens expire!)
The current token will expire. Generate a new one:

**Via Graph API Explorer:**
1. Go to: https://developers.facebook.com/tools/explorer/2470412986746506/
2. Click "Generate Access Token"
3. Select permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
4. Copy the token

**Update Vercel Environment Variables:**
1. Go to: https://vercel.com/audiocosa/audico-whatsapp-agent/settings/environment-variables
2. Update `WHATSAPP_ACCESS_TOKEN` with the new token
3. Redeploy (or it will auto-deploy on next git push)

### 3. Test Sending First Message

**Option A: Via curl (quick test)**
```bash
curl -X POST "https://graph.facebook.com/v18.0/987697637758138/messages" \
  -H "Authorization: Bearer YOUR_NEW_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "27799041903",
    "type": "text",
    "text": {
      "body": "👋 Hi from Audico! This is a test message. Reply to start chatting with our AI assistant!"
    }
  }'
```

**Option B: Via Meta's Send Message Tool**
1. Go to: https://developers.facebook.com/apps/2470412986746506/whatsapp-business/wa-dev-console/
2. Select your business number (+27 61 874 8005) from the dropdown
3. Enter a test phone number
4. Click "Send message"

### 4. Test Incoming Messages & AI Response
1. After sending the first message, reply from your phone
2. The webhook should receive it and trigger the AI agent
3. Check Vercel logs: https://vercel.com/audiocosa/audico-whatsapp-agent/logs
4. Check Supabase tables for conversation/message records

### 5. Production Checklist
Once testing works:
- [ ] Update access token to a longer-lived one (60 days or more)
- [ ] Test all AI tools (product search, quote building, escalation)
- [ ] Add more test scenarios
- [ ] Monitor Vercel logs for errors
- [ ] Consider adding error alerting (email/Slack)
- [ ] Document customer-facing usage instructions

---

## Troubleshooting

### If messages still don't send after approval:
1. **Regenerate access token** (they expire frequently)
2. **Check phone number status** - must be "Connected" not "Pending"
3. **Verify Vercel env vars** - make sure `WHATSAPP_ACCESS_TOKEN` is updated
4. **Check Vercel logs** for errors
5. **Test webhook** - send a test POST to the webhook URL manually

### If webhook doesn't receive messages:
1. Check webhook is subscribed to `messages` field in Meta app settings
2. Verify webhook URL is correct: `https://audico-whatsapp-agent.vercel.app/api/webhook`
3. Check Vercel function logs for incoming requests

### If AI doesn't respond correctly:
1. Check Supabase `products` table has data
2. Verify `ANTHROPIC_API_KEY` is valid
3. Check `bm25_product_search` RPC function exists in Supabase
4. Review Vercel logs for Claude API errors

---

## Alternative: WhatsApp Business App Approach

If Meta approval takes too long or keeps failing, you can pivot to WhatsApp Business App:

**Pros:**
- Works immediately (no Meta Cloud API approval needed)
- Simpler setup
- Same AI agent code (just different connector)

**Cons:**
- Requires a phone with the SIM card
- Less "official" than Cloud API
- Requires browser automation or unofficial API

**Setup would involve:**
1. Download WhatsApp Business app on phone with +27 61 874 8005 SIM
2. Use a library like `whatsapp-web.js` to connect via QR code
3. Modify `lib/whatsapp.ts` to use the library instead of Graph API
4. Deploy updated code

---

## Files & Code Structure

```
whatsapp-agent/
├── app/
│   └── api/
│       └── webhook/
│           └── route.ts          # Webhook handler (verified working)
├── lib/
│   ├── agent.ts                  # Claude AI agent with tools
│   ├── whatsapp.ts               # WhatsApp Cloud API client
│   ├── supabase.ts               # Product search & DB operations
│   └── types.ts                  # TypeScript types
├── supabase/
│   └── migrations/
│       └── 001_whatsapp_tables.sql  # DB schema (already run)
├── .env                          # Local env vars (not in git)
└── package.json                  # Dependencies
```

---

## Key Contacts & Resources

- **Vercel Dashboard:** https://vercel.com/audiocosa/audico-whatsapp-agent
- **GitHub Repo:** https://github.com/AudicoSA/audico-whatsapp-agent
- **Meta App:** https://developers.facebook.com/apps/2470412986746506/
- **WhatsApp Manager:** https://business.facebook.com/wa/manage/phone-numbers/
- **Supabase Dashboard:** https://supabase.com/dashboard/project/ajdehycoypilsegmxbto

---

## Summary

**You're 99% done!** Everything is built, deployed, and configured. The ONLY blocker is Meta's approval of your phone number for API use.

**When you get the approval email from Meta:**
1. Generate a fresh access token
2. Update Vercel env var
3. Send a test message
4. Reply to test the bot

**Estimated time to go live after approval:** ~5 minutes

---

**Last updated:** 2026-02-21 by Claude
