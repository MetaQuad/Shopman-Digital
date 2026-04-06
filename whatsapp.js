const axios = require('axios');
require('dotenv').config();

const API_URL = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`;
const TOKEN = process.env.WHATSAPP_TOKEN;

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

// ─── Send a plain text message ───

async function sendText(to, body) {
  try {
    await axios.post(API_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    }, { headers });
  } catch (err) {
    console.error('sendText error:', err.response?.data || err.message);
  }
}

// ─── Send interactive buttons (max 3 buttons) ───

async function sendButtons(to, body, buttons) {
  // buttons = [{ id: 'record', title: 'Record mauzo' }, ...]
  try {
    await axios.post(API_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.map(b => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.substring(0, 20) }
          }))
        }
      }
    }, { headers });
  } catch (err) {
    console.error('sendButtons error:', err.response?.data || err.message);
  }
}

// ─── Send a list message (for channel selection etc.) ───

async function sendList(to, body, buttonText, sections) {
  // sections = [{ title: 'Options', rows: [{ id: 'mpesa', title: 'M-Pesa', description: '...' }] }]
  try {
    await axios.post(API_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: buttonText.substring(0, 20),
          sections
        }
      }
    }, { headers });
  } catch (err) {
    console.error('sendList error:', err.response?.data || err.message);
  }
}

// ─── Mark message as read (blue ticks) ───

async function markRead(messageId) {
  try {
    await axios.post(API_URL, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    }, { headers });
  } catch (err) {
    // Non-critical, don't crash
  }
}

module.exports = { sendText, sendButtons, sendList, markRead };
