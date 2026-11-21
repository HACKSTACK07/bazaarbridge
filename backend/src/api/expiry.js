const cron = require('node-cron');
const { getClient } = require('../db');

/**
 * Task 5: Expiry Cleanup Worker
 * Runs every 60s via node-cron.
 * Uses ONE atomic statement with CTEs:
 * - Locks expired reservations with FOR UPDATE SKIP LOCKED
 * - Marks status = 'expired'
 * - Restores reserved_quantity in inventory (ordered by offer_id, location_id)
 * - Emits one 'inventory-updated' outbox row per affected offer
 * - NEVER touches 'confirmed' rows
 */
async function cleanExpiredReservations() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const sql = `
      WITH expired_reservations AS (
        SELECT reservation_id, offer_id, location_id, quantity
        FROM reservations
        WHERE status = 'reserved' AND expires_at < now()
        ORDER BY offer_id, location_id
        FOR UPDATE SKIP LOCKED
      ),
      marked AS (
        UPDATE reservations r
        SET status = 'expired'
        FROM expired_reservations e
        WHERE r.reservation_id = e.reservation_id
        RETURNING e.reservation_id, e.offer_id, e.location_id, e.quantity
      ),
      restored AS (
        UPDATE inventory i
        SET reserved_quantity = i.reserved_quantity - m.qty
        FROM (
          SELECT offer_id, location_id, SUM(quantity)::int as qty
          FROM marked
          GROUP BY offer_id, location_id
          ORDER BY offer_id, location_id
        ) m
        WHERE i.offer_id = m.offer_id AND i.location_id = m.location_id
        RETURNING i.offer_id
      )
      INSERT INTO outbox_events (event_type, aggregate_key, payload)
      SELECT DISTINCT
        'inventory-updated',
        offer_id::text,
        jsonb_build_object('offer_id', offer_id, 'reason', 'expiry_cleanup')
      FROM marked
      RETURNING aggregate_key;
    `;

    const res = await client.query(sql);
    await client.query('COMMIT');

    if (res.rowCount > 0) {
      console.log(`[Expiry Cleanup] Restored stock and emitted outbox events for ${res.rowCount} offer(s).`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Expiry Cleanup] Error executing cleanup statement:', err);
  } finally {
    client.release();
  }
}

let cronJob = null;

function startExpiryCleanup() {
  if (cronJob) return;
  // Runs every 60 seconds
  cronJob = cron.schedule('* * * * *', async () => {
    try {
      await cleanExpiredReservations();
    } catch (e) {
      console.error('[Expiry Cleanup] Unexpected failure in cron tick:', e);
    }
  });
  console.log('[Expiry Cleanup] Cron job initialized (runs every 60s).');
}

function stopExpiryCleanup() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

module.exports = {
  cleanExpiredReservations,
  startExpiryCleanup,
  stopExpiryCleanup
};
