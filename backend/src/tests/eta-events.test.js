// backend/src/tests/eta-events.test.js
// Phase 1 Test: Event Pipeline - ETA Updated Event Emission
// Contract: Material ETA changes emit eta-updated outbox event keyed by group_id

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Event Pipeline: ETA Updated Event Emitted on Material Change', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // 1. Create a test fulfilment group with ETA
  const groupId = 'g_eta_test_' + Date.now();
  const orderId = 'o_eta_test_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, eta_window_start, eta_window_end, eta_basis, otp_hash)
    VALUES ($1, $2, '10000000-0000-0000-0000-000000000001', 'standard', 'order_accepted', 2900, NOW(), NOW() + INTERVAL '2 days', '{"basis":"standard"}', 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId]);

  // 2. Simulate picking queue change that materially affects ETA
  // (In real implementation, this would be triggered by order_accepted event)
  const initialEta = await pool.query(`
    SELECT eta_window_start, eta_window_end FROM fulfilment_groups WHERE group_id = $1
  `, [groupId]);

  // 3. Update ETA (simulating what fulfilment-pipeline would do)
  await pool.query(`
    UPDATE fulfilment_groups 
    SET eta_window_start = NOW() + INTERVAL '1 hour',
        eta_window_end = NOW() + INTERVAL '3 hours',
        eta_basis = '{"basis":"standard","picking_queue":5}'
    WHERE group_id = $1
  `, [groupId]);

  // 4. Verify outbox event was created
  const outboxCheck = await pool.query(`
    SELECT 1 FROM outbox_events 
    WHERE event_type = 'eta-updated' 
    AND aggregate_key = $1
    AND payload->>'group_id' = $1
    AND created_at > NOW() - INTERVAL '1 minute'
  `, [groupId]);

  assert.strictEqual(outboxCheck.rowCount, 1, 'eta-updated outbox event must be emitted on ETA change');
  assert.strictEqual(outboxCheck.rows[0]?.aggregate_key, groupId, 'Event key must be group_id');

  // 5. Verify payload structure
  const payloadCheck = await pool.query(`
    SELECT payload FROM outbox_events 
    WHERE event_type = 'eta-updated' AND aggregate_key = $1
    ORDER BY created_at DESC LIMIT 1
  `, [groupId]);

  const payload = payloadCheck.rows[0]?.payload;
  assert.ok(payload, 'Event must have payload');
  assert.strictEqual(payload.group_id, groupId, 'Payload must contain group_id');
  assert.ok(payload.eta_window_start, 'Payload must contain eta_window_start');
  assert.ok(payload.eta_window_end, 'Payload must contain eta_window_end');
  assert.ok(payload.eta_basis, 'Payload must contain eta_basis');

  // Cleanup
  await pool.query(`DELETE FROM outbox_events WHERE event_type = 'eta-updated' AND aggregate_key = $1`, [groupId]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Event Pipeline: ETA Updated NOT emitted on non-material change', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  const groupId = 'g_eta_test2_' + Date.now();
  const orderId = 'o_eta_test2_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, eta_window_start, eta_window_end, eta_basis, otp_hash)
    VALUES ($1, $2, '10000000-0000-0000-0000-000000000001', 'standard', 'order_accepted', 2900, NOW(), NOW() + INTERVAL '2 days', '{"basis":"standard"}', 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId]);

  // Non-material update (same ETA window, just internal note)
  await pool.query(`
    UPDATE fulfilment_groups 
    SET eta_basis = '{"basis":"standard","note":"internal update"}'
    WHERE group_id = $1
  `, [groupId]);

  // Should NOT emit eta-updated
  const outboxCheck = await pool.query(`
    SELECT 1 FROM outbox_events 
    WHERE event_type = 'eta-updated' AND aggregate_key = $1
    AND created_at > NOW() - INTERVAL '1 minute'
  `, [groupId]);

  assert.strictEqual(outboxCheck.rowCount, 0, 'eta-updated must NOT be emitted for non-material changes');

  // Cleanup
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});