/**
 * Consumer "inventory-finalizer" (Authoritative Contract v7.2)
 *
 * Topic: bazaar.core.events
 * Event: order-placed (Keyed by order_id)
 * Execution Pattern: PATTERN A (PostgreSQL-only, ONE transaction)
 *
 * Rules:
 * 1. Process items ORDER BY offer_id, stock_location_id (v7.2 lock order).
 * 2. On Postgres deadlock (40P01), throw so Kafka retries.
 * 3. In the SAME transaction as the marker:
 *    UPDATE order_items SET stock_finalised=true, item_status='confirmed'
 *    WHERE order_item_id=$1 AND item_status <> 'cancelled' AND stock_finalised=false
 *    RETURNING offer_id, stock_location_id, quantity;
 *    - 0 rows -> SKIP this line entirely (already cancelled or finalised).
 *    - This conditional UPDATE is the lock that serialises against the cancellation path.
 * 4. deduct_units:
 *    UPDATE inventory SET quantity=quantity-$q, reserved_quantity=reserved_quantity-$q
 *    WHERE offer_id=$o AND location_id=$loc AND quantity>=$q AND reserved_quantity>=$q;
 *    - rowCount <> 1 -> THROW INVENTORY_DEDUCTION_FAILED.
 *    - The whole transaction rolls back, marker included, and Kafka retries.
 *    - NEVER mark stock_finalised on a deduction that did not happen.
 * 5. Set order status 'confirmed'.
 * 6. Emit outbox 'inventory-updated' (offer_id) and ONE 'notification-created' ("Order confirmed", user_id).
 *    - Do NOT insert into notifications table directly (only 'notifier' consumer inserts).
 */

const CONSUMER_NAME = 'inventory-finalizer';

/**
 * Handles an 'order-placed' event using Pattern A.
 *
 * @param {object} params
 * @param {string} params.eventId - Unique UUID of outbox event
 * @param {object} params.payload - Event payload containing order_id (and optional items)
 * @param {string} params.aggregateKey - Kafka message key (order_id)
 * @param {object} db - Database pool or client
 * @returns {Promise<{ status: string, orderId?: string, skipped?: boolean }>}
 */
async function processOrderPlaced({ eventId, payload, aggregateKey }, db) {
  const orderId = payload?.order_id || aggregateKey;
  if (!orderId) {
    throw new Error('order_id is required for inventory-finalizer');
  }

  // Use dedicated connection/client for the transaction
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    // 1. Idempotency marker: Pattern A
    const markerQuery = `
      INSERT INTO processed_events (event_id, consumer_name)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING event_id;
    `;
    const markerRes = await client.query(markerQuery, [eventId, CONSUMER_NAME]);

    if (markerRes.rowCount === 0) {
      // 0 rows -> already processed by this consumer. Commit marker, ack, skip.
      await client.query('COMMIT');
      inTransaction = false;
      return { status: 'SKIPPED', reason: 'ALREADY_PROCESSED' };
    }

    // 2. Fetch order details (user_id for notification)
    const orderQuery = `
      SELECT order_id, user_id, status
      FROM orders
      WHERE order_id = $1
      FOR UPDATE;
    `;
    const orderRes = await client.query(orderQuery, [orderId]);
    if (orderRes.rowCount === 0) {
      throw new Error(`Order [${orderId}] not found in database.`);
    }
    const userId = orderRes.rows[0].user_id;

    // 3. Fetch order items ORDER BY offer_id, stock_location_id (v7.2 lock order)
    const itemsQuery = `
      SELECT order_item_id, offer_id, stock_location_id, quantity, item_status, stock_finalised
      FROM order_items
      WHERE order_id = $1
      ORDER BY offer_id, stock_location_id;
    `;
    const itemsRes = await client.query(itemsQuery, [orderId]);
    const items = itemsRes.rows || [];

    const touchedOffers = new Set();

    // 4. Per order_item processing
    for (const item of items) {
      // Conditional UPDATE: the lock that serialises against cancellation
      const finalizeQuery = `
        UPDATE order_items
        SET stock_finalised = true, item_status = 'confirmed'
        WHERE order_item_id = $1
          AND item_status <> 'cancelled'
          AND stock_finalised = false
        RETURNING offer_id, stock_location_id, quantity;
      `;
      const finalizeRes = await client.query(finalizeQuery, [item.order_item_id]);

      // 0 rows -> SKIP this line entirely (already cancelled or finalised)
      if (finalizeRes.rowCount === 0) {
        continue;
      }

      const finalized = finalizeRes.rows[0];
      const q = finalized.quantity;
      const o = finalized.offer_id;
      const loc = finalized.stock_location_id;

      // deduct_units: conditional deduction
      const deductQuery = `
        UPDATE inventory
        SET quantity = quantity - $1,
            reserved_quantity = reserved_quantity - $1
        WHERE offer_id = $2 AND location_id = $3
          AND quantity >= $1 AND reserved_quantity >= $1;
      `;
      const deductRes = await client.query(deductQuery, [q, o, loc]);

      // rowCount <> 1 -> THROW INVENTORY_DEDUCTION_FAILED
      // The whole transaction rolls back, marker included, and Kafka retries.
      if (deductRes.rowCount !== 1) {
        const error = new Error(`INVENTORY_DEDUCTION_FAILED: Insufficient stock to deduct ${q} units of offer ${o} at location ${loc}`);
        error.code = 'INVENTORY_DEDUCTION_FAILED';
        throw error;
      }

      touchedOffers.add(o);
    }

    // 5. Set order status 'confirmed'
    const updateOrderQuery = `
      UPDATE orders
      SET status = 'confirmed'
      WHERE order_id = $1;
    `;
    await client.query(updateOrderQuery, [orderId]);

    // 6. In the SAME transaction: Emit outbox 'inventory-updated' (offer_id)
    for (const offerId of touchedOffers) {
      const outboxInventoryQuery = `
        INSERT INTO outbox_events (event_type, aggregate_key, payload)
        VALUES ($1, $2, $3);
      `;
      await client.query(outboxInventoryQuery, [
        'inventory-updated',
        offerId,
        JSON.stringify({ offer_id: offerId })
      ]);
    }

    // 7. Emit ONE 'notification-created' ("Order confirmed", user_id)
    // Contract rule: Do NOT insert into notifications table. Only 'notifier' consumer inserts.
    const outboxNotificationQuery = `
      INSERT INTO outbox_events (event_type, aggregate_key, payload)
      VALUES ($1, $2, $3);
    `;
    await client.query(outboxNotificationQuery, [
      'notification-created',
      userId,
      JSON.stringify({
        user_id: userId,
        message: 'Order confirmed',
        event_ref: orderId
      })
    ]);

    await client.query('COMMIT');
    inTransaction = false;

    return {
      status: 'CONFIRMED',
      orderId,
      finalizedOffers: Array.from(touchedOffers)
    };
  } catch (err) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        // Rollback attempt
      }
    }

    // Postgres deadlock code 40P01 or INVENTORY_DEDUCTION_FAILED: throw so Kafka retries
    if (err.code === '40P01' || err.code === 'INVENTORY_DEDUCTION_FAILED') {
      err.retryable = true;
    }
    throw err;
  } finally {
    if (typeof client.release === 'function') {
      client.release();
    }
  }
}

module.exports = {
  CONSUMER_NAME,
  processOrderPlaced
};
