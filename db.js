'use strict';
// Database layer: built-in node:sqlite (Node 22.5+), no npm packages needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'store.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  highlights TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price INTEGER NOT NULL,          -- selling price, INR
  mrp INTEGER,                     -- strike-through price (optional)
  cost INTEGER,                    -- what the supplier charges you (private)
  stock INTEGER,                   -- NULL = not tracked (supplier-managed)
  images TEXT NOT NULL DEFAULT '', -- newline separated URLs
  icon TEXT NOT NULL DEFAULT '📦', -- placeholder emoji when there is no image
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_url TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  cod_fee INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL,            -- cod | upi | online
  payment_status TEXT NOT NULL DEFAULT 'pending', -- pending | verifying | paid | failed | refunded
  payment_ref TEXT NOT NULL DEFAULT '',
  razorpay_order_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',      -- new | confirmed | shipped | delivered | cancelled | rto
  supplier_ordered INTEGER NOT NULL DEFAULT 0,
  courier TEXT NOT NULL DEFAULT '',
  tracking_no TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  restocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📦',
  image TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  cost INTEGER,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
`);

/* ---------- helpers ---------- */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}
function uniqueSlug(table, base, ignoreId = 0) {
  let slug = slugify(base), n = 1;
  const q = db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`);
  while (q.get(slug, ignoreId)) slug = `${slugify(base)}-${++n}`;
  return slug;
}

/* ---------- settings ---------- */
const DEFAULT_SETTINGS = {
  store_name: 'GadgetGully',
  tagline: 'Smart gadgets & accessories, delivered across India',
  announcement: 'Free shipping on orders above ₹999. Cash on Delivery available.',
  upi_id: '',
  whatsapp: '',            // with country code, digits only e.g. 919876543210
  support_email: '',
  support_phone: '',
  business_address: '',
  delivery_estimate: '7-12 business days',
  shipping_fee: '60',
  free_shipping_above: '999',
  cod_enabled: '1',
  cod_fee: '40',
  prepaid_discount_pct: '0',
  return_window_days: '7'
};
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (r.key in out) out[r.key] = r.value;
  }
  return out;
}
function setSettings(obj) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  tx(() => { for (const [k, v] of Object.entries(obj)) if (SETTING_KEYS.includes(k)) up.run(k, String(v)); });
}

/* ---------- sample catalog (replace from the admin panel) ---------- */
function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0) return;
  const cats = [
    ['Audio', '🎧'], ['Smart Wearables', '⌚'], ['Power & Charging', '🔋'],
    ['Smart Home', '💡'], ['PC & Gaming', '🖱️'], ['Mobile Accessories', '📱']
  ];
  const insCat = db.prepare('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)');
  const catId = {};
  tx(() => { for (const [n, i] of cats) catId[n] = Number(insCat.run(n, slugify(n), i).lastInsertRowid); });

  // [name, category, price, mrp, cost, icon, featured, description, highlights]
  const P = [
    ['TWS Bluetooth Earbuds with ENC', 'Audio', 1299, 2499, 640, '🎧', 1,
      'True wireless earbuds with environmental noise cancellation for calls, a compact charging case and low-latency mode for videos and games.',
      'Bluetooth 5.3\nENC for clearer calls\nUp to 6 hours playback per charge (case adds more)\nTouch controls\nUSB-C charging case'],
    ['Bluetooth Neckband with Fast Charge', 'Audio', 899, 1799, 430, '🎧', 0,
      'Lightweight neckband for daily use. Magnetic earbuds, 10 minute fast charge and a splash-resistant body.',
      'Bluetooth 5.3\nMagnetic earbuds\nFast charge\nSplash resistant\nVoice assistant support'],
    ['Portable Bluetooth Speaker 10W', 'Audio', 1499, 2999, 760, '🔊', 1,
      'Compact speaker with punchy sound, built-in mic and a microSD slot. Easy to carry on trips.',
      '10W output\nBluetooth 5.0\nMicroSD and AUX input\nBuilt-in microphone\nType-C charging'],
    ['Smart Watch with Bluetooth Calling', 'Smart Wearables', 1999, 4999, 980, '⌚', 1,
      'AMOLED-style display smart watch with Bluetooth calling, heart-rate and sleep tracking and multiple sports modes.',
      'Bluetooth calling\nHeart rate & SpO2 tracking\nSleep tracking\nMultiple sports modes\nWater resistant (splash/sweat)'],
    ['Fitness Band with Step & Sleep Tracking', 'Smart Wearables', 1199, 2499, 560, '⌚', 0,
      'Slim fitness band for everyday tracking with notifications and a week-long battery.',
      'Step, calorie & sleep tracking\nCall & message alerts\nUp to 7 days battery\nCharges via USB'],
    ['20000mAh Power Bank 22.5W Fast Charge', 'Power & Charging', 1799, 3499, 940, '🔋', 1,
      'High-capacity power bank with 22.5W fast charging and dual output, enough for several phone charges.',
      '20000mAh capacity\n22.5W fast charging\nUSB-A + Type-C ports\nLED battery indicator'],
    ['65W GaN Fast Charger (3 Ports)', 'Power & Charging', 1599, 2999, 780, '🔌', 0,
      'Compact GaN charger that can power a laptop, phone and earbuds at once. Cable not included.',
      '65W max output\n2x Type-C + 1x USB-A\nGaN technology (runs cooler)\nFoldable plug'],
    ['Magnetic Wireless Charging Pad', 'Power & Charging', 999, 1999, 450, '🧲', 0,
      'Slim 15W magnetic wireless charger for compatible phones. Works with most Qi-enabled devices.',
      'Up to 15W wireless charging\nMagnetic alignment (for compatible phones)\nLED indicator\nType-C input'],
    ['Wi-Fi Smart Plug 16A with Energy Monitor', 'Smart Home', 799, 1499, 360, '💡', 1,
      'Control appliances from your phone, set schedules and track power usage. Works with popular voice assistants.',
      '16A / 3680W\nApp control & schedules\nEnergy monitoring\n2.4GHz Wi-Fi'],
    ['Wi-Fi LED Strip Lights 5m RGB', 'Smart Home', 1099, 2299, 480, '🌈', 0,
      'Colour-changing LED strip with app and remote control and music sync. Easy peel-and-stick install.',
      '5 metre strip\n16 million colours\nApp + remote control\nMusic sync'],
    ['RGB Wired Gaming Mouse 7200 DPI', 'PC & Gaming', 699, 1499, 300, '🖱️', 0,
      'Ergonomic wired gaming mouse with adjustable DPI, programmable buttons and RGB lighting.',
      'Up to 7200 DPI\n6 programmable buttons\nRGB lighting\nBraided cable'],
    ['Aluminium Laptop Stand (Adjustable)', 'PC & Gaming', 899, 1799, 380, '💻', 0,
      'Foldable, height-adjustable stand that improves airflow and posture. Fits most 10-17 inch laptops.',
      'Aluminium alloy\nAdjustable height\nFoldable & portable\nAnti-slip pads'],
    ['10" Ring Light with Tripod Stand', 'Mobile Accessories', 1299, 2599, 590, '📸', 1,
      'Dimmable ring light with phone holder and extendable tripod for reels, video calls and product shots.',
      '3 colour modes\nStepless dimming\nExtendable tripod\nPhone holder included'],
    ['Phone Gimbal-Style Tripod with Remote', 'Mobile Accessories', 599, 1299, 240, '📱', 0,
      'Flexible tripod with Bluetooth remote shutter. Wraps around poles and rails for hands-free shooting.',
      'Flexible legs\nBluetooth remote\nFits most phones\nPortable'],
  ];
  const insP = db.prepare(`INSERT INTO products
    (name, slug, description, highlights, category_id, price, mrp, cost, stock, images, icon, supplier_name, supplier_url, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?, '', '', ?)`);
  tx(() => {
    for (const [name, cat, price, mrp, cost, icon, feat, desc, hl] of P) {
      insP.run(name, uniqueSlug('products', name), desc, hl, catId[cat], price, mrp, cost, icon, feat);
    }
  });
}

module.exports = {
  db, tx, DATA_DIR, hashPassword, verifyPassword, slugify, uniqueSlug,
  getSettings, setSettings, SETTING_KEYS, DEFAULT_SETTINGS, seed
};
