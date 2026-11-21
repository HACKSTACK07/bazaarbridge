// backend/src/tests/refund-flow.test.js
// Phase 1 Test: Event Pipeline - Refund Credit Flow
// Contract: refund-credit-requested -> refund-credit consumer -> credits money -> notification-created

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Refund Flow: refund-credit-requested leads to credited status and notification', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // 1. Create test order_item and refund
  const orderItemId = 'oi_refund_' + Date.now();
  const refundId = 'r_refund_' + Date.now();
  const eventId = 'e_refund_credit_' + Date.now();
  const orderId = 'o_refund_' + Date.now();
  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, item_status)
    VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 100000, 0, 2900, '10000000-0000-0000-0000-000000000001', 'placed')
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId]);

  await pool.query(`
    INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status)
    VALUES ($1, $2, 100000, 2900, 'path_a', 'initiated')
    ON CONFLICT (refund_id) DO NOTHING
  `, [refundId, orderItemId]);

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

      // Credit the refund (gate: status in requested/initiated)
      const creditRes = await client.query(`
        UPDATE refunds 
        SET status = 'credited', credited_at = NOW(), gateway_ref = $1
        WHERE refund_id = $2 AND status IN ('requested', 'initiated')
        RETURNING order_item_id, item_amount, fee_amount
      `, ['gw_ref_' + Date.now(), refundId]);

      if (creditRes.rowCount === 0) {
        // Check if already credited
        const check = await client.query(`SELECT status FROM refunds WHERE refund_id = $1`, [refundId]);
        if (check.rows[0]?.status === 'credited') {
          await client.query('COMMIT');
          return { outcome: 'already_credited' };
        }
        throw new Error('Refund not in creditable state');
      }

      const { order_item_id, item_amount, fee_amount } = creditRes.rows[0];

      // Credit order_items (with caps)
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
        throw new Error('REFUND_CAP_EXCEEDED');
      }

      // Emit notification-created outbox event
      await client.query(`
        INSERT INTO outbox_events (event_type, aggregate_key, payload)
        VALUES ('notification-created', $1, $2)
      `, [order_item_id, JSON.stringify({ 
        user_id: '30000000-0000-0000-0000-000000000001',
        message: 'Refund credited (SAMPLE)',
        event_ref: eventId,
        type: 'refund_credited'
      })]);

      await client.query('COMMIT');
      return { outcome: 'credited' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // 3. Process refund credit
  const result = await processRefundCredit();
  assert.strictEqual(result.outcome, 'credited');

  // 4. Verify refund status = credited
  const refundCheck = await pool.query(`
    SELECT status, credited_at, gateway_ref FROM refunds WHERE refund_id = $1
  `, [refundId]);
  assert.strictEqual(refundCheck.rows[0].status, 'credited');
  assert.ok(refundCheck.rows[0].credited_at);
  assert.ok(refundCheck.rows[0].gateway_ref);

  // 5. Verify order_items amounts updated
  const itemCheck = await pool.query(`
    SELECT item_refunded_amount, fee_refunded_amount FROM order_items WHERE order_item_id = $1
  `, [orderItemId]);
  assert.strictEqual(itemCheck.rows[0].item_refunded_amount, 100000);
  assert.strictEqual(itemCheck.rows[0].fee_refunded_amount, 2900);

  // 6. Verify outbox notification-created event
  const notifCheck = await pool.query(`
    SELECT 1 FROM outbox_events 
    WHERE event_type = 'notification-created' 
    AND payload->>'type' = 'refund_credited'
    AND created_at > NOW() - INTERVAL '1 minute'
  `);
  assert.strictEqual(notifCheck.rowCount, 1, 'notification-created outbox event must be emitted');

  // 7. Retry - should be idempotent
  const retryResult = await processRefundCredit();
  assert.strictEqual(retryResult.outcome, 'skipped_duplicate', 'Retry must be skipped as duplicate');

  // Cleanup
  await pool.query(`DELETE FROM outbox_events WHERE event_type = 'notification-created' AND payload->>'type' = 'refund_credited'`);
  await pool.query(`DELETE FROM processed_events WHERE event_id = $1`, [eventId]);
  await pool.query(`DELETE FROM refunds WHERE refund_id = $1`, [refundId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Refund Flow: Double refund prevention (cap enforcement)', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Setup: refund already partially credited
  const orderItemId = 'oi_refund2_' + Date.now();
  const refundId = 'r_refund2_' + Date.now();
  const eventId = 'e_refund_credit2_' + Date.now();
  const orderId = 'o_refund2_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, item_status, item_refunded_amount, fee_refunded_amount)
    VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 100000, 0, 2900, '10000000-0000-0000-0000-000000000001', 'placed', 50000, 0)
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId]);

  await pool.query(`
    INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status)
    VALUES ($1, $2, 60000, 2900, 'path_a', 'initiated')
    ON CONFLICT (refund_id) DO NOTHING
  `, [refundId, orderItemId]);

  // Attempt to credit 60000 when only 50000 remaining (line_price - discount_share = 100000, already refunded 50000)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const creditRes = await client.query(`
      UPDATE refunds 
      SET status = 'credited', credited_at = NOW(), gateway_ref = $1
      WHERE refund_id = $2 AND status IN ('requested', 'initiated')
      RETURNING order_item_id, item_amount, fee_amount
    `, ['gw_test', refundId]);

    if (creditRes.rowCount === 0) throw new Error('Refund not creditable');

    const { order_item_id, item_amount, fee_amount } = creditRes.rows[0];

    // This should fail due to cap
    const itemRes = await client.query(`
      UPDATE order_items
      SET item_refunded_amount = item_refunded_amount + $1,
          fee_refunded_amount = fee_refunded_amount + $2
      WHERE order_item_id = $3
        AND item_refunded_amount + $1 <= line_price - discount_share
        AND fee_refunded_amount + $2 <= delivery_fee_share
      RETURNING 1
    `, [item_amount, fee_amount, order_item_id]);

    assert.strictEqual(itemRes.rowCount, 0, 'Refund cap must be enforced');

    // Refund should be marked failed in separate transaction
    await client.query('ROLLBACK');
    
    await client.query(`
      UPDATE refunds SET status = 'failed' WHERE refund_id = $1 AND status IN ('requested', 'initiated')
    `, [refundId]);

    const failedCheck = await pool.query(`SELECT status FROM refunds WHERE refund_id = $1`, [refundId]);
    assert.strictEqual(failedCheck.rows[0].status, 'failed');

  } finally {
    client.release();
  }

  // Cleanup
  await pool.query(`DELETE FROM refunds WHERE refund_id = $1`, [refundId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});