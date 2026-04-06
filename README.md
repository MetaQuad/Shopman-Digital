# Cach Tracker — Setup Guide

## What you're building
A WhatsApp bot that lets Kenyan shopkeepers record daily sales by chatting in Swahili.
Shopkeeper messages the bot → records item, amount, payment channel → gets daily summaries.

---

## STEP 1: Meta Developer Account (do this first)

### 1A. Create accounts
1. Go to https://developers.facebook.com
2. Click "Get Started" → log in with your Facebook account
3. Follow prompts to register as a developer
4. You'll need a Meta Business Portfolio — create one if prompted

### 1B. Create a WhatsApp app
1. In the developer dashboard, click "Create App"
2. Choose "Business" as the app type
3. Give it a name like "Cach Tracker"
4. Click "Add use case" → select "Connect with customers through WhatsApp"
5. Follow prompts to connect a WhatsApp Business Account

### 1C. Get your credentials
Go to your app → WhatsApp → API Setup. You need:
- **Phone Number ID** → goes in `.env` as `WHATSAPP_PHONE_ID`
- **Access Token** → click "Generate" → goes in `.env` as `WHATSAPP_TOKEN`
  (For testing, the temporary token works. For production, create a permanent System User token.)

### 1D. Add test numbers
In API Setup, add your own phone number as a "recipient" so you can test.

---

## STEP 2: Supabase Database

### 2A. Create a project
1. Go to https://supabase.com and create a free account
2. Click "New Project" → name it "cach-tracker" → pick a strong password → choose a region close to Kenya (e.g. "East EU" or "Central EU")
3. Wait for it to spin up (about 30 seconds)

### 2B. Run the schema
1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click "New Query"
3. Paste the entire contents of `schema.sql` from this project
4. Click "Run" — you should see "Success" for each statement

### 2C. Get your credentials
Go to **Settings → API** in Supabase. You need:
- **Project URL** → goes in `.env` as `SUPABASE_URL`
- **anon public key** → goes in `.env` as `SUPABASE_KEY`

---

## STEP 3: Deploy the Server

### Option A: Railway (recommended — simplest)

1. Go to https://railway.app and sign in with GitHub
2. Click "New Project" → "Deploy from GitHub Repo"
3. Push this cach-tracker folder to a GitHub repo first, then connect it
4. In Railway, go to your project → **Variables** tab → add all 5 environment variables:
   ```
   WHATSAPP_TOKEN=your_token
   WHATSAPP_PHONE_ID=your_phone_id
   WEBHOOK_VERIFY_TOKEN=cach-tracker-secret-2024
   SUPABASE_URL=https://yourproject.supabase.co
   SUPABASE_KEY=your_key
   ```
5. Railway auto-deploys. Note your live URL (something like `cach-tracker-production.up.railway.app`)

### Option B: Render (also free)

1. Go to https://render.com → New → Web Service → connect your GitHub repo
2. Set the build command to `npm install` and start command to `npm start`
3. Add the same 5 environment variables
4. Note your live URL

---

## STEP 4: Connect the Webhook

1. Go back to the Meta Developer Dashboard → your app → WhatsApp → Configuration
2. Under "Webhook", click "Edit"
3. **Callback URL**: `https://your-railway-url.com/webhook`
4. **Verify Token**: `cach-tracker-secret-2024` (must match your `.env`)
5. Click "Verify and Save"
6. Under "Webhook Fields", subscribe to: **messages**

---

## STEP 5: Test It

1. Open WhatsApp on your phone
2. Send "Hi" to the test phone number shown in your Meta dashboard
3. You should get the welcome message with 3 buttons
4. Try recording a sale, checking the summary, etc.

---

## Quick Reference — Chat Commands

| What shopkeeper types     | What happens                    |
|---------------------------|---------------------------------|
| hi / habari / menu        | Shows welcome + main menu       |
| rekodi / record           | Starts sale recording flow      |
| muhtasari / summary       | Shows today's totals            |
| info / msaada             | Explains how Cach works         |
| cancel / acha             | Cancels current action          |
| Mayai, 10 tray, 2400, mpesa | Quick-records a sale in one go |

---

## File Structure

```
cach-tracker/
├── server.js       ← Express server + webhook endpoints
├── bot.js          ← Swahili conversation logic
├── whatsapp.js     ← WhatsApp API message sender
├── db.js           ← Supabase database queries
├── schema.sql      ← Database tables (run once in Supabase)
├── package.json    ← Dependencies
├── .env.example    ← Environment variables template
└── README.md       ← This file
```

---

## Cost Summary

| Component          | Cost at launch       |
|--------------------|---------------------|
| WhatsApp messages  | FREE (service window) |
| Supabase database  | FREE (up to 500MB)  |
| Railway hosting    | FREE tier available  |
| Domain name        | Optional (~$12/year) |
| **Total**          | **$0/month to start** |

---

## Next Steps After Launch

- [ ] Switch from test phone number to a dedicated business number
- [ ] Create a permanent System User token (the temp one expires in 24h)
- [ ] Set up daily summary notifications (template message, small cost)
- [ ] Add weekly/monthly reports
- [ ] Connect credit-readiness scoring on top of the sales data
