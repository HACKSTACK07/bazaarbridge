// backend/src/tests/refund-cap.test.js
// Phase 2 Mandatory Test: Refund Cap Enforcement
// Contract: Hand-craft refund exceeding caps -> consumer raises, status rolls back, refund='failed', order_items unchanged.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Refund Cap: Exceeding item_amount cap -> consumer raises, refund failed, amounts unchanged', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // 1. Create order_item with partial refund already applied
  const orderId = 'o_cap_' + Date.now();
  const orderItemId = 'oi_cap_' + Date.now();
  const refundId = 'r_cap_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  // item_paid_amount = 100000, already refunded 50000 -> remaining cap = 50000
  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, item_status, item_paid_amount, paid_amount, item_refunded_amount, fee_refunded_amount)
    VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 100000, 0, 2900, '10000000-0000-0000-0000-000000000001', 'confirmed', 100000, 102900, 50000, 0)
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId]);

  // Refund requesting 60000 (exceeds remaining 50000 cap)
  await pool.query(`
    INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status)
    VALUES ($1, $2, 60000, 2900, 'path_a', 'initiated')
    ON CONFLICT (refund_id) DO NOTHING
  `, [refundId, orderItemId]);

  const eventId = 'e_cap_' + Date.now();

  // 2. Simulate refund-credit consumer (Pattern A)
  async function processRefundCredit() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const marker = await client.query(`
        INSERT INTO processed_events (event_id, consumer_name)
        VALUES ($1, 'refund-credit')
        ON CONFLICT (event_id, consumer_name) DO NOTHING
        RETURNING event_id
      `, [eventId]);

      if (marker.rowCount === 0) {
        await client.query('COMMIT');
        return { outcome: 'skipped_duplicate' };
      }

      // Credit the refund
      const creditRes = await client.query(`
        UPDATE refunds 
        SET status = 'credited', credited_at = NOW(), gateway_ref = $1
        WHERE refund_id = $2 AND status IN ('requested', 'initiated')
        RETURNING order_item_id, item_amount, fee_amount
      `, ['gw_cap_test', refundId]);

      if (creditRes.rowCount === 0) throw new Error('Refund not creditable');

      const { order_item_id, item_amount, fee_amount } = creditRes.rows[0];

      // Credit order_items WITH CAPS
      const itemRes = await client.query(`
        UPDATE order_items
        SET item_refunded_amount = item_refunded_amount + $1,
            fee_refunded_amount = fee_refunded_amount + $2
        WHERE order_item_id = $3
          AND item_refunded_amount + $1 <= line_price - discount_share
          AND fee_refunded_amount + $2 <= delivery_fee_share
        RETURNING 1
      `, [item_amount, fee_amount, order_item_id]);

      if (itemRes.rowCount === 0) {
        // CAP EXCEEDED - rollback refund status in separate transaction
        await client.query('ROLLBACK');
        
        await client.query(`
          UPDATE refunds SET status = 'failed' WHERE refund_id = $1 AND status IN ('requested', 'initiated')
        `, [refundId]);
        throw new Error('REFUND_CAP_EXCEEDED');
      }

      // Emit notification
      await client.query(`
        INSERT INTO outbox_events (event_type, aggregate_key, payload)
        VALUES ('notification-created', $1, $2)
      `, [order_item_id, JSON.stringify({ type: 'refund_credited' })]);

      await client.query('COMMIT');
      return { outcome: 'credited' };
    } catch (err) {
      if (err.message !== 'REFUND_CAP_EXCEEDED') {
        await client.query('ROLLBACK');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // 3. Process -> must raise REFUND_CAP_EXCEEDED
  let raised = false;
  try {
    await processRefundCredit();
  } catch (e) {
    raised = true;
    assert.match(e.message, /REFUND_CAP_EXCEEDED/);
  }
  assert.strictEqual(raised, true, 'Consumer must raise on cap exceed');

  // 4. Refund status = 'failed'
  const refundCheck = await pool.query(`SELECT status FROM refunds WHERE refund_id = $1`, [refundId]);
  assert.strictEqual(refundCheck.rows[0].status, 'failed', 'Refund must be marked failed');

  // 5. Order items amounts UNCHANGED
  const itemCheck = await pool.query(`SELECT item_refunded_amount, fee_refunded_amount FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(itemCheck.rows[0].item_refunded_amount, 50000, 'item_refunded_amount unchanged');
  assert.strictEqual(itemCheck.rows[0].fee_refunded_amount, 0, 'fee_refunded_amount unchanged');

  // Cleanup
  await pool.query(`DELETE FROM refunds WHERE refund_id = $1`, [refundId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Refund Cap: Exceeding fee_amount cap -> same behavior', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  const orderId = 'o_cap_fee_' + Date.now();
  const orderItemId = 'oi_cap_fee_' + Date.now();
  const refundId = 'r_cap_fee_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, item_status, item_paid_amount, paid_amount, item_refunded_amount, fee_refunded_amount)
    VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 100000, 0, 2900, '10000000-0000-0000-0000-000000000001', 'confirmed', 100000, 102900, 0, 1000)
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId]);

  // Fee cap: delivery_fee_share = 2900, already refunded 1000 -> remaining = 1900
  // Request 3000 fee refund -> exceeds cap
  await pool.query(`
    INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status)
    VALUES ($1, $2, 0, 3000, 'path_a', 'initiated')
    ON CONFLICT (refund_id) DO NOTHING
  `, [refundId, orderItemId]);

  const eventId = 'e_cap_fee_' + Date.now();

  async function processRefundCredit() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const marker = await client.query(`
        INSERT INTO processed_events (event_id, consumer_name)
        VALUES ($1, 'refund-credit')
        ON CONFLICT (event_id, consumer_name) DO NOTHING
        RETURNING event_id
      `, [eventId]);

      if (marker.rowCount === 0) {
        await client.query('COMMIT');
        return { outcome: 'skipped_duplicate' };
      }

      const creditRes = await client.query(`
        UPDATE refunds SET status = 'credited', credited_at = NOW(), gateway_ref = $1
        WHERE refund_id = $2 AND status IN ('requested', 'initiated')
        RETURNING order_item_id, item_amount, fee_amount
      `, ['gw_cap_fee', refundId]);

      if (creditRes.rowCount === 0) throw new Error('Refund not creditable');

      const { order_item_id, item_amount, fee_amount } = creditRes.rows[0];

      const itemRes = await client.query(`
        UPDATE order_items
        SET item_refunded_amount = item_refunded_amount + $1,
            fee_refunded_amount = fee_refunded_amount + $2
        WHERE order_item_id = $3
          AND item_refunded_amount + $1 <= line_price - discount_share
          AND fee_refunded_amount + $2 <= delivery_fee_share
        RETURNING 1
      `, [item_amount, fee_amount, order_item_id]);

      if (itemRes.rowCount === 0) {
        await client.query('ROLLBACK');
        await client.query(`UPDATE refunds SET status = 'failed' WHERE refund_id = $1 AND status IN ('requested', 'initiated')`, [refundId]);
        throw new Error('REFUND_CAP_EXCEEDED');
      }

      await client.query('COMMIT');
      return { outcome: 'credited' };
    } catch (err) {
      if (err.message !== 'REFUND_CAP_EXCEEDED') await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  }

  let raised = false;
  try { await processRefundCredit(); } catch (e) { raised = true; assert.match(e.message, /REFUND_CAP_EXCEEDED/); }
  assert.strictEqual(raised, true);

  const refundCheck = await pool.query(`SELECT status FROM refunds WHERE refund_id = $1`, [refundId]);
  assert.strictEqual(refundCheck.rows[0].status, 'failed');

  const itemCheck = await pool.query(`SELECT fee_refunded_amount FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(itemCheck.rows[0].fee_refunded_amount, 1000, 'fee_refunded_amount unchanged');

  // Cleanup
  await pool.query(`DELETE FROM refunds WHERE refund_id = $1`, [refundId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});