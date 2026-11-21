// backend/src/tests/comparison-api.test.js
// Phase 1 Test: Comparison Winners via Actual API Endpoint
// Contract: GET /api/products/:id/offers?category= returns winners with reasons from stored fields

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, isApiReachable, isDbReachable, getDbPool, skipIfBlocked } = require('./helpers');

test('Comparison API: All five categories return distinct winners with reasons', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const speakerId = '60000000-0000-0000-0000-000000000001';
  const categories = ['budget', 'fastest', 'rated', 'value', 'available'];
  const winners = [];

  for (const cat of categories) {
    const res = await apiRequest('GET', `/api/products/${speakerId}/offers?category=${cat}`);
    assert.strictEqual(res.status, 200, `Category ${cat} should return 200`);
    assert.ok(res.data.offers && res.data.offers.length > 0, `Category ${cat} should have offers`);
    
    // Winner is first offer (ranked)
    const winner = res.data.offers[0];
    assert.ok(winner.offer_id, `Winner must have offer_id for ${cat}`);
    assert.ok(winner.selling_price, `Winner must have selling_price for ${cat}`);
    assert.ok(winner.reason && winner.reason.length > 10, `Winner must have meaningful reason for ${cat}`);
    assert.ok(!winner.reason.includes('hardcoded'), `Reason must not be hardcoded for ${cat}`);
    assert.ok(!winner.reason.includes('placeholder'), `Reason must not be placeholder for ${cat}`);
    
    winners.push({ category: cat, ...winner });
  }

  // 2. All 5 winners must be distinct offers
  const uniqueOfferIds = new Set(winners.map(w => w.offer_id));
  assert.strictEqual(uniqueOfferIds.size, 5, 'All five category winners must be distinct offers');

  // 3. Verify expected prices (from seed data calibration)
  const budgetWinner = winners.find(w => w.category === 'budget');
  const fastestWinner = winners.find(w => w.category === 'fastest');
  const ratedWinner = winners.find(w => w.category === 'rated');
  const valueWinner = winners.find(w => w.category === 'value');
  const availWinner = winners.find(w => w.category === 'available');

  assert.strictEqual(budgetWinner.selling_price, 69900, 'Budget winner must be Rs.699');
  assert.strictEqual(fastestWinner.selling_price, 77900, 'Fastest delivery winner must be Rs.779');
  assert.strictEqual(ratedWinner.selling_price, 74900, 'Best rated dealer winner must be Rs.749');
  assert.strictEqual(valueWinner.selling_price, 72500, 'Best value winner must be Rs.725');
  assert.strictEqual(availWinner.selling_price, 76900, 'Most available winner must be Rs.769');
});

test('Comparison API: Reason strings derived from stored fields only', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const speakerId = '60000000-0000-0000-0000-000000000001';
  const res = await apiRequest('GET', `/api/products/${speakerId}/offers?category=budget`);
  assert.strictEqual(res.status, 200);

  const winner = res.data.offers[0];
  const reason = winner.reason;

  // Reason must reference actual stored data: price, delivery days, rating, reviews, stock
  assert.ok(
    reason.includes('Rs.') || reason.includes('₹'),
    'Reason must reference price from stored selling_price'
  );
  
  // Reason must not contain fabricated text
  const forbidden = ['hardcoded', 'placeholder', 'mock', 'fake', 'sample reason', 'test reason'];
  for (const word of forbidden) {
    assert.ok(!reason.toLowerCase().includes(word), `Reason must not contain "${word}"`);
  }
});

test('Comparison API: Missing data handled honestly', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Create a product with an offer missing delivery_days
  const testProductId = '60000000-0000-0000-0000-000000000099';
  const testOfferId = '70000000-0000-0000-0000-000000000099';

  await pool.query(`
    INSERT INTO products (product_id, name, category_id)
    VALUES ($1, 'Test Product Missing Data', '50000000-0000-0000-0000-000000000001')
    ON CONFLICT (product_id) DO NOTHING
  `, [testProductId]);

  await pool.query(`
    INSERT INTO dealer_offers (offer_id, product_id, dealer_id, purchase_price, selling_price, status, bangalore_delivery_days)
    VALUES ($1, $2, '40000000-0000-0000-0000-000000000001', 100000, 150000, 'active', NULL)
    ON CONFLICT (offer_id) DO NOTHING
  `, [testOfferId, testProductId]);

  // Add inventory
  await pool.query(`
    INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
    VALUES ($1, '10000000-0000-0000-0000-000000000001', 5, 0)
    ON CONFLICT (offer_id, location_id) DO NOTHING
  `, [testOfferId]);

  const res = await apiRequest('GET', `/api/products/${testProductId}/offers?category=budget`);
  // Should handle missing delivery_days gracefully (either exclude or use transfer_days_max)
  assert.ok([200, 404].includes(res.status), 'Should handle missing data gracefully');

  // Cleanup
  await pool.query(`DELETE FROM inventory WHERE offer_id = $1`, [testOfferId]);
  await pool.query(`DELETE FROM dealer_offers WHERE offer_id = $1`, [testOfferId]);
  await pool.query(`DELETE FROM products WHERE product_id = $1`, [testProductId]);
});