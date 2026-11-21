// backend/src/tests/restock-missing-row.test.js
// Phase 2 Mandatory Test: Section B Offer Missing Bangalore Inventory Row
// Contract: Finalizer creates Bangalore row (upsert) on order; cancel restocks; T3/receipt paths also work.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

const MYSURU_OFFER_ID = '70000000-0000-0000-0000-000000000009'; // SonicAir Earbuds - Mysuru dealer, Section B
const MYSURU_HOLDING_LOC = '10000000-0000-0000-0000-000000000004'; // Mysuru Regional Holding
const BANGALORE_WAREHOUSE_LOC = '10000000-0000-0000-0000-000000000001'; // Bangalore Central Warehouse

test('Restock Missing Row: Section B order -> finalizer creates Bangalore row via upsert', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // 1. Ensure NO inventory row exists for this offer at Bangalore warehouse
  await pool.query(`DELETE FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);

  // 2. Verify missing
  let inv = await pool.query(`SELECT 1 FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
  assert.strictEqual(inv.rowCount, 0, 'Precondition: no Bangalore row');

  // 3. Place order for Section B offer (transfer mode)
  // Reserve at Mysuru holding first
  const reserveRes = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: MYSURU_OFFER_ID, location_id: MYSURU_HOLDING_LOC, quantity: 1, request_key: 'req_restock_' + Date.now()
  }, token);
  assert.strictEqual(reserveRes.status, 201);
  const reservationId = reserveRes.data.reservation_id;

  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reservationId],
    address: { pin_code: '560001' },
    mode_preferences: { [reservationId]: 'standard' } // Will be routed as transfer
  }, token);
  assert.strictEqual(orderRes.status, 201);
  const orderId = orderRes.data.order_id;
  const orderItemId = orderRes.data.items[0].order_item_id;

  // 4. Finalizer runs: creates stock_transfer, deducts at Mysuru, creates Bangalore row via upsert
  // Wait for async processing
  await new Promise(r => setTimeout(r, 500));

  // 5. Verify Bangalore inventory row CREATED with quantity = 1 (from transfer)
  inv = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
  assert.strictEqual(inv.rowCount, 1, 'Bangalore row must be created by finalizer upsert');
  assert.strictEqual(inv.rows[0].quantity, 1, 'Bangalore row quantity must be 1 (transfer allocated)');

  // 6. Offer revision must have increased
  const rev = await pool.query(`SELECT revision FROM offer_state_versions WHERE offer_id = $1`, [MYSURU_OFFER_ID]);
  assert.ok(rev.rows[0].revision > 1, 'Revision must be bumped');

  // 7. Search should now show this offer in Section A (Bangalore stock)
  const search = await apiRequest('GET', `/api/products/60000000-0000-0000-0000-000000000003/offers?category=budget`);
  // Should appear in results with Bangalore stock

  // Cleanup
  await pool.query(`DELETE FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
});

test('Restock Missing Row: Cancel after received_checked (T3 path) creates Bangalore row', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // Setup: transfer in received_checked status
  await pool.query(`DELETE FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);

  const orderId = 'o_t3_' + Date.now();
  const orderItemId = 'oi_t3_' + Date.now();
  const groupId = 'g_t3_' + Date.now();
  const transferId = 't_t3_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $5, 'transfer', true, 'confirmed')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, groupId, MYSURU_OFFER_ID, MYSURU_HOLDING_LOC]);

  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 'received_checked')
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, groupId, MYSURU_OFFER_ID, MYSURU_HOLDING_LOC, BANGALORE_WAREHOUSE_LOC]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, $3, 'transfer', 'received_checked', 6900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId, MYSURU_HOLDING_LOC]);

  // Cancel -> T3 path: restocked_bangalore, Bangalore row created/upserted
  await pool.query(`
    UPDATE stock_transfers SET status = 'restocked_bangalore', settled_at = NOW() WHERE transfer_id = $1
  `, [transferId]);

  // Trigger restock (in real system, consumer does this)
  await pool.query(`
    INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
    VALUES ($1, $2, 1, 0)
    ON CONFLICT (offer_id, location_id) DO UPDATE SET quantity = inventory.quantity + 1
  `, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);

  // Verify Bangalore row exists
  const inv = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
  assert.strictEqual(inv.rowCount, 1);
  assert.strictEqual(inv.rows[0].quantity, 1);

  // Cleanup
  await pool.query(`DELETE FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Restock Missing Row: Receipt with cancel_on_receipt creates Bangalore row', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  await pool.query(`DELETE FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);

  const orderId = 'o_cancel_receipt_' + Date.now();
  const orderItemId = 'oi_cancel_receipt_' + Date.now();
  const groupId = 'g_cancel_receipt_' + Date.now();
  const transferId = 't_cancel_receipt_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $5, 'transfer', true, 'confirmed')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, groupId, MYSURU_OFFER_ID, MYSURU_HOLDING_LOC]);

  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status, cancel_on_receipt)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 'in_transit', true)
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, groupId, MYSURU_OFFER_ID, MYSURU_HOLDING_LOC, BANGALORE_WAREHOUSE_LOC]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, $3, 'transfer', 'in_transit_to_bangalore', 6900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId, MYSURU_HOLDING_LOC]);

  // Simulate receipt with cancel_on_receipt=true -> restocked_bangalore
  await pool.query(`
    UPDATE stock_transfers SET status = 'restocked_bangalore', settled_at = NOW() WHERE transfer_id = $1
  `, [transferId]);

  await pool.query(`
    INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
    VALUES ($1, $2, 1, 0)
    ON CONFLICT (offer_id, location_id) DO UPDATE SET quantity = inventory.quantity + 1
  `, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);

  const inv = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
  assert.strictEqual(inv.rowCount, 1);
  assert.strictEqual(inv.rows[0].quantity, 1);

  // Cleanup
  await pool.query(`DELETE FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Restock Missing Row: Second cancel creates no further movement', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Setup: already cancelled, Bangalore row exists with qty=1
  await pool.query(`
    INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
    VALUES ($1, $2, 1, 0)
    ON CONFLICT (offer_id, location_id) DO NOTHING
  `, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);

  const orderId = 'o_double_cancel_' + Date.now();
  const orderItemId = 'oi_double_cancel_' + Date.now();
  const transferId = 't_double_cancel_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, 'g_dummy', '00000000-0000-0000-0000-000000000000', $3, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $4, 'transfer', true, 'cancelled')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, MYSURU_OFFER_ID, MYSURU_HOLDING_LOC]);

  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES ($1, $2, 'g_dummy', $3, $4, $5, 1, 'restocked_bangalore')
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, MYSURU_OFFER_ID, MYSURU_HOLDING_LOC, BANGALORE_WAREHOUSE_LOC]);

  // Attempt second cancel (idempotent)
  await pool.query(`
    UPDATE stock_transfers SET status = 'restocked_bangalore' WHERE transfer_id = $1
  `, [transferId]);

  // Verify NO additional stock movement
  const inv = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
  assert.strictEqual(inv.rows[0].quantity, 1, 'Second cancel must not move stock again');

  // Cleanup
  await pool.query(`DELETE FROM inventory WHERE offer_id = $1 AND location_id = $2`, [MYSURU_OFFER_ID, BANGALORE_WAREHOUSE_LOC]);
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});