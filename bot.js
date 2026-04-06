const wa = require('./whatsapp');
const db = require('./db');

// ─── Helpers ───

function fmtKES(n) {
  return 'KES ' + Math.round(n).toLocaleString();
}

const CHANNELS = ['mpesa', 'cash', 'till', 'credit'];
const CHANNEL_LABELS = { mpesa: 'M-Pesa', cash: 'Cash', till: 'Till', credit: 'Credit' };
const CHANNEL_EMOJI = { mpesa: '📱', cash: '💵', till: '🏪', credit: '📝' };

// Try to parse a quick one-liner like: "Mayai, 10 tray, 2400, mpesa"
function parseQuickSale(text) {
  // Flexible format: item, qty unit, amount, channel
  // Also supports: "Mayai 2400" (just item + amount)
  const parts = text.split(',').map(s => s.trim());

  if (parts.length >= 3) {
    // Full format: "Mayai, 10 tray, 2400, mpesa"
    const item = parts[0];
    const qtyPart = parts[1].match(/^(\d+\.?\d*)\s*(.*)$/);
    const qty = qtyPart ? parseFloat(qtyPart[1]) : 1;
    const unit = qtyPart && qtyPart[2] ? qtyPart[2] : 'pcs';
    const amount = parseFloat(parts[2]);
    const channel = parts[3] ? parts[3].toLowerCase().trim() : 'cash';

    if (item && amount > 0) {
      return {
        item,
        qty,
        unit,
        amount,
        channel: CHANNELS.includes(channel) ? channel : 'cash'
      };
    }
  }

  return null;
}

// ─── Main message handler ───

async function handleMessage(phone, message, messageId) {
  // Mark as read (blue ticks)
  await wa.markRead(messageId);

  // Get or create the shop for this phone number
  const shop = await db.getOrCreateShop(phone);
  if (!shop) {
    await wa.sendText(phone, 'Samahani, kuna tatizo la kiufundi. Jaribu tena baadaye.');
    return;
  }

  // Get current conversation state
  const chatState = await db.getChatState(phone);
  const state = chatState.state || 'menu';

  // Extract the text or button reply
  let text = '';
  let buttonId = null;

  if (message.type === 'text') {
    text = message.text.body.trim();
  } else if (message.type === 'interactive') {
    if (message.interactive.type === 'button_reply') {
      buttonId = message.interactive.button_reply.id;
      text = message.interactive.button_reply.title;
    } else if (message.interactive.type === 'list_reply') {
      buttonId = message.interactive.list_reply.id;
      text = message.interactive.list_reply.title;
    }
  }

  const lower = text.toLowerCase();

  // ─── Global commands (work from any state) ───

  if (lower === 'menu' || lower === 'start' || lower === 'hi' || lower === 'habari' || lower === 'hello') {
    await db.resetChatState(phone);
    await sendWelcome(phone);
    return;
  }

  if (lower === 'cancel' || lower === 'acha') {
    await db.resetChatState(phone);
    await wa.sendText(phone, 'Sawa, nimesimamisha. Andika *menu* kuanza upya.');
    return;
  }

  // ─── Route based on state ───

  switch (state) {
    case 'menu':
      await handleMenu(phone, shop, text, lower, buttonId);
      break;
    case 'awaiting_item':
      await handleItem(phone, text);
      break;
    case 'awaiting_amount':
      await handleAmount(phone, text);
      break;
    case 'awaiting_channel':
      await handleChannel(phone, shop, text, lower, buttonId);
      break;
    default:
      await db.resetChatState(phone);
      await sendWelcome(phone);
  }
}

// ─── Welcome ───

async function sendWelcome(phone) {
  await wa.sendButtons(
    phone,
    `Habari yako! 👋\n\nMimi ni *Cach Tracker* — nitakusaidia kurekodi mauzo yako ya leo ili uwe na record nzuri za biashara yako.\n\nChagua chini:`,
    [
      { id: 'record', title: '📦 Rekodi mauzo' },
      { id: 'summary', title: '📊 Muhtasari wa leo' },
      { id: 'info', title: 'ℹ️ Maelezo zaidi' }
    ]
  );
}

// ─── Menu state ───

async function handleMenu(phone, shop, text, lower, buttonId) {
  // Check for a quick sale format first
  const quickSale = parseQuickSale(text);
  if (quickSale) {
    const sale = await db.recordSale(shop.id, quickSale);
    if (sale) {
      await sendSaleConfirmation(phone, quickSale);
    }
    return;
  }

  // Button presses or text commands
  if (buttonId === 'record' || lower.includes('record') || lower.includes('rekodi') || lower.includes('uza')) {
    await db.setChatState(phone, { state: 'awaiting_item' });
    await wa.sendText(
      phone,
      `Sawa! Tuanze kurekodi.\n\n*Bidhaa gani umeuzwa?*\nAndika jina la bidhaa (mfano: Mayai, Unga, Mchele)\n\n💡 _Njia ya haraka: andika kila kitu pamoja:_\n_Mayai, 10 tray, 2400, mpesa_`
    );
    return;
  }

  if (buttonId === 'summary' || lower.includes('summary') || lower.includes('muhtasari') || lower.includes('jumla')) {
    await sendSummary(phone, shop);
    return;
  }

  if (buttonId === 'info' || lower.includes('info') || lower.includes('maelezo') || lower.includes('help') || lower.includes('msaada')) {
    await wa.sendText(
      phone,
      `*Cach Tracker* inakusaidia:\n\n` +
      `📦 Kurekodi kila uuzaji — bidhaa, quantity, amount, channel\n` +
      `📊 Kuona jumla ya mauzo ya leo\n` +
      `📱 Kutenganisha M-Pesa, Cash, Till, na Credit\n\n` +
      `Data yako hii ndiyo itakayosaidia kupata mkopo wa biashara baadaye.\n\n` +
      `*Jinsi ya kutumia:*\n` +
      `• Andika *rekodi* kuanza kurekodi\n` +
      `• Andika *muhtasari* kuona mauzo ya leo\n` +
      `• Andika *menu* kurudi mwanzo\n\n` +
      `💡 *Njia ya haraka:* Andika mauzo yote moja kwa moja:\n_Mayai, 10 tray, 2400, mpesa_`
    );
    await wa.sendButtons(phone, 'Unataka nini?', [
      { id: 'record', title: '📦 Rekodi mauzo' },
      { id: 'summary', title: '📊 Muhtasari' }
    ]);
    return;
  }

  // Didn't understand
  await wa.sendButtons(
    phone,
    `Samahani, sijaelewa: "${text}"\n\nChagua moja kati ya hizi:`,
    [
      { id: 'record', title: '📦 Rekodi mauzo' },
      { id: 'summary', title: '📊 Muhtasari wa leo' },
      { id: 'info', title: 'ℹ️ Msaada' }
    ]
  );
}

// ─── Step-by-step recording: Item ───

async function handleItem(phone, text) {
  if (!text || text.length < 1) {
    await wa.sendText(phone, 'Tafadhali andika jina la bidhaa (mfano: Mayai, Unga, Mchele)');
    return;
  }

  // Check if they sent a quick sale format instead
  const quickSale = parseQuickSale(text);
  if (quickSale) {
    const shop = await db.getOrCreateShop(phone);
    if (shop) {
      const sale = await db.recordSale(shop.id, quickSale);
      if (sale) {
        await db.resetChatState(phone);
        await sendSaleConfirmation(phone, quickSale);
      }
    }
    return;
  }

  // Parse item — might include qty: "Mayai 10 tray"
  const match = text.match(/^(.+?)\s+(\d+\.?\d*)\s*(.*)$/);
  let item, qty, unit;

  if (match) {
    item = match[1].trim();
    qty = parseFloat(match[2]);
    unit = match[3].trim() || 'pcs';
  } else {
    item = text;
    qty = 1;
    unit = 'pcs';
  }

  await db.setChatState(phone, {
    state: 'awaiting_amount',
    temp_item: item,
    temp_qty: qty,
    temp_unit: unit
  });

  await wa.sendText(
    phone,
    `📦 *${item}* — ${qty} ${unit}\n\n*Kiasi gani (KES) umepokea?*\nAndika nambari tu (mfano: 2400)`
  );
}

// ─── Step-by-step recording: Amount ───

async function handleAmount(phone, text) {
  // Remove "KES", "ksh", commas, spaces
  const cleaned = text.replace(/[kKeEsShH,\s]/g, '');
  const amount = parseFloat(cleaned);

  if (!amount || amount <= 0 || isNaN(amount)) {
    await wa.sendText(phone, 'Tafadhali andika nambari ya KES tu (mfano: 2400)');
    return;
  }

  await db.setChatState(phone, {
    state: 'awaiting_channel',
    temp_amount: amount
  });

  await wa.sendButtons(
    phone,
    `💰 *${fmtKES(amount)}*\n\nUmelipwa kupitia njia gani?`,
    [
      { id: 'ch_mpesa', title: '📱 M-Pesa' },
      { id: 'ch_cash', title: '💵 Cash' },
      { id: 'ch_till', title: '🏪 Till / Credit' }
    ]
  );
}

// ─── Step-by-step recording: Channel ───

async function handleChannel(phone, shop, text, lower, buttonId) {
  let channel = 'cash';

  if (buttonId === 'ch_mpesa' || lower.includes('mpesa') || lower.includes('m-pesa')) {
    channel = 'mpesa';
  } else if (buttonId === 'ch_cash' || lower.includes('cash') || lower.includes('taslimu')) {
    channel = 'cash';
  } else if (buttonId === 'ch_till' || lower.includes('till')) {
    channel = 'till';
  } else if (lower.includes('credit') || lower.includes('mkopo')) {
    channel = 'credit';
  }

  // Retrieve the temp data and save
  const chatState = await db.getChatState(phone);

  const saleData = {
    item: chatState.temp_item,
    qty: chatState.temp_qty || 1,
    unit: chatState.temp_unit || 'pcs',
    amount: chatState.temp_amount,
    channel
  };

  const sale = await db.recordSale(shop.id, saleData);

  // Reset state back to menu
  await db.resetChatState(phone);

  if (sale) {
    await sendSaleConfirmation(phone, saleData);
  } else {
    await wa.sendText(phone, 'Samahani, kuna tatizo la kuhifadhi. Jaribu tena.');
  }
}

// ─── Sale confirmation message ───

async function sendSaleConfirmation(phone, sale) {
  const shop = await db.getOrCreateShop(phone);
  const todaySales = await db.getTodaySales(shop.id);
  const total = todaySales.reduce((s, x) => s + parseFloat(x.amount), 0);

  const qtyStr = sale.unit && sale.unit !== 'pcs' ? `${sale.qty} ${sale.unit}` : `${sale.qty}`;

  await wa.sendButtons(
    phone,
    `✅ *Uuzaji umerekodiwa!*\n\n` +
    `📦 Bidhaa: *${sale.item}*\n` +
    `📏 Quantity: ${qtyStr}\n` +
    `💰 Kiasi: *${fmtKES(sale.amount)}*\n` +
    `${CHANNEL_EMOJI[sale.channel]} Channel: ${CHANNEL_LABELS[sale.channel]}\n\n` +
    `📊 Jumla ya leo: *${fmtKES(total)}* (${todaySales.length} mauzo)`,
    [
      { id: 'record', title: '➕ Rekodi nyingine' },
      { id: 'summary', title: '📊 Muhtasari' }
    ]
  );
}

// ─── Daily summary ───

async function sendSummary(phone, shop) {
  const sales = await db.getTodaySales(shop.id);

  if (sales.length === 0) {
    await wa.sendButtons(
      phone,
      `📊 *Muhtasari wa Leo*\n\nBado haujarekordi mauzo yoyote leo.\nBonyeza chini kuanza.`,
      [{ id: 'record', title: '📦 Rekodi mauzo' }]
    );
    return;
  }

  const total = sales.reduce((s, x) => s + parseFloat(x.amount), 0);
  const avg = Math.round(total / sales.length);

  // Channel breakdown
  const byChannel = {};
  sales.forEach(s => {
    byChannel[s.channel] = (byChannel[s.channel] || 0) + parseFloat(s.amount);
  });

  let channelLines = '';
  for (const ch of CHANNELS) {
    if (byChannel[ch] > 0) {
      const pct = Math.round(byChannel[ch] / total * 100);
      channelLines += `${CHANNEL_EMOJI[ch]} ${CHANNEL_LABELS[ch]}: ${fmtKES(byChannel[ch])} (${pct}%)\n`;
    }
  }

  // Top items
  const byItem = {};
  sales.forEach(s => {
    byItem[s.item] = (byItem[s.item] || 0) + parseFloat(s.amount);
  });
  const topItems = Object.entries(byItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, val]) => `  • ${name}: ${fmtKES(val)}`)
    .join('\n');

  // Date
  const dateStr = new Date().toLocaleDateString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'Africa/Nairobi'
  });

  await wa.sendButtons(
    phone,
    `📊 *Muhtasari — Leo*\n` +
    `${dateStr}\n\n` +
    `💰 *Jumla: ${fmtKES(total)}*\n` +
    `📦 Mauzo: ${sales.length}\n` +
    `📈 Wastani: ${fmtKES(avg)}\n\n` +
    `*Channels:*\n${channelLines}\n` +
    `*Bidhaa bora:*\n${topItems}`,
    [
      { id: 'record', title: '➕ Rekodi mauzo' },
      { id: 'summary', title: '🔄 Refresh' }
    ]
  );
}

module.exports = { handleMessage, sendWelcome };
