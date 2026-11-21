// backend/src/tests/notification-deduplication.test.js
// Phase 1 Test: Event Pipeline - Notification Deduplication
// Contract: Single writer (notifier consumer) for notifications; duplicate events don't create duplicate notifications

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Notification Deduplication: Duplicate order-placed creates one notification', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const userId = '30000000-0000-0000-0000-000000000001';
  const eventId = 'e_notif_dup_' + Date.now();

  // 1. Count initial notifications
  const initial = await pool.query(`
    SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1
  `, [userId]);
  const startCount = initial.rows[0].count;

  // 2. Simulate notifier consumer processing same event twice
  async function processNotification() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check processed_events marker
      const marker = await client.query(`
        INSERT INTO processed_events (event_id, consumer_name)
        VALUES ($1, 'notifier')
        ON CONFLICT (event_id, consumer_name) DO NOTHING
        RETURNING event_id
      `, [eventId]);

      if (marker.rowCount === 0) {
        await client.query('COMMIT');
        return { outcome: 'skipped_duplicate' };
      }

      // Insert notification (single writer pattern)
      await client.query(`
        INSERT INTO notifications (user_id, message, event_ref)
        VALUES ($1, $2, $3)
      `, [userId, 'Your order has been confirmed (SAMPLE)', eventId]);

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
  const run1 = await processNotification();
  assert.strictEqual(run1.outcome, 'processed');

  // 4. Second (duplicate) delivery
  const run2 = await processNotification();
  assert.strictEqual(run2.outcome, 'skipped_duplicate');

  // 5. Exactly one notification added
  const final = await pool.query(`
    SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1
  `, [userId]);
  assert.strictEqual(final.rows[0].count, startCount + 1, 'Exactly one notification must be created');

  // 6. Only one processed_events marker
  const markerCheck = await pool.query(`
    SELECT COUNT(*) FROM processed_events WHERE event_id = $1 AND consumer_name = 'notifier'
  `, [eventId]);
  assert.strictEqual(markerCheck.rows[0].count, 1, 'Only one processed_events marker');
});

test('Notification Deduplication: Different event types create separate notifications', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const userId = '30000000-0000-0000-0000-000000000001';

  const initial = await pool.query(`
    SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1
  `, [userId]);
  const startCount = initial.rows[0].count;

  // Process order-placed notification
  const event1 = 'e_notif_order_' + Date.now();
  await pool.query(`
    INSERT INTO processed_events (event_id, consumer_name) VALUES ($1, 'notifier')
    ON CONFLICT DO NOTHING
  `, [event1]);
  await pool.query(`
    INSERT INTO notifications (user_id, message, event_ref) VALUES ($1, 'Order placed', $2)
  `, [userId, event1]);

  // Process fulfilment-status-updated notification
  const event2 = 'e_notif_fulfil_' + Date.now();
  await pool.query(`
    INSERT INTO processed_events (event_id, consumer_name) VALUES ($1, 'notifier')
    ON CONFLICT DO NOTHING
  `, [event2]);
  await pool.query(`
    INSERT INTO notifications (user_id, message, event_ref) VALUES ($1, 'Order picked', $2)
  `, [userId, event2]);

  // Process refund-credit-requested notification
  const event3 = 'e_notif_refund_' + Date.now();
  await pool.query(`
    INSERT INTO processed_events (event_id, consumer_name) VALUES ($1, 'notifier')
    ON CONFLICT DO NOTHING
  `, [event3]);
  await pool.query(`
    INSERT INTO notifications (user_id, message, event_ref) VALUES ($1, 'Refund credited', $2)
  `, [userId, event3]);

  const final = await pool.query(`
    SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1
  `, [userId]);
  assert.strictEqual(final.rows[0].count, startCount + 3, 'Three different events must create three notifications');

  // Cleanup
  await pool.query(`DELETE FROM processed_events WHERE event_id IN ($1, $2, $3)`, [event1, event2, event3]);
  await pool.query(`DELETE FROM notifications WHERE event_ref IN ($1, $2, $3) AND user_id = $4`, [event1, event2, event3, userId]);
});

test('Notification Deduplication: Concurrent duplicate detection race', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const userId = '30000000-0000-0000-0000-000000000001';
  const eventId = 'e_notif_race_' + Date.now();

  const initial = await pool.query(`
    SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1
  `, [userId]);
  const startCount = initial.rows[0].count;

  // Simulate 10 concurrent deliveries of same event
  async function processNotification() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const marker = await client.query(`
        INSERT INTO processed_events (event_id, consumer_name)
        VALUES ($1, 'notifier')
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
      `, [userId, 'Test notification', eventId]);

      await client.query('COMMIT');
      return { outcome: 'processed' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const promises = Array.from({ length: 10 }, () => processNotification());
  const results = await Promise.all(promises);

  const processed = results.filter(r => r.outcome === 'processed').length;
  assert.strictEqual(processed, 1, 'Exactly one must process');

  const final = await pool.query(`
    SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1
  `, [userId]);
  assert.strictEqual(final.rows[0].count, startCount + 1, 'Exactly one notification created');

  // Cleanup
  await pool.query(`DELETE FROM processed_events WHERE event_id = $1`, [eventId]);
  await pool.query(`DELETE FROM notifications WHERE event_ref = $1 AND user_id = $2`, [eventId, userId]);
});