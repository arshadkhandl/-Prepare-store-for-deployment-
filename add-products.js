'use strict';
// Adds ~45 more gadget products to your store. Safe to run more than once:
// products that already exist (same name) are skipped, nothing is deleted or changed.
//
//   node add-products.js
//
// IMPORTANT: prices below are STARTING ESTIMATES, not real supplier prices.
// Before you sell, open Admin > Products and set the real supplier cost (what Meesho or your
// supplier charges you), your selling price, photos, and check the highlights against the
// exact listing you will ship. Products are added without photos on purpose.
const { db, tx, slugify, uniqueSlug } = require('./db');

const CATEGORIES = [
  ['Audio', '🎧'], ['Smart Wearables', '⌚'], ['Power & Charging', '🔋'], ['Smart Home', '💡'],
  ['PC & Gaming', '🖱️'], ['Mobile Accessories', '📱'],
  ['Grooming', '✂️'], ['Car & Travel', '🚗'], ['Kitchen Gadgets', '🥤']
];

// [name, category, price, mrp, cost, icon, featured, description, highlights (one per line)]
const P = [
  // Audio
  ['Wireless Gaming Earbuds with Low Latency Mode', 'Audio', 999, 1399, 470, '🎧', 1, 'Wireless earbuds with a low-latency mode for mobile games and videos, and a compact charging case.', 'Bluetooth wireless\nLow-latency game mode\nCharging case included\nBuilt-in microphone for calls'],
  ['Foldable Over-Ear Bluetooth Headphones', 'Audio', 1299, 1799, 620, '🎧', 0, 'Foldable over-ear headphones that work wirelessly or with an AUX cable. Padded ear cups for long listening.', 'Bluetooth + AUX cable\nFoldable design\nPadded ear cups\nBuilt-in microphone'],
  ['Type-C Wired Earphones with Mic', 'Audio', 249, 399, 95, '🎧', 0, 'In-ear wired earphones with a Type-C plug, inline mic and call button. For phones with a Type-C audio port.', 'Type-C plug\nInline mic and button\nLightweight\nTangle-resistant cable'],
  ['Bluetooth Soundbar for TV and PC 16W', 'Audio', 1799, 2499, 880, '🔊', 0, 'Compact soundbar that connects over Bluetooth or AUX to a TV, laptop or phone for fuller sound.', 'Bluetooth + AUX input\nCompact size\nUSB powered or adapter\nWorks with TV, PC and phone'],
  ['Wireless Collar Microphone for Phones', 'Audio', 899, 1299, 410, '🎤', 1, 'Clip-on wireless mic set with receiver for vlogs, reels and interviews. Check your phone port before ordering.', 'Clip-on microphone\nPlug-in receiver\nGood for reels and vlogs\nPort type depends on model, confirm with listing'],
  ['Mini Bluetooth Speaker with Carabiner', 'Audio', 599, 899, 260, '🔊', 0, 'Pocket-size Bluetooth speaker with a carabiner clip for bags and backpacks.', 'Bluetooth wireless\nCarabiner clip\nBuilt-in mic\nRechargeable'],
  // Smart Wearables
  ['Smart Watch with Metal Strap and Calling', 'Smart Wearables', 1599, 2299, 740, '⌚', 1, 'Smart watch with a metal strap, Bluetooth calling, health tracking and sports modes.', 'Bluetooth calling\nHeart rate tracking\nSleep tracking\nMultiple sports modes'],
  ['Kids Smart Watch with Camera and Games', 'Smart Wearables', 999, 1499, 460, '⌚', 0, 'Colourful smart watch for kids with a camera, simple games, alarm and stopwatch.', 'Camera and games\nAlarm and stopwatch\nSoft silicone strap\nUSB charging'],
  ['Colour Display Smart Band Fitness Tracker', 'Smart Wearables', 799, 1199, 360, '⌚', 0, 'Slim fitness band with a colour display that tracks steps, sleep and heart rate and shows notifications.', 'Step and sleep tracking\nHeart rate\nCall and message alerts\nMulti-day battery'],
  ['Silicone Smart Watch Strap 22mm (Pack of 2)', 'Smart Wearables', 299, 449, 110, '⌚', 0, 'Soft silicone replacement straps in two colours. Check that your watch takes a 22mm strap.', 'Pack of 2 straps\n22mm width\nSoft silicone\nQuick-release pins'],
  // Power & Charging
  ['Braided Type-C Fast Charging Cable 1.5m (Pack of 2)', 'Power & Charging', 349, 549, 130, '🔌', 0, 'Two durable braided Type-C cables for fast charging and data transfer.', 'Pack of 2\n1.5 metre length\nBraided cable\nFast charging support'],
  ['3-in-1 Charging Cable (Micro, Type-C, Lightning)', 'Power & Charging', 299, 449, 110, '🔌', 0, 'One cable with three connectors so you can charge most phones and accessories.', 'Micro USB, Type-C and Lightning heads\nSingle USB-A plug\nTravel friendly'],
  ['33W Fast Wall Charger with Type-C Cable', 'Power & Charging', 599, 899, 270, '🔌', 1, 'Compact wall charger with a Type-C cable for fast charging compatible phones.', 'Up to 33W output\nType-C cable included\nCompact body\nFor compatible fast-charge phones'],
  ['10000mAh Slim Power Bank', 'Power & Charging', 899, 1299, 420, '🔋', 0, 'Slim power bank that fits in a pocket. Charges phones and small devices on the go.', '10000mAh capacity\nSlim body\nDual output\nLED indicator'],
  ['Multiplug Extension Board with USB Ports', 'Power & Charging', 799, 1199, 360, '🔌', 0, 'Extension board with multiple sockets and USB charging ports, and a switch with indicator light.', 'Multiple sockets\nUSB charging ports\nMaster switch and indicator\nLong cord'],
  // Smart Home
  ['Wi-Fi Smart LED Bulb RGB 9W', 'Smart Home', 499, 799, 210, '💡', 0, 'Colour-changing smart bulb you control from your phone. Set schedules and scenes.', 'App control\nColour and white modes\nSchedules and timers\n2.4GHz Wi-Fi'],
  ['Indoor Wi-Fi Security Camera 2MP Pan-Tilt', 'Smart Home', 1499, 2199, 700, '📹', 1, 'Indoor camera you can rotate from the app. Two-way audio and motion alerts.', '2MP video\nPan and tilt from the app\nTwo-way audio\nMotion alerts\nMemory card slot (card sold separately)'],
  ['Portable Mini Projector for Home Use', 'Smart Home', 3999, 5499, 1950, '📽️', 0, 'Compact projector for movies and presentations. Connects to a phone, laptop or streaming stick.', 'HDMI and USB input\nBuilt-in speaker\nCompact and portable\nBest used in a dim room'],
  ['Rechargeable Motion Sensor Night Light (Pack of 2)', 'Smart Home', 399, 599, 160, '💡', 0, 'Stick-anywhere night lights that switch on when they sense motion in the dark.', 'Pack of 2\nMotion sensor\nUSB rechargeable\nMagnetic or adhesive mount'],
  ['LED Digital Table Clock with Temperature', 'Smart Home', 449, 699, 190, '⏰', 0, 'Digital clock with an LED display, alarm and temperature reading for desk or bedside.', 'LED display\nAlarm\nTemperature display\nUSB powered'],
  ['Portable Neck Fan Rechargeable', 'Smart Home', 899, 1399, 400, '🌀', 1, 'Hands-free neck fan with adjustable speeds for travel, commuting and outdoor work.', 'Hands-free wear\nMultiple speeds\nRechargeable battery\nLightweight'],
  // PC & Gaming
  ['Wireless Keyboard and Mouse Combo', 'PC & Gaming', 999, 1499, 450, '⌨️', 0, 'Keyboard and mouse set with one USB receiver. Good for home office and study.', 'One USB receiver for both\nFull-size keyboard\nQuiet keys\nBatteries sold separately'],
  ['RGB Gaming Keyboard with Backlight', 'PC & Gaming', 1299, 1899, 600, '⌨️', 0, 'Wired gaming keyboard with colourful backlight and gaming-style keys.', 'RGB backlight\nUSB wired\nAnti-ghosting keys\nSpill-resistant design'],
  ['XL Gaming Mouse Pad with Stitched Edges', 'PC & Gaming', 399, 599, 160, '🖱️', 0, 'Large mouse pad that covers your keyboard and mouse area. Anti-slip rubber base.', 'Extra large size\nStitched edges\nAnti-slip base\nSmooth surface'],
  ['4-Port USB 3.0 Hub', 'PC & Gaming', 499, 799, 210, '💻', 0, 'Add four USB ports to your laptop or PC with one compact hub.', '4 x USB 3.0 ports\nPlug and play\nCompact\nWorks with Windows and macOS'],
  ['Laptop Cooling Pad with Fans', 'PC & Gaming', 899, 1299, 400, '💻', 0, 'Cooling pad with built-in fans that helps keep your laptop cooler during long use.', 'Multiple fans\nUSB powered\nAdjustable height\nFits most laptops up to 15.6 inch'],
  ['Full HD 1080p Webcam with Microphone', 'PC & Gaming', 1199, 1699, 540, '📷', 0, 'Plug-and-play webcam for video calls, classes and streaming.', '1080p video\nBuilt-in microphone\nUSB plug and play\nClip or tripod mount'],
  ['Wireless Gamepad Controller for Phone and PC', 'PC & Gaming', 1299, 1899, 580, '🎮', 0, 'Wireless controller for mobile and PC games. Check game and phone compatibility before ordering.', 'Wireless connection\nRechargeable\nPhone holder clip\nCompatibility varies by game'],
  ['Mobile Gaming Trigger Buttons (Pair)', 'PC & Gaming', 349, 549, 130, '🎮', 0, 'Clip-on trigger buttons for shooter games on your phone.', 'Pair of triggers\nClip-on design\nNo battery needed\nFits most phones'],
  // Mobile Accessories
  ['Magnetic Phone Cooling Fan Clip-On', 'Mobile Accessories', 999, 1499, 450, '📱', 0, 'Clip-on cooler that helps reduce phone heat during long gaming or video sessions.', 'Clip-on design\nUSB powered\nQuiet fan\nFits most phones'],
  ['Adjustable Desk Phone Stand', 'Mobile Accessories', 299, 449, 110, '📱', 0, 'Foldable stand for phones and small tablets. Handy for video calls and watching videos.', 'Adjustable angle\nFoldable\nNon-slip pads\nLightweight'],
  ['Selfie Stick Tripod with Bluetooth Remote', 'Mobile Accessories', 599, 899, 250, '📸', 1, 'Extendable selfie stick that also works as a tripod. Includes a Bluetooth shutter remote.', 'Extendable pole\nTripod legs\nBluetooth remote\nFits most phones'],
  ['3-in-1 Mobile Camera Lens Kit', 'Mobile Accessories', 599, 899, 250, '📷', 0, 'Clip-on lens kit with wide-angle, macro and fisheye lenses for phone photos.', 'Wide, macro and fisheye lenses\nUniversal clip\nCarry pouch included'],
  ['Type-C OTG Card Reader', 'Mobile Accessories', 399, 599, 150, '💾', 0, 'Read memory cards on your phone or laptop with a Type-C connector. Cards sold separately.', 'Type-C connector\nSD and microSD slots\nPlug and play\nCards not included'],
  // Grooming
  ['Cordless Beard Trimmer for Men', 'Grooming', 799, 1199, 340, '✂️', 1, 'Rechargeable trimmer with adjustable length settings for beard and hair shaping.', 'Cordless and rechargeable\nAdjustable length\nSharp blades\nUSB charging'],
  ['Foldable Hair Dryer with Hot and Cool Air', 'Grooming', 899, 1399, 400, '💇', 0, 'Foldable hair dryer with hot and cool settings, easy to pack for travel.', 'Hot and cool settings\nFoldable handle\nTravel friendly\nCheck wattage on your listing'],
  ['Rechargeable Electric Lint Remover', 'Grooming', 499, 749, 200, '🧺', 0, 'Removes lint and pills from clothes, sofas and blankets. USB rechargeable.', 'Rechargeable\nSafe blade guard\nUSB charging\nCompact'],
  // Kitchen Gadgets
  ['Mini Electric Food Chopper', 'Kitchen Gadgets', 599, 899, 260, '🥬', 0, 'Small chopper for onions, garlic, chillies and nuts. Easy to clean.', 'Compact size\nSharp stainless blades\nEasy to clean\nUSB charging on many models, confirm with listing'],
  ['Portable USB Rechargeable Blender Bottle', 'Kitchen Gadgets', 699, 999, 300, '🥤', 1, 'Portable blender for shakes and smoothies at home, gym or office.', 'USB rechargeable\nPortable bottle\nStainless blades\nEasy to rinse'],
  ['Digital Kitchen Weighing Scale', 'Kitchen Gadgets', 449, 699, 190, '⚖️', 0, 'Compact digital scale for cooking and baking with a clear display and tare function.', 'Digital display\nTare function\nCompact\nBatteries may be sold separately'],
  ['Handheld Electric Milk Frother', 'Kitchen Gadgets', 349, 549, 130, '☕', 0, 'Whisk milk into foam for coffee, or mix protein shakes and eggs.', 'Battery operated\nStainless whisk\nLightweight\nBatteries sold separately'],
  // Car & Travel
  ['Magnetic Car Phone Holder for Dashboard', 'Car & Travel', 299, 499, 105, '🚗', 0, 'Dashboard phone holder with a strong magnet. Keeps your phone in view for maps.', 'Magnetic hold\nDashboard mount\n360 degree rotation\nMetal plate included'],
  ['Portable Car Vacuum Cleaner', 'Car & Travel', 799, 1199, 350, '🚗', 0, 'Handheld vacuum for car seats and floor mats. Plugs into the car socket or charges by USB depending on model.', 'Handheld size\nWashable filter\nCrevice nozzle\nPower source depends on model, confirm with listing'],
  ['Portable Tyre Inflator Air Pump', 'Car & Travel', 1999, 2799, 950, '🚗', 0, 'Compact electric pump for car and bike tyres and balls, with a pressure display.', 'Digital pressure display\nMultiple nozzles\nCompact\nFor car and bike tyres'],
  ['1080p Car Dash Camera', 'Car & Travel', 2199, 2999, 1050, '📹', 0, 'Dash camera that records your drive in Full HD with loop recording. Memory card sold separately.', 'Full HD recording\nLoop recording\nWide-angle lens\nMemory card not included'],
  ['Digital Luggage Weighing Scale', 'Car & Travel', 349, 549, 130, '🧳', 0, 'Hand-held scale to check bag weight before you reach the airport.', 'Digital display\nEasy-to-read weight\nStrap hook\nBattery details vary, confirm with listing']
];

const PRODUCT_IMAGES = {
  'Wireless Gaming Earbuds with Low Latency Mode': '',
  'Foldable Over-Ear Bluetooth Headphones': '',
  'Type-C Wired Earphones with Mic': '',
  'Bluetooth Soundbar for TV and PC 16W': '',
  'Wireless Collar Microphone for Phones': '',
  'Mini Bluetooth Speaker with Carabiner': '',

  'Smart Watch with Metal Strap and Calling': '',
  'Kids Smart Watch with Camera and Games': '',
  'Colour Display Smart Band Fitness Tracker': '',
  'Silicone Smart Watch Strap 22mm (Pack of 2)': '',

  'Braided Type-C Fast Charging Cable 1.5m (Pack of 2)': '',
  '3-in-1 Charging Cable (Micro, Type-C, Lightning)': '',
  '33W Fast Wall Charger with Type-C Cable': '',
  '10000mAh Slim Power Bank': '',
  'Multiplug Extension Board with USB Ports': '',

  'Wi-Fi Smart LED Bulb RGB 9W': '',
  'Indoor Wi-Fi Security Camera 2MP Pan-Tilt': '',
  'Portable Mini Projector for Home Use': '',
  'Rechargeable Motion Sensor Night Light (Pack of 2)': '',
  'LED Digital Table Clock with Temperature': '',
  'Portable Neck Fan Rechargeable': '',

  'Wireless Keyboard and Mouse Combo': '',
  'RGB Gaming Keyboard with Backlight': '',
  'XL Gaming Mouse Pad with Stitched Edges': '',
  '4-Port USB 3.0 Hub': '',
  'Laptop Cooling Pad with Fans': '',
  'Full HD 1080p Webcam with Microphone': '',
  'Wireless Gamepad Controller for Phone and PC': '',
  'Mobile Gaming Trigger Buttons (Pair)': '',

  'Magnetic Phone Cooling Fan Clip-On': '',
  'Adjustable Desk Phone Stand': '',
  'Selfie Stick Tripod with Bluetooth Remote': '',
  '3-in-1 Mobile Camera Lens Kit': '',
  'Type-C OTG Card Reader': '',

  'Cordless Beard Trimmer for Men': '',
  'Foldable Hair Dryer with Hot and Cool Air': '',
  'Rechargeable Electric Lint Remover': '',

  'Mini Electric Food Chopper': '',
  'Portable USB Rechargeable Blender Bottle': '',
  'Digital Kitchen Weighing Scale': '',
  'Handheld Electric Milk Frother': '',

  'Magnetic Car Phone Holder for Dashboard': '',
  'Portable Car Vacuum Cleaner': '',
  'Portable Tyre Inflator Air Pump': '',
  '1080p Car Dash Camera': '',
  'Digital Luggage Weighing Scale': ''
};

const getCat = db.prepare('SELECT id FROM categories WHERE name = ?');
const insCat = db.prepare('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)');
const hasProd = db.prepare('SELECT 1 FROM products WHERE lower(name) = lower(?)');
const insProd = db.prepare(`INSERT INTO products
  (name, slug, description, highlights, category_id, price, mrp, cost, stock, images, icon, supplier_name, supplier_url, featured, active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'Meesho', '', ?, 1)`);
let added = 0, skipped = 0, newCats = 0;
tx(() => {
  const catId = {};
  for (const [name, icon] of CATEGORIES) {
    const row = getCat.get(name);
    if (row) { catId[name] = row.id; continue; }
    catId[name] = Number(insCat.run(name, uniqueSlug('categories', name), icon).lastInsertRowid);
    newCats++;
  }
  for (const [name, cat, price, mrp, cost, icon, feat, desc, hl] of P) {
    if (hasProd.get(name)) { skipped++; continue; }
    if (!catId[cat]) throw new Error('Unknown category ' + cat);
  const imageUrl = PRODUCT_IMAGES[name] || '';

insProd.run(
  name,
  uniqueSlug('products', name),
  desc,
  hl,
  catId[cat],
  price,
  mrp,
  cost,
  imageUrl,
  icon,
  feat
);
  }
});

console.log(`Done. ${added} products added, ${skipped} already existed, ${newCats} new categories.`);
console.log('Next: open Admin > Products and set real supplier cost, selling price and photos for each item.');