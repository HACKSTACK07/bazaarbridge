// backend/src/tests/cancel-cross-key.test.js
// Phase 2 Mandatory Test: Cross-Key Cancellation
// Contract: 2 different request_keys -> one 200, one 409; stock moved once; ONE refunds row.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

test('Cross-Key Cancellation: Two request_keys for same reservation', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();
  const offerId = '70000000-0000-0000-0000-000000000010';
  const locId = '10000000-0000-0000-0000-000000000001';

  // 1. Reset stock
  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);

  // 2. Reserve with request_key_1
  const reserve1 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: offerId, location_id: locId, quantity: 1, request_key: 'req_cross_A'
  }, token);
  assert.strictEqual(reserve1.status, 201);
  const reservationId = reserve1.data.reservation_id;

  // 3. Try to reserve SAME offer/location/user with DIFFERENT request_key -> should fail (unique user_id, request_key)
  // Actually the unique constraint is on (user_id, request_key), so same user can have different request_keys
  // But the offer only has 10 units, first reserve took 1, second would take another
  // Let's test the cancellation path: same reservation_id, two different cancel request_keys

  // 4. Place order
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reservationId],
    address: { pin_code: '560001' },
    mode_preferences: { [reservationId]: 'standard' }
  }, token);
  assert.strictEqual(orderRes.status, 201);
  const orderId = orderRes.data.order_id;
  const orderItemId = orderRes.data.items[0].order_item_id;

  // 4. Fire TWO cancellation requests concurrently with DIFFERENT request_keys
  const [cancel1, cancel2] = await Promise.all([
    apiRequest('POST', `/api/orders/${orderId}/items/${orderItemId}/cancel`, {
      request_key: 'cancel_cross_A_' + Date.now()
    }, token),
    apiRequest('POST', `/api/orders/${orderId}/items/${orderItemId}/cancel`, {
      request_key: 'cancel_cross_B_' + Date.now()
    }, token)
  ]);

  const statuses = [cancel1.status, cancel2.status].sort();
  assert.strictEqual(statuses[0], 200, 'One cancellation must succeed');
  assert.strictEqual(statuses[1], 409, 'Second must get 409 ALREADY_CANCELLED_OR_TOO_LATE');
  const conflict = cancel1.status === 409 ? cancel1 : cancel2;
  assert.strictEqual(conflict.data.error, 'ALREADY_CANCELLED_OR_TOO_LATE');

  // 5. Exactly ONE refunds row created
  const refunds = await pool.query(`SELECT COUNT(*)::int as cnt FROM refunds WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(refunds.rows[0].cnt, 1, 'Exactly one refunds row');

  // 6. Stock moved exactly once (quantity restored from 9->10)
  const inv = await pool.query(`SELECT quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);
  assert.strictEqual(inv.rows[0].quantity, 10, 'Stock restored once');

  // 7. Order item status = cancelled
  const item = await pool.query(`SELECT item_status FROM order_items WHERE order_item_id = $1`, [orderItemId]);
  assert.strictEqual(item.rows[0].item_status, 'cancelled');
});