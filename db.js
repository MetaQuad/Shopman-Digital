const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── Shop Management ───

async function getOrCreateShop(phone) {
  let { data: shop } = await supabase
    .from('shops')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!shop) {
    const { data: newShop, error } = await supabase
      .from('shops')
      .insert({ phone })
      .select()
      .single();

    if (error) {
      console.error('Error creating shop:', error);
      return null;
    }
    shop = newShop;
  }

  return shop;
}

// ─── Sales ───

async function recordSale(shopId, { item, qty, unit, amount, channel }) {
  const { data, error } = await supabase
    .from('sales')
    .insert({
      shop_id: shopId,
      item,
      qty: qty || 1,
      unit: unit || 'pcs',
      amount,
      channel: channel || 'cash'
    })
    .select()
    .single();

  if (error) {
    console.error('Error recording sale:', error);
    return null;
  }
  return data;
}

async function deleteSale(saleId) {
  const { error } = await supabase
    .from('sales')
    .delete()
    .eq('id', saleId);

  if (error) {
    console.error('Error deleting sale:', error);
    return false;
  }
  return true;
}

async function getTodaySales(shopId) {
  const now = new Date();
  const eat = new Date(now.getTime() + (3 * 60 * 60 * 1000));
  const startOfDay = new Date(eat.getFullYear(), eat.getMonth(), eat.getDate());
  const utcStart = new Date(startOfDay.getTime() - (3 * 60 * 60 * 1000));

  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('shop_id', shopId)
    .gte('recorded_at', utcStart.toISOString())
    .order('recorded_at', { ascending: true });

  if (error) {
    console.error('Error fetching sales:', error);
    return [];
  }
  return data || [];
}

// ─── Chat State ───

async function getChatState(phone) {
  const { data } = await supabase
    .from('chat_state')
    .select('*')
    .eq('phone', phone)
    .single();

  return data || { phone, state: 'menu', temp_item: null, temp_qty: null, temp_unit: null, temp_amount: null };
}

async function setChatState(phone, updates) {
  const { error } = await supabase
    .from('chat_state')
    .upsert({
      phone,
      ...updates,
      updated_at: new Date().toISOString()
    });

  if (error) console.error('Error updating chat state:', error);
}

async function resetChatState(phone) {
  await setChatState(phone, {
    state: 'menu',
    temp_item: null,
    temp_qty: null,
    temp_unit: null,
    temp_amount: null
  });
}

module.exports = {
  getOrCreateShop,
  recordSale,
  deleteSale,
  getTodaySales,
  getChatState,
  setChatState,
  resetChatState
};
