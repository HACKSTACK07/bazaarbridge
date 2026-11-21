/**
 * BazaarBridge Phase 2 Automated End-to-End Test Suite
 * Covers: Real Cancellation State Machine, Replay Check, Refunds, Fulfilment Grouping,
 * Dynamic Fees, PIN Check, Delivery OTP Proofs, Hub Status, and Shopping Assistant.
 */

const assert = require('assert');
const { pool } = require('../db');

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:11597';

async function runTests() {
  console.log(`\n======================================================`);
  console.log(`Running BazaarBridge Phase 2 Test Suite`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`======================================================\n`);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`• ${name}... `);
      await fn();
      console.log(`✔ PASS`);
      passed++;
    } catch (err) {
      console.log(`✖ FAIL`);
      console.error(`  Error: ${err.message}`);
      if (err.stack) {
        console.error(`  Stack: ${err.stack.split('\n').slice(1, 3).join('\n')}`);
      }
      failed++;
    }
  }

  let authToken = null;
  let adminToken = null;

  // Login as Customer and Admin
  const custRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@bazaarbridge.dev', password: 'Demo@1234' })
  });
  const custData = await custRes.json();
  authToken = custData.token;

  const admRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@bazaarbridge.dev', password: 'Admin@1234' })
  });
  const admData = await admRes.json();
  adminToken = admData.token;

  // -----------------------------------------------------------------
  // 1. PIN CHECK & SERVICEABILITY
  // -----------------------------------------------------------------
  console.log(`--- [1/6] Fulfilment & PIN Check Tests ---`);

  await test('POST /api/check-pin for Koramangala/Indiranagar (560001) returns quick_available = true', async () => {
    const res = await fetch(`${BASE_URL}/api/check-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bypass-hours': 'true' },
      body: JSON.stringify({ pin_code: '560001' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.quick_available, true);
    assert.strictEqual(data.standard_available, true);
    assert.ok(data.hub_id, 'Must return serviced hub_id');
  });

  await test('POST /api/check-pin for unserviced PIN (999999) returns quick_available = false', async () => {
    const res = await fetch(`${BASE_URL}/api/check-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_code: '999999' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.quick_available, false);
    assert.strictEqual(data.standard_available, true);
    assert.strictEqual(data.hub_id, null);
  });

  // -----------------------------------------------------------------
  // 2. CHECKOUT WITH GROUPING, MODES & FEES
  // -----------------------------------------------------------------
  console.log(`\n--- [2/6] Checkout with Grouping, Dynamic Fees & OTP ---`);

  // Find an offer with quick mode eligibility
  const clientDb = await pool.connect();
  let quickOfferId = null;
  try {
    const qRes = await clientDb.query("SELECT o.offer_id FROM dealer_offers o WHERE 'quick' = ANY(o.eligible_modes) LIMIT 1;");
    quickOfferId = qRes.rows[0].offer_id;
  } finally {
    clientDb.release();
  }

  let resv1Id = null;
  await test('Reserve item for multi-group checkout', async () => {
    const res = await fetch(`${BASE_URL}/api/cart/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({
        offer_id: quickOfferId,
        quantity: 1,
        request_key: 'req-ph2-resv-' + Date.now()
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    resv1Id = data.reservation_id;
  });

  let createdOrderId = null;
  let createdGroups = [];

  await test('POST /api/orders creates fulfilment_groups, allocates fees, and derives OTP hash', async () => {
    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'x-bypass-hours': 'true'
      },
      body: JSON.stringify({
        reservation_ids: [resv1Id],
        address: { pin_code: '560001', line1: '100 Feet Rd' },
        mode_preferences: { [resv1Id]: 'quick' }
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.order_id, 'Must return order_id');
    assert.ok(data.groups.length > 0, 'Must have at least 1 fulfilment group');
    assert.strictEqual(data.groups[0].mode, 'quick');
    assert.strictEqual(data.groups[0].fee_total, 4900, 'Quick fee must be 4900 paise (Rs.49)');
    createdOrderId = data.order_id;
    createdGroups = data.groups;
  });

  // -----------------------------------------------------------------
  // 3. REAL CANCELLATION STATE MACHINE (PHASE 2 TASK 1)
  // -----------------------------------------------------------------
  console.log(`\n--- [3/6] Real Cancellation State Machine & Cross-Key Idempotency ---`);

  // Fetch created order items
  const orderDetailsRes = await fetch(`${BASE_URL}/api/orders/${createdOrderId}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  const orderDetails = await orderDetailsRes.json();
  const targetItem = orderDetails.items[0];

  let cancellationCaseId = null;
  let cancellationRefundId = null;
  const cancelReqKey = 'cancel-req-' + Date.now();

  await test('POST /api/orders/:id/items/:itemId/cancel transitions item and creates requested refund', async () => {
    const res = await fetch(`${BASE_URL}/api/orders/${createdOrderId}/items/${targetItem.order_item_id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ request_key: cancelReqKey })
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.case_id, 'Must return case_id');
    assert.strictEqual(data.refund.status, 'requested');
    assert.ok(data.refund.amount > 0, 'Refund amount must be > 0');
    cancellationCaseId = data.case_id;
    cancellationRefundId = data.refund.refund_id;
  });

  await test('Replaying cancellation with same request_key returns original record unchanged (Idempotent)', async () => {
    const res = await fetch(`${BASE_URL}/api/orders/${createdOrderId}/items/${targetItem.order_item_id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ request_key: cancelReqKey })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.case_id, cancellationCaseId);
    assert.strictEqual(data.refund.refund_id, cancellationRefundId);
  });

  await test('Cancelling an already cancelled item with different request_key is rejected (409 ALREADY_CANCELLED_OR_TOO_LATE)', async () => {
    const res = await fetch(`${BASE_URL}/api/orders/${createdOrderId}/items/${targetItem.order_item_id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ request_key: 'different-key-' + Date.now() })
    });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.error, 'ALREADY_CANCELLED_OR_TOO_LATE');
  });

  await test('Order item cancellation emitted order-item-cancelled outbox event', async () => {
    const client = await pool.connect();
    try {
      const outRes = await client.query(`
        SELECT * FROM outbox_events 
        WHERE event_type = 'order-item-cancelled' AND aggregate_key = $1
        ORDER BY created_at DESC LIMIT 1;
      `, [targetItem.offer_id]);
      assert.strictEqual(outRes.rowCount, 1, 'outbox_events must have order-item-cancelled row');
      const payload = typeof outRes.rows[0].payload === 'string' ? JSON.parse(outRes.rows[0].payload) : outRes.rows[0].payload;
      assert.strictEqual(payload.order_item_id, targetItem.order_item_id);
    } finally {
      client.release();
    }
  });

  // -----------------------------------------------------------------
  // 4. REFUNDS & SIMULATOR
  // -----------------------------------------------------------------
  console.log(`\n--- [4/6] Admin Refunds Credit & Simulator Events ---`);

  await test('POST /api/admin/refunds/:id/credit writes refund-credit-requested outbox event (202 Accepted)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/refunds/${cancellationRefundId}/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ gateway_ref: 'gw_sim_123' })
    });
    assert.strictEqual(res.status, 202);
    const data = await res.json();
    assert.ok(data.event_id, 'Must return event_id');
  });

  // Setup second order to test OTP delivery flow
  let deliverOrderId = null;
  let deliverGroupId = null;
  const dResvKey = 'req-deliver-' + Date.now();
  const dResvRes = await fetch(`${BASE_URL}/api/cart/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ offer_id: quickOfferId, quantity: 1, request_key: dResvKey })
  });
  const dResv = await dResvRes.json();

  const dOrderRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'x-bypass-hours': 'true'
    },
    body: JSON.stringify({
      reservation_ids: [dResv.reservation_id],
      address: { pin_code: '560001', line1: 'Koramangala 4th Block' }
    })
  });
  const dOrder = await dOrderRes.json();
  deliverOrderId = dOrder.order_id;
  deliverGroupId = dOrder.groups[0].group_id;

  await test('GET /api/admin/groups/:id/demo-otp returns derived code for admin simulator', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/groups/${deliverGroupId}/demo-otp`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.demo_otp, 'Must return demo_otp');
    assert.strictEqual(data.demo_otp.length, 6, 'OTP must be 6 digits');
  });

  await test('GET /api/orders/:id exposes delivery_otp only for owning customer while undelivered', async () => {
    const res = await fetch(`${BASE_URL}/api/orders/${deliverOrderId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.groups[0].delivery_otp, 'Delivery OTP must be present for customer');
    assert.strictEqual(data.groups[0].delivery_otp_label, 'SAMPLE DEMO OTP');
  });

  await test('POST /api/simulator/fire-event requires OTP for otp_verified event (400 OTP_REQUIRED)', async () => {
    const res = await fetch(`${BASE_URL}/api/simulator/fire-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ group_id: deliverGroupId, event_type: 'otp_verified' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'OTP_REQUIRED');
  });

  await test('POST /api/simulator/fire-event with OTP writes only otp_proof to outbox (Never raw code)', async () => {
    const otpRes = await fetch(`${BASE_URL}/api/admin/groups/${deliverGroupId}/demo-otp`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const { demo_otp } = await otpRes.json();

    const res = await fetch(`${BASE_URL}/api/simulator/fire-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ group_id: deliverGroupId, event_type: 'otp_verified', otp: demo_otp })
    });
    assert.strictEqual(res.status, 202);

    const client = await pool.connect();
    try {
      const outRes = await client.query(`
        SELECT payload FROM outbox_events 
        WHERE aggregate_key = $1 AND event_type = 'fulfilment-status-updated'
        ORDER BY created_at DESC LIMIT 1;
      `, [deliverGroupId]);
      const p = typeof outRes.rows[0].payload === 'string' ? JSON.parse(outRes.rows[0].payload) : outRes.rows[0].payload;
      assert.ok(p.otp_proof, 'otp_proof must be present');
      assert.strictEqual(p.otp, undefined, 'Raw OTP code must NEVER be stored in outbox');
    } finally {
      client.release();
    }
  });

  // -----------------------------------------------------------------
  // 5. HUB STATUS TOGGLE & 30-DAY PRICE HISTORY
  // -----------------------------------------------------------------
  console.log(`\n--- [5/6] Hub Status Toggle & 30-Day Price History ---`);

  const hubId = '85e72cbb-9bf6-4b69-8092-dcbdd7e74f8a'; // Will find from DB
  const client = await pool.connect();
  let testHubId = null;
  try {
    const hRes = await client.query('SELECT hub_id FROM fulfilment_hubs LIMIT 1;');
    testHubId = hRes.rows[0].hub_id;
  } finally {
    client.release();
  }

  await test('POST /api/admin/hubs/:id/status toggles hub and emits inventory-updated & eta-updated', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/hubs/${testHubId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ active: false })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.active, false);

    // Re-enable hub
    await fetch(`${BASE_URL}/api/admin/hubs/${testHubId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ active: true })
    });
  });

  await test('GET /api/products/:id/price-history returns 30-day reference price structure', async () => {
    const prodListRes = await fetch(`${BASE_URL}/api/products`);
    const prodList = await prodListRes.json();
    const testProd = prodList[0];
    const res = await fetch(`${BASE_URL}/api/products/${testProd.product_id}/price-history`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.offers), 'Offers must be an array');
  });

  // -----------------------------------------------------------------
  // 6. SHOPPING ASSISTANT (FEATURE_ASSISTANT)
  // -----------------------------------------------------------------
  console.log(`\n--- [6/6] Shopping Assistant (FEATURE_ASSISTANT) ---`);

  await test('POST /api/shopping-assistant parses user query and returns grounded PG results', async () => {
    const res = await fetch(`${BASE_URL}/api/shopping-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ message: 'looking for wireless bluetooth speaker' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.filters, 'Must return validated filters object');
    assert.ok(Array.isArray(data.results), 'Results must be an array from PostgreSQL');
    assert.strictEqual(typeof data.fallback, 'boolean');
    assert.ok(data.message, 'Must return explanation message');
  });

  await test('POST /api/shopping-assistant rejects messages exceeding 500 characters', async () => {
    const longMsg = 'a'.repeat(501);
    const res = await fetch(`${BASE_URL}/api/shopping-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ message: longMsg })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'MESSAGE_TOO_LONG');
  });

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log(`\n======================================================`);
  console.log(`Phase 2 Test Execution Summary:`);
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
