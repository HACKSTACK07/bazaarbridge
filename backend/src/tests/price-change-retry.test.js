// backend/src/tests/price-change-retry.test.js
// Phase 1 Mandatory Test: Price Change Recovery Flow on 1-Unit Product
// Contract: Continue from test 5 on a 1-UNIT product: POST /api/cart/release -> 200,
// reserved_quantity back to 0. Re-reserve -> 201 at new price. POST /api/orders -> 201.
// Assert the customer is never blocked by their own hold.

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, getToken, isApiReachable, isDbReachable, getDbPool, skipIfBlocked } = require('./helpers');

test('Price Change Recovery and Re-reservation on 1-Unit Product', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const LAST_UNIT_OFFER_ID = '70000000-0000-0000-0000-000000000006';
  const WAREHOUSE_LOC_ID = '10000000-0000-0000-0000-000000000001';

  // 1. Reset: quantity = 1, reserved_quantity = 0, selling_price = 349900
  await pool.query(
    `UPDATE inventory SET quantity = 1, reserved_quantity = 0
     WHERE offer_id = $1 AND location_id = $2`,
    [LAST_UNIT_OFFER_ID, WAREHOUSE_LOC_ID]
  );
  await pool.query(
    `UPDATE dealer_offers SET selling_price = 349900 WHERE offer_id = $1`,
    [LAST_UNIT_OFFER_ID]
  );

  const token = await getToken('demo@bazaarbridge.dev', 'Demo@1234');

  // 2. Reserve the only 1 unit
  const reqKey1 = 'req_pc_retry_1_' + Date.now();
  const reserve1 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: LAST_UNIT_OFFER_ID,
    location_id: WAREHOUSE_LOC_ID,
    quantity: 1,
    request_key: reqKey1
  }, token);

  assert.strictEqual(reserve1.status, 201);
  const reservationId1 = reserve1.data.reservation_id;

  // 3. Dealer increases price to 379900
  await pool.query(
    `UPDATE dealer_offers SET selling_price = 379900 WHERE offer_id = $1`,
    [LAST_UNIT_OFFER_ID]
  );

  // 4. Order fails with 409 PRICE_CHANGED
  const failOrder = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reservationId1],
    address: { pin_code: '560001' }
  }, token);
  assert.strictEqual(failOrder.status, 409);
  assert.strictEqual(failOrder.data.error, 'PRICE_CHANGED');

  // 5. Customer releases old hold: POST /api/cart/release -> 200
  const releaseRes = await apiRequest('POST', '/api/cart/release', {
    reservation_id: reservationId1
  }, token);
  assert.strictEqual(releaseRes.status, 200);

  // Verify reserved_quantity is restored back to 0
  const invAfterRelease = await pool.query(
    `SELECT quantity, reserved_quantity FROM inventory
     WHERE offer_id = $1 AND location_id = $2`,
    [LAST_UNIT_OFFER_ID, WAREHOUSE_LOC_ID]
  );
  assert.strictEqual(invAfterRelease.rows[0].quantity, 1);
  assert.strictEqual(invAfterRelease.rows[0].reserved_quantity, 0);

  // 6. Re-reserve immediately at the new price -> 201 (NOT blocked by own hold)
  const reqKey2 = 'req_pc_retry_2_' + Date.now();
  const reserve2 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: LAST_UNIT_OFFER_ID,
    location_id: WAREHOUSE_LOC_ID,
    quantity: 1,
    request_key: reqKey2
  }, token);
  assert.strictEqual(reserve2.status, 201);
  const reservationId2 = reserve2.data.reservation_id;

  // 7. Place order with new reservation -> 201
  const successOrder = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reservationId2],
    address: { pin_code: '560001' }
  }, token);
  assert.strictEqual(successOrder.status, 201);
});
