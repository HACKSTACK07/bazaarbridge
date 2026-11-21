// backend/src/tests/double-refund.test.js
// Phase 2 Mandatory Test: Double Refund Prevention
// Contract: POST /api/admin/refunds/:id/credit TWICE concurrently -> exactly one credit; amounts capped at paid; third call no-op. Unique constraint on (order_item_id, kind).

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

test('Double Refund: Concurrent credit requests -> exactly one credit', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // 1. Create order with known amounts
  const orderId = 'o_dbl_ref_' + Date.now();
  const orderItemId = 'oi_dbl_ref_' + Date.now();
  const refundId = 'r_dbl_ref_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, item_status, item_paid_amount, paid_amount, item_refunded_amount, fee_refunded_amount)
    VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 100000, 0, 2900, '10000000-0000-0000-0000-000000000001', 'confirmed', 100000, 102900, 0, 0)
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId]);

  await pool.query(`
    INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status, gateway_ref)
    VALUES ($1, $2, 100000, 2900, 'path_a', 'initiated', 'gw_initial')
    ON CONFLICT (refund_id) DO NOTHING
  `, [refundId, orderItemId]);

  // 2. Fire TWO concurrent admin credit requests
  const [credit1, credit2] = await Promise.all([
    apiRequest('POST', `/api/admin/refunds/${refundId}/credit`, { gateway_ref: 'gw_concurrent_1' }, token),
    apiRequest('POST', `/api/admin/refunds/${refundId}/credit`, { gateway_ref: 'gw_concurrent_2' }, token)
  ]);

  const statuses = [credit1.status, credit2.status].sort();
  assert.strictEqual(statuses[0], 202, 'One credit must succeed (202)');
  assert.strictEqual(statuses[1], 202, 'Second also returns 202 (idempotent event creation)');

  // 3. Wait for refund-credit consumer to process
  await new Promise(r => setTimeout(r, 500));

  // 4. Verify: refund status = 'credited', amounts = paid amounts
  const refundCheck = await pool.query(`SELECT status, credited_at, gateway_ref FROM refunds WHERE refund_id = $1`, [refundId]);
  assert.strictEqual(refundCheck.rows[0].status, 'credited');
  assert.ok(refundCheck.rows[0].credited_at);
  assert.ok(refundCheck.rows[0].gateway_ref);

  const itemCheck = await pool.query(`SELECT item_refunded_amount, fee_refunded_amount, refunded_amount FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(itemCheck.rows[0].item_refunded_amount, 100000, 'item_refunded_amount = item_paid_amount');
  assert.strictEqual(itemCheck.rows[0].fee_refunded_amount, 2900, 'fee_refunded_amount = delivery_fee_share');
  assert.strictEqual(itemCheck.rows[0].refunded_amount, 102900, 'refunded_amount = paid_amount');

  // 5. THIRD credit call after completion -> no second credit
  const credit3 = await apiRequest('POST', `/api/admin/refunds/${refundId}/credit`, { gateway_ref: 'gw_third' }, token);
  assert.strictEqual(credit3.status, 202);

  await new Promise(r => setTimeout(r, 500));

  const itemCheck2 = await pool.query(`SELECT item_refunded_amount, fee_refunded_amount FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(itemCheck2.rows[0].item_refunded_amount, 100000, 'Third call must not increase refund');
  assert.strictEqual(itemCheck2.rows[0].fee_refunded_amount, 2900);
});

test('Double Refund: Unique constraint on (order_item_id, kind) rejects second refunds row', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Try to insert second refunds row with same (order_item_id, kind)
  const orderItemId = 'oi_unique_' + Date.now();
  const refundId1 = 'r_unique_1_' + Date.now();
  const refundId2 = 'r_unique_2_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, item_status)
    VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 100000, 0, 2900, '10000000-0000-0000-0000-000000000001', 'confirmed')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId]);

  // First refund row
  await pool.query(`
    INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status)
    VALUES ($1, $2, 100000, 2900, 'path_a', 'requested')
    ON CONFLICT (refund_id) DO NOTHING
  `, [refundId1, orderItemId]);

  // Second refund row with SAME (order_item_id, kind) -> must violate unique constraint
  let violated = false;
  try {
    await pool.query(`
      INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status)
      VALUES ($1, $2, 100000, 2900, 'path_a', 'requested')
      ON CONFLICT (refund_id) DO NOTHING
    `, [refundId2, orderItemId]);
  } catch (e) {
    violated = true;
    assert.match(e.message, /unique constraint|duplicate key/i);
  }
  assert.strictEqual(violated, true, 'Unique constraint on (order_item_id, kind) must reject second row');

  // Cleanup
  await pool.query(`DELETE FROM refunds WHERE refund_id IN ($1, $2)`, [refundId1, refundId2]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});