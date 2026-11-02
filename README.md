# GadgetGully: Dropshipping Store (Electronics)

Ek complete store: customer storefront + admin panel + database. Koi npm package nahi chahiye, sirf **Node.js 22.5 ya usse naya**.

## Local chalana

```bash
node server.js
```

- Store: http://localhost:3000
- Admin: http://localhost:3000/admin/
- Pehli baar chalane par terminal mein admin ka username aur password print hota hai. Login ke baad **Settings > Change admin password** se badal lo.
- Apna password pehle se set karna ho:
  `ADMIN_USER=me ADMIN_PASS='koi-lamba-password' node server.js`

## Pehle ye setup karo (Admin > Settings)

1. Store ka naam, support email/phone, **business address** (payment providers aur policy pages ke liye zaroori).
2. **UPI ID** daalo (sirf apna business/current account ID). Customer isi par pay karega aur UTR dega.
3. **WhatsApp number** (country code ke saath, jaise 919876543210).
4. Shipping fee, COD fee, delivery time. Dropshipping mein delivery 7-12 din realistic hai, kam promise mat karo.
5. **Products** mein sample products hata do ya edit karo. Apni supplier cost, asli photo links aur sahi description daalo.

## Roz ka kaam (order aane par)

1. Dashboard par "Orders to place with supplier" dikhega.
2. Order kholo > **Copy details for supplier** > supplier ko bhejo/order karo.
3. "Ordered from supplier" tick karo. Courier aur tracking number aate hi daalo aur status **Shipped** karo. Customer ko apne order page par tracking dikhegi.
4. **WhatsApp customer** button se confirmation ya tracking message bhejo.
5. UPI order: dashboard par "UPI payments to verify" dekho. Apne bank/UPI app mein UTR match karo, phir payment status **Paid** karo.
6. COD order delivered karne par payment automatically Paid ho jaata hai.

## Online payment (cards/net banking), optional

Razorpay account banao (KYC chahiye), phir server ko keys ke saath chalao:

```bash
RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=xxx node server.js
```

Ya project folder mein `.env` file banao:

```
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
ADMIN_PASS=koi-lamba-password
```

Keys set hote hi checkout mein "Cards, net banking and wallets" option aa jaata hai. Payment ki signature server verify karta hai.

## Internet par live karna (deploy)

Kisi bhi aise host par chalao jahan Node.js 22+ aur **persistent disk** ho (Railway, Render, VPS, etc.).

- Start command: `node server.js`
- `DATA_DIR` ko persistent disk par point karo (jaise `/data`). Isi folder mein database aur session key rehti hai. **Isko backup karo**, yahi aapke saare orders hain.
- HTTPS ke peeche chalao aur set karo: `TRUST_PROXY=1` (host ka reverse proxy ho toh) aur `COOKIE_SECURE=1`.
- `PORT` host khud deta hai, server use padh leta hai.
- Pehli deploy par `ADMIN_USER` aur `ADMIN_PASS` zaroor set karo.

## Environment variables

| Variable | Kaam |
|---|---|
| `PORT` | Server port (default 3000) |
| `DATA_DIR` | Database aur session key ka folder (default `./data`) |
| `ADMIN_USER`, `ADMIN_PASS` | Pehli baar admin account banane ke liye |
| `SESSION_SECRET` | Optional, login cookie ki secret |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Online payment |
| `TRUST_PROXY=1` | Host ke proxy ke peeche ho toh |
| `COOKIE_SECURE=1` | HTTPS par admin cookie secure karne ke liye |
| `SEED=0` | Sample products mat banao |

## Business ke liye zaroori baatein

- **Sahi MRP aur sahi claims.** Fake "70% off" ya jhoothe specs se returns, chargebacks aur consumer complaints aate hain.
- **Supplier se pehle test order karo** (quality, packing, delivery time), phir ads chalao.
- **Margin** dashboard mein ads, payment fees, return shipping aur RTO (COD return) ko shamil nahi karta. COD mein RTO ka nuksan sabse bada hota hai, isliye COD fee aur phone/WhatsApp confirmation rakho.
- Policy pages (shipping, returns, privacy, terms) generic hain. Apne supplier ki asli terms ke hisaab se check karo, aur zaroorat ho toh GST/business registration ke liye CA se baat karo.
- Admin password lamba rakho aur kisi se share mat karo.
