// backend/src/tests/transfer-flow.test.js
// Phase 2 Mandatory Test: Stock Transfer Flow
// Contract: Finalizer deducts at HOLDING + creates transfer row (with offer_id); group reserved_at_origin -> transfer_requested.
// Drive in_transit -> received_checked -> allocated as THREE events.
// received_checked does NOT allocate and changes NO quantity.
// Allocated sets stock_location_id to Bangalore and STILL changes no quantity.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

const TRANSFER_OFFER_ID = '70000000-0000-0000-0000-000000000009'; // SonicAir Earbuds
const MYSURU_HOLDING = '10000000-0000-0000-0000-000000000004';
const BANGALORE_WAREHOUSE = '10000000-0000-0000-0000-000000000001';

test('Transfer Flow: Finalizer deducts at HOLDING, creates transfer row with offer_id, group reserved_at_origin -> transfer_requested', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // 1. Reset stock at Mysuru Holding
  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [TRANSFER_OFFER_ID, MYSURU_HOLDING]);

  // 2. Reserve at Mysuru Holding
  const reserveRes = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: TRANSFER_OFFER_ID, location_id: MYSURU_HOLDING, quantity: 1, request_key: 'req_transfer_' + Date.now()
  }, token);
  assert.strictEqual(reserveRes.status, 201);
  const reservationId = reserveRes.data.reservation_id;

  // 3. Place order (should be routed as transfer)
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reservationId],
    address: { pin_code: '560001' },
    mode_preferences: { [reservationId]: 'standard' }
  }, token);
  assert.strictEqual(orderRes.status, 201);
  const orderId = orderRes.data.order_id;
  const orderItemId = orderRes.data.items[0].order_item_id;
  const groupId = orderRes.data.groups[0].group_id;

  // 4. Wait for finalizer to process
  await new Promise(r => setTimeout(r, 500));

  // 5. Verify: Finalizer deducted at HOLDING location
  let inv = await pool.query(`SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [TRANSFER_OFFER_ID, MYSURU_HOLDING]);
  assert.strictEqual(inv.rows[0].quantity, 9, 'Holding location quantity deducted');
  assert.strictEqual(inv.rows[0].reserved_quantity, 0, 'Reserved restored');

  // 6. Verify: stock_transfers row created with offer_id, status='transfer_requested' (or 'requested' -> 'transfer_requested')
  const transfer = await pool.query(`
    SELECT transfer_id, status, offer_id, from_location_id, to_location_id, quantity
    FROM stock_transfers WHERE order_item_id = $1
  `, [orderItemId]);
  assert.strictEqual(transfer.rowCount, 1, 'Transfer row must be created');
  assert.strictEqual(transfer.rows[0].offer_id, TRANSFER_OFFER_ID, 'Transfer must carry offer_id (v7.1)');
  assert.strictEqual(transfer.rows[0].from_location_id, MYSURU_HOLDING);
  assert.strictEqual(transfer.rows[0].to_location_id, BANGALORE_WAREHOUSE);
  assert.strictEqual(transfer.rows[0].quantity, 1);
  assert.ok(['requested', 'transfer_requested'].includes(transfer.rows[0].status), 'Status must be requested/transfer_requested');

  // 7. Verify: fulfilment_group status = 'reserved_at_origin' -> 'transfer_requested'
  const group = await pool.query(`SELECT status, mode FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  assert.strictEqual(group.rows[0].mode, 'transfer');
  assert.ok(['reserved_at_origin', 'transfer_requested'].includes(group.rows[0].status));
});

test('Transfer Flow: Three events - in_transit -> received_checked -> allocated', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Setup: transfer in 'transfer_requested' state
  const orderId = 'o_transfer_events_' + Date.now();
  const orderItemId = 'oi_transfer_events_' + Date.now();
  const groupId = 'g_transfer_events_' + Date.now();
  const transferId = 't_transfer_events_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $5, 'transfer', true, 'confirmed')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, groupId, TRANSFER_OFFER_ID, MYSURU_HOLDING]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, $3, 'transfer', 'reserved_at_origin', 6900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId, MYSURU_HOLDING]);

  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 'transfer_requested')
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, groupId, TRANSFER_OFFER_ID, MYSURU_HOLDING, BANGALORE_WAREHOUSE]);

  // 1. Event: in_transit
  await pool.query(`
    UPDATE stock_transfers SET status = 'in_transit', in_transit_at = NOW() WHERE transfer_id = $1
  `, [transferId]);
  await pool.query(`
    UPDATE fulfilment_groups SET status = 'in_transit_to_bangalore' WHERE group_id = $1
  `, [groupId]);
  await pool.query(`
    INSERT INTO outbox_events (event_type, aggregate_key, payload)
    VALUES ('stock-transfer-status-updated', $1, $2)
  `, [groupId, JSON.stringify({ group_id: groupId, event_type: 'in_transit' })]);

  // 2. Event: received_checked - does NOT allocate, changes NO quantity
  await pool.query(`
    UPDATE stock_transfers SET status = 'received_checked', received_at = NOW() WHERE transfer_id = $1
  `, [transferId]);
  await pool.query(`
    UPDATE fulfilment_groups SET status = 'received_checked' WHERE group_id = $1
  `, [groupId]);
  await pool.query(`
    INSERT INTO outbox_events (event_type, aggregate_key, payload)
    VALUES ('stock-transfer-status-updated', $1, $2)
  `, [groupId, JSON.stringify({ group_id: groupId, event_type: 'received_checked' })]);

  // Verify: NO quantity changes at either location
  let invHolding = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [TRANSFER_OFFER_ID, MYSURU_HOLDING]);
  let invBLR = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [TRANSFER_OFFER_ID, BANGALORE_WAREHOUSE]);
  
  // Quantity at holding already deducted by finalizer (9), Bangalore still 0
  assert.strictEqual(invHolding.rows[0].quantity, 9, 'Holding unchanged after received_checked');
  assert.strictEqual(invBLR.rows[0]?.quantity || 0, 0, 'Bangalore unchanged after received_checked');

  // 3. Event: allocated - sets stock_location_id to Bangalore, STILL no quantity change
  await pool.query(`
    UPDATE stock_transfers SET status = 'allocated', allocated_at = NOW() WHERE transfer_id = $1
  `, [transferId]);
  await pool.query(`
    UPDATE order_items SET stock_location_id = $1 WHERE order_item_id = $2
  `, [BANGALORE_WAREHOUSE, orderItemId]);
  await pool.query(`
    UPDATE fulfilment_groups SET status = 'allocated', location_id = $1 WHERE group_id = $2
  `, [BANGALORE_WAREHOUSE, groupId]);
  await pool.query(`
    INSERT INTO outbox_events (event_type, aggregate_key, payload)
    VALUES ('stock-transfer-status-updated', $1, $2)
  `, [groupId, JSON.stringify({ group_id: groupId, event_type: 'allocated' })]);

  // Verify: Bangalore row created/upserted, order_item stock_location_id = Bangalore, STILL no quantity change
  const itemCheck = await pool.query(`SELECT stock_location_id FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(itemCheck.rows[0].stock_location_id, BANGALORE_WAREHOUSE, 'Order item stock_location_id must be Bangalore');

  const groupCheck = await pool.query(`SELECT location_id, status FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  assert.strictEqual(groupCheck.rows[0].location_id, BANGALORE_WAREHOUSE);
  assert.strictEqual(groupCheck.rows[0].status, 'allocated');

  // 4. Verify exactly THREE outbox events
  const events = await pool.query(`
    SELECT payload->>'event_type' as event_type FROM outbox_events
    WHERE event_type = 'stock-transfer-status-updated' AND aggregate_key = $1
    ORDER BY created_at
  `, [groupId]);
  assert.strictEqual(events.rowCount, 3, 'Exactly 3 events must be emitted');
  const types = events.rows.map(r => r.event_type);
  assert.deepStrictEqual(types, ['in_transit', 'received_checked', 'allocated']);

  // Cleanup
  await pool.query(`DELETE FROM outbox_events WHERE event_type = 'stock-transfer-status-updated' AND aggregate_key = $1`, [groupId]);
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Transfer Flow: received_checked does NOT change quantity', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Setup fresh transfer
  const orderId = 'o_t_rc_' + Date.now();
  const orderItemId = 'oi_t_rc_' + Date.now();
  const groupId = 'g_t_rc_' + Date.now();
  const transferId = 't_t_rc_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $5, 'transfer', true, 'confirmed')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, groupId, TRANSFER_OFFER_ID, MYSURU_HOLDING]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, $3, 'transfer', 'in_transit_to_bangalore', 6900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId, MYSURU_HOLDING]);

  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 'in_transit')
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, groupId, TRANSFER_OFFER_ID, MYSURU_HOLDING, BANGALORE_WAREHOUSE]);

  // Transition to received_checked
  await pool.query(`
    UPDATE stock_transfers SET status = 'received_checked', received_at = NOW() WHERE transfer_id = $1
  `, [transferId]);
  await pool.query(`
    UPDATE fulfilment_groups SET status = 'received_checked' WHERE group_id = $1
  `, [groupId]);

  // Verify NO quantity changes
  const invHolding = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [TRANSFER_OFFER_ID, MYSURU_HOLDING]);
  const invBLR = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [TRANSFER_OFFER_ID, BANGALORE_WAREHOUSE]);
  
  assert.strictEqual(invHolding.rows[0].quantity, 9, 'Holding unchanged');
  assert.strictEqual(invBLR.rows[0]?.quantity || 0, 0, 'Bangalore unchanged (units still in transit)');

  // Cleanup
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Transfer Flow: allocated sets stock_location_id to Bangalore, no quantity change', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Setup: transfer at received_checked
  const orderId = 'o_t_alloc_' + Date.now();
  const orderItemId = 'oi_t_alloc_' + Date.now();
  const groupId = 'g_t_alloc_' + Date.now();
  const transferId = 't_t_alloc_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $5, 'transfer', true, 'confirmed')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, groupId, TRANSFER_OFFER_ID, MYSURU_HOLDING]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, $3, 'transfer', 'received_checked', 6900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId, MYSURU_HOLDING]);

  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 'received_checked')
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, groupId, TRANSFER_OFFER_ID, MYSURU_HOLDING, BANGALORE_WAREHOUSE]);

  // Allocate
  await pool.query(`
    UPDATE stock_transfers SET status = 'allocated', allocated_at = NOW() WHERE transfer_id = $1
  `, [transferId]);
  await pool.query(`
    UPDATE order_items SET stock_location_id = $1 WHERE order_item_id = $2
  `, [BANGALORE_WAREHOUSE, orderItemId]);
  await pool.query(`
    UPDATE fulfilment_groups SET status = 'allocated', location_id = $1 WHERE group_id = $2
  `, [BANGALORE_WAREHOUSE, groupId]);

  // Verify stock_location_id = Bangalore
  const item = await pool.query(`SELECT stock_location_id FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(item.rows[0].stock_location_id, BANGALORE_WAREHOUSE);

  // Verify group location updated
  const group = await pool.query(`SELECT location_id, status FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  assert.strictEqual(group.rows[0].location_id, BANGALORE_WAREHOUSE);
  assert.strictEqual(group.rows[0].status, 'allocated');

  // Verify NO quantity change (units still in transit, now allocated to this order)
  const invBLR = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [TRANSFER_OFFER_ID, BANGALORE_WAREHOUSE]);
  assert.strictEqual(invBLR.rows[0]?.quantity || 0, 0, 'Bangalore quantity unchanged (units allocated to order, not free stock)');

  // Cleanup
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});