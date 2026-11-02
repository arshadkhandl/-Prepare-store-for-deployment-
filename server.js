'use strict';
// Dropshipping store server. Zero npm dependencies: needs Node 22.5+ only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Minimal .env loader (no dotenv package). Real environment variables win over the file.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (_) { /* no .env file, that's fine */ }

const D = require('./db');
const { db, tx } = D;

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_NAME = 'ds_admin';
const SESSION_DAYS = 7;
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

/* ---------------- secrets & first-run admin ---------------- */
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(D.DATA_DIR, 'session.key');
  try { return fs.readFileSync(f, 'utf8'); } catch (_) { /* create below */ }
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0) return;
  const user = process.env.ADMIN_USER || 'admin';
  const given = process.env.ADMIN_PASS;
  const pass = given || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(user, D.hashPassword(pass));
  console.log('\n==============================================');
  console.log(' Admin account created');
  console.log(`   URL:      /admin/`);
  console.log(`   Username: ${user}`);
  console.log(`   Password: ${given ? '(from ADMIN_PASS)' : pass}`);
  if (!given) console.log(' Change this password after first login.');
  console.log('==============================================\n');
}

/* ---------------- tiny utilities ---------------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function clientIp(req) {
  if (TRUST_PROXY) {
    const x = req.headers['x-forwarded-for'];
    if (x) return String(x).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  if (b.n > max) throw new HttpError(429, 'Too many requests. Please try again in a few minutes.');
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (_) { return null; }
}
const fingerprint = (hash) => crypto.createHash('sha256').update(hash).digest('hex').slice(0, 12);

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) {
  return process.env.COOKIE_SECURE === '1' || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
}
function setSessionCookie(req, res, value, maxAgeSec) {
  const parts = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getAdmin(req) {
  const p = unsign(parseCookies(req)[COOKIE_NAME]);
  if (!p) return null;
  const row = db.prepare('SELECT id, username, password_hash FROM admins WHERE id = ?').get(p.id);
  if (!row || fingerprint(row.password_hash) !== p.fp) return null;
  return { id: row.id, username: row.username };
}

function readJson(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(bad('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' || Buffer.isBuffer(data) ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', ...headers
  });
  res.end(body);
}

/* ---------------- validation helpers ---------------- */
const str = (v, min, max, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw bad(`${label} is invalid`);
  return s;
};
const optStr = (v, max, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > max) throw bad(`${label} is too long`);
  return s;
};
const intOrNull = (v, label, min = 0) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw bad(`${label} must be a whole number`);
  return n;
};
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) throw bad('Enter a valid 10-digit Indian mobile number');
  return d;
}
function cleanImages(v) {
  const lines = String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length > 8) throw bad('Maximum 8 images per product');
  for (const l of lines) {
    if (!/^(https?:\/\/|\/assets\/)/i.test(l) || l.length > 500) throw bad('Image links must start with http:// or https://');
  }
  return lines.join('\n');
}
function cleanUrl(v, label) {
  const s = optStr(v, 500, label);
  if (s && !/^https?:\/\//i.test(s)) throw bad(`${label} must start with http:// or https://`);
  return s;
}

/* ---------------- row mappers ---------------- */
function publicProduct(p, full = false) {
  const images = p.images ? p.images.split('\n') : [];
  const o = {
    id: p.id, name: p.name, slug: p.slug, price: p.price, mrp: p.mrp, icon: p.icon,
    image: images[0] || '', category_id: p.category_id, category: p.category_name || '',
    category_slug: p.category_slug || '', featured: !!p.featured,
    in_stock: p.stock === null || p.stock > 0,
    low_stock: p.stock !== null && p.stock > 0 && p.stock <= 5 ? p.stock : null
  };
  if (full) { o.description = p.description; o.highlights = p.highlights ? p.highlights.split('\n') : []; o.images = images; }
  return o;
}
const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name, c.slug AS category_slug
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

function orderView(o, admin = false) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id).map((i) => ({
    name: i.name, icon: i.icon, image: i.image, price: i.price, qty: i.qty,
    ...(admin ? { cost: i.cost, product_id: i.product_id } : {})
  }));
  const v = {
    order_no: o.order_no, status: o.status, payment_method: o.payment_method, payment_status: o.payment_status,
    subtotal: o.subtotal, shipping: o.shipping, cod_fee: o.cod_fee, discount: o.discount, total: o.total,
    courier: o.courier, tracking_no: o.tracking_no, created_at: o.created_at, items,
    name: o.name, city: o.city, state: o.state, pincode: o.pincode
  };
  if (admin) {
    Object.assign(v, {
      id: o.id, phone: o.phone, email: o.email, address: o.address, payment_ref: o.payment_ref,
      supplier_ordered: !!o.supplier_ordered, notes: o.notes, updated_at: o.updated_at,
      profit: items.reduce((s, i) => s + (i.cost == null ? 0 : (i.price - i.cost) * i.qty), 0),
      cost_known: items.every((i) => i.cost != null)
    });
  }
  return v;
}

/* ---------------- order creation ---------------- */
function newOrderNo() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let t = 0; t < 10; t++) {
    let s = 'GG-';
    for (let i = 0; i < 6; i++) s += alphabet[crypto.randomInt(alphabet.length)];
    if (!db.prepare('SELECT 1 FROM orders WHERE order_no = ?').get(s)) return s;
  }
  throw new Error('Could not allocate order number');
}

function createOrder(body, ip) {
  rateLimit(`order:${ip}`, 30, 60 * 60 * 1000);
  const S = D.getSettings();
  const cust = body.customer || {};
  const name = str(cust.name, 2, 80, 'Name');
  const phone = normPhone(cust.phone);
  const email = optStr(cust.email, 120, 'Email');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email is invalid');
  const address = str(cust.address, 8, 300, 'Address');
  const city = str(cust.city, 2, 60, 'City');
  const state = str(cust.state, 2, 60, 'State');
  const pincode = String(cust.pincode || '').trim();
  if (!/^[1-9]\d{5}$/.test(pincode)) throw bad('Enter a valid 6-digit pincode');

  const method = body.payment_method;
  if (!['cod', 'upi', 'online'].includes(method)) throw bad('Choose a payment method');
  if (method === 'cod' && S.cod_enabled !== '1') throw bad('Cash on Delivery is not available');
  if (method === 'upi' && !S.upi_id) throw bad('UPI payment is not available');
  if (method === 'online' && !(RZP_KEY_ID && RZP_KEY_SECRET)) throw bad('Online payment is not available');

  const cart = Array.isArray(body.items) ? body.items : [];
  if (!cart.length || cart.length > 20) throw bad('Your cart is empty');
  const merged = new Map();
  for (const it of cart) {
    const id = Number(it.id), qty = Number(it.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 10) throw bad('Invalid cart item');
    merged.set(id, Math.min(10, (merged.get(id) || 0) + qty));
  }

  return tx(() => {
    const lines = [];
    for (const [id, qty] of merged) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
      if (!p) throw bad('A product in your cart is no longer available');
      if (p.stock !== null && p.stock < qty) throw bad(`Only ${p.stock} left of "${p.name}"`);
      lines.push({ p, qty });
    }
    const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
    const shipping = subtotal >= Number(S.free_shipping_above) ? 0 : Number(S.shipping_fee);
    const codFee = method === 'cod' ? Number(S.cod_fee) : 0;
    const discount = method === 'cod' ? 0 : Math.round(subtotal * Number(S.prepaid_discount_pct) / 100);
    const total = subtotal + shipping + codFee - discount;
    const orderNo = newOrderNo();

    const r = db.prepare(`INSERT INTO orders
      (order_no, name, phone, email, address, city, state, pincode, subtotal, shipping, cod_fee, discount, total, payment_method)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(orderNo, name, phone, email, address, city, state, pincode, subtotal, shipping, codFee, discount, total, method);
    const orderId = Number(r.lastInsertRowid);
    const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, icon, image, price, cost, qty) VALUES (?,?,?,?,?,?,?,?)');
    for (const { p, qty } of lines) {
      insItem.run(orderId, p.id, p.name, p.icon, (p.images || '').split('\n')[0] || '', p.price, p.cost, qty);
      if (p.stock !== null) db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, p.id);
    }
    return { order_no: orderNo, total, payment_method: method, payment_status: 'pending' };
  });
}

function findOrderForCustomer(orderNo, phone) {
  const o = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(String(orderNo || '').trim().toUpperCase());
  let p; try { p = normPhone(phone); } catch (_) { p = ''; }
  // identical error for unknown order and wrong phone, so order numbers cannot be probed
  if (!o || o.phone !== p) throw new HttpError(404, 'No order found with these details');
  return o;
}

/* ---------------- Razorpay (optional) ---------------- */
async function razorpayCreate(order) {
  const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');
  const resp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: order.total * 100, currency: 'INR', receipt: order.order_no })
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || !j.id) { console.error('Razorpay error', resp.status, j && j.error); throw new HttpError(502, 'Could not start online payment. Please try again or choose another method.'); }
  return j.id;
}

/* ---------------- routes ---------------- */
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, admin: !!opts.admin });
};

function publicSettings() {
  const S = D.getSettings();
  const { business_address, ...rest } = S; // keep full set below; address is public on policy pages
  return {
    ...rest, business_address,
    free_shipping_above: Number(S.free_shipping_above), shipping_fee: Number(S.shipping_fee),
    cod_enabled: S.cod_enabled === '1', cod_fee: Number(S.cod_fee),
    prepaid_discount_pct: Number(S.prepaid_discount_pct),
    upi_enabled: !!S.upi_id, online_enabled: !!(RZP_KEY_ID && RZP_KEY_SECRET),
    razorpay_key_id: RZP_KEY_ID
  };
}

route('GET', '/healthz', () => ({ ok: true }));
route('GET', '/api/store', () => ({
  settings: publicSettings(),
  categories: db.prepare('SELECT id, name, slug, icon FROM categories ORDER BY name').all()
}));

route('GET', '/api/products', ({ query }) => {
  const where = ['p.active = 1']; const args = [];
  if (query.category) { where.push('c.slug = ?'); args.push(String(query.category)); }
  if (query.q) { where.push('(p.name LIKE ? OR p.description LIKE ?)'); const q = `%${String(query.q).slice(0, 60)}%`; args.push(q, q); }
  if (query.featured === '1') where.push('p.featured = 1');
  const order = { price_asc: 'p.price ASC', price_desc: 'p.price DESC', new: 'p.id DESC' }[query.sort] || 'p.featured DESC, p.id DESC';
  const rows = db.prepare(`${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`).all(...args);
  return rows.map((r) => publicProduct(r));
});

route('GET', '/api/products/:slug', ({ params }) => {
  const p = db.prepare(`${PRODUCT_SELECT} WHERE p.slug = ? AND p.active = 1`).get(params.slug);
  if (!p) throw new HttpError(404, 'Product not found');
  const related = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.id != ? AND p.category_id IS ? ORDER BY p.featured DESC, p.id DESC LIMIT 4`).all(p.id, p.category_id);
  return { product: publicProduct(p, true), related: related.map((r) => publicProduct(r)) };
});

route('POST', '/api/orders', ({ body, ip }) => createOrder(body, ip));

route('GET', '/api/orders/track', ({ query, ip }) => {
  rateLimit(`track:${ip}`, 60, 10 * 60 * 1000);
  return orderView(findOrderForCustomer(query.order_no, query.phone));
});

route('POST', '/api/orders/upi-ref', ({ body, ip }) => {
  rateLimit(`upiref:${ip}`, 40, 60 * 60 * 1000);
  const o = findOrderForCustomer(body.order_no, body.phone);
  if (o.payment_method !== 'upi' || !['pending', 'verifying', 'failed'].includes(o.payment_status)) throw bad('This order does not need a UPI reference');
  const utr = str(body.utr, 8, 22, 'UTR / transaction ID');
  if (!/^[A-Za-z0-9]+$/.test(utr)) throw bad('UTR / transaction ID is invalid');
  db.prepare("UPDATE orders SET payment_ref = ?, payment_status = 'verifying', updated_at = datetime('now') WHERE id = ?").run(utr, o.id);
  return { ok: true, payment_status: 'verifying' };
});

route('POST', '/api/payments/razorpay/create', async ({ body, ip }) => {
  if (!(RZP_KEY_ID && RZP_KEY_SECRET)) throw bad('Online payment is not enabled');
  rateLimit(`rzp:${ip}`, 20, 60 * 60 * 1000);
  const o = findOrderForCustomer(body.order_no, body.phone);
  if (o.payment_method !== 'online' || o.payment_status === 'paid') throw bad('This order cannot be paid online');
  const rid = await razorpayCreate(o);
  db.prepare("UPDATE orders SET razorpay_order_id = ?, updated_at = datetime('now') WHERE id = ?").run(rid, o.id);
  return { razorpay_order_id: rid, amount: o.total * 100, key: RZP_KEY_ID };
});

route('POST', '/api/payments/razorpay/verify', ({ body, ip }) => {
  rateLimit(`rzpv:${ip}`, 30, 60 * 60 * 1000);
  const o = findOrderForCustomer(body.order_no, body.phone);
  const pid = String(body.razorpay_payment_id || ''), sig = String(body.razorpay_signature || '');
  if (!o.razorpay_order_id || String(body.razorpay_order_id) !== o.razorpay_order_id) throw bad('Payment does not match this order');
  const expect = crypto.createHmac('sha256', RZP_KEY_SECRET).update(`${o.razorpay_order_id}|${pid}`).digest('hex');
  const a = Buffer.from(expect), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad('Payment verification failed');
  db.prepare("UPDATE orders SET payment_status = 'paid', payment_ref = ?, updated_at = datetime('now') WHERE id = ?").run(pid, o.id);
  return { ok: true, payment_status: 'paid' };
});

/* ---- admin: auth ---- */
route('POST', '/api/admin/login', ({ body, ip, req, res }) => {
  rateLimit(`login:${ip}`, 8, 15 * 60 * 1000);
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(body.username || ''));
  const ok = row ? D.verifyPassword(String(body.password || ''), row.password_hash)
    : (D.verifyPassword('x', D.hashPassword('y')), false); // equalise timing
  if (!ok) throw new HttpError(401, 'Wrong username or password');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  setSessionCookie(req, res, sign({ id: row.id, fp: fingerprint(row.password_hash), exp }), SESSION_DAYS * 86400);
  return { ok: true, username: row.username };
});
route('POST', '/api/admin/logout', ({ req, res }) => { setSessionCookie(req, res, '', 0); return { ok: true }; });
route('GET', '/api/admin/me', ({ admin }) => ({ username: admin.username }), { admin: true });
route('POST', '/api/admin/password', ({ body, admin, req, res }) => {
  const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(admin.id);
  if (!D.verifyPassword(String(body.current || ''), row.password_hash)) throw new HttpError(400, 'Current password is wrong');
  const next = String(body.next || '');
  if (next.length < 10) throw bad('New password must be at least 10 characters');
  const hash = D.hashPassword(next);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, admin.id);
  setSessionCookie(req, res, sign({ id: admin.id, fp: fingerprint(hash), exp: Date.now() + SESSION_DAYS * 864e5 }), SESSION_DAYS * 86400);
  return { ok: true };
}, { admin: true });

/* ---- admin: dashboard ---- */
route('GET', '/api/admin/stats', () => {
  const counts = {};
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()) counts[r.status] = r.n;
  const live = "o.status NOT IN ('cancelled','rto')";
  const money = db.prepare(`SELECT COALESCE(SUM(o.total),0) AS revenue FROM orders o WHERE ${live}`).get();
  const profit = db.prepare(`SELECT COALESCE(SUM((i.price - COALESCE(i.cost, i.price)) * i.qty),0) AS p
    FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${live}`).get();
  const toOrder = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE supplier_ordered = 0 AND status IN ('new','confirmed')").get().n;
  const toVerify = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE payment_status = 'verifying'").get().n;
  const days = db.prepare(`SELECT date(o.created_at) AS d, COUNT(*) AS orders, SUM(o.total) AS revenue
    FROM orders o WHERE ${live} AND o.created_at >= datetime('now','-6 days','start of day') GROUP BY d ORDER BY d`).all();
  const lowStock = db.prepare('SELECT id, name, stock FROM products WHERE active = 1 AND stock IS NOT NULL AND stock <= 5 ORDER BY stock LIMIT 10').all();
  const top = db.prepare(`SELECT i.name, SUM(i.qty) AS qty FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE ${live} GROUP BY i.name ORDER BY qty DESC LIMIT 5`).all();
  return {
    counts, revenue: money.revenue, est_profit: profit.p, to_order: toOrder, to_verify: toVerify,
    total_orders: Object.values(counts).reduce((a, b) => a + b, 0), days, low_stock: lowStock, top
  };
}, { admin: true });

/* ---- admin: products & categories ---- */
function readProduct(body, existingId = 0) {
  const price = intOrNull(body.price, 'Selling price', 1);
  if (price === null) throw bad('Selling price is required');
  const mrp = intOrNull(body.mrp, 'MRP', 1);
  if (mrp !== null && mrp < price) throw bad('MRP cannot be lower than the selling price');
  const catId = intOrNull(body.category_id, 'Category', 1);
  if (catId !== null && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(catId)) throw bad('Category not found');
  const name = str(body.name, 2, 150, 'Product name');
  return {
    name, price, mrp, category_id: catId,
    cost: intOrNull(body.cost, 'Supplier cost', 0),
    stock: intOrNull(body.stock, 'Stock', 0),
    description: optStr(body.description, 4000, 'Description'),
    highlights: optStr(body.highlights, 1500, 'Highlights'),
    images: cleanImages(body.images),
    icon: optStr(body.icon, 8, 'Icon') || '📦',
    supplier_name: optStr(body.supplier_name, 120, 'Supplier name'),
    supplier_url: cleanUrl(body.supplier_url, 'Supplier link'),
    featured: body.featured ? 1 : 0, active: body.active === false || body.active === 0 ? 0 : 1,
    slug: D.uniqueSlug('products', name, existingId)
  };
}
route('GET', '/api/admin/products', () =>
  db.prepare(`${PRODUCT_SELECT} ORDER BY p.id DESC`).all().map((p) => ({ ...p, images: p.images })), { admin: true });
route('POST', '/api/admin/products', ({ body }) => {
  const v = readProduct(body);
  const r = db.prepare(`INSERT INTO products (name, slug, description, highlights, category_id, price, mrp, cost, stock, images, icon, supplier_name, supplier_url, featured, active)
    VALUES (@name,@slug,@description,@highlights,@category_id,@price,@mrp,@cost,@stock,@images,@icon,@supplier_name,@supplier_url,@featured,@active)`).run(v);
  return { id: Number(r.lastInsertRowid) };
}, { admin: true });
route('PUT', '/api/admin/products/:id', ({ params, body }) => {
  const id = Number(params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'Product not found');
  const v = readProduct(body, id);
  db.prepare(`UPDATE products SET name=@name, slug=@slug, description=@description, highlights=@highlights, category_id=@category_id,
    price=@price, mrp=@mrp, cost=@cost, stock=@stock, images=@images, icon=@icon, supplier_name=@supplier_name,
    supplier_url=@supplier_url, featured=@featured, active=@active WHERE id=@id`).run({ ...v, id });
  return { ok: true };
}, { admin: true });
route('DELETE', '/api/admin/products/:id', ({ params }) => {
  // order history keeps its own copy of name/price, so deleting is safe
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(params.id));
  return { ok: true };
}, { admin: true });

route('POST', '/api/admin/categories', ({ body }) => {
  const name = str(body.name, 2, 40, 'Category name');
  const r = db.prepare('INSERT INTO categories (name, slug, icon) VALUES (?,?,?)')
    .run(name, D.uniqueSlug('categories', name), optStr(body.icon, 8, 'Icon') || '📦');
  return { id: Number(r.lastInsertRowid) };
}, { admin: true });
route('DELETE', '/api/admin/categories/:id', ({ params }) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(Number(params.id));
  return { ok: true };
}, { admin: true });
route('GET', '/api/admin/categories', () => db.prepare('SELECT * FROM categories ORDER BY name').all(), { admin: true });

/* ---- admin: orders ---- */
const STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled', 'rto'];
const PAY_STATUSES = ['pending', 'verifying', 'paid', 'failed', 'refunded'];

route('GET', '/api/admin/orders', ({ query }) => {
  const where = []; const args = [];
  if (query.status && STATUSES.includes(query.status)) { where.push('status = ?'); args.push(query.status); }
  if (query.todo === 'supplier') where.push("supplier_ordered = 0 AND status IN ('new','confirmed')");
  if (query.todo === 'verify') where.push("payment_status = 'verifying'");
  if (query.q) { where.push('(order_no LIKE ? OR phone LIKE ? OR name LIKE ?)'); const q = `%${String(query.q).slice(0, 40)}%`; args.push(q, q, q); }
  const rows = db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).all(...args);
  return rows.map((o) => orderView(o, true));
}, { admin: true });

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
}
route('GET', '/api/admin/orders.csv', ({ query, res }) => {
  const where = query.todo === 'supplier' ? "WHERE supplier_ordered = 0 AND status IN ('new','confirmed')" : '';
  const rows = db.prepare(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT 2000`).all();
  const head = ['Order', 'Date', 'Status', 'Payment', 'Pay status', 'Total', 'Name', 'Phone', 'Address', 'City', 'State', 'Pincode', 'Items', 'Courier', 'Tracking'];
  const lines = [head.map(csvCell).join(',')];
  for (const o of rows) {
    const items = db.prepare('SELECT name, qty FROM order_items WHERE order_id = ?').all(o.id).map((i) => `${i.name} x${i.qty}`).join('; ');
    lines.push([o.order_no, o.created_at, o.status, o.payment_method, o.payment_status, o.total, o.name, o.phone, o.address, o.city, o.state, o.pincode, items, o.courier, o.tracking_no].map(csvCell).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="orders.csv"', 'Cache-Control': 'no-store' });
  res.end('﻿' + lines.join('\r\n'));
  return undefined;
}, { admin: true });

route('PUT', '/api/admin/orders/:id', ({ params, body }) => {
  const id = Number(params.id);
  return tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw new HttpError(404, 'Order not found');
    const status = body.status === undefined ? o.status : body.status;
    if (!STATUSES.includes(status)) throw bad('Invalid status');
    if (o.status === 'cancelled' && status !== 'cancelled') throw bad('Cancelled orders cannot be reopened. Ask the customer to place a new order.');
    let pay = body.payment_status === undefined ? o.payment_status : body.payment_status;
    if (!PAY_STATUSES.includes(pay)) throw bad('Invalid payment status');
    if (status === 'delivered' && o.payment_method === 'cod' && pay === 'pending') pay = 'paid';

    let restocked = o.restocked;
    if (status === 'cancelled' && !o.restocked) {
      for (const it of db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(id)) {
        if (it.product_id) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').run(it.qty, it.product_id);
      }
      restocked = 1;
    }
    db.prepare(`UPDATE orders SET status=?, payment_status=?, supplier_ordered=?, courier=?, tracking_no=?, notes=?, restocked=?, updated_at=datetime('now') WHERE id=?`)
      .run(status, pay,
        body.supplier_ordered === undefined ? o.supplier_ordered : (body.supplier_ordered ? 1 : 0),
        body.courier === undefined ? o.courier : optStr(body.courier, 60, 'Courier'),
        body.tracking_no === undefined ? o.tracking_no : optStr(body.tracking_no, 60, 'Tracking number'),
        body.notes === undefined ? o.notes : optStr(body.notes, 1000, 'Notes'),
        restocked, id);
    return orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(id), true);
  });
}, { admin: true });

/* ---- admin: settings ---- */
route('GET', '/api/admin/settings', () => ({
  settings: D.getSettings(),
  razorpay_configured: !!(RZP_KEY_ID && RZP_KEY_SECRET)
}), { admin: true });
route('PUT', '/api/admin/settings', ({ body }) => {
  const clean = {};
  const num = (k, min, max) => { const n = Number(body[k]); if (!Number.isInteger(n) || n < min || n > max) throw bad(`${k.replace(/_/g, ' ')} must be a whole number between ${min} and ${max}`); return String(n); };
  for (const k of D.SETTING_KEYS) {
    if (body[k] === undefined) continue;
    if (['shipping_fee', 'free_shipping_above', 'cod_fee'].includes(k)) clean[k] = num(k, 0, 100000);
    else if (k === 'prepaid_discount_pct') clean[k] = num(k, 0, 50);
    else if (k === 'return_window_days') clean[k] = num(k, 0, 60);
    else if (k === 'cod_enabled') clean[k] = body[k] ? '1' : '0';
    else if (k === 'whatsapp') { const d = String(body[k]).replace(/\D/g, ''); if (d && (d.length < 11 || d.length > 14)) throw bad('WhatsApp number needs country code, e.g. 919876543210'); clean[k] = d; }
    else if (k === 'upi_id') { const u = String(body[k]).trim(); if (u && !/^[\w.\-]{2,64}@[A-Za-z]{2,32}$/.test(u)) throw bad('UPI ID looks invalid (example: name@okbank)'); clean[k] = u; }
    else clean[k] = optStr(body[k], k === 'business_address' ? 400 : 200, k.replace(/_/g, ' '));
  }
  D.setSettings(clean);
  return { ok: true };
}, { admin: true });

/* ---------------- static files ---------------- */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; " +
    "connect-src 'self' https://lumberjack.razorpay.com; form-action 'self'; base-uri 'self'; frame-ancestors 'none'");
}

/* ---------------- request handler ---------------- */
async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/') && pathname !== '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, pathname);
  }

  try {
    // CSRF defence in depth: state-changing calls must be same-origin JSON
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let oh = ''; try { oh = new URL(origin).host; } catch (_) { /* bad origin */ }
        if (oh !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
      }
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw bad('Content-Type must be application/json');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      let admin = null;
      if (r.admin) { admin = getAdmin(req); if (!admin) throw new HttpError(401, 'Please log in'); }
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      const out = await r.handler({ req, res, params, query: Object.fromEntries(url.searchParams), body, ip: clientIp(req), admin });
      if (out === undefined) return; // handler wrote the response itself
      return send(res, 200, out);
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error('Unhandled error:', e);
    return send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
}

/* ---------------- start ---------------- */
ensureAdmin();
if (process.env.SEED !== '0') D.seed();

const server = http.createServer((req, res) => { handle(req, res); });
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(PORT, () => {
  console.log(`Store running on http://localhost:${PORT}  (admin: /admin/)`);
  if (!(RZP_KEY_ID && RZP_KEY_SECRET)) console.log('Razorpay: not configured (COD and UPI still work)');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
