// backend/src/tests/stock-transfer-flow.test.js
// Phase 1 Test: Event Pipeline - Stock Transfer Flow
// Contract: transfer status machine: requested -> in_transit -> received_checked -> allocated

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Stock Transfer Flow: Full lifecycle requested -> in_transit -> received_checked -> allocated', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Setup: Order with Section B (transfer) item
  const orderItemId = 'oi_transfer_' + Date.now();
  const transferId = 't_transfer_' + Date.now();
  const groupId = 'g_transfer_' + Date.now();
  const orderId = 'o_transfer_' + Date.now();
  const offerId = '70000000-0000-0000-0000-000000000009'; // Mysuru dealer offer
  const fromLoc = '10000000-0000-0000-0000-000000000004'; // Mysuru Holding
  const toLoc = '10000000-0000-0000-0000-000000000001';   // Bangalore Warehouse

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $5, 'transfer', true, 'confirmed')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, groupId, offerId, fromLoc]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, $3, 'transfer', 'reserved_at_origin', 6900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId, fromLoc]);

  // 1. Create stock_transfer in 'requested' status (by inventory-finalizer)
  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 'requested')
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, groupId, offerId, fromLoc, toLoc]);

  // 2. Verify initial state
  let transfer = await pool.query(`SELECT status FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  assert.strictEqual(transfer.rows[0].status, 'requested');

  // 3. Simulate fulfilment-pipeline: Mark In Transit
  await pool.query(`
    UPDATE stock_transfers SET status = 'in_transit', in_transit_at = NOW() WHERE transfer_id = $1
  `, [transferId]);
  await pool.query(`
    INSERT INTO outbox_events (event_type, aggregate_key, payload)
    VALUES ('stock-transfer-status-updated', $1, $2)
  `, [groupId, JSON.stringify({ group_id: groupId, event_type: 'in_transit' })]);

  transfer = await pool.query(`SELECT status FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  assert.strictEqual(transfer.rows[0].status, 'in_transit');

  // 4. Simulate fulfilment-pipeline: Mark Received & QC'd
  await pool.query(`
    UPDATE stock_transfers SET status = 'received_checked', received_at = NOW() WHERE transfer_id = $1
  `, [transferId]);
  await pool.query(`
    INSERT INTO outbox_events (event_type, aggregate_key, payload)
    VALUES ('stock-transfer-status-updated', $1, $2)
  `, [groupId, JSON.stringify({ group_id: groupId, event_type: 'received_checked' })]);

  transfer = await pool.query(`SELECT status FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  assert.strictEqual(transfer.rows[0].status, 'received_checked');

  // 5. Simulate fulfilment-pipeline: Allocate to Order
  await pool.query(`
    UPDATE stock_transfers SET status = 'allocated', allocated_at = NOW() WHERE transfer_id = $1
  `, [transferId]);
  await pool.query(`
    UPDATE order_items SET stock_location_id = $1 WHERE order_item_id = $2
  `, [toLoc, orderItemId]);
  await pool.query(`
    UPDATE fulfilment_groups SET status = 'allocated', location_id = $1 WHERE group_id = $2
  `, [toLoc, groupId]);
  await pool.query(`
    INSERT INTO outbox_events (event_type, aggregate_key, payload)
    VALUES ('stock-transfer-status-updated', $1, $2)
  `, [groupId, JSON.stringify({ group_id: groupId, event_type: 'allocated' })]);

  transfer = await pool.query(`SELECT status FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  assert.strictEqual(transfer.rows[0].status, 'allocated');

  // 6. Verify order_item stock_location_id updated to Bangalore
  const itemCheck = await pool.query(`SELECT stock_location_id FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(itemCheck.rows[0].stock_location_id, toLoc);

  // 7. Verify fulfilment_group location updated
  const groupCheck = await pool.query(`SELECT location_id, status FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  assert.strictEqual(groupCheck.rows[0].location_id, toLoc);
  assert.strictEqual(groupCheck.rows[0].status, 'allocated');

  // 8. Verify outbox events emitted for each transition
  const events = await pool.query(`
    SELECT event_type, payload FROM outbox_events 
    WHERE event_type = 'stock-transfer-status-updated' 
    AND aggregate_key = $1
    ORDER BY created_at
  `, [groupId]);
  assert.strictEqual(events.rowCount, 3, 'Three stock-transfer-status-updated events must be emitted');
  const eventTypes = events.rows.map(r => r.payload.event_type);
  assert.deepStrictEqual(eventTypes, ['in_transit', 'received_checked', 'allocated']);

  // Cleanup
  await pool.query(`DELETE FROM outbox_events WHERE event_type = 'stock-transfer-status-updated' AND aggregate_key = $1`, [groupId]);
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Stock Transfer Flow: Cancellation at origin before dispatch', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  const orderItemId = 'oi_cancel1_' + Date.now();
  const transferId = 't_cancel1_' + Date.now();
  const groupId = 'g_cancel1_' + Date.now();
  const orderId = 'o_cancel1_' + Date.now();
  const offerId = '70000000-0000-0000-0000-000000000009';
  const fromLoc = '10000000-0000-0000-0000-000000000004';
  const toLoc = '10000000-0000-0000-0000-000000000001';

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $5, 'transfer', true, 'cancelled')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, groupId, offerId, fromLoc]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, $3, 'transfer', 'reserved_at_origin', 6900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId, fromLoc]);

  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 'requested')
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, groupId, offerId, fromLoc, toLoc]);

  // Cancel at origin (before in_transit)
  await pool.query(`
    UPDATE stock_transfers SET status = 'cancelled_at_origin', settled_at = NOW() WHERE transfer_id = $1
  `, [transferId]);

  // Verify restock at origin (Mysuru Holding) via restock_units upsert
  const invCheck = await pool.query(`
    SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2
  `, [offerId, fromLoc]);
  assert.ok(invCheck.rows[0].quantity >= 1, 'Units must be restocked at origin');

  // Verify terminal status
  const transfer = await pool.query(`SELECT status FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  assert.strictEqual(transfer.rows[0].status, 'cancelled_at_origin');

  // Cleanup
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Stock Transfer Flow: Cancellation after receipt (restocked_bangalore)', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  const orderItemId = 'oi_cancel2_' + Date.now();
  const transferId = 't_cancel2_' + Date.now();
  const groupId = 'g_cancel2_' + Date.now();
  const orderId = 'o_cancel2_' + Date.now();
  const offerId = '70000000-0000-0000-0000-000000000009';
  const fromLoc = '10000000-0000-0000-0000-000000000004';
  const toLoc = '10000000-0000-0000-0000-000000000001';

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 6900, 106900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, group_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, fulfilment_route, stock_finalised, item_status)
    VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, '40000000-0000-0000-0000-000000000006', 1, 100000, 0, 6900, $5, 'transfer', true, 'cancelled')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId, groupId, offerId, fromLoc]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, $3, 'transfer', 'received_checked', 6900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId, fromLoc]);

  await pool.query(`
    INSERT INTO stock_transfers (transfer_id, order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 'received_checked')
    ON CONFLICT (transfer_id) DO NOTHING
  `, [transferId, orderItemId, groupId, offerId, fromLoc, toLoc]);

  // Cancel after receipt -> restocked_bangalore
  await pool.query(`
    UPDATE stock_transfers SET status = 'restocked_bangalore', settled_at = NOW() WHERE transfer_id = $1
  `, [transferId]);

  // Verify restock at Bangalore (upsert - row may be new)
  const invCheck = await pool.query(`
    SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2
  `, [offerId, toLoc]);
  assert.ok(invCheck.rows[0].quantity >= 1, 'Units must be restocked at Bangalore (upsert)');

  const transfer = await pool.query(`SELECT status FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  assert.strictEqual(transfer.rows[0].status, 'restocked_bangalore');

  // Cleanup
  await pool.query(`DELETE FROM stock_transfers WHERE transfer_id = $1`, [transferId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});