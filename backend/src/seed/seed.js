// backend/src/seed/seed.js
// Idempotent Database Seeder for BazaarBridge (Version 7.2)
// Follows schema.sql, agent-rules.md, api-contract.md, service-contracts.md

const fs = require('fs');
const path = require('path');
const seedData = require('./seed-data');

// Dynamically check for bcrypt or bcryptjs
let bcryptModule = null;
try {
  bcryptModule = require('bcryptjs');
} catch (e1) {
  try {
    bcryptModule = require('bcrypt');
  } catch (e2) {
    // Falls back to verified standard pre-computed hashes
  }
}

// Dynamically check for pg
let pg = null;
try {
  pg = require('pg');
} catch (e) {
  // pg may not be installed if dependencies have not been installed yet
}

function escapeSqlString(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function escapeSqlJson(obj) {
  if (obj === null || obj === undefined) return 'NULL';
  return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
}

function escapeSqlArray(arr) {
  if (!arr || !Array.isArray(arr)) return "'{}'::text[]";
  const items = arr.map(item => `"${String(item).replace(/"/g, '\\"')}"`).join(',');
  return `'{${items}}'::text[]`;
}

/**
 * Generates the complete, idempotent SQL script
 */
function generateSeedSql(adminPassword) {
  const users = seedData.getUsers(adminPassword);
  
  // If bcrypt is available and adminPassword provided, update admin password hash
  if (bcryptModule && adminPassword) {
    users[1].password_hash = bcryptModule.hashSync(adminPassword, 10);
  }

  const lines = [
    '--',
    '-- BazaarBridge Database Seed Script (SAMPLE DATA)',
    '-- Authoritative seed for Version 7.2 Frozen Schema',
    '-- Idempotent: safe to run multiple times without duplicate records or errors',
    '--',
    'BEGIN;',
    ''
  ];

  // 1. Stock Locations
  lines.push('-- 1. Stock Locations (Bangalore Warehouse, Bangalore Hub, Quarantine, Mysuru Holding)');
  lines.push('INSERT INTO stock_locations (location_id, name, city, state, location_type, is_home, is_sellable)');
  lines.push('VALUES');
  const locRows = seedData.stockLocations.map(loc => 
    `  ('${loc.location_id}', ${escapeSqlString(loc.name)}, ${escapeSqlString(loc.city)}, ${escapeSqlString(loc.state)}, ${escapeSqlString(loc.location_type)}, ${loc.is_home}, ${loc.is_sellable})`
  );
  lines.push(locRows.join(',\n'));
  lines.push('ON CONFLICT (location_id) DO UPDATE SET');
  lines.push('  name = EXCLUDED.name,');
  lines.push('  city = EXCLUDED.city,');
  lines.push('  state = EXCLUDED.state,');
  lines.push('  location_type = EXCLUDED.location_type,');
  lines.push('  is_home = EXCLUDED.is_home,');
  lines.push('  is_sellable = EXCLUDED.is_sellable;');
  lines.push('');

  // 2. Fulfilment Hubs
  lines.push('-- 2. Fulfilment Hubs (Bangalore Express Hub)');
  lines.push('INSERT INTO fulfilment_hubs (hub_id, location_id, address, hours, active, order_capacity, delivery_radius_km)');
  lines.push('VALUES');
  const hubRows = seedData.fulfilmentHubs.map(hub =>
    `  ('${hub.hub_id}', '${hub.location_id}', ${escapeSqlString(hub.address)}, ${escapeSqlJson(hub.hours)}, ${hub.active}, ${hub.order_capacity}, ${hub.delivery_radius_km})`
  );
  lines.push(hubRows.join(',\n'));
  lines.push('ON CONFLICT (location_id) DO UPDATE SET');
  lines.push('  address = EXCLUDED.address,');
  lines.push('  hours = EXCLUDED.hours,');
  lines.push('  active = EXCLUDED.active,');
  lines.push('  order_capacity = EXCLUDED.order_capacity,');
  lines.push('  delivery_radius_km = EXCLUDED.delivery_radius_km;');
  lines.push('');

  // 3. Hub Service Areas (3 PIN codes)
  lines.push('-- 3. Hub Service Areas (3 PIN codes: 560001, 560038, 560025)');
  lines.push('INSERT INTO hub_service_areas (area_id, hub_id, pin_code)');
  lines.push('VALUES');
  const areaRows = seedData.hubServiceAreas.map(area =>
    `  ('${area.area_id}', '${area.hub_id}', ${escapeSqlString(area.pin_code)})`
  );
  lines.push(areaRows.join(',\n'));
  lines.push('ON CONFLICT (pin_code) DO UPDATE SET');
  lines.push('  hub_id = EXCLUDED.hub_id;');
  lines.push('');

  // 4. Users
  lines.push('-- 4. Demo Users (Customer, Admin, Rider with bcrypt hashes)');
  lines.push('INSERT INTO users (user_id, name, email, password_hash, role)');
  lines.push('VALUES');
  const userRows = users.map(user =>
    `  ('${user.user_id}', ${escapeSqlString(user.name)}, ${escapeSqlString(user.email)}, ${escapeSqlString(user.password_hash)}, ${escapeSqlString(user.role)})`
  );
  lines.push(userRows.join(',\n'));
  lines.push('ON CONFLICT (email) DO UPDATE SET');
  lines.push('  name = EXCLUDED.name,');
  lines.push('  password_hash = EXCLUDED.password_hash,');
  lines.push('  role = EXCLUDED.role;');
  lines.push('');

  // 5. Carts
  lines.push('-- 5. User Carts');
  lines.push('INSERT INTO carts (cart_id, user_id)');
  lines.push('VALUES');
  const cartRows = seedData.carts.map(cart =>
    `  ('${cart.cart_id}', '${cart.user_id}')`
  );
  lines.push(cartRows.join(',\n'));
  lines.push('ON CONFLICT (user_id) DO NOTHING;');
  lines.push('');

  // 6. Dealers
  lines.push('-- 6. Dealers (5 Bangalore Dealers with distinct ratings/reviews + 1 Mysuru Dealer)');
  lines.push('INSERT INTO dealers (dealer_id, shop_name, city, state, contact, dealer_rating, total_reviews, verified, supplier_status)');
  lines.push('VALUES');
  const dealerRows = seedData.dealers.map(d =>
    `  ('${d.dealer_id}', ${escapeSqlString(d.shop_name)}, ${escapeSqlString(d.city)}, ${escapeSqlString(d.state)}, ${escapeSqlString(d.contact)}, ${d.dealer_rating}, ${d.total_reviews}, ${d.verified}, ${escapeSqlString(d.supplier_status)})`
  );
  lines.push(dealerRows.join(',\n'));
  lines.push('ON CONFLICT (dealer_id) DO UPDATE SET');
  lines.push('  shop_name = EXCLUDED.shop_name,');
  lines.push('  city = EXCLUDED.city,');
  lines.push('  state = EXCLUDED.state,');
  lines.push('  contact = EXCLUDED.contact,');
  lines.push('  dealer_rating = EXCLUDED.dealer_rating,');
  lines.push('  total_reviews = EXCLUDED.total_reviews,');
  lines.push('  verified = EXCLUDED.verified,');
  lines.push('  supplier_status = EXCLUDED.supplier_status;');
  lines.push('');

  // 7. Categories
  lines.push('-- 7. Product Categories (5 Categories)');
  lines.push('INSERT INTO categories (category_id, category_name)');
  lines.push('VALUES');
  const catRows = seedData.categories.map(c =>
    `  ('${c.category_id}', ${escapeSqlString(c.category_name)})`
  );
  lines.push(catRows.join(',\n'));
  lines.push('ON CONFLICT (category_name) DO NOTHING;');
  lines.push('');

  // 8. Products
  lines.push('-- 8. Products (40 Products across 5 Categories; Product 1 is Bluetooth Speaker)');
  lines.push('INSERT INTO products (product_id, name, description, brand, category_id, specs)');
  lines.push('VALUES');
  const prodRows = seedData.products.map(p =>
    `  ('${p.product_id}', ${escapeSqlString(p.name)}, ${escapeSqlString(p.description)}, ${escapeSqlString(p.brand)}, '${p.category_id}', ${escapeSqlJson(p.specs)})`
  );
  lines.push(prodRows.join(',\n'));
  lines.push('ON CONFLICT (product_id) DO UPDATE SET');
  lines.push('  name = EXCLUDED.name,');
  lines.push('  description = EXCLUDED.description,');
  lines.push('  brand = EXCLUDED.brand,');
  lines.push('  category_id = EXCLUDED.category_id,');
  lines.push('  specs = EXCLUDED.specs;');
  lines.push('');

  // 9. Dealer Offers
  lines.push('-- 9. Dealer Offers (Includes 5 Bluetooth Speaker offers + 1-unit offer + popular product offers)');
  lines.push('INSERT INTO dealer_offers (offer_id, product_id, dealer_id, purchase_price, selling_price, status, bangalore_delivery_days, transfer_days_min, transfer_days_max, eligible_modes, warranty_months, warranty_note)');
  lines.push('VALUES');
  const offerRows = seedData.dealerOffers.map(o => {
    const bDays = o.bangalore_delivery_days !== null ? o.bangalore_delivery_days : 'NULL';
    const tMin = o.transfer_days_min !== null ? o.transfer_days_min : 'NULL';
    const tMax = o.transfer_days_max !== null ? o.transfer_days_max : 'NULL';
    const wNote = escapeSqlString(o.warranty_note);
    return `  ('${o.offer_id}', '${o.product_id}', '${o.dealer_id}', ${o.purchase_price}, ${o.selling_price}, ${escapeSqlString(o.status)}, ${bDays}, ${tMin}, ${tMax}, ${escapeSqlArray(o.eligible_modes)}, ${o.warranty_months}, ${wNote})`;
  });
  lines.push(offerRows.join(',\n'));
  lines.push('ON CONFLICT (offer_id) DO UPDATE SET');
  lines.push('  purchase_price = EXCLUDED.purchase_price,');
  lines.push('  selling_price = EXCLUDED.selling_price,');
  lines.push('  status = EXCLUDED.status,');
  lines.push('  bangalore_delivery_days = EXCLUDED.bangalore_delivery_days,');
  lines.push('  transfer_days_min = EXCLUDED.transfer_days_min,');
  lines.push('  transfer_days_max = EXCLUDED.transfer_days_max,');
  lines.push('  eligible_modes = EXCLUDED.eligible_modes,');
  lines.push('  warranty_months = EXCLUDED.warranty_months,');
  lines.push('  warranty_note = EXCLUDED.warranty_note;');
  lines.push('');

  // 10. Inventory
  lines.push('-- 10. Inventory Records (Warehouse, Hub, Quarantine, Mysuru Holding; Includes 1-unit stock)');
  lines.push('INSERT INTO inventory (inventory_id, offer_id, location_id, quantity, reserved_quantity)');
  lines.push('VALUES');
  const invRows = seedData.inventory.map(inv =>
    `  ('${inv.inventory_id}', '${inv.offer_id}', '${inv.location_id}', ${inv.quantity}, ${inv.reserved_quantity})`
  );
  lines.push(invRows.join(',\n'));
  lines.push('ON CONFLICT (offer_id, location_id) DO UPDATE SET');
  lines.push('  quantity = EXCLUDED.quantity,');
  lines.push('  reserved_quantity = EXCLUDED.reserved_quantity;');
  lines.push('');

  // 11. Sample Price History (Historical closed records for reference price calculation)
  lines.push('-- 11. Sample Price History (Closed past periods where valid_to is NOT NULL)');
  for (const hp of seedData.historicalPrices) {
    lines.push(`INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)`);
    lines.push(`SELECT '${hp.offer_id}', ${hp.selling_price}, NOW() - INTERVAL '${hp.valid_from_offset_days} days', NOW() - INTERVAL '${hp.valid_to_offset_days} days'`);
    lines.push(`WHERE NOT EXISTS (`);
    lines.push(`  SELECT 1 FROM offer_price_history`);
    lines.push(`  WHERE offer_id = '${hp.offer_id}' AND valid_to = NOW() - INTERVAL '${hp.valid_to_offset_days} days'`);
    lines.push(`);`);
  }
  lines.push('');

  // 12. Coupons ([FEATURE_COUPONS])
  lines.push('-- 12. Coupons (SAVE10, WELCOME50, FESTIVE15, BAZAAR100)');
  lines.push('INSERT INTO coupons (coupon_id, code, kind, value, min_basket_paise, max_redemptions, redeemed_count, per_customer_limit, valid_from, valid_to, active)');
  lines.push('VALUES');
  const couponRows = seedData.coupons.map(c =>
    `  ('${c.coupon_id}', ${escapeSqlString(c.code)}, ${escapeSqlString(c.kind)}, ${c.value}, ${c.min_basket_paise}, ${c.max_redemptions}, ${c.redeemed_count}, ${c.per_customer_limit}, NOW() + INTERVAL '${c.valid_from_offset_days} days', NOW() + INTERVAL '${c.valid_to_offset_days} days', ${c.active})`
  );
  lines.push(couponRows.join(',\n'));
  lines.push('ON CONFLICT (code) DO UPDATE SET');
  lines.push('  kind = EXCLUDED.kind,');
  lines.push('  value = EXCLUDED.value,');
  lines.push('  min_basket_paise = EXCLUDED.min_basket_paise,');
  lines.push('  max_redemptions = EXCLUDED.max_redemptions,');
  lines.push('  per_customer_limit = EXCLUDED.per_customer_limit,');
  lines.push('  valid_from = EXCLUDED.valid_from,');
  lines.push('  valid_to = EXCLUDED.valid_to,');
  lines.push('  active = EXCLUDED.active;');
  lines.push('');

  lines.push('COMMIT;');
  return lines.join('\n');
}

/**
 * Runs seed against database via PostgreSQL client
 */
async function runSeed() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
  const sql = generateSeedSql(adminPassword);
  const sqlPath = path.join(__dirname, 'seed.sql');

  // Always write seed.sql
  fs.writeFileSync(sqlPath, sql, 'utf8');
  console.log(`[Seed] Successfully generated idempotent SQL: ${sqlPath}`);

  const pgUri = process.env.PG_URI;
  if (!pgUri) {
    console.log('[Seed] Notice: PG_URI environment variable is not set.');
    console.log('[Seed] To apply seed to PostgreSQL, run:');
    console.log(`       psql $PG_URI -f ${sqlPath}`);
    console.log('   or:');
    console.log(`       PG_URI="postgres://..." node backend/src/seed/seed.js`);
    return { writtenSql: true, executedDb: false };
  }

  if (!pg) {
    console.log('[Seed] Notice: "pg" npm package is not installed in the current environment.');
    console.log('[Seed] Run: npm install pg (or run psql directly)');
    console.log(`[Seed] SQL file is ready at: ${sqlPath}`);
    return { writtenSql: true, executedDb: false };
  }

  console.log('[Seed] Connecting to PostgreSQL database...');
  const pool = new pg.Pool({ connectionString: pgUri });
  const client = await pool.connect();

  try {
    console.log('[Seed] Executing idempotent seed transaction...');
    await client.query(sql);
    console.log('[Seed] Database seed completed successfully!');
    return { writtenSql: true, executedDb: true };
  } catch (err) {
    console.error('[Seed] Database seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = {
  generateSeedSql,
  runSeed
};

// CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--verify')) {
    const runVerification = require('./verify');
    runVerification();
  } else {
    runSeed()
      .then(res => {
        console.log('[Seed] Done. Status:', JSON.stringify(res));
      })
      .catch(err => {
        console.error('[Seed] Execution error:', err);
        process.exit(1);
      });
  }
}

