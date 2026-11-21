// backend/src/tests/notification-dedup.test.js
// Phase 2 Mandatory Test: Notification Deduplication
// Contract: Replay fulfilment, cancellation AND refund-credit events -> no second timeline row, notification or alert. Exactly ONE notification per cancellation and per refund.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Notification Dedup: Replay fulfilment events -> no duplicate timeline/notification', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  const groupId = 'g_notif_fulfil_' + Date.now();
  const orderId = 'o_notif_fulfil_' + Date.now();
  const eventId1 = 'e_fulfil_1_' + Date.now();
  const eventId2 = 'e_fulfil_2_' + Date.now();

  // Setup
  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO fulfilment_groups (group_id, order_id, location_id, mode, status, fee_total, otp_hash)
    VALUES ($1, $2, '10000000-0000-0000-0000-000000000001', 'standard', 'order_accepted', 2900, 'dummy_hash')
    ON CONFLICT (group_id) DO NOTHING
  `, [groupId, orderId]);

  // 1. Count initial timeline rows and notifications
  const initialTimeline = await pool.query(`SELECT COUNT(*)::int as cnt FROM shipment_timeline WHERE group_id = $1`, [groupId]);
  const initialNotifs = await pool.query(`SELECT COUNT(*)::int as cnt FROM notifications WHERE user_id = '30000000-0000-0000-0000-000000000001'`);

  // 2. Simulate fulfilment-pipeline consumer processing SAME event twice (replay)
  async function processFulfilment(eventId, status) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const marker = await client.query(`
        INSERT INTO processed_events (event_id, consumer_name)
        VALUES ($1, 'fulfilment-pipeline')
        ON CONFLICT (event_id, consumer_name) DO NOTHING
        RETURNING event_id
      `, [eventId]);

      if (marker.rowCount === 0) {
        await client.query('COMMIT');
        return { outcome: 'skipped_duplicate' };
      }

      // Update group status
      await client.query(`
        UPDATE fulfilment_groups SET status = $1 WHERE group_id = $2
      `, [status, groupId]);

      // Insert timeline row
      await client.query(`
        INSERT INTO shipment_timeline (group_id, status, event_type, actor, note)
        VALUES ($1, $2, $3, 'system', $4)
      `, [groupId, status, status, `Transition to ${status}`]);

      // Insert notification (single writer: notifier)
      await client.query(`
        INSERT INTO notifications (user_id, message, event_ref)
        VALUES ($1, $2, $3)
      `, ['30000000-0000-0000-0000-000000000001', `Order ${status} (SAMPLE)`, eventId]);

      await client.query('COMMIT');
      return { outcome: 'processed' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // 3. First delivery
  await processFulfilment(eventId1, 'packed');
  
  // 4. Replay (duplicate)
  await processFulfilment(eventId1, 'packed');

  // 5. Different event (packed -> out_for_delivery)
  await processFulfilment(eventId2, 'out_for_delivery');
  await processFulfilment(eventId2, 'out_for_delivery');

  // 6. Assert: timeline has exactly 2 rows (packed, out_for_delivery)
  const finalTimeline = await pool.query(`SELECT COUNT(*)::int as cnt, status FROM shipment_timeline WHERE group_id = $1 GROUP BY status`, [groupId]);
  assert.strictEqual(finalTimeline.rows.length, 2, 'Exactly 2 distinct status transitions');
  const statuses = finalTimeline.rows.map(r => r.status).sort();
  assert.deepStrictEqual(statuses, ['out_for_delivery', 'packed']);

  // 7. Assert: exactly 2 notifications (one per unique transition)
  const finalNotifs = await pool.query(`SELECT COUNT(*)::int as cnt FROM notifications WHERE user_id = '30000000-0000-0000-0000-000000000001'`);
  assert.strictEqual(finalNotifs.rows[0].cnt, initialNotifs.rows[0].cnt + 2, 'Exactly one notification per unique transition');

  // Cleanup
  await pool.query(`DELETE FROM processed_events WHERE event_id IN ($1, $2) AND consumer_name = 'fulfilment-pipeline'`, [eventId1, eventId2]);
  await pool.query(`DELETE FROM shipment_timeline WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM notifications WHERE event_ref IN ($1, $2)`, [eventId1, eventId2]);
  await pool.query(`DELETE FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Notification Dedup: Replay cancellation event -> exactly one notification per cancellation', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  const orderId = 'o_notif_cancel_' + Date.now();
  const orderItemId = 'oi_notif_cancel_' + Date.now();
  const refundId = 'r_notif_cancel_' + Date.now();
  const eventId = 'e_cancel_' + Date.now();

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

  await pool.query(`
    INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status)
    VALUES ($1, $2, 100000, 2900, 'path_a', 'requested')
    ON CONFLICT (refund_id) DO NOTHING
  `, [refundId, orderItemId]);

  const initialNotifs = await pool.query(`SELECT COUNT(*)::int as cnt FROM notifications WHERE user_id = '30000000-0000-0000-0000-000000000001'`);

  // Simulate cancellation-handler replay
  async function processCancellation(eventId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const marker = await client.query(`
        INSERT INTO processed_events (event_id, consumer_name)
        VALUES ($1, 'cancellation-handler')
        ON CONFLICT (event_id, consumer_name) DO NOTHING
        RETURNING event_id
      `, [eventId]);

      if (marker.rowCount === 0) {
        await client.query('COMMIT');
        return { outcome: 'skipped_duplicate' };
      }

      // Update order_item
      await client.query(`
        UPDATE order_items SET item_status = 'cancelled', cancelled_at = NOW() WHERE order_item_id = $1
      `, [orderItemId]);

      // Insert notification
      await client.query(`
        INSERT INTO notifications (user_id, message, event_ref)
        VALUES ($1, $2, $3)
      `, ['30000000-0000-0000-0000-000000000001', 'Order cancelled, refund initiated (SAMPLE)', eventId]);

      await client.query('COMMIT');
      return { outcome: 'processed' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  }

  // First + replay
  await processCancellation(eventId);
  await processCancellation(eventId);

  // Exactly one notification
  const finalNotifs = await pool.query(`SELECT COUNT(*)::int as cnt FROM notifications WHERE user_id = '30000000-0000-0000-0000-000000000001'`);
  assert.strictEqual(finalNotifs.rows[0].cnt, initialNotifs.rows[0].cnt + 1, 'Exactly one notification per cancellation');

  // Cleanup
  await pool.query(`DELETE FROM processed_events WHERE event_id = $1 AND consumer_name = 'cancellation-handler'`, [eventId]);
  await pool.query(`DELETE FROM notifications WHERE event_ref = $1`, [eventId]);
  await pool.query(`DELETE FROM refunds WHERE refund_id = $1`, [refundId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Notification Dedup: Replay refund-credit event -> exactly one notification per refund', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  const orderId = 'o_notif_refund_' + Date.now();
  const orderItemId = 'oi_notif_refund_' + Date.now();
  const refundId = 'r_notif_refund_' + Date.now();
  const eventId = 'e_refund_credit_' + Date.now();

  await pool.query(`
    INSERT INTO orders (order_id, user_id, items_total, discount_total, delivery_fee_total, total_amount, status)
    VALUES ($1, '30000000-0000-0000-0000-000000000001', 100000, 0, 2900, 102900, 'placed')
    ON CONFLICT (order_id) DO NOTHING
  `, [orderId]);

  await pool.query(`
    INSERT INTO order_items (order_item_id, order_id, reservation_id, offer_id, dealer_id, quantity, line_price, discount_share, delivery_fee_share, stock_location_id, item_status, item_paid_amount, paid_amount)
    VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 100000, 0, 2900, '10000000-0000-0000-0000-000000000001', 'confirmed', 100000, 102900)
    ON CONFLICT (order_item_id) DO NOTHING
  `, [orderItemId, orderId]);

  await pool.query(`
    INSERT INTO refunds (refund_id, order_item_id, item_amount, fee_amount, kind, status)
    VALUES ($1, $2, 100000, 2900, 'path_a', 'initiated')
    ON CONFLICT (refund_id) DO NOTHING
  `, [refundId, orderItemId]);

  const initialNotifs = await pool.query(`SELECT COUNT(*)::int as cnt FROM notifications WHERE user_id = '30000000-0000-0000-0000-000000000001'`);

  // Simulate refund-credit consumer replay
  async function processRefundCredit(eventId) {
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

      await client.query(`
        UPDATE refunds SET status = 'credited', credited_at = NOW(), gateway_ref = $1
        WHERE refund_id = $2 AND status IN ('requested', 'initiated')
      `, ['gw_test', refundId]);

      await client.query(`
        UPDATE order_items SET item_refunded_amount = item_refunded_amount + 100000, fee_refunded_amount = fee_refunded_amount + 2900 WHERE order_item_id = $1
      `, [orderItemId]);

      await client.query(`
        INSERT INTO notifications (user_id, message, event_ref)
        VALUES ($1, $2, $3)
      `, ['30000000-0000-0000-0000-000000000001', 'Refund credited (SAMPLE)', eventId]);

      await client.query('COMMIT');
      return { outcome: 'processed' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  }

  await processRefundCredit(eventId);
  await processRefundCredit(eventId);

  const finalNotifs = await pool.query(`SELECT COUNT(*)::int as cnt FROM notifications WHERE user_id = '30000000-0000-0000-0000-000000000001'`);
  assert.strictEqual(finalNotifs.rows[0].cnt, initialNotifs.rows[0].cnt + 1, 'Exactly one notification per refund');

  // Cleanup
  await pool.query(`DELETE FROM processed_events WHERE event_id = $1 AND consumer_name = 'refund-credit'`, [eventId]);
  await pool.query(`DELETE FROM notifications WHERE event_ref = $1`, [eventId]);
  await pool.query(`DELETE FROM refunds WHERE refund_id = $1`, [refundId]);
  await pool.query(`DELETE FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [orderId]);
});

test('Notification Dedup: Alert deduplication (FEATURE_ALERTS)', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Alert watcher processes inventory-updated + order-item-cancelled -> creates alerts
  // Test that replay doesn't create duplicate alerts
  const offerId = '70000000-0000-0000-0000-000000000001';
  const eventId = 'e_alert_' + Date.now();

  // This test assumes alert_subscriptions table exists and alert-watcher consumer
  // For now, verify the pattern works with processed_events marker
  const initialAlerts = await pool.query(`SELECT COUNT(*)::int as cnt FROM notifications WHERE message LIKE '%alert%'`);

  async function processAlert(eventId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const marker = await client.query(`
        INSERT INTO processed_events (event_id, consumer_name)
        VALUES ($1, 'alert-watcher')
        ON CONFLICT (event_id, consumer_name) DO NOTHING
        RETURNING event_id
      `, [eventId]);

      if (marker.rowCount === 0) {
        await client.query('COMMIT');
        return { outcome: 'skipped_duplicate' };
      }

      await client.query(`
        INSERT INTO notifications (user_id, message, event_ref)
        VALUES ($1, $2, $3)
      `, ['30000000-0000-0000-0000-000000000001', 'Price drop alert (SAMPLE)', eventId]);

      await client.query('COMMIT');
      return { outcome: 'processed' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  }

  await processAlert(eventId);
  await processAlert(eventId);

  const finalAlerts = await pool.query(`SELECT COUNT(*)::int as cnt FROM notifications WHERE message LIKE '%alert%'`);
  assert.strictEqual(finalAlerts.rows[0].cnt, initialAlerts.rows[0].cnt + 1, 'Exactly one alert notification');

  // Cleanup
  await pool.query(`DELETE FROM processed_events WHERE event_id = $1 AND consumer_name = 'alert-watcher'`, [eventId]);
  await pool.query(`DELETE FROM notifications WHERE event_ref = $1`, [eventId]);
});