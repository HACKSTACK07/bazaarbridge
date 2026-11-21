/**
 * ETA Estimation Logic
 * Strictly implements Section 04 of BazaarBridge Implementation Plan v7.2.
 * No external routing API is used.
 */

/**
 * Calculates live count of groups at a hub today in status ('order_accepted', 'picked', 'packed')
 */
async function getPickingQueueCount(client, locationId) {
  const sql = `
    SELECT count(*)::int as queue_count
    FROM fulfilment_groups
    WHERE location_id = $1
      AND status IN ('order_accepted', 'picked', 'packed')
      AND created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata');
  `;
  const res = await client.query(sql, [locationId]);
  return res.rows[0]?.queue_count || 0;
}

/**
 * Computes ETA window and basis for a given fulfilment mode
 */
async function computeEta(client, { mode, locationId, transferDaysMax = 3 }) {
  const now = new Date();

  if (mode === 'quick') {
    const queue = await getPickingQueueCount(client, locationId);
    // quick = accept 5m + picking_queue * 4m + pack 5m + assign 5m + travel 20m
    const totalMinutes = 5 + (queue * 4) + 5 + 5 + 20;

    // Range +/- 15m
    const startMins = Math.max(10, totalMinutes - 15);
    const endMins = totalMinutes + 15;

    const windowStart = new Date(now.getTime() + startMins * 60 * 1000);
    const windowEnd = new Date(now.getTime() + endMins * 60 * 1000);

    return {
      windowStart,
      windowEnd,
      basis: {
        mode: 'quick',
        picking_queue: queue,
        calculated_minutes: totalMinutes,
        window_minutes: [startMins, endMins]
      }
    };
  }

  if (mode === 'standard') {
    // standard = warehouse 1 business day + local 1-2 days (total 2 to 3 days)
    const windowStart = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    return {
      windowStart,
      windowEnd,
      basis: {
        mode: 'standard',
        warehouse_days: 1,
        local_delivery_days: [1, 2]
      }
    };
  }

  if (mode === 'transfer') {
    // transfer = transfer_days_max + warehouse 1 day + local 1-2 days
    const maxTransfer = transferDaysMax || 3;
    const minDays = maxTransfer + 1 + 1;
    const maxDays = maxTransfer + 1 + 2;

    const windowStart = new Date(now.getTime() + minDays * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);

    return {
      windowStart,
      windowEnd,
      basis: {
        mode: 'transfer',
        transfer_days_max: maxTransfer,
        warehouse_days: 1,
        local_days: [1, 2]
      }
    };
  }

  throw new Error(`Unsupported mode for ETA: ${mode}`);
}

module.exports = {
  getPickingQueueCount,
  computeEta
};
