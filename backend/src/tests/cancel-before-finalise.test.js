// backend/src/tests/cancel-before-finalise.test.js
// Phase 2 Mandatory Test: Cancellation Before Finalisation
// Contract: Pause finalizer, cancel -> reservation 'released', reserved_quantity restored, quantity UNCHANGED, ONE refunds row. Resume -> finalizer SKIPS line.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked, pauseConsumer, resumeConsumer } = require('./helpers');

test('Cancel Before Finalisation: Reservation released, stock restored, finalizer skips', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();
  const offerId = '70000000-0000-0000-0000-000000000010';
  const locId = '10000000-0000-0000-0000-000000000001';

  // 1. Reset stock: qty=10, reserved=2
  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 2 WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);

  // 2. Reserve 1 unit
  const reserveRes = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: offerId, location_id: locId, quantity: 1, request_key: 'req_cancel_bf_' + Date.now()
  }, token);
  assert.strictEqual(reserveRes.status, 201);
  const reservationId = reserveRes.data.reservation_id;

  // 3. Verify reserved_quantity = 3
  let inv = await pool.query(`SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);
  assert.strictEqual(inv.rows[0].reserved_quantity, 3);

  // 4. Pause inventory-finalizer consumer
  await pauseConsumer('inventory-finalizer');

  // 5. Place order (creates order-placed event, but finalizer paused)
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reservationId],
    address: { pin_code: '560001' },
    mode_preferences: { [reservationId]: 'standard' }
  }, token);
  assert.strictEqual(orderRes.status, 201);
  const orderId = orderRes.data.order_id;

  // 6. Cancel the order item (cancellation-handler runs, finalizer still paused)
  const cancelRes = await apiRequest('POST', `/api/orders/${orderId}/items/${orderRes.data.items[0].order_item_id}/cancel`, {
    request_key: 'cancel_bf_' + Date.now()
  }, token);
  assert.strictEqual(cancelRes.status, 200);
  const caseId = cancelRes.data.case_id;
  const refundId = cancelRes.data.refund.refund_id;

  // 7. Verify: reservation status = 'released', reserved_quantity back to 2, quantity UNCHANGED
  const resvCheck = await pool.query(`SELECT status FROM reservations WHERE reservation_id = $1`, [reservationId]);
  assert.strictEqual(resvCheck.rows[0].status, 'released');
  inv = await pool.query(`SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);
  assert.strictEqual(inv.rows[0].quantity, 10, 'quantity must be unchanged');
  assert.strictEqual(inv.rows[0].reserved_quantity, 2, 'reserved_quantity must be restored');

  // 8. Exactly ONE refunds row created
  const refundCheck = await pool.query(`SELECT status, item_amount, fee_amount FROM refunds WHERE refund_id = $1`, [refundId]);
  assert.strictEqual(refundCheck.rows[0].status, 'requested');

  // 9. Resume finalizer -> it must SKIP this order's line (already cancelled)
  await resumeConsumer('inventory-finalizer');
  // Wait for consumer to process (in real test, poll processed_events)
  await new Promise(r => setTimeout(r, 500));

  // 10. Verify NO second stock movement (quantity still 10, reserved 2)
  inv = await pool.query(`SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);
  assert.strictEqual(inv.rows[0].quantity, 10);
  assert.strictEqual(inv.rows[0].reserved_quantity, 2);
});