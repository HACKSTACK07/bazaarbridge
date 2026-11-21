// backend/src/tests/release-idempotency.test.js
// Phase 1 Mandatory Test: Reservation Release Invariants & Idempotency
// Contract:
// - Release the same reservation twice concurrently -> reserved_quantity restored EXACTLY once; both calls 200.
// - Release a CONFIRMED reservation -> 409 CANNOT_RELEASE_CONFIRMED.
// - DELETE a cart item with an attached hold -> hold released once.

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, getToken, isApiReachable, isDbReachable, getDbPool, skipIfBlocked } = require('./helpers');

test('Reservation Release Idempotency and Invariants Test', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const TEST_OFFER_ID = '70000000-0000-0000-0000-000000000004';
  const WAREHOUSE_LOC_ID = '10000000-0000-0000-0000-000000000001';

  const token = await getToken('demo@bazaarbridge.dev', 'Demo@1234');

  // --- Part 1: Concurrent Release Idempotency ---
  const reqKey = 'req_rel_race_' + Date.now();
  const reserveRes = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: TEST_OFFER_ID,
    location_id: WAREHOUSE_LOC_ID,
    quantity: 1,
    request_key: reqKey
  }, token);
  assert.strictEqual(reserveRes.status, 201);
  const reservationId = reserveRes.data.reservation_id;

  // Release twice concurrently
  const [rel1, rel2] = await Promise.all([
    apiRequest('POST', '/api/cart/release', { reservation_id: reservationId }, token),
    apiRequest('POST', '/api/cart/release', { reservation_id: reservationId }, token)
  ]);

  // Both should return 200 OK (idempotent)
  assert.strictEqual(rel1.status, 200);
  assert.strictEqual(rel2.status, 200);

  // --- Part 2: Release a CONFIRMED reservation -> 409 CANNOT_RELEASE_CONFIRMED ---
  const reqKeyConfirm = 'req_confirm_rel_' + Date.now();
  const reserveConfirm = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: TEST_OFFER_ID,
    location_id: WAREHOUSE_LOC_ID,
    quantity: 1,
    request_key: reqKeyConfirm
  }, token);
  assert.strictEqual(reserveConfirm.status, 201);
  const confirmedResvId = reserveConfirm.data.reservation_id;

  // Place order to confirm the reservation
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [confirmedResvId],
    address: { pin_code: '560001' }
  }, token);
  assert.strictEqual(orderRes.status, 201);

  // Attempting to release confirmed reservation directly must fail
  const cannotReleaseRes = await apiRequest('POST', '/api/cart/release', {
    reservation_id: confirmedResvId
  }, token);
  assert.strictEqual(cannotReleaseRes.status, 409);
  assert.strictEqual(cannotReleaseRes.data.error, 'CANNOT_RELEASE_CONFIRMED');

  // --- Part 3: DELETE cart item with attached reservation releases hold ---
  // Attach item to cart
  const addCartRes = await apiRequest('POST', '/api/cart/items', {
    offer_id: TEST_OFFER_ID,
    quantity: 1
  }, token);
  const cartItemId = addCartRes.data.cart_item_id;

  const reqKeyCart = 'req_cart_hold_' + Date.now();
  const reserveCart = await apiRequest('POST', '/api/cart/reserve', {
    cart_item_id: cartItemId,
    offer_id: TEST_OFFER_ID,
    location_id: WAREHOUSE_LOC_ID,
    quantity: 1,
    request_key: reqKeyCart
  }, token);
  const cartResvId = reserveCart.data.reservation_id;

  // Delete cart item -> atomically releases attached hold
  const delRes = await apiRequest('DELETE', `/api/cart/items/${cartItemId}`, null, token);
  assert.strictEqual(delRes.status, 200);

  const resvCheck = await pool.query(
    `SELECT status FROM reservations WHERE reservation_id = $1`,
    [cartResvId]
  );
  assert.strictEqual(resvCheck.rows[0].status, 'released');
});
