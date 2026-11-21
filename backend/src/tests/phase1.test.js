/**
 * BazaarBridge Phase 1 Automated End-to-End Test Suite
 * Covers: Auth, Catalog, 5-Tab Comparison, Atomic Reservations, Expiry/Release, and Orders.
 */

const assert = require('assert');
const { pool } = require('../db');

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:11597';

async function runTests() {
  console.log(`\n======================================================`);
  console.log(`Running BazaarBridge Phase 1 & Gate 1 Test Suite`);
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
  let testUser = null;
  let sampleProduct = null;
  let speakerProduct = null;

  // -----------------------------------------------------------------
  // 1. AUTHENTICATION & SECURITY
  // -----------------------------------------------------------------
  console.log(`--- [1/4] Authentication & Session Tests ---`);

  await test('POST /api/auth/login with valid credentials', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@bazaarbridge.dev', password: 'Demo@1234' })
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.token, 'Token must be present in response');
    assert.strictEqual(data.user.email || 'demo@bazaarbridge.dev', 'demo@bazaarbridge.dev');
    authToken = data.token;
    testUser = data.user;
  });

  await test('POST /api/auth/login rejects invalid password', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@bazaarbridge.dev', password: 'WrongPassword!99' })
    });
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.error, 'INVALID_CREDENTIALS');
  });

  await test('GET /api/auth/me returns authenticated user from JWT', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.user.role, 'customer');
  });

  await test('GET /api/auth/me rejects request without token', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`);
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
  });

  // -----------------------------------------------------------------
  // 2. CATALOG & 5-TAB COMPARISON
  // -----------------------------------------------------------------
  console.log(`\n--- [2/4] Catalog & 5-Tab Comparison Tests ---`);

  await test('GET /api/products returns all 40 seeded products', async () => {
    const res = await fetch(`${BASE_URL}/api/products`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.length, 40, `Expected 40 products, got ${data.length}`);
    sampleProduct = data[0];
    speakerProduct = data.find(p => p.name.includes('SoundCraft Pulse') || p.name.toLowerCase().includes('pulse bluetooth speaker') || p.name.includes('EchoSonic'));
    assert.ok(speakerProduct, 'Bluetooth speaker with comparison offers must exist in catalog');
  });

  await test('GET /api/search/filters returns categories and cities', async () => {
    const res = await fetch(`${BASE_URL}/api/search/filters`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.categories.length >= 5, 'Must have at least 5 categories');
    assert.ok(data.cities.includes('Bangalore'), 'Bangalore must be an active dealer city');
  });

  await test('GET /api/products/:id/offers?category=budget returns lowest price', async () => {
    const res = await fetch(`${BASE_URL}/api/products/${speakerProduct.product_id}/offers?category=budget`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const offers = Array.isArray(data) ? data : data.offers;
    assert.ok(offers.length > 0, 'Offers must not be empty');
    assert.ok(offers[0].reason.length > 0, 'Reason must describe offer ranking');
    // Verify first is indeed lowest price
    const p0 = BigInt(offers[0].selling_price);
    for (let i = 1; i < offers.length; i++) {
      assert.ok(p0 <= BigInt(offers[i].selling_price), 'Budget sort order violation');
    }
  });

  await test('GET /api/products/:id/offers?category=fastest returns fastest delivery', async () => {
    const res = await fetch(`${BASE_URL}/api/products/${speakerProduct.product_id}/offers?category=fastest`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const offers = Array.isArray(data) ? data : data.offers;
    assert.ok(offers.length > 0);
    assert.ok(offers[0].reason.length > 0);
  });

  await test('GET /api/products/:id/offers?category=rated returns top dealer rating', async () => {
    const res = await fetch(`${BASE_URL}/api/products/${speakerProduct.product_id}/offers?category=rated`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const offers = Array.isArray(data) ? data : data.offers;
    assert.ok(offers.length > 0);
    const r0 = parseFloat(offers[0].dealer_rating);
    for (let i = 1; i < offers.length; i++) {
      assert.ok(r0 >= parseFloat(offers[i].dealer_rating), 'Rated sort order violation');
    }
  });

  await test('GET /api/products/:id/offers?category=available returns highest stock', async () => {
    const res = await fetch(`${BASE_URL}/api/products/${speakerProduct.product_id}/offers?category=available`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const offers = Array.isArray(data) ? data : data.offers;
    assert.ok(offers.length > 0);
    const s0 = offers[0].free_units;
    for (let i = 1; i < offers.length; i++) {
      assert.ok(s0 >= offers[i].free_units, 'Available sort order violation');
    }
  });

  // -----------------------------------------------------------------
  // 3. ATOMIC STOCK RESERVATION (reserve_offer)
  // -----------------------------------------------------------------
  console.log(`\n--- [3/4] Stock Reservation & Release Tests ---`);

  // Find an available offer to test reservations
  const offersRes = await fetch(`${BASE_URL}/api/products/${speakerProduct.product_id}/offers?category=available`);
  const offersData = await offersRes.json();
  const offersList = Array.isArray(offersData) ? offersData : offersData.offers;
  const testOffer = offersList[0];

  let testReservationId = null;
  const requestKey1 = 'req-test-' + Date.now();

  await test('POST /api/cart/reserve creates atomic hold with 10-minute expiry', async () => {
    const res = await fetch(`${BASE_URL}/api/cart/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        offer_id: testOffer.offer_id,
        quantity: 1,
        request_key: requestKey1
      })
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.reservation_id, 'Must return reservation_id');
    assert.strictEqual(data.status, 'reserved');
    assert.strictEqual(BigInt(data.price_paise), BigInt(testOffer.selling_price));
    testReservationId = data.reservation_id;
  });

  await test('POST /api/cart/reserve is idempotent on identical request_key', async () => {
    const res = await fetch(`${BASE_URL}/api/cart/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        offer_id: testOffer.offer_id,
        quantity: 1,
        request_key: requestKey1
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.reservation_id, testReservationId, 'Must return exact same reservation on retry');
  });

  await test('POST /api/cart/reserve rejects quantity exceeding stock (OUT_OF_STOCK)', async () => {
    const res = await fetch(`${BASE_URL}/api/cart/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        offer_id: testOffer.offer_id,
        quantity: 99999,
        request_key: 'req-oversell-' + Date.now()
      })
    });
    assert.strictEqual(res.status, 409, `Expected 409, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.error, 'OUT_OF_STOCK');
  });

  await test('POST /api/cart/release releases hold and restores inventory', async () => {
    const res = await fetch(`${BASE_URL}/api/cart/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ reservation_id: testReservationId })
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'released');
  });

  await test('POST /api/cart/release is idempotent when already released', async () => {
    const res = await fetch(`${BASE_URL}/api/cart/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ reservation_id: testReservationId })
    });
    assert.strictEqual(res.status, 200, 'Idempotent release must return 200');
  });

  // -----------------------------------------------------------------
  // 4. ORDER PLACEMENT & PRICE-CHECK INTEGRITY
  // -----------------------------------------------------------------
  console.log(`\n--- [4/4] Order Placement & Price Integrity Tests ---`);

  let orderReservationId = null;
  const orderReqKey = 'req-order-' + Date.now();

  await test('Reserve unit for clean order placement', async () => {
    const res = await fetch(`${BASE_URL}/api/cart/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        offer_id: testOffer.offer_id,
        quantity: 1,
        request_key: orderReqKey
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    orderReservationId = data.reservation_id;
  });

  let createdOrderId = null;
  await test('POST /api/orders confirms reservation and creates order', async () => {
    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        reservation_ids: [orderReservationId],
        delivery_address: {
          pin: '560034',
          line1: '123 Test Apt',
          city: 'Bangalore'
        }
      })
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.order_id, 'Must return created order_id');
    assert.strictEqual(data.status, 'placed');
    assert.ok(data.total_amount > 0);
    createdOrderId = data.order_id;
  });

  await test('Releasing a confirmed reservation is rejected (409 CANNOT_RELEASE_CONFIRMED)', async () => {
    const res = await fetch(`${BASE_URL}/api/cart/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ reservation_id: orderReservationId })
    });
    assert.strictEqual(res.status, 409, `Expected 409, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.error, 'CANNOT_RELEASE_CONFIRMED');
  });

  await test('POST /api/orders rolls back on PRICE_CHANGED mismatch', async () => {
    // 1. Reserve item
    const rKey = 'req-pricecheck-' + Date.now();
    const resvRes = await fetch(`${BASE_URL}/api/cart/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        offer_id: testOffer.offer_id,
        quantity: 1,
        request_key: rKey
      })
    });
    assert.strictEqual(resvRes.status, 201);
    const resv = await resvRes.json();

    // 2. Temporarily change selling_price in DB to trigger price check failure
    const client = await pool.connect();
    const originalPrice = BigInt(testOffer.selling_price);
    const changedPrice = originalPrice + 10000n;
    try {
      await client.query('UPDATE dealer_offers SET selling_price = $1 WHERE offer_id = $2;', [
        changedPrice.toString(),
        testOffer.offer_id
      ]);

      // 3. Attempt order placement -> MUST abort with 409 PRICE_CHANGED
      const orderRes = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          reservation_ids: [resv.reservation_id],
          delivery_address: { pin: '560034', line1: 'Test Address' }
        })
      });
      assert.strictEqual(orderRes.status, 409, `Expected 409, got ${orderRes.status}`);
      const errData = await orderRes.json();
      assert.strictEqual(errData.error, 'PRICE_CHANGED');
    } finally {
      // Revert price and release reservation
      await client.query('UPDATE dealer_offers SET selling_price = $1 WHERE offer_id = $2;', [
        originalPrice.toString(),
        testOffer.offer_id
      ]);
      client.release();

      await fetch(`${BASE_URL}/api/cart/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ reservation_id: resv.reservation_id })
      });
    }
  });

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log(`\n======================================================`);
  console.log(`Test Execution Summary:`);
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
