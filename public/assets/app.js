(() => {
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } };
const ssGet = (k, d) => { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } };

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : (method === 'GET' ? undefined : '{}')
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

let store = null;           // { settings, categories }
const app = $('#app');

/* ---------- cart (display data only; the server recomputes prices) ---------- */
let cart = lsGet('gg_cart_v1', []).filter((i) => Number.isInteger(i.id) && i.qty > 0);
const cartCount = () => cart.reduce((s, i) => s + i.qty, 0);
function saveCart() {
  lsSet('gg_cart_v1', cart);
  const b = $('#cart-badge'); b.textContent = cartCount(); b.dataset.n = cartCount();
}
function addToCart(id, qty = 1) {
  const it = cart.find((i) => i.id === id);
  if (it) it.qty = Math.min(10, it.qty + qty); else cart.push({ id, qty: Math.min(10, qty) });
  saveCart();
}
function setQty(id, qty) {
  const it = cart.find((i) => i.id === id);
  if (!it) return;
  if (qty < 1) cart = cart.filter((i) => i.id !== id); else it.qty = Math.min(10, qty);
  saveCart();
}

/* ---------- toast ---------- */
let toastTimer;
function toast(html, ms = 3500) {
  const t = $('#toast'); t.innerHTML = html; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- shared view pieces ---------- */
const offPct = (p) => (p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0);

function thumb(p, withRibbon = true) {
  const t = 't' + ((p.category_id || 0) % 6);
  const off = offPct(p);
  const inner = p.image
    ? `<img src="${esc(p.image)}" alt="" loading="lazy" data-fallback="${esc(p.icon)}">`
    : `<span class="ph" aria-hidden="true">${esc(p.icon)}</span>`;
  return `<div class="thumb ${t}">${inner}${withRibbon && off ? `<span class="ribbon">${off}% off</span>` : ''}</div>`;
}

function card(p) {
  const note = !p.in_stock ? '' : (p.low_stock ? `<span class="lowstock">Only ${p.low_stock} left</span>` : '');
  return `<article class="card">
    <a class="card-link" href="#/product/${esc(p.slug)}">
      ${thumb(p)}
      <div class="card-body">
        <span class="card-cat">${esc(p.category)}</span>
        <span class="card-name">${esc(p.name)}</span>
        <div class="card-price"><span class="tag">${inr(p.price)}</span>${p.mrp > p.price ? `<span class="mrp">${inr(p.mrp)}</span>` : ''}</div>
        ${note}
      </div>
    </a>
    <div class="card-foot">${p.in_stock ? `<button class="btn btn-block btn-sm" data-add="${p.id}" type="button">Add to cart</button>` : '<span class="soldout">Out of stock</span>'}</div>
  </article>`;
}

function setTitle(t) {
  const n = store ? store.settings.store_name : 'Store';
  document.title = t ? `${t} | ${n}` : n;
}

function calcTotals(items, method) {
  const S = store.settings;
  const subtotal = items.reduce((s, i) => s + i.p.price * i.qty, 0);
  const shipping = subtotal >= S.free_shipping_above ? 0 : S.shipping_fee;
  const cod = method === 'cod' ? S.cod_fee : 0;
  const discount = method && method !== 'cod' ? Math.round((subtotal * S.prepaid_discount_pct) / 100) : 0;
  return { subtotal, shipping, cod, discount, total: subtotal + shipping + cod - discount };
}
function sumRows(t) {
  return `<div class="sum-row"><span>Items</span><span>${inr(t.subtotal)}</span></div>
    <div class="sum-row"><span>Shipping</span><span>${t.shipping ? inr(t.shipping) : 'Free'}</span></div>
    ${t.cod ? `<div class="sum-row"><span>Cash on Delivery fee</span><span>${inr(t.cod)}</span></div>` : ''}
    ${t.discount ? `<div class="sum-row"><span>Online payment discount</span><span>- ${inr(t.discount)}</span></div>` : ''}
    <div class="sum-row sum-total"><span>Total</span><span>${inr(t.total)}</span></div>`;
}

/* ---------- pages ---------- */
async function home() {
  const [feat, latest] = await Promise.all([api('/api/products?featured=1'), api('/api/products?sort=new')]);
  const S = store.settings;
  const pays = [S.cod_enabled && 'cash on delivery', S.upi_enabled && 'UPI', S.online_enabled && 'card or net banking'].filter(Boolean);
  const payLine = pays.length ? `Pay by ${pays.join(', ').replace(/, ([^,]*)$/, ' or $1')}.` : '';
  const tags = feat.slice(0, 3).map((p) => `
    <a class="hero-tag" href="#/product/${esc(p.slug)}">
      <div class="big-icon" aria-hidden="true">${esc(p.icon)}</div>
      <div class="nm">${esc(p.name)}</div>
      <span class="tag">${inr(p.price)}</span>
    </a>`).join('');
  const shelf = store.categories.map((c) => `<a href="#/shop?category=${esc(c.slug)}"><span class="ic" aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}</a>`).join('');
  const trust = [
    S.cod_enabled && `<div><b>Pay on delivery</b><span class="small muted">Cash on delivery for ${S.cod_fee ? inr(S.cod_fee) + ' extra' : 'no extra fee'}.</span></div>`,
    `<div><b>Delivery in ${esc(S.delivery_estimate)}</b><span class="small muted">Tracking details appear on your order page once shipped.</span></div>`,
    Number(S.return_window_days) > 0 && `<div><b>${esc(S.return_window_days)}-day returns</b><span class="small muted">For damaged, defective or wrong items.</span></div>`,
    (S.whatsapp || S.support_email) && `<div><b>Help when you need it</b><span class="small muted">${S.whatsapp ? 'Message us on WhatsApp.' : 'Email our support team.'}</span></div>`
  ].filter(Boolean).join('');
  setTitle('');
  return `
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <h1>Smart gadgets without the showroom markup</h1>
      <p class="lead">Earbuds, smartwatches, chargers and smart-home basics, shipped across India. ${esc(payLine)}</p>
      <form class="hero-search" id="hero-search-form" role="search">
        <label class="sr-only" for="hq">Search gadgets</label>
        <input id="hq" name="q" type="search" placeholder="What are you looking for?" autocomplete="off">
        <button type="submit">Search</button>
      </form>
    </div>
    <div class="hero-tags" aria-label="Popular products">${tags}</div>
  </div></section>
  <section class="section"><div class="wrap"><div class="shelf">${shelf}</div></div></section>
  ${feat.length ? `<section class="section"><div class="wrap">
    <div class="section-head"><h2>Popular right now</h2><a href="#/shop">See all gadgets</a></div>
    <div class="grid">${feat.slice(0, 8).map(card).join('')}</div></div></section>` : ''}
  <section class="section"><div class="wrap">
    <div class="section-head"><h2>New in the store</h2><a href="#/shop?sort=new">Browse everything</a></div>
    <div class="grid">${latest.slice(0, 8).map(card).join('')}</div></div></section>
  <section class="section"><div class="wrap"><div class="trust">${trust}</div></div></section>`;
}

async function shop(q) {
  const params = new URLSearchParams();
  if (q.category) params.set('category', q.category);
  if (q.q) params.set('q', q.q);
  if (q.sort) params.set('sort', q.sort);
  const list = await api('/api/products?' + params);
  const cat = store.categories.find((c) => c.slug === q.category);
  const title = q.q ? `Results for "${q.q}"` : (cat ? cat.name : 'All gadgets');
  setTitle(title);
  const keep = (extra) => { const p = new URLSearchParams(); if (q.q) p.set('q', q.q); if (q.sort) p.set('sort', q.sort); Object.entries(extra).forEach(([k, v]) => v && p.set(k, v)); const s = p.toString(); return '#/shop' + (s ? '?' + s : ''); };
  const chips = [`<a class="chip" href="${keep({})}" ${!q.category ? 'aria-current="true"' : ''}>All</a>`]
    .concat(store.categories.map((c) => `<a class="chip" href="${keep({ category: c.slug })}" ${q.category === c.slug ? 'aria-current="true"' : ''}>${esc(c.name)}</a>`)).join('');
  const sorts = [['', 'Featured first'], ['new', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']]
    .map(([v, l]) => `<option value="${v}" ${(q.sort || '') === v ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="wrap section">
    <h1 style="font-size:clamp(1.6rem,4vw,2.4rem);margin-bottom:1rem">${esc(title)}</h1>
    <div class="toolbar">
      <div class="chips" role="navigation" aria-label="Categories">${chips}</div>
      <label class="muted small" for="sort">Sort by</label>
      <select id="sort" data-sort>${sorts}</select>
      <span class="muted small">${list.length} ${list.length === 1 ? 'product' : 'products'}</span>
    </div>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>`
      : `<div class="empty"><h2>Nothing found</h2><p class="muted">Try a shorter search or pick another category.</p><a class="btn" href="#/shop">Show all gadgets</a></div>`}
  </div>`;
}

async function product(slug) {
  const { product: p, related } = await api('/api/products/' + encodeURIComponent(slug));
  const S = store.settings;
  setTitle(p.name);
  document.body.classList.toggle('has-sticky', p.in_stock);
  const imgs = p.images || [];
  const main = imgs[0] ? `<img id="main-img" src="${esc(imgs[0])}" alt="${esc(p.name)}" data-fallback="${esc(p.icon)}">` : `<span class="ph" aria-hidden="true">${esc(p.icon)}</span>`;
  const thumbs = imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button type="button" data-img="${esc(u)}" aria-label="Show image ${i + 1}" ${i === 0 ? 'aria-current="true"' : ''}><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : '';
  const off = offPct(p);
  const assure = [
    `<div><span aria-hidden="true">🚚</span><span>Delivery in ${esc(S.delivery_estimate)}. Shipping ${S.shipping_fee ? inr(S.shipping_fee) : 'free'}${S.free_shipping_above ? `, free above ${inr(S.free_shipping_above)}` : ''}.</span></div>`,
    S.cod_enabled && `<div><span aria-hidden="true">💵</span><span>Cash on Delivery available${S.cod_fee ? ` (${inr(S.cod_fee)} fee)` : ''}.</span></div>`,
    Number(S.return_window_days) > 0 && `<div><span aria-hidden="true">↩️</span><span>${esc(S.return_window_days)}-day return for damaged, defective or wrong items. <a href="#/page/returns">Return policy</a></span></div>`
  ].filter(Boolean).join('');
  const buy = p.in_stock ? `
    <div class="buy-row">
      <div class="qty" role="group" aria-label="Quantity">
        <button type="button" data-qty-step="-1" aria-label="Decrease quantity">−</button>
        <output id="pdp-qty" aria-live="polite">1</output>
        <button type="button" data-qty-step="1" aria-label="Increase quantity">+</button>
      </div>
      <button class="btn btn-ghost" type="button" data-add="${p.id}" data-qty-from="pdp-qty">Add to cart</button>
      <button class="btn" type="button" data-buy="${p.id}" data-qty-from="pdp-qty">Buy now</button>
    </div>` : '<p class="soldout">This product is out of stock right now.</p>';
  return `<div class="wrap">
    <div class="crumbs"><a href="#/">Home</a> / <a href="#/shop${p.category_slug ? '?category=' + esc(p.category_slug) : ''}">${esc(p.category || 'Shop')}</a></div>
    <div class="pdp">
      <div class="gallery"><div class="main t${(p.category_id || 0) % 6}" id="gallery-main">${main}</div>${thumbs}</div>
      <div>
        <h1>${esc(p.name)}</h1>
        <div class="price-row"><span class="tag tag-lg">${inr(p.price)}</span>${p.mrp > p.price ? `<span class="mrp">${inr(p.mrp)}</span><span class="off">${off}% off</span>` : ''}</div>
        ${p.low_stock ? `<p class="lowstock">Only ${p.low_stock} left in stock</p>` : ''}
        ${p.highlights.length ? `<ul class="points">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${buy}
        <div class="assure">${assure}</div>
      </div>
    </div>
    ${p.description ? `<section class="section"><h2>About this product</h2><p class="desc" style="margin-top:.6rem">${esc(p.description)}</p></section>` : ''}
    ${related.length ? `<section class="section"><h2 style="margin-bottom:1rem">You may also like</h2><div class="grid">${related.map(card).join('')}</div></section>` : ''}
  </div>
  ${p.in_stock ? `<div class="sticky-bar"><span class="tag">${inr(p.price)}</span><button class="btn" type="button" data-add="${p.id}" data-qty-from="pdp-qty">Add to cart</button></div>` : ''}`;
}

async function cartItems() {
  if (!cart.length) return [];
  const all = await api('/api/products');
  const map = new Map(all.map((p) => [p.id, p]));
  const before = cart.length;
  cart = cart.filter((i) => map.has(i.id) && map.get(i.id).in_stock);
  if (cart.length !== before) { saveCart(); toast('Some items in your cart are no longer available and were removed.', 5000); }
  return cart.map((i) => ({ p: map.get(i.id), qty: i.qty }));
}

async function cartPage() {
  setTitle('Your cart');
  const items = await cartItems();
  if (!items.length) {
    return `<div class="wrap section"><div class="empty"><h2>Your cart is empty</h2><p class="muted">Add a gadget and it will show up here.</p><a class="btn" href="#/shop">Start shopping</a></div></div>`;
  }
  const t = calcTotals(items, null);
  const S = store.settings;
  const need = S.free_shipping_above - t.subtotal;
  const rows = items.map(({ p, qty }) => `
    <div class="line-item">
      ${thumb(p, false)}
      <div>
        <h3><a href="#/product/${esc(p.slug)}">${esc(p.name)}</a></h3>
        <div class="line-meta">
          <div class="qty" role="group" aria-label="Quantity for ${esc(p.name)}">
            <button type="button" data-cart-step="${p.id}:-1" aria-label="Decrease quantity">−</button>
            <output>${qty}</output>
            <button type="button" data-cart-step="${p.id}:1" aria-label="Increase quantity">+</button>
          </div>
          <strong>${inr(p.price * qty)}</strong>
          <button class="link-btn" type="button" data-remove="${p.id}">Remove</button>
        </div>
      </div>
    </div>`).join('');
  return `<div class="wrap"><h1 style="font-size:clamp(1.6rem,4vw,2.4rem);padding:1.2rem 0">Your cart</h1>
    <div class="cart-grid">
      <div>${rows}</div>
      <aside class="summary">
        <h2>Order summary</h2>
        ${need > 0 ? `<div class="free-note">Add ${inr(need)} more to get free shipping.</div>` : `<div class="free-note ok">You get free shipping on this order.</div>`}
        ${sumRows(t)}
        <p class="small muted" style="margin:.6rem 0">${S.cod_enabled && S.cod_fee ? `Cash on Delivery adds ${inr(S.cod_fee)}. ` : ''}Final total is shown at checkout.</p>
        <a class="btn btn-block" href="#/checkout">Go to checkout</a>
      </aside>
    </div></div>`;
}

const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
let checkoutItems = [];

async function checkout() {
  setTitle('Checkout');
  checkoutItems = await cartItems();
  if (!checkoutItems.length) { location.hash = '#/cart'; return ''; }
  const S = store.settings;
  const c = lsGet('gg_customer', {});
  const methods = [];
  if (S.cod_enabled) methods.push(['cod', 'Cash on Delivery', `Pay in cash when the order arrives.${S.cod_fee ? ` ${inr(S.cod_fee)} extra.` : ''} We may confirm your order by phone or WhatsApp first.`]);
  if (S.upi_enabled) methods.push(['upi', 'UPI', `Pay with any UPI app after placing the order.${S.prepaid_discount_pct ? ` Save ${S.prepaid_discount_pct}%.` : ''}`]);
  if (S.online_enabled) methods.push(['online', 'Cards, net banking and wallets', `Secure online payment.${S.prepaid_discount_pct ? ` Save ${S.prepaid_discount_pct}%.` : ''}`]);
  if (!methods.length) return `<div class="wrap section"><div class="empty"><h2>Checkout is not available yet</h2><p class="muted">The store has no payment method turned on. Please come back soon.</p></div></div>`;
  const first = methods[0][0];
  const field = (name, label, attrs = '', val = '', hint = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(val)}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  return `<div class="wrap"><h1 style="font-size:clamp(1.6rem,4vw,2.4rem);padding:1.2rem 0">Checkout</h1>
    <form id="checkout-form" class="checkout-grid" novalidate>
      <div>
        <div class="alert alert-err" id="form-error" role="alert"></div>
        <section class="panel"><h2>Delivery details</h2>
          <div class="grid2">
            ${field('name', 'Full name', 'required autocomplete="name" maxlength="80"', c.name)}
            ${field('phone', 'Mobile number', 'required inputmode="numeric" autocomplete="tel" maxlength="14"', c.phone, 'We call or message this number about your delivery.')}
          </div>
          ${field('email', 'Email (optional)', 'type="email" autocomplete="email" maxlength="120"', c.email)}
          <label class="field"><span>Full address</span><textarea name="address" rows="3" required maxlength="300" autocomplete="street-address">${esc(c.address || '')}</textarea><small>House or flat number, street, landmark.</small></label>
          <div class="grid2">
            ${field('city', 'City', 'required autocomplete="address-level2" maxlength="60"', c.city)}
            <label class="field"><span>State</span><select name="state" required autocomplete="address-level1"><option value="">Select state</option>${STATES.map((s) => `<option ${c.state === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          </div>
          ${field('pincode', 'Pincode', 'required inputmode="numeric" maxlength="6" autocomplete="postal-code"', c.pincode)}
        </section>
        <section class="panel"><h2>Payment</h2>
          ${methods.map(([v, t, d], i) => `<label class="pay-opt"><input type="radio" name="payment_method" value="${v}" ${i === 0 ? 'checked' : ''}><span><b>${t}</b><span class="small muted">${d}</span></span></label>`).join('')}
        </section>
      </div>
      <aside class="summary">
        <h2>Your order</h2>
        ${checkoutItems.map(({ p, qty }) => `<div class="mini-item"><span>${esc(p.name)} x ${qty}</span><span>${inr(p.price * qty)}</span></div>`).join('')}
        <div id="sum" style="margin-top:.6rem">${sumRows(calcTotals(checkoutItems, first))}</div>
        <button class="btn btn-block" type="submit" id="place-btn" style="margin-top:.9rem">Place order</button>
        <p class="small muted" style="margin:.7rem 0 0">By placing this order you agree to our <a href="#/page/terms">terms</a>, <a href="#/page/returns">return policy</a> and <a href="#/page/privacy">privacy policy</a>.</p>
      </aside>
    </form></div>`;
}

/* ---------- Razorpay ---------- */
function loadRzp() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not open the payment window. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}
async function payOnline(orderNo, phone) {
  const c = await api('/api/payments/razorpay/create', { method: 'POST', body: { order_no: orderNo, phone } });
  await loadRzp();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: c.key, amount: c.amount, currency: 'INR', name: store.settings.store_name, order_id: c.razorpay_order_id,
      prefill: { contact: phone }, theme: { color: '#2438E8' },
      handler: async (r) => {
        try {
          await api('/api/payments/razorpay/verify', { method: 'POST', body: { order_no: orderNo, phone, razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature } });
          resolve('paid');
        } catch (e) { toast(esc(e.message), 6000); resolve('error'); }
      },
      modal: { ondismiss: () => resolve('dismissed') }
    });
    rzp.on('payment.failed', () => toast('Payment failed. You can try again from your order page.', 6000));
    rzp.open();
  });
}

/* ---------- order + tracking ---------- */
const STEPS = [['new', 'Placed'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']];
const STATUS_TEXT = { new: 'Order received', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'Returned to seller' };

function payHtml(o) {
  const S = store.settings;
  if (o.payment_status === 'paid') return `<div class="alert alert-ok">Payment received. Thank you.</div>`;
  if (o.payment_status === 'refunded') return `<div class="alert alert-info">This order was refunded.</div>`;
  if (['cancelled', 'rto'].includes(o.status)) return '';
  if (o.payment_method === 'cod') return `<div class="alert alert-info">Pay ${inr(o.total)} in cash when your order arrives. We may call or message you to confirm the order before it ships.</div>`;
  if (o.payment_method === 'online') return `<div class="panel"><h2>Complete your payment</h2><p>Your order is saved. Pay ${inr(o.total)} to confirm it.</p><button class="btn" type="button" data-pay-online>Pay ${inr(o.total)} now</button></div>`;
  if (o.payment_method === 'upi') {
    if (o.payment_status === 'verifying') return `<div class="alert alert-info">We received your payment reference. We'll confirm your order once the payment shows in our account.</div>`;
    const link = `upi://pay?pa=${encodeURIComponent(S.upi_id)}&pn=${encodeURIComponent(S.store_name)}&am=${Number(o.total).toFixed(2)}&cu=INR&tn=${encodeURIComponent(o.order_no)}`;
    return `<div class="panel"><h2>Pay ${inr(o.total)} with UPI</h2>
      <div class="upi-box">
        <p class="small muted" style="margin-bottom:.3rem">UPI ID</p>
        <div class="copy-row"><span class="upi-id">${esc(S.upi_id)}</span><button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(S.upi_id)}">Copy</button></div>
      </div>
      <p><a class="btn" href="${esc(link)}">Open UPI app</a></p>
      <p class="small muted">On a computer, send the exact amount to the UPI ID above from your phone. Add <b>${esc(o.order_no)}</b> as the note.</p>
      <form id="utr-form" style="margin-top:1rem">
        <div class="alert alert-err" id="utr-error" role="alert"></div>
        <label class="field"><span>After paying, enter the UTR or transaction ID</span><input name="utr" required minlength="8" maxlength="22" autocomplete="off" placeholder="12-digit UTR from your UPI app"></label>
        <button class="btn" type="submit">Submit payment reference</button>
      </form></div>`;
  }
  return '';
}

function orderHtml(o, fresh) {
  const S = store.settings;
  const idx = STEPS.findIndex(([k]) => k === o.status);
  const dead = ['cancelled', 'rto'].includes(o.status);
  const good = o.status === 'delivered';
  const wa = S.whatsapp ? `<a class="btn btn-ghost btn-sm" href="https://wa.me/${esc(S.whatsapp)}?text=${encodeURIComponent('Hi, I need help with order ' + o.order_no)}" rel="noopener">Ask about this order on WhatsApp</a>` : '';
  return `<div class="wrap prose" style="max-width:52rem">
    <div class="order-head">
      <h1 style="margin:0 0 .5rem">${fresh ? 'Thank you, your order is placed' : 'Your order'}</h1>
      <div class="copy-row"><span class="order-no">${esc(o.order_no)}</span><button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(o.order_no)}">Copy</button>
        <span class="status-pill ${good ? 'good' : (dead ? 'badp' : '')}">${esc(STATUS_TEXT[o.status] || o.status)}</span></div>
      ${fresh ? `<p class="muted" style="margin-top:.7rem">Keep this order number. You need it with your mobile number to <a href="#/track">track your order</a>.</p>` : ''}
    </div>
    ${dead ? '' : `<ol class="steps" aria-label="Order progress">${STEPS.map(([k, l], i) => `<li class="${i <= idx ? 'done' : ''}" ${i === idx ? 'aria-current="step"' : ''}>${l}</li>`).join('')}</ol>`}
    ${payHtml(o)}
    ${o.tracking_no ? `<section class="panel"><h2>Shipment</h2><dl class="kv"><dt>Courier</dt><dd>${esc(o.courier || 'Courier partner')}</dd><dt>Tracking number</dt><dd>${esc(o.tracking_no)} <button class="link-btn" type="button" data-copy="${esc(o.tracking_no)}">Copy</button></dd></dl><p class="small muted" style="margin:.7rem 0 0">Use the tracking number on the courier's website or app. Updates may take some hours to appear.</p></section>` : ''}
    <section class="panel"><h2>Items</h2>
      ${o.items.map((i) => `<div class="mini-item"><span>${esc(i.icon)} ${esc(i.name)} x ${i.qty}</span><span>${inr(i.price * i.qty)}</span></div>`).join('')}
      <div style="margin-top:.6rem">${sumRows({ subtotal: o.subtotal, shipping: o.shipping, cod: o.cod_fee, discount: o.discount, total: o.total })}</div>
    </section>
    <section class="panel"><h2>Delivering to</h2><p style="margin:0">${esc(o.name)}, ${esc(o.city)}, ${esc(o.state)} - ${esc(o.pincode)}</p>
      <p class="small muted" style="margin:.4rem 0 0">Expected delivery: ${esc(S.delivery_estimate)} after your order is confirmed.</p></section>
    <p>${wa}</p>
    <p><a href="#/shop">Continue shopping</a></p>
  </div>`;
}

function rememberOrder(no, phone) { const m = ssGet('gg_orders', {}); m[no] = phone; ssSet('gg_orders', m); }

async function orderPage(no) {
  no = String(no).toUpperCase();
  setTitle('Order ' + no);
  const phone = ssGet('gg_orders', {})[no];
  if (!phone) { location.hash = '#/track?order_no=' + encodeURIComponent(no); return ''; }
  try {
    const o = await api(`/api/orders/track?order_no=${encodeURIComponent(no)}&phone=${encodeURIComponent(phone)}`);
    return orderHtml(o, ssGet('gg_fresh', '') === no && !o.tracking_no && o.status === 'new');
  } catch (e) {
    return `<div class="wrap section"><div class="empty"><h2>We couldn't open this order</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/track?order_no=${encodeURIComponent(no)}">Check order details again</a></div></div>`;
  }
}

function trackPage(q) {
  setTitle('Track your order');
  return `<div class="wrap prose"><h1>Track your order</h1>
    <p class="muted">Enter the order number from your confirmation and the mobile number you used.</p>
    <form id="track-form" class="panel">
      <div class="alert alert-err" id="track-error" role="alert"></div>
      <label class="field"><span>Order number</span><input name="order_no" required value="${esc(q.order_no || '')}" placeholder="GG-XXXXXX" autocapitalize="characters" autocomplete="off" maxlength="20"></label>
      <label class="field"><span>Mobile number</span><input name="phone" required inputmode="numeric" autocomplete="tel" maxlength="14"></label>
      <button class="btn" type="submit">Track order</button>
    </form></div>`;
}

/* ---------- policy pages ---------- */
function policyPage(slug) {
  const S = store.settings;
  const contact = [S.support_email && `Email: <a href="mailto:${esc(S.support_email)}">${esc(S.support_email)}</a>`, S.support_phone && `Phone: ${esc(S.support_phone)}`, S.whatsapp && `WhatsApp: <a href="https://wa.me/${esc(S.whatsapp)}" rel="noopener">message us</a>`, S.business_address && `Address: ${esc(S.business_address)}`].filter(Boolean);
  const contactBlock = contact.length ? `<ul>${contact.map((c) => `<li>${c}</li>`).join('')}</ul>` : '<p>Contact details will be added soon.</p>';
  const days = Number(S.return_window_days);
  const pages = {
    shipping: ['Shipping policy', `
      <p>We ship across India through our courier and fulfilment partners. Your order is packed and dispatched from a partner warehouse, so it may not come from the same place as other items in your cart.</p>
      <h2>Delivery time</h2><p>Most orders arrive in <b>${esc(S.delivery_estimate)}</b> after the order is confirmed. Remote areas can take longer. Items in one order can arrive in separate parcels.</p>
      <h2>Shipping charges</h2><p>Shipping is ${S.shipping_fee ? inr(S.shipping_fee) : 'free'}${S.free_shipping_above ? ` and free on orders of ${inr(S.free_shipping_above)} or more` : ''}.${S.cod_enabled && S.cod_fee ? ` Cash on Delivery orders have an extra ${inr(S.cod_fee)} handling fee.` : ''}</p>
      <h2>Tracking</h2><p>Once your order ships, the courier name and tracking number appear on your <a href="#/track">order page</a>.</p>
      <h2>Cash on Delivery</h2><p>We may call or message you to confirm a Cash on Delivery order before it ships. If we cannot reach you, we may cancel the order.</p>
      <h2>If we cannot deliver</h2><p>If a courier cannot reach your pincode, we will contact you and refund any amount you paid.</p>`],
    returns: ['Returns and refunds', `
      <p>${days > 0 ? `You can ask for a return or replacement within <b>${days} days</b> of delivery if your item is damaged, defective or not what you ordered.` : 'Please contact us as soon as you receive a damaged, defective or wrong item.'}</p>
      <h2>How to ask for a return</h2><ul><li>Contact us with your order number and a short description of the problem.</li><li>Share clear photos or an unboxing video that shows the issue.</li><li>Keep the product, accessories and packaging until we reply.</li></ul>
      <h2>What we can accept</h2><p>Items that are damaged on arrival, not working, or different from what you ordered. We cannot accept items that were used incorrectly, physically damaged after delivery, or returned without their accessories.</p>
      <h2>Refunds</h2><p>After we approve a return, we send a replacement or refund your money to the original payment method. For Cash on Delivery orders we refund by bank transfer or UPI, so we will ask for your details. We will tell you the expected refund time when we approve your request.</p>
      <h2>Contact us</h2>${contactBlock}`],
    privacy: ['Privacy policy', `
      <p>We collect only what we need to take and deliver your order.</p>
      <h2>What we collect</h2><ul><li>Your name, mobile number, email (if you give one) and delivery address.</li><li>Your order details and payment status.</li></ul>
      <h2>How we use it</h2><p>To confirm and deliver your order, tell you about its progress and help you if something goes wrong. We share your name, phone number and address with courier and fulfilment partners so they can deliver it.</p>
      <h2>Payments</h2><p>Online payments are handled by our payment provider. We do not see or store your card details. For UPI payments we store the transaction reference you give us.</p>
      <h2>Your device</h2><p>Your browser stores your cart and, to save you typing, your last delivery details. You can clear them from your browser settings.</p>
      <h2>Your choices</h2><p>To see, correct or delete your data, contact us.</p>${contactBlock}`],
    terms: ['Terms of service', `
      <p>By placing an order on ${esc(S.store_name)} you agree to these terms.</p>
      <h2>Orders and prices</h2><p>All prices are in Indian rupees. An order is confirmed only after we accept it. If a price or stock detail is wrong, we may cancel the order and refund any payment.</p>
      <h2>Product information</h2><p>Photos and descriptions are for guidance. Colours, packaging and minor details can differ slightly.</p>
      <h2>Delivery and returns</h2><p>See our <a href="#/page/shipping">shipping policy</a> and <a href="#/page/returns">returns policy</a>.</p>
      <h2>Liability</h2><p>Our liability for any order is limited to the amount you paid for it.</p>
      <h2>Governing law</h2><p>These terms are governed by the laws of India.</p>`],
    contact: ['Contact us', `<p>We're here to help with orders, deliveries and returns. Please keep your order number ready.</p>${contactBlock}`]
  };
  const pg = pages[slug];
  if (!pg) return notFound();
  setTitle(pg[0]);
  return `<div class="wrap prose"><h1>${pg[0]}</h1>${pg[1]}</div>`;
}

function notFound() {
  setTitle('Page not found');
  return `<div class="wrap section"><div class="empty"><h2>We can't find that page</h2><p class="muted">The link may be old or mistyped.</p><a class="btn" href="#/">Go to the home page</a></div></div>`;
}

/* ---------- router ---------- */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { path: path || '', q: Object.fromEntries(new URLSearchParams(qs || '')) };
}
let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const { path, q } = parseHash();
  document.body.classList.remove('has-sticky');
  app.innerHTML = '<div class="wrap section"><div class="skeleton" style="height:320px"></div></div>';
  let html;
  try {
    let m;
    if (path === '') html = await home();
    else if (path === 'shop') html = await shop(q);
    else if ((m = path.match(/^product\/([^/]+)$/))) html = await product(decodeURIComponent(m[1]));
    else if (path === 'cart') html = await cartPage();
    else if (path === 'checkout') html = await checkout();
    else if (path === 'track') html = trackPage(q);
    else if ((m = path.match(/^order\/([^/]+)$/))) html = await orderPage(decodeURIComponent(m[1]));
    else if ((m = path.match(/^page\/([a-z-]+)$/))) html = policyPage(m[1]);
    else html = notFound();
  } catch (e) {
    html = `<div class="wrap section"><div class="empty"><h2>${/not found/i.test(e.message) ? "We can't find that product" : 'Something went wrong'}</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/shop">Browse the shop</a></div></div>`;
  }
  if (token !== renderToken) return; // a newer navigation took over
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* ---------- global events ---------- */
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.dataset.fallback !== undefined) {
    const span = document.createElement('span'); span.className = 'ph'; span.textContent = t.dataset.fallback || '📦'; span.setAttribute('aria-hidden', 'true');
    t.replaceWith(span);
  }
}, true);

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-add],[data-buy],[data-qty-step],[data-cart-step],[data-remove],[data-img],[data-copy],[data-pay-online]');
  if (!el) return;
  const qtyOf = (btn) => { const out = btn.dataset.qtyFrom && document.getElementById(btn.dataset.qtyFrom); return out ? Number(out.textContent) || 1 : 1; };
  if (el.dataset.add) {
    addToCart(Number(el.dataset.add), qtyOf(el));
    toast('Added to cart. <a href="#/cart">View cart</a>');
  } else if (el.dataset.buy) {
    addToCart(Number(el.dataset.buy), qtyOf(el)); location.hash = '#/checkout';
  } else if (el.dataset.qtyStep) {
    const out = $('#pdp-qty'); out.textContent = Math.max(1, Math.min(10, Number(out.textContent) + Number(el.dataset.qtyStep)));
  } else if (el.dataset.cartStep) {
    const [id, d] = el.dataset.cartStep.split(':').map(Number);
    const it = cart.find((i) => i.id === id); if (it) setQty(id, it.qty + d);
    render();
  } else if (el.dataset.remove) {
    setQty(Number(el.dataset.remove), 0); render();
  } else if (el.dataset.img) {
    const main = $('#gallery-main'); main.innerHTML = `<img id="main-img" src="${esc(el.dataset.img)}" alt="" data-fallback="📦">`;
    document.querySelectorAll('.thumbs button').forEach((b) => b.removeAttribute('aria-current')); el.setAttribute('aria-current', 'true');
  } else if (el.dataset.copy !== undefined) {
    try { await navigator.clipboard.writeText(el.dataset.copy); toast('Copied'); } catch (_) { toast('Press and hold the text to copy it'); }
  } else if (el.hasAttribute('data-pay-online')) {
    const no = parseHash().path.split('/')[1]; const phone = ssGet('gg_orders', {})[String(no).toUpperCase()];
    el.disabled = true;
    try { const r = await payOnline(String(no).toUpperCase(), phone); if (r === 'paid') toast('Payment received. Thank you.'); render(); }
    catch (err) { toast(esc(err.message), 6000); el.disabled = false; }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'payment_method' && checkoutItems.length) $('#sum').innerHTML = sumRows(calcTotals(checkoutItems, t.value));
  if (t.matches('[data-sort]')) { const { q } = parseHash(); const p = new URLSearchParams(q); t.value ? p.set('sort', t.value) : p.delete('sort'); location.hash = '#/shop?' + p; }
});

function showErr(id, msg) { const b = document.getElementById(id); if (b) { b.textContent = msg; b.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }

document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.id === 'search-form' || f.id === 'hero-search-form') {
    e.preventDefault();
    const v = new FormData(f).get('q').toString().trim();
    location.hash = v ? '#/shop?q=' + encodeURIComponent(v) : '#/shop';
  } else if (f.id === 'checkout-form') {
    e.preventDefault();
    const btn = $('#place-btn'); const fd = Object.fromEntries(new FormData(f));
    showErr('form-error', '');
    const phone = String(fd.phone || '').replace(/\D/g, '');
    if (!/^(91|0)?[6-9]\d{9}$/.test(phone)) return showErr('form-error', 'Enter a valid 10-digit mobile number.');
    if (!/^[1-9]\d{5}$/.test(String(fd.pincode).trim())) return showErr('form-error', 'Enter a valid 6-digit pincode.');
    for (const [k, l] of [['name', 'your name'], ['address', 'your address'], ['city', 'your city'], ['state', 'your state']]) if (!String(fd[k] || '').trim()) return showErr('form-error', `Please enter ${l}.`);
    btn.disabled = true; btn.textContent = 'Placing your order...';
    const customer = { name: fd.name, phone: fd.phone, email: fd.email, address: fd.address, city: fd.city, state: fd.state, pincode: fd.pincode };
    try {
      const r = await api('/api/orders', { method: 'POST', body: { customer, payment_method: fd.payment_method, items: checkoutItems.map((i) => ({ id: i.p.id, qty: i.qty })) } });
      lsSet('gg_customer', customer);
      rememberOrder(r.order_no, String(fd.phone)); ssSet('gg_fresh', r.order_no);
      cart = []; saveCart(); checkoutItems = [];
      location.hash = '#/order/' + r.order_no;
      if (r.payment_method === 'online') {
        try { await payOnline(r.order_no, String(fd.phone)); } catch (err) { toast(esc(err.message), 6000); }
        render();
      }
    } catch (err) { showErr('form-error', err.message); btn.disabled = false; btn.textContent = 'Place order'; }
  } else if (f.id === 'track-form') {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f)); const no = String(fd.order_no).trim().toUpperCase();
    showErr('track-error', '');
    try {
      await api(`/api/orders/track?order_no=${encodeURIComponent(no)}&phone=${encodeURIComponent(fd.phone)}`);
      rememberOrder(no, String(fd.phone)); location.hash = '#/order/' + no;
    } catch (err) { showErr('track-error', err.message); }
  } else if (f.id === 'utr-form') {
    e.preventDefault();
    const no = parseHash().path.split('/')[1].toUpperCase(); const phone = ssGet('gg_orders', {})[no];
    try { await api('/api/orders/upi-ref', { method: 'POST', body: { order_no: no, phone, utr: new FormData(f).get('utr') } }); toast('Payment reference received.'); render(); }
    catch (err) { showErr('utr-error', err.message); }
  }
});

window.addEventListener('hashchange', render);

/* ---------- boot ---------- */
function chrome() {
  const S = store.settings;
  $('#announce').textContent = S.announcement || '';
  $('#logo-text').textContent = S.store_name;
  const links = [['shop', 'Shop'], ['track', 'Track order']].map(([p, l]) => `<li><a href="#/${p}">${l}</a></li>`).join('');
  const policies = [['shipping', 'Shipping policy'], ['returns', 'Returns and refunds'], ['privacy', 'Privacy policy'], ['terms', 'Terms of service'], ['contact', 'Contact us']].map(([p, l]) => `<li><a href="#/page/${p}">${l}</a></li>`).join('');
  $('#footer').innerHTML = `<div class="wrap footer-grid">
    <div><h3>${esc(S.store_name)}</h3><p>${esc(S.tagline)}</p>${S.business_address ? `<p class="small">${esc(S.business_address)}</p>` : ''}</div>
    <div><h3>Shop</h3><ul>${links}</ul></div>
    <div><h3>Help</h3><ul>${policies}</ul></div>
    <div class="small" style="grid-column:1/-1">&copy; ${new Date().getFullYear()} ${esc(S.store_name)}. All prices in INR.</div></div>`;
  $('#wa').innerHTML = S.whatsapp ? `<a class="wa-fab" href="https://wa.me/${esc(S.whatsapp)}?text=${encodeURIComponent('Hi, I have a question')}" rel="noopener">WhatsApp us</a>` : '';
}

(async function boot() {
  saveCart();
  try {
    store = await api('/api/store');
    chrome();
    render();
  } catch (e) {
    app.innerHTML = `<div class="wrap section"><div class="empty"><h2>The store is not loading</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="/">Try again</a></div></div>`;
  }
})();
})();
