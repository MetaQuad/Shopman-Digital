const wa = require('./whatsapp');
const db = require('./db');

// ─── Helpers ───

function fmtKES(n) {
  return 'KES ' + Math.round(n).toLocaleString();
}

const CHANNELS = ['mpesa', 'cash', 'till', 'credit'];
const CHANNEL_LABELS = { mpesa: 'M-Pesa', cash: 'Cash', till: 'Till', credit: 'Credit' };
const CHANNEL_EMOJI = { mpesa: '📱', cash: '💵', till: '🏪', credit: '📝' };

function parseAmount(text) {
  let cleaned = text.toLowerCase().replace(/[,\s]/g, '');
  cleaned = cleaned.replace(/^(ksh|kes|sh)/, '');
  // Handle "k" shorthand: 2.4k = 2400, 1k = 1000
  const kMatch = cleaned.match(/^(\d+\.?\d*)k$/);
  if (kMatch) return parseFloat(kMatch[1]) * 1000;
  const num = parseFloat(cleaned);
  return (num > 0 && !isNaN(num)) ? num : null;
}

// Parse flexible one-liner formats:
// "Mayai, 10 tray, 2400, mpesa"  (full)
// "Mayai 2400 mpesa"             (item + amount + channel)
// "Mayai 2400"                   (item + amount)
// "Mayai 2.4k"                   (item + amount with k shorthand)
function parseQuickSale(text) {
  // Format 1: comma-separated
  const parts = text.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    const item = parts[0];
    const qtyPart = parts[1].match(/^(\d+\.?\d*)\s*(.*)$/);
    const qty = qtyPart ? parseFloat(qtyPart[1]) : 1;
    const unit = qtyPart && qtyPart[2] ? qtyPart[2] : 'pcs';
    const amount = parseAmount(parts[2]);
    const channel = parts[3] ? parts[3].toLowerCase().trim() : 'cash';
    if (item && amount) {
      return { item, qty, unit, amount, channel: CHANNELS.includes(channel) ? channel : 'cash' };
    }
  }

  // Format 2: "Item Amount Channel" or "Item Amount"
  // Match: words (item name), then a number/amount, then optional channel
  const spaceMatch = text.match(/^(.+?)\s+(\d+\.?\d*k?)\s*(mpesa|cash|till|credit)?$/i);
  if (spaceMatch) {
    const item = spaceMatch[1].trim();
    const amount = parseAmount(spaceMatch[2]);
    const channel = spaceMatch[3] ? spaceMatch[3].toLowerCase() : 'cash';
    if (item && amount && amount >= 5) {
      return { item, qty: 1, unit: 'pcs', amount, channel: CHANNELS.includes(channel) ? channel : 'cash' };
    }
  }

  return null;
}

function getGreeting() {
  const hour = new Date(Date.now() + 3 * 60 * 60 * 1000).getHours();
  if (hour < 12) return 'Habari ya asubuhi';
  if (hour < 17) return 'Habari ya mchana';
  return 'Habari ya jioni';
}

// ─── Main message handler ───

async function handleMessage(phone, message, messageId) {
  await wa.markRead(messageId);

  const shop = await db.getOrCreateShop(phone);
  if (!shop) {
    await wa.sendText(phone, 'Samahani, kuna tatizo la kiufundi. Jaribu tena baadaye.');
    return;
  }

  const chatState = await db.getChatState(phone);
  const state = chatState.state || 'menu';

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

  if (['menu', 'start', 'hi', 'habari', 'hello', 'hey', 'sasa', 'niaje'].includes(lower)) {
    await db.resetChatState(phone);
    await sendWelcome(phone, shop);
    return;
  }

  if (['cancel', 'acha', 'sitisha', 'back', 'rudi'].includes(lower)) {
    await db.resetChatState(phone);
    await wa.sendButtons(phone, 'Sawa, nimesimamisha.', [
      { id: 'record', title: '📦 Rekodi mauzo' },
      { id: 'summary', title: '📊 Muhtasari' }
    ]);
    return;
  }

  // Check for quick sale from any state
  if (state === 'menu') {
    const quickSale = parseQuickSale(text);
    if (quickSale) {
      const sale = await db.recordSale(shop.id, quickSale);
      if (sale) {
        await db.resetChatState(phone);
        await sendSaleConfirmation(phone, shop, quickSale);
        return;
      }
    }
  }

  // ─── Route based on state ───

  switch (state) {
    case 'menu':
      await handleMenu(phone, shop, text, lower, buttonId);
      break;
    case 'awaiting_item':
      await handleItem(phone, shop, text);
      break;
    case 'awaiting_amount':
      await handleAmount(phone, text);
      break;
    case 'awaiting_channel':
      await handleChannel(phone, shop, text, lower, buttonId);
      break;
    default:
      await db.resetChatState(phone);
      await sendWelcome(phone, shop);
  }
}

// ─── Welcome ───

async function sendWelcome(phone, shop) {
  const todaySales = await db.getTodaySales(shop.id);
  const greeting = getGreeting();

  let body;
  if (todaySales.length > 0) {
    const total = todaySales.reduce((s, x) => s + parseFloat(x.amount), 0);
    body = `${greeting}! 👋\n\nLeo umerekordi mauzo *${todaySales.length}* — jumla *${fmtKES(total)}*.\n\nUnataka nini?`;
  } else {
    body = `${greeting}! 👋\n\nMimi ni *Cach Tracker* — msaidizi wako wa kurekodi mauzo.\n\nBado hujarekordi mauzo leo. Tuanze?`;
  }

  await wa.sendButtons(phone, body, [
    { id: 'record', title: '📦 Rekodi mauzo' },
    { id: 'summary', title: '📊 Muhtasari wa leo' },
    { id: 'recent', title: '📋 Mauzo ya hivi karibuni' }
  ]);
}

// ─── Menu state ───

async function handleMenu(phone, shop, text, lower, buttonId) {
  if (buttonId === 'record' || matchAny(lower, ['record', 'rekodi', 'uza', 'mauzo', 'ongeza', 'add', 'sale'])) {
    await db.setChatState(phone, { state: 'awaiting_item' });
    await wa.sendText(
      phone,
      `Sawa! Bidhaa gani umeuzwa?\n\nAndika jina (mfano: _Mayai_, _Unga_, _Mchele_)\n\n💡 _Au andika kila kitu moja kwa moja:_\n_Mayai, 10 tray, 2400, mpesa_\n_au hata: Unga 1500_`
    );
    return;
  }

  if (buttonId === 'summary' || matchAny(lower, ['summary', 'muhtasari', 'jumla', 'total', 'leo'])) {
    await sendSummary(phone, shop);
    return;
  }

  if (buttonId === 'recent' || matchAny(lower, ['recent', 'karibuni', 'last', 'history', 'log', 'list'])) {
    await sendRecentSales(phone, shop);
    return;
  }

  if (buttonId === 'delete_last' || matchAny(lower, ['delete', 'futa', 'ondoa', 'remove'])) {
    await deleteLastSale(phone, shop);
    return;
  }

  if (buttonId === 'info' || matchAny(lower, ['info', 'maelezo', 'help', 'msaada', 'jinsi'])) {
    await sendHelp(phone);
    return;
  }

  // Didn't understand — but be helpful
  await wa.sendButtons(
    phone,
    `Sijaelewa "${text}" — lakini unaweza:\n\n• Andika jina la bidhaa na bei kurekodi haraka\n  _mfano: Mayai 2400_\n• Au chagua chini:`,
    [
      { id: 'record', title: '📦 Rekodi mauzo' },
      { id: 'summary', title: '📊 Muhtasari' },
      { id: 'recent', title: '📋 Mauzo ya karibuni' }
    ]
  );
}

// ─── Step: Item ───

async function handleItem(phone, shop, text) {
  if (!text || text.length < 1) {
    await wa.sendText(phone, 'Andika jina la bidhaa (mfano: _Mayai_, _Unga_, _Mchele_)');
    return;
  }

  // Check if they typed a quick sale
  const quickSale = parseQuickSale(text);
  if (quickSale) {
    const sale = await db.recordSale(shop.id, quickSale);
    if (sale) {
      await db.resetChatState(phone);
      await sendSaleConfirmation(phone, shop, quickSale);
    }
    return;
  }

  // Check if they typed "Item Amount" (e.g., "Unga 1500")
  const itemAmount = text.match(/^(.+?)\s+(\d+\.?\d*k?)$/i);
  if (itemAmount) {
    const item = itemAmount[1].trim();
    const amount = parseAmount(itemAmount[2]);
    if (amount && amount >= 5) {
      await db.setChatState(phone, {
        state: 'awaiting_channel',
        temp_item: item,
        temp_qty: 1,
        temp_unit: 'pcs',
        temp_amount: amount
      });
      await wa.sendButtons(
        phone,
        `📦 *${item}* — *${fmtKES(amount)}*\n\nUmelipwa kupitia?`,
        [
          { id: 'ch_mpesa', title: '📱 M-Pesa' },
          { id: 'ch_cash', title: '💵 Cash' },
          { id: 'ch_till', title: '🏪 Till / Credit' }
        ]
      );
      return;
    }
  }

  // Parse item with optional qty: "Mayai 10 tray"
  const match = text.match(/^(.+?)\s+(\d+\.?\d*)\s+(.+)$/);
  let item, qty, unit;

  if (match) {
    item = match[1].trim();
    qty = parseFloat(match[2]);
    unit = match[3].trim();
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

  const qtyStr = unit !== 'pcs' ? `${qty} ${unit}` : '';
  const itemDisplay = qtyStr ? `*${item}* (${qtyStr})` : `*${item}*`;

  await wa.sendText(
    phone,
    `📦 ${itemDisplay}\n\nKiasi gani (KES) umepokea?\nAndika nambari tu — _mfano: 2400 au 2.4k_`
  );
}

// ─── Step: Amount ───

async function handleAmount(phone, text) {
  const amount = parseAmount(text);

  if (!amount) {
    await wa.sendText(phone, 'Hiyo sio nambari. Andika bei tu — _mfano: 2400 au 2.4k au ksh 500_\n\nAndika *acha* kughairi.');
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

// ─── Step: Channel ───

async function handleChannel(phone, shop, text, lower, buttonId) {
  let channel = 'cash';

  if (buttonId === 'ch_mpesa' || matchAny(lower, ['mpesa', 'm-pesa', 'pesa'])) {
    channel = 'mpesa';
  } else if (buttonId === 'ch_cash' || matchAny(lower, ['cash', 'taslimu', 'pesa taslimu'])) {
    channel = 'cash';
  } else if (buttonId === 'ch_till' || matchAny(lower, ['till'])) {
    channel = 'till';
  } else if (matchAny(lower, ['credit', 'mkopo'])) {
    channel = 'credit';
  }

  const chatState = await db.getChatState(phone);

  const saleData = {
    item: chatState.temp_item,
    qty: chatState.temp_qty || 1,
    unit: chatState.temp_unit || 'pcs',
    amount: chatState.temp_amount,
    channel
  };

  const sale = await db.recordSale(shop.id, saleData);
  await db.resetChatState(phone);

  if (sale) {
    await sendSaleConfirmation(phone, shop, saleData);
  } else {
    await wa.sendText(phone, 'Samahani, kuna tatizo la kuhifadhi. Jaribu tena — andika *rekodi* kuanza upya.');
  }
}

// ─── Sale confirmation ───

async function sendSaleConfirmation(phone, shop, sale) {
  const todaySales = await db.getTodaySales(shop.id);
  const total = todaySales.reduce((s, x) => s + parseFloat(x.amount), 0);
  const qtyStr = sale.unit && sale.unit !== 'pcs' ? `${sale.qty} ${sale.unit}` : `${sale.qty}`;

  await wa.sendButtons(
    phone,
    `✅ *Imerekodiwa!*\n\n` +
    `📦 ${sale.item} (${qtyStr})\n` +
    `💰 *${fmtKES(sale.amount)}* — ${CHANNEL_EMOJI[sale.channel]} ${CHANNEL_LABELS[sale.channel]}\n\n` +
    `Jumla ya leo: *${fmtKES(total)}* (mauzo ${todaySales.length})`,
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
      `📊 *Muhtasari wa Leo*\n\nBado haujarekordi mauzo yoyote leo.`,
      [{ id: 'record', title: '📦 Anza kurekodi' }]
    );
    return;
  }

  const total = sales.reduce((s, x) => s + parseFloat(x.amount), 0);
  const avg = Math.round(total / sales.length);

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

  const byItem = {};
  sales.forEach(s => {
    byItem[s.item] = (byItem[s.item] || 0) + parseFloat(s.amount);
  });
  const topItems = Object.entries(byItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, val]) => `  • ${name}: ${fmtKES(val)}`)
    .join('\n');

  const dateStr = new Date().toLocaleDateString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'Africa/Nairobi'
  });

  await wa.sendButtons(
    phone,
    `📊 *Muhtasari — Leo*\n` +
    `📅 ${dateStr}\n\n` +
    `💰 Jumla: *${fmtKES(total)}*\n` +
    `📦 Mauzo: *${sales.length}*\n` +
    `📈 Wastani: ${fmtKES(avg)}\n\n` +
    `*Channels:*\n${channelLines}\n` +
    `*Bidhaa bora:*\n${topItems}`,
    [
      { id: 'record', title: '➕ Rekodi mauzo' },
      { id: 'recent', title: '📋 Ona orodha' }
    ]
  );
}

// ─── Recent sales list ───

async function sendRecentSales(phone, shop) {
  const sales = await db.getTodaySales(shop.id);

  if (sales.length === 0) {
    await wa.sendButtons(
      phone,
      `📋 Hakuna mauzo yaliyorekodiwa leo.`,
      [{ id: 'record', title: '📦 Anza kurekodi' }]
    );
    return;
  }

  const last5 = sales.slice(-5).reverse();
  let lines = last5.map((s, i) => {
    const time = new Date(s.recorded_at).toLocaleTimeString('en-KE', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Africa/Nairobi'
    });
    return `${i + 1}. ${s.item} — *${fmtKES(parseFloat(s.amount))}* (${CHANNEL_LABELS[s.channel]}) _${time}_`;
  }).join('\n');

  const total = sales.reduce((s, x) => s + parseFloat(x.amount), 0);

  await wa.sendButtons(
    phone,
    `📋 *Mauzo ya hivi karibuni*\n\n${lines}\n\n` +
    `Jumla ya leo: *${fmtKES(total)}* (${sales.length} mauzo)`,
    [
      { id: 'record', title: '➕ Rekodi nyingine' },
      { id: 'delete_last', title: '🗑️ Futa ya mwisho' }
    ]
  );
}

// ─── Delete last sale ───

async function deleteLastSale(phone, shop) {
  const sales = await db.getTodaySales(shop.id);

  if (sales.length === 0) {
    await wa.sendText(phone, 'Hakuna mauzo ya kufuta.');
    return;
  }

  const last = sales[sales.length - 1];
  const deleted = await db.deleteSale(last.id);

  if (deleted) {
    const remaining = sales.length - 1;
    const newTotal = sales.slice(0, -1).reduce((s, x) => s + parseFloat(x.amount), 0);

    await wa.sendButtons(
      phone,
      `🗑️ Imefutwa: *${last.item}* — ${fmtKES(parseFloat(last.amount))}\n\n` +
      `Mauzo yanayobaki: ${remaining} — Jumla: *${fmtKES(newTotal)}*`,
      [
        { id: 'record', title: '📦 Rekodi mauzo' },
        { id: 'summary', title: '📊 Muhtasari' }
      ]
    );
  } else {
    await wa.sendText(phone, 'Samahani, sikuweza kufuta. Jaribu tena.');
  }
}

// ─── Help ───

async function sendHelp(phone) {
  await wa.sendText(
    phone,
    `*Jinsi ya kutumia Cach Tracker:*\n\n` +
    `📦 *Rekodi mauzo:*\n` +
    `  Andika _rekodi_ au tumia njia ya haraka:\n` +
    `  • _Mayai 2400_ (bidhaa + bei)\n` +
    `  • _Unga 1.5k mpesa_ (na channel)\n` +
    `  • _Mayai, 10 tray, 2400, mpesa_ (full)\n\n` +
    `📊 *Muhtasari:* Andika _muhtasari_\n` +
    `📋 *Orodha:* Andika _karibuni_\n` +
    `🗑️ *Futa:* Andika _futa_\n` +
    `🏠 *Menu:* Andika _menu_\n` +
    `❌ *Ghairi:* Andika _acha_`
  );
  await wa.sendButtons(phone, 'Unataka nini?', [
    { id: 'record', title: '📦 Rekodi mauzo' },
    { id: 'summary', title: '📊 Muhtasari' }
  ]);
}

// ─── Utility ───

function matchAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

module.exports = { handleMessage, sendWelcome };
