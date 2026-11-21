// backend/src/tests/duplicate-event.test.js
// Phase 1 Mandatory Test: Duplicate Event Safety (Consumer Pattern A)
// Contract: Publish the same order-placed event twice ->
// quantity decreases exactly once; NO duplicate notification.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Duplicate Event Processing Idempotency Test', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const TEST_OFFER_ID = '70000000-0000-0000-0000-000000000007';
  const WAREHOUSE_LOC_ID = '10000000-0000-0000-0000-000000000001';
  const TEST_USER_ID = '30000000-0000-0000-0000-000000000001';

  // 1. Initialize stock and count notifications
  await pool.query(
    `UPDATE inventory SET quantity = 20, reserved_quantity = 2
     WHERE offer_id = $1 AND location_id = $2`,
    [TEST_OFFER_ID, WAREHOUSE_LOC_ID]
  );

  const initialNotifs = await pool.query(
    `SELECT count(*)::int as count FROM notifications WHERE user_id = $1`,
    [TEST_USER_ID]
  );
  const startNotifCount = initialNotifs.rows[0].count;

  const eventId = 'e0000000-0000-0000-0000-' + String(Date.now()).slice(-12);
  const consumerName = 'inventory-finalizer';

  // Helper simulating Consumer Pattern A logic:
  // Transaction: processed_events marker ON CONFLICT DO NOTHING,
  // conditional deduct_units UPDATE, outbox notification insert
  async function simulateConsumerExecution() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const marker = await client.query(
        `INSERT INTO processed_events (event_id, consumer_name)
         VALUES ($1, $2)
         ON CONFLICT (event_id, consumer_name) DO NOTHING
         RETURNING event_id`,
        [eventId, consumerName]
      );

      if (marker.rowCount === 0) {
        // Already processed: skip duplicate safely
        await client.query('COMMIT');
        return { outcome: 'skipped_duplicate' };
      }

      // Deduct stock conditionally
      const stockRes = await client.query(
        `UPDATE inventory
         SET quantity = quantity - 2,
             reserved_quantity = reserved_quantity - 2
         WHERE offer_id = $1 AND location_id = $2
           AND quantity >= 2 AND reserved_quantity >= 2
         RETURNING quantity, reserved_quantity`,
        [TEST_OFFER_ID, WAREHOUSE_LOC_ID]
      );

      if (stockRes.rowCount === 0) {
        throw new Error('Stock deduction condition failed');
      }

      // Insert notification
      await client.query(
        `INSERT INTO notifications (user_id, message, event_ref)
         VALUES ($1, $2, $3)`,
        [TEST_USER_ID, 'Your order has been confirmed (SAMPLE)', eventId]
      );

      await client.query('COMMIT');
      return { outcome: 'processed_success', stock: stockRes.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // 2. First delivery of the event
  const run1 = await simulateConsumerExecution();
  assert.strictEqual(run1.outcome, 'processed_success');

  // 3. Second (duplicate) delivery of the EXACT same event
  const run2 = await simulateConsumerExecution();
  assert.strictEqual(run2.outcome, 'skipped_duplicate');

  // 4. Assert stock was deducted exactly once
  const stockCheck = await pool.query(
    `SELECT quantity, reserved_quantity FROM inventory
     WHERE offer_id = $1 AND location_id = $2`,
    [TEST_OFFER_ID, WAREHOUSE_LOC_ID]
  );
  assert.strictEqual(stockCheck.rows[0].quantity, 18);
  assert.strictEqual(stockCheck.rows[0].reserved_quantity, 0);

  // 5. Assert exactly one notification was added
  const endNotifs = await pool.query(
    `SELECT count(*)::int as count FROM notifications WHERE user_id = $1`,
    [TEST_USER_ID]
  );
  assert.strictEqual(endNotifs.rows[0].count, startNotifCount + 1);
});
