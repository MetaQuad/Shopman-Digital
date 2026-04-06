-- =============================================
-- CACH TRACKER — Database Schema
-- Run this in Supabase SQL Editor (one time)
-- =============================================

-- Shops / businesses that use the bot
CREATE TABLE shops (
  id            BIGSERIAL PRIMARY KEY,
  phone         TEXT UNIQUE NOT NULL,       -- WhatsApp number e.g. "254712345678"
  name          TEXT DEFAULT 'My Shop',     -- Shop name (set later)
  owner_name    TEXT,                        -- Owner name
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Every sale recorded
CREATE TABLE sales (
  id            BIGSERIAL PRIMARY KEY,
  shop_id       BIGINT REFERENCES shops(id) ON DELETE CASCADE,
  item          TEXT NOT NULL,               -- e.g. "Mayai"
  qty           NUMERIC DEFAULT 1,           -- e.g. 10
  unit          TEXT DEFAULT 'pcs',           -- e.g. "tray", "kg"
  amount        NUMERIC NOT NULL,            -- KES amount received
  channel       TEXT DEFAULT 'cash',         -- mpesa | cash | till | credit
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation state per user (tracks where they are in the chat flow)
CREATE TABLE chat_state (
  phone         TEXT PRIMARY KEY,
  state         TEXT DEFAULT 'menu',         -- menu | awaiting_item | awaiting_amount | awaiting_channel
  temp_item     TEXT,                        -- holds item name mid-flow
  temp_qty      NUMERIC,
  temp_unit     TEXT,
  temp_amount   NUMERIC,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_sales_shop    ON sales(shop_id);
CREATE INDEX idx_sales_date    ON sales(recorded_at);
CREATE INDEX idx_shops_phone   ON shops(phone);

-- Row-Level Security (optional but recommended)
ALTER TABLE shops      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_state ENABLE ROW LEVEL SECURITY;

-- Allow the service role full access (your server uses the service key)
CREATE POLICY "Service full access" ON shops      FOR ALL USING (true);
CREATE POLICY "Service full access" ON sales      FOR ALL USING (true);
CREATE POLICY "Service full access" ON chat_state FOR ALL USING (true);
