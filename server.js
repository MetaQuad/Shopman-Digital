require('dotenv').config();
const express = require('express');
const bot = require('./bot');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// ─── Health check ───

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'Cach Tracker',
    version: '1.0.0'
  });
});

// ─── Webhook verification (Meta sends GET to verify your endpoint) ───

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }

  console.log('❌ Webhook verification failed');
  return res.sendStatus(403);
});

// ─── Incoming messages (Meta sends POST with message data) ───

app.post('/webhook', async (req, res) => {
  // Always respond 200 quickly (Meta expects fast acknowledgment)
  res.sendStatus(200);

  try {
    const body = req.body;

    // Dig into the nested structure Meta sends
    if (body.object !== 'whatsapp_business_account') return;

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value;
        if (!value || !value.messages) continue;

        const messages = value.messages;
        const contacts = value.contacts || [];

        for (const message of messages) {
          const phone = message.from; // e.g. "254712345678"
          const contactName = contacts.find(c => c.wa_id === phone)?.profile?.name || '';

          console.log(`📩 Message from ${phone} (${contactName}): ${message.type}`);

          // Handle the message
          await bot.handleMessage(phone, message, message.id);
        }
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

// ─── Start server ───

app.listen(PORT, () => {
  console.log(`\n🌱 Cach Tracker server running on port ${PORT}`);
  console.log(`   Webhook URL: https://your-domain.com/webhook`);
  console.log(`   Health check: http://localhost:${PORT}/\n`);
});
