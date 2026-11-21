// backend/src/tests/cancel-after-finalise.test.js
// Phase 2 Mandatory Test: Cancellation After Finalisation
// Contract: quantity restored once, reservation stays 'confirmed'.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

test('Cancel After Finalisation: Quantity restored once, reservation stays confirmed', async (t) => {
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

  // 2. Reserve
  const reserveRes = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: offerId, location_id: locId, quantity: 1, request_key: 'req_cancel_af_' + Date.now()
  }, token);
  assert.strictEqual(reserveRes.status, 201);
  const reservationId = reserveRes.data.reservation_id;

  // 3. Place order -> finalizer runs, deducts stock
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reservationId],
    address: { pin_code: '560001' },
    mode_preferences: { [reservationId]: 'standard' }
  }, token);
  assert.strictEqual(orderRes.status, 201);
  const orderId = orderRes.data.order_id;
  const orderItemId = orderRes.data.items[0].order_item_id;

  // 4. Verify finalizer ran: reserved_quantity back to 2, quantity=9
  let inv = await pool.query(`SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);
  assert.strictEqual(inv.rows[0].quantity, 9, 'Finalizer must have deducted quantity');
  assert.strictEqual(inv.rows[0].reserved_quantity, 2, 'Reserved must be restored');

  // 5. Reservation should be 'confirmed'
  let resvCheck = await pool.query(`SELECT status, stock_finalised FROM reservations WHERE reservation_id = $1`, [reservationId]);
  assert.strictEqual(resvCheck.rows[0].status, 'confirmed');
  assert.strictEqual(resvCheck.rows[0].stock_finalised, true);

  // 6. Cancel the order item
  const cancelRes = await apiRequest('POST', `/api/orders/${orderId}/items/${orderItemId}/cancel`, {
    request_key: 'cancel_af_' + Date.now()
  }, token);
  assert.strictEqual(cancelRes.status, 200);

  // 7. Verify: quantity restored ONCE (9 -> 10), reservation STAYS 'confirmed'
  inv = await pool.query(`SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);
  assert.strictEqual(inv.rows[0].quantity, 10, 'Quantity must be restored once');
  assert.strictEqual(inv.rows[0].reserved_quantity, 2);

  resvCheck = await pool.query(`SELECT status, stock_finalised FROM reservations WHERE reservation_id = $1`, [reservationId]);
  assert.strictEqual(resvCheck.rows[0].status, 'confirmed', 'Reservation must stay confirmed');
  assert.strictEqual(resvCheck.rows[0].stock_finalised, true);

  // 8. Order item status = 'cancelled', refund requested
  const itemCheck = await pool.query(`SELECT item_status FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(itemCheck.rows[0].item_status, 'cancelled');
});