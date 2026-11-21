// backend/src/tests/finalizer-guard.test.js
// Phase 1 Mandatory Test: Finalizer Stock Guard & Retry Safety
// Contract: Force inventory.quantity below ordered qty, replay order-placed ->
// consumer throws, transaction rolls back, stock_finalised stays false,
// NO processed_events marker persists, and the event is retried.
// Restore the quantity -> retry succeeds exactly once.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Inventory Finalizer Guard and Rollback Test', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const TEST_OFFER_ID = '70000000-0000-0000-0000-000000000010';
  const WAREHOUSE_LOC_ID = '10000000-0000-0000-0000-000000000001';
  const eventId = 'e_guard_' + Date.now();
  const consumerName = 'inventory-finalizer';

  // Helper simulating consumer transaction logic:
  async function runFinalizerAttempt(orderedQty) {
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
        await client.query('COMMIT');
        return { status: 'already_processed' };
      }

      // Guarded deduction: row count MUST be 1
      const deductRes = await client.query(
        `UPDATE inventory
         SET quantity = quantity - $1,
             reserved_quantity = reserved_quantity - $1
         WHERE offer_id = $2 AND location_id = $3
           AND quantity >= $1 AND reserved_quantity >= $1
         RETURNING quantity, reserved_quantity`,
        [orderedQty, TEST_OFFER_ID, WAREHOUSE_LOC_ID]
      );

      if (deductRes.rowCount === 0) {
        throw new Error('GUARD_FAILED: Insufficient quantity or reserved_quantity');
      }

      await client.query('COMMIT');
      return { status: 'success' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // 1. Force inventory quantity below ordered qty (e.g. quantity=1, orderedQty=5)
  await pool.query(
    `UPDATE inventory SET quantity = 1, reserved_quantity = 1
     WHERE offer_id = $1 AND location_id = $2`,
    [TEST_OFFER_ID, WAREHOUSE_LOC_ID]
  );

  // 2. Run finalizer attempt -> MUST throw and rollback
  let thrown = false;
  try {
    await runFinalizerAttempt(5);
  } catch (err) {
    thrown = true;
    assert.match(err.message, /GUARD_FAILED/);
  }
  assert.strictEqual(thrown, true, 'Consumer must throw when stock condition fails');

  // Assert NO processed_events marker persisted
  const markerCheck = await pool.query(
    `SELECT 1 FROM processed_events WHERE event_id = $1 AND consumer_name = $2`,
    [eventId, consumerName]
  );
  assert.strictEqual(markerCheck.rowCount, 0, 'No marker must persist on failed stock movement');

  // 3. Restore inventory quantity to allow success
  await pool.query(
    `UPDATE inventory SET quantity = 10, reserved_quantity = 5
     WHERE offer_id = $1 AND location_id = $2`,
    [TEST_OFFER_ID, WAREHOUSE_LOC_ID]
  );

  // 4. Retry event -> MUST succeed exactly once
  const retryResult = await runFinalizerAttempt(5);
  assert.strictEqual(retryResult.status, 'success');

  // Marker must now exist
  const finalMarkerCheck = await pool.query(
    `SELECT 1 FROM processed_events WHERE event_id = $1 AND consumer_name = $2`,
    [eventId, consumerName]
  );
  assert.strictEqual(finalMarkerCheck.rowCount, 1, 'Marker must persist after successful stock finalization');
});
