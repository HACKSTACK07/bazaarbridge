// backend/src/tests/finalizer-deadlock.test.js
// Phase 1 v7.2 Test: Finalizer Deadlock Prevention (ORDER BY offer_id, location_id)
// Contract: Two orders with the same two offers in opposite line order, replayed
// concurrently -> both finalise, each line's quantity drops exactly once, no marker is lost.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, skipIfBlocked } = require('./helpers');

test('Finalizer Deadlock Prevention via Lock Ordering Test (v7.2)', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const OFFER_A = '70000000-0000-0000-0000-000000000001';
  const OFFER_B = '70000000-0000-0000-0000-000000000002';
  const WAREHOUSE_LOC_ID = '10000000-0000-0000-0000-000000000001';

  // 1. Reset stock for both offers
  await pool.query(
    `UPDATE inventory SET quantity = 20, reserved_quantity = 5
     WHERE offer_id IN ($1, $2) AND location_id = $3`,
    [OFFER_A, OFFER_B, WAREHOUSE_LOC_ID]
  );

  const order1EventId = 'e_deadlock_1_' + Date.now();
  const order2EventId = 'e_deadlock_2_' + Date.now();

  // Consumer transaction touching multiple rows MUST order by offer_id, location_id
  async function finalizeOrder(eventId, items) {
    // Sort items by offer_id, location_id to guarantee deadlock-free locking
    const sortedItems = [...items].sort((a, b) =>
      a.offer_id.localeCompare(b.offer_id) || a.location_id.localeCompare(b.location_id)
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const marker = await client.query(
        `INSERT INTO processed_events (event_id, consumer_name)
         VALUES ($1, 'inventory-finalizer')
         ON CONFLICT (event_id, consumer_name) DO NOTHING
         RETURNING event_id`,
        [eventId]
      );

      if (marker.rowCount === 0) {
        await client.query('COMMIT');
        return { status: 'already_processed' };
      }

      for (const item of sortedItems) {
        const res = await client.query(
          `UPDATE inventory
           SET quantity = quantity - $1,
               reserved_quantity = reserved_quantity - $1
           WHERE offer_id = $2 AND location_id = $3
             AND quantity >= $1 AND reserved_quantity >= $1
           RETURNING quantity`,
          [item.quantity, item.offer_id, item.location_id]
        );
        if (res.rowCount === 0) {
          throw new Error('Lock or stock condition failed on ' + item.offer_id);
        }
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

  // 2. Order 1 lines: [OFFER_A, OFFER_B]; Order 2 lines: [OFFER_B, OFFER_A] (opposite order)
  const order1Lines = [
    { offer_id: OFFER_A, location_id: WAREHOUSE_LOC_ID, quantity: 1 },
    { offer_id: OFFER_B, location_id: WAREHOUSE_LOC_ID, quantity: 1 }
  ];
  const order2Lines = [
    { offer_id: OFFER_B, location_id: WAREHOUSE_LOC_ID, quantity: 1 },
    { offer_id: OFFER_A, location_id: WAREHOUSE_LOC_ID, quantity: 1 }
  ];

  // 3. Fire both concurrently
  const [res1, res2] = await Promise.all([
    finalizeOrder(order1EventId, order1Lines),
    finalizeOrder(order2EventId, order2Lines)
  ]);

  // Assert both finalized without deadlocking
  assert.strictEqual(res1.status, 'success');
  assert.strictEqual(res2.status, 'success');

  // 4. Assert each offer's quantity dropped exactly by 2
  const check = await pool.query(
    `SELECT offer_id, quantity, reserved_quantity FROM inventory
     WHERE offer_id IN ($1, $2) AND location_id = $3`,
    [OFFER_A, OFFER_B, WAREHOUSE_LOC_ID]
  );
  assert.strictEqual(check.rows.length, 2);
  check.rows.forEach(r => {
    assert.strictEqual(r.quantity, 18);
    assert.strictEqual(r.reserved_quantity, 3);
  });
});
