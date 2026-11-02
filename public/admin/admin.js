(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const root = $('#root');
let me = null;
let settingsCache = null;

class AuthError extends Error {}
async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : (method === 'GET' ? undefined : '{}')
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.noAuthRedirect) { me = null; showLogin(); throw new AuthError('Please log in'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

let toastTimer;
function toast(msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const fail = (e) => { if (!(e instanceof AuthError)) toast(e.message, 5000); };

const STATUS = { new: 'New', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'Returned (RTO)' };
const PAY = { pending: 'Pending', verifying: 'Verify payment', paid: 'Paid', failed: 'Failed', refunded: 'Refunded' };
const METHOD = { cod: 'Cash on Delivery', upi: 'UPI', online: 'Online (Razorpay)' };
const statusClass = (s) => (s === 'delivered' ? 'good' : (s === 'cancelled' || s === 'rto' ? 'bad' : (s === 'new' ? 'warn' : '')));
const payClass = (s) => (s === 'paid' ? 'good' : (s === 'verifying' ? 'todo' : (s === 'failed' || s === 'refunded' ? 'bad' : 'warn')));
const when = (s) => new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const pctMargin = (price, cost) => (cost == null || !price ? null : Math.round(((price - cost) / price) * 100));

/* ---------- login & shell ---------- */
function showLogin() {
  root.innerHTML = `<form class="login-box" id="login-form">
    <h1>Store admin</h1>
    <div class="alert alert-err" id="login-error" role="alert"></div>
    <label class="field"><span>Username</span><input name="username" autocomplete="username" required></label>
    <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn btn-block" type="submit">Log in</button>
  </form>`;
}

function shell() {
  root.innerHTML = `<header class="adm-bar"><div class="wrap adm-row">
      <a class="logo" href="#/"><span class="logo-mark" aria-hidden="true"></span>Admin</a>
      <nav class="adm-nav" aria-label="Admin">
        <a href="#/" data-nav="">Dashboard</a><a href="#/orders" data-nav="orders">Orders</a>
        <a href="#/products" data-nav="products">Products</a><a href="#/settings" data-nav="settings">Settings</a>
      </nav>
      <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">View store</a>
      <button class="btn btn-ghost btn-sm" type="button" id="logout">Log out</button>
    </div></header>
    <main class="wrap adm-main" id="view" tabindex="-1"></main>`;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, ''); const [path, qs] = raw.split('?');
  return { path: path || '', q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let token = 0;
async function route() {
  if (!me) return;
  const t = ++token; const { path, q } = parseHash();
  document.querySelectorAll('[data-nav]').forEach((a) => { if (a.dataset.nav === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const view = $('#view'); view.innerHTML = '<p class="muted">Loading...</p>';
  try {
    let html;
    if (path === '') html = await dashboard();
    else if (path === 'orders') html = await orders(q);
    else if (path === 'products') html = await products();
    else if (path === 'settings') html = await settings();
    else html = '<p>Page not found.</p>';
    if (t === token) view.innerHTML = html;
  } catch (e) { if (t === token) { fail(e); view.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; } }
}

/* ---------- dashboard ---------- */
async function dashboard() {
  const s = await api('/api/admin/stats');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const hit = s.days.find((x) => x.d === d);
    days.push({ d, orders: hit ? hit.orders : 0, revenue: hit ? hit.revenue : 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.orders));
  const bars = days.map((d) => `<div class="bar ${d.orders ? '' : 'zero'}" title="${esc(d.d)}: ${d.orders} orders, ${inr(d.revenue)}"><span>${d.orders}</span><i style="height:${Math.round((d.orders / max) * 100)}%"></i><span class="muted">${esc(new Date(d.d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }))}</span></div>`).join('');
  const live = s.total_orders - (s.counts.cancelled || 0) - (s.counts.rto || 0);
  return `<h1>Dashboard</h1>
    <div class="stats">
      <a class="stat ${s.to_order ? 'alert-stat' : ''}" href="#/orders?todo=supplier"><span class="n">${s.to_order}</span>Orders to place with supplier</a>
      <a class="stat ${s.to_verify ? 'alert-stat' : ''}" href="#/orders?todo=verify"><span class="n">${s.to_verify}</span>UPI payments to verify</a>
      <div class="stat"><span class="n">${live}</span>Active orders (of ${s.total_orders})</div>
      <div class="stat"><span class="n">${inr(s.revenue)}</span>Order value, excl. cancelled</div>
      <div class="stat"><span class="n">${inr(s.est_profit)}</span>Product margin (est.)</div>
    </div>
    <p class="hint" style="margin-top:-.4rem">Margin is selling price minus your supplier cost. It does not include ads, payment fees, shipping you pay the supplier, or returns.</p>
    <div class="cols">
      <section class="card-box"><h2>Orders, last 7 days</h2><div class="bars">${bars}</div></section>
      <div>
        <section class="card-box"><h2>Best sellers</h2>${s.top.length ? `<ul class="list-plain">${s.top.map((t) => `<li><span>${esc(t.name)}</span><b>${t.qty} sold</b></li>`).join('')}</ul>` : '<p class="muted">No sales yet.</p>'}</section>
        <section class="card-box"><h2>Low stock</h2>${s.low_stock.length ? `<ul class="list-plain">${s.low_stock.map((t) => `<li><span>${esc(t.name)}</span><b>${t.stock} left</b></li>`).join('')}</ul>` : '<p class="muted">Nothing is running low. Products with blank stock are not tracked.</p>'}</section>
      </div>
    </div>`;
}

/* ---------- orders ---------- */
function orderMessage(o, store) {
  const items = o.items.map((i) => `${i.name} x${i.qty}`).join(', ');
  if (o.status === 'shipped' && o.tracking_no) return `Hi ${o.name}, your order ${o.order_no} from ${store} has shipped via ${o.courier || 'our courier'}. Tracking number: ${o.tracking_no}.`;
  const pay = o.payment_method === 'cod' ? `Please keep ${inr(o.total)} ready as cash on delivery.` : '';
  return `Hi ${o.name}, this is ${store}. We received your order ${o.order_no} (${items}) for ${inr(o.total)}. Delivery to ${o.city} - ${o.pincode}. ${pay} Please reply YES to confirm your order.`.replace(/\s+/g, ' ').trim();
}
function supplierBlock(o) {
  return `${o.name}\n${o.phone}\n${o.address}\n${o.city}, ${o.state} - ${o.pincode}\n\n${o.items.map((i) => `${i.name} x ${i.qty}`).join('\n')}\nOrder ref: ${o.order_no}${o.payment_method === 'cod' ? `\nCOD amount to collect: ${o.total}` : '\nPrepaid: no cash to collect'}`;
}

function orderHtml(o, open) {
  const store = (settingsCache && settingsCache.store_name) || 'our store';
  const needsSupplier = !o.supplier_ordered && ['new', 'confirmed'].includes(o.status);
  const locked = o.status === 'cancelled';
  const wa = `https://wa.me/91${esc(o.phone)}?text=${encodeURIComponent(orderMessage(o, store))}`;
  const opt = (map, cur) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
  return `<details class="order" data-id="${o.id}" ${open ? 'open' : ''}>
    <summary>
      <span class="o-no">${esc(o.order_no)}</span>
      <span>${esc(o.name)}, ${esc(o.city)}<br><span class="muted small">${esc(o.items.map((i) => `${i.name} x${i.qty}`).join(', '))}</span></span>
      <strong>${inr(o.total)}</strong>
      <span><span class="pill ${payClass(o.payment_status)}">${esc(METHOD[o.payment_method])}: ${esc(PAY[o.payment_status])}</span></span>
      <span><span class="pill ${statusClass(o.status)}">${esc(STATUS[o.status])}</span>${needsSupplier ? ' <span class="pill todo">Order from supplier</span>' : ''}</span>
    </summary>
    <div class="order-body">
      <div>
        <h3>Customer</h3>
        <p style="margin:0 0 .8rem">${esc(o.name)}<br><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>${o.email ? `<br>${esc(o.email)}` : ''}<br>${esc(o.address)}<br>${esc(o.city)}, ${esc(o.state)} - ${esc(o.pincode)}</p>
        <div class="row-actions" style="margin-bottom:1rem">
          <a class="btn btn-sm" href="${wa}" target="_blank" rel="noopener">WhatsApp customer</a>
          <button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(supplierBlock(o))}">Copy details for supplier</button>
        </div>
        <h3>Items</h3>
        <div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Qty</th></tr></thead><tbody>
          ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${inr(i.price)}</td><td class="num">${i.cost == null ? '-' : inr(i.cost)}</td><td class="num">${i.qty}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="small muted" style="margin:.5rem 0 0">Placed ${esc(when(o.created_at))}. Items ${inr(o.subtotal)}, shipping ${inr(o.shipping)}${o.cod_fee ? `, COD fee ${inr(o.cod_fee)}` : ''}${o.discount ? `, discount ${inr(o.discount)}` : ''}. ${o.cost_known ? `Product margin ${inr(o.profit)}.` : 'Add supplier cost to products to see margin.'}</p>
        ${o.payment_ref ? `<p class="small" style="margin:.5rem 0 0"><b>Payment reference:</b> ${esc(o.payment_ref)}</p>` : ''}
      </div>
      <form data-order-form="${o.id}">
        <h3>Manage order</h3>
        ${locked ? '<div class="alert alert-info">This order is cancelled and stock was returned. It cannot be reopened.</div>' : ''}
        <label class="check"><input type="checkbox" name="supplier_ordered" ${o.supplier_ordered ? 'checked' : ''}> Ordered from supplier</label>
        <div class="form-row c2">
          <label class="field"><span>Order status</span><select name="status" ${locked ? 'disabled' : ''}>${opt(STATUS, o.status)}</select></label>
          <label class="field"><span>Payment status</span><select name="payment_status">${opt(PAY, o.payment_status)}</select></label>
        </div>
        <div class="form-row c2">
          <label class="field"><span>Courier</span><input name="courier" value="${esc(o.courier)}" maxlength="60" placeholder="Delhivery, Ekart, DTDC"></label>
          <label class="field"><span>Tracking number</span><input name="tracking_no" value="${esc(o.tracking_no)}" maxlength="60"></label>
        </div>
        <label class="field"><span>Private notes</span><textarea name="notes" rows="2" maxlength="1000">${esc(o.notes)}</textarea></label>
        <button class="btn" type="submit">Save changes</button>
      </form>
    </div></details>`;
}

async function orders(q) {
  settingsCache = settingsCache || (await api('/api/admin/settings')).settings;
  const params = new URLSearchParams();
  ['status', 'todo', 'q'].forEach((k) => q[k] && params.set(k, q[k]));
  const list = await api('/api/admin/orders?' + params);
  const tab = (label, p) => {
    const cur = (q.status || '') === (p.status || '') && (q.todo || '') === (p.todo || '');
    const qs = new URLSearchParams(p).toString();
    return `<a class="chip" href="#/orders${qs ? '?' + qs : ''}" ${cur ? 'aria-current="true"' : ''}>${label}</a>`;
  };
  return `<h1>Orders</h1>
    <div class="tabs">
      ${tab('All', {})}${tab('To order from supplier', { todo: 'supplier' })}${tab('Verify UPI payment', { todo: 'verify' })}
      ${['new', 'confirmed', 'shipped', 'delivered', 'cancelled', 'rto'].map((s) => tab(STATUS[s], { status: s })).join('')}
    </div>
    <div class="bar-tools">
      <form id="order-search" class="bar-tools" style="margin:0"><label class="sr-only" for="oq">Search orders</label>
        <input id="oq" type="search" name="q" value="${esc(q.q || '')}" placeholder="Search order no, name or phone"><button class="btn btn-sm" type="submit">Search</button></form>
      <span class="spacer"></span>
      <a class="btn btn-ghost btn-sm" href="/api/admin/orders.csv${q.todo === 'supplier' ? '?todo=supplier' : ''}" download>Download CSV${q.todo === 'supplier' ? ' (to order)' : ''}</a>
    </div>
    ${list.length ? `<div id="order-list">${list.map((o) => orderHtml(o, list.length === 1)).join('')}</div>` : '<div class="empty"><h2>No orders here</h2><p class="muted">Orders appear as soon as a customer checks out.</p></div>'}`;
}

/* ---------- products ---------- */
let productList = [];
let categoryList = [];

async function products() {
  [productList, categoryList] = await Promise.all([api('/api/admin/products'), api('/api/admin/categories')]);
  const rows = productList.map((p) => {
    const m = pctMargin(p.price, p.cost);
    const img = (p.images || '').split('\n')[0];
    return `<tr>
      <td><div class="mini-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : esc(p.icon)}</div></td>
      <td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.category_name || 'No category')}${p.featured ? ' · featured' : ''}</span></td>
      <td class="num">${inr(p.price)}</td>
      <td class="num">${p.cost == null ? '-' : inr(p.cost)}</td>
      <td class="num">${m == null ? '-' : `${inr(p.price - p.cost)} (${m}%)`}</td>
      <td class="num">${p.stock == null ? 'Not tracked' : p.stock}</td>
      <td><span class="pill ${p.active ? 'good' : ''}">${p.active ? 'Live' : 'Hidden'}</span></td>
      <td><button class="btn btn-ghost btn-sm" type="button" data-edit="${p.id}">Edit</button></td></tr>`;
  }).join('');
  return `<h1>Products</h1>
    <div class="bar-tools"><button class="btn" type="button" data-edit="new">Add product</button></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th></th><th>Product</th><th class="num">Price</th><th class="num">Supplier cost</th><th class="num">Margin</th><th class="num">Stock</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8">No products yet.</td></tr>'}</tbody></table></div>
    <details class="card-box" style="margin-top:1rem"><summary><b>Categories</b> (${categoryList.length})</summary>
      <ul class="list-plain" style="margin:.6rem 0">${categoryList.map((c) => `<li><span>${esc(c.icon)} ${esc(c.name)}</span><button class="link-btn" type="button" data-del-cat="${c.id}">Delete</button></li>`).join('')}</ul>
      <form id="cat-form" class="form-row c3" style="align-items:end"><label class="field"><span>New category</span><input name="name" required maxlength="40"></label><label class="field"><span>Icon (emoji)</span><input name="icon" maxlength="8" placeholder="📦"></label><div class="field"><button class="btn" type="submit">Add category</button></div></form>
      <p class="hint">Deleting a category keeps its products. They just show up without a category.</p>
    </details>
    <dialog id="product-dialog"></dialog>`;
}

function openProduct(id) {
  const p = id === 'new' ? { active: 1, featured: 0, icon: '📦', price: '', mrp: '', cost: '', stock: null } : productList.find((x) => String(x.id) === String(id));
  if (!p) return;
  const dlg = $('#product-dialog');
  const v = (x) => (x == null ? '' : esc(x));
  dlg.innerHTML = `<form id="product-form" data-id="${id === 'new' ? '' : p.id}">
    <div class="dlg-head"><h2>${id === 'new' ? 'Add product' : 'Edit product'}</h2><button class="btn btn-ghost btn-sm" type="button" data-close>Close</button></div>
    <div class="dlg-body">
      <div class="alert alert-err" id="product-error" role="alert"></div>
      <label class="field"><span>Product name</span><input name="name" required maxlength="150" value="${v(p.name)}"></label>
      <div class="form-row c2">
        <label class="field"><span>Category</span><select name="category_id"><option value="">No category</option>${categoryList.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Placeholder icon (emoji)</span><input name="icon" maxlength="8" value="${v(p.icon)}"><small>Shown when the product has no image.</small></label>
      </div>
      <div class="form-row c3">
        <label class="field"><span>Selling price (₹)</span><input name="price" inputmode="numeric" required value="${v(p.price)}"></label>
        <label class="field"><span>MRP (₹, optional)</span><input name="mrp" inputmode="numeric" value="${v(p.mrp)}"><small>Shown struck through. Use the real MRP.</small></label>
        <label class="field"><span>Your supplier cost (₹)</span><input name="cost" inputmode="numeric" value="${v(p.cost)}"><small>Private. Used for margin.</small></label>
      </div>
      <p class="hint margin-hint" id="margin-hint"></p>
      <label class="field"><span>Stock</span><input name="stock" inputmode="numeric" value="${v(p.stock)}"><small>Leave blank if the supplier manages stock. Add a number to stop sales at zero.</small></label>
      <label class="field"><span>Image links (one per line)</span><textarea name="images" rows="3" placeholder="https://...">${v(p.images)}</textarea><small>Use images you have the right to use. The first image is the main one.</small></label>
      <label class="field"><span>Highlights (one per line)</span><textarea name="highlights" rows="4">${v(p.highlights)}</textarea><small>Only claims that are true for the product you ship.</small></label>
      <label class="field"><span>Description</span><textarea name="description" rows="4">${v(p.description)}</textarea></label>
      <div class="form-row c2">
        <label class="field"><span>Supplier name (private)</span><input name="supplier_name" maxlength="120" value="${v(p.supplier_name)}"></label>
        <label class="field"><span>Supplier product link (private)</span><input name="supplier_url" maxlength="500" value="${v(p.supplier_url)}" placeholder="https://..."></label>
      </div>
      <label class="check"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> Show in "Popular right now" on the home page</label>
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Live on the store</label>
      <div class="dlg-foot"><button class="btn" type="submit">Save product</button>${id === 'new' ? '' : `<button class="btn btn-ghost" type="button" data-del-product="${p.id}">Delete product</button>`}</div>
    </div></form>`;
  dlg.showModal();
  updateMargin();
}
function updateMargin() {
  const f = $('#product-form'); if (!f) return;
  const price = Number(f.price.value), cost = f.cost.value === '' ? null : Number(f.cost.value);
  const h = $('#margin-hint'); h.className = 'hint margin-hint';
  if (!price || cost == null || Number.isNaN(cost)) { h.textContent = ''; return; }
  const m = price - cost;
  h.textContent = `Margin per sale: ${inr(m)} (${Math.round((m / price) * 100)}%) before ads, fees and returns.`;
  h.classList.add(m > 0 ? 'good' : 'bad');
}

/* ---------- settings ---------- */
async function settings() {
  const { settings: S, razorpay_configured } = await api('/api/admin/settings');
  settingsCache = S;
  const f = (name, label, extra = '', hint = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(S[name])}" ${extra}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  return `<h1>Settings</h1>
    <form id="settings-form">
      <section class="card-box"><h2>Store</h2>
        ${f('store_name', 'Store name', 'required maxlength="60"')}
        ${f('tagline', 'Tagline', 'maxlength="120"', 'Shown in the footer.')}
        ${f('announcement', 'Top banner text', 'maxlength="120"', 'Leave blank to hide the banner.')}
      </section>
      <section class="card-box"><h2>Contact (shown on policy pages)</h2>
        <div class="form-row c2">${f('support_email', 'Support email', 'type="email" maxlength="120"')}${f('support_phone', 'Support phone', 'maxlength="40"')}</div>
        ${f('whatsapp', 'WhatsApp number with country code', 'inputmode="numeric" maxlength="14" placeholder="919876543210"', 'Digits only. Adds a WhatsApp button to the store.')}
        ${f('business_address', 'Business address', 'maxlength="400"', 'Required by most payment providers. Shown in the footer.')}
      </section>
      <section class="card-box"><h2>Delivery and returns</h2>
        ${f('delivery_estimate', 'Delivery time shown to customers', 'maxlength="60"', 'Be realistic. Dropship orders usually take 7 to 12 days.')}
        <div class="form-row c3">${f('shipping_fee', 'Shipping fee (₹)', 'inputmode="numeric"')}${f('free_shipping_above', 'Free shipping above (₹)', 'inputmode="numeric"')}${f('return_window_days', 'Return window (days)', 'inputmode="numeric"')}</div>
      </section>
      <section class="card-box"><h2>Payments</h2>
        <label class="check"><input type="checkbox" name="cod_enabled" ${S.cod_enabled === '1' ? 'checked' : ''}> Accept Cash on Delivery</label>
        <div class="form-row c2">${f('cod_fee', 'COD fee (₹)', 'inputmode="numeric"', 'Helps cover failed deliveries.')}${f('prepaid_discount_pct', 'Discount for UPI / online payment (%)', 'inputmode="numeric"', 'Encourages prepaid orders. Use 0 for none.')}</div>
        ${f('upi_id', 'Your UPI ID', 'maxlength="64" placeholder="name@okbank"', 'Customers pay to this ID. Leave blank to turn UPI off. Use a business or current account ID.')}
        <p class="alert ${razorpay_configured ? 'alert-ok' : 'alert-info'}" style="margin:0">${razorpay_configured ? 'Online payments with Razorpay are on.' : 'Online payments (cards, net banking) are off. To turn them on, start the server with RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET set. See the README.'}</p>
      </section>
      <button class="btn" type="submit">Save settings</button>
    </form>
    <form id="password-form" class="card-box" style="margin-top:1.5rem">
      <h2>Change admin password</h2>
      <div class="alert alert-err" id="pw-error" role="alert"></div>
      <div class="form-row c2"><label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>New password (10+ characters)</span><input name="next" type="password" autocomplete="new-password" minlength="10" required></label></div>
      <button class="btn btn-ink" type="submit">Change password</button>
    </form>`;
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-edit],[data-close],[data-del-product],[data-del-cat],[data-copy],#logout');
  if (!el) return;
  try {
    if (el.id === 'logout') { await api('/api/admin/logout', { method: 'POST' }); me = null; showLogin(); }
    else if (el.dataset.edit) openProduct(el.dataset.edit);
    else if (el.hasAttribute('data-close')) $('#product-dialog').close();
    else if (el.dataset.delProduct) {
      if (!confirm('Delete this product? Past orders keep their details. To just hide it, untick "Live on the store" instead.')) return;
      await api('/api/admin/products/' + el.dataset.delProduct, { method: 'DELETE' }); $('#product-dialog').close(); toast('Product deleted'); route();
    } else if (el.dataset.delCat) {
      if (!confirm('Delete this category? Its products stay in the store without a category.')) return;
      await api('/api/admin/categories/' + el.dataset.delCat, { method: 'DELETE' }); route();
    } else if (el.dataset.copy !== undefined) {
      try { await navigator.clipboard.writeText(el.dataset.copy); toast('Copied'); } catch (_) { toast('Could not copy. Select the text manually.'); }
    }
  } catch (err) { fail(err); }
});

document.addEventListener('input', (e) => { if (e.target.closest('#product-form') && ['price', 'cost'].includes(e.target.name)) updateMargin(); });

document.addEventListener('submit', async (e) => {
  const f = e.target; const fd = () => Object.fromEntries(new FormData(f));
  try {
    if (f.id === 'login-form') {
      e.preventDefault(); $('#login-error').textContent = '';
      try { await api('/api/admin/login', { method: 'POST', body: fd(), noAuthRedirect: true }); me = await api('/api/admin/me'); shell(); route(); }
      catch (err) { $('#login-error').textContent = err.message; }
    } else if (f.id === 'order-search') {
      e.preventDefault(); const { q } = parseHash(); const p = new URLSearchParams(q); const v = fd().q.trim(); v ? p.set('q', v) : p.delete('q'); location.hash = '#/orders?' + p;
    } else if (f.dataset.orderForm) {
      e.preventDefault(); const id = f.dataset.orderForm; const d = fd();
      const body = { supplier_ordered: f.supplier_ordered.checked, payment_status: d.payment_status, courier: d.courier, tracking_no: d.tracking_no, notes: d.notes };
      if (!f.status.disabled) body.status = d.status;
      const o = await api('/api/admin/orders/' + id, { method: 'PUT', body });
      f.closest('details.order').outerHTML = orderHtml(o, true); toast('Order saved');
    } else if (f.id === 'product-form') {
      e.preventDefault(); const d = fd(); const id = f.dataset.id;
      const body = { ...d, featured: f.featured.checked, active: f.active.checked };
      $('#product-error').textContent = '';
      try { await api('/api/admin/products' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body }); $('#product-dialog').close(); toast('Product saved'); route(); }
      catch (err) { if (err instanceof AuthError) throw err; $('#product-error').textContent = err.message; $('#product-error').scrollIntoView({ block: 'nearest' }); }
    } else if (f.id === 'cat-form') {
      e.preventDefault(); await api('/api/admin/categories', { method: 'POST', body: fd() }); toast('Category added'); route();
    } else if (f.id === 'settings-form') {
      e.preventDefault(); const d = fd(); d.cod_enabled = f.cod_enabled.checked;
      await api('/api/admin/settings', { method: 'PUT', body: d }); settingsCache = null; toast('Settings saved');
    } else if (f.id === 'password-form') {
      e.preventDefault(); $('#pw-error').textContent = '';
      try { await api('/api/admin/password', { method: 'POST', body: fd() }); f.reset(); toast('Password changed'); }
      catch (err) { if (err instanceof AuthError) throw err; $('#pw-error').textContent = err.message; }
    }
  } catch (err) { fail(err); }
});

window.addEventListener('hashchange', route);

(async function boot() {
  try { me = await api('/api/admin/me', { noAuthRedirect: true }); shell(); route(); }
  catch (_) { showLogin(); }
})();
})();
